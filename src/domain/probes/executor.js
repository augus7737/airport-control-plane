import net from "node:net";

export function createProbeExecutorDomain(dependencies) {
  const {
    cwdProvider = () => process.cwd(),
    defaultNodeSshUser = "root",
    getNodeById,
    getPreferredLanIpv4,
    nowIso,
    persistNodeStore,
    persistProbeStore,
    persistTaskStore,
    probeSshTimeoutMsValue,
    probeStore,
    probeTcpTimeoutMsValue,
    randomUUID,
    resolveNodeSshTransport,
    samePrivateIpv4Subnet,
    setNodeRecord,
    spawn,
    terminateChildProcess,
    upsertTaskRecord,
  } = dependencies;

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function resolveProbeTarget(node) {
    const publicIpv4 = node?.facts?.public_ipv4 || null;
    const publicIpv6 = node?.facts?.public_ipv6 || null;
    const privateIpv4 = node?.facts?.private_ipv4 || null;
    const mode = node?.networking?.access_mode || "direct";
    const preferredLanIpv4 = getPreferredLanIpv4();
    const relayNode =
      mode === "relay" && node?.networking?.relay_node_id
        ? getNodeById(node.networking.relay_node_id)
        : null;
    const relayPrivateIpv4 = relayNode?.facts?.private_ipv4 || null;
    const relayCanReachTargetPrivately =
      mode === "relay" &&
      privateIpv4 &&
      relayPrivateIpv4 &&
      samePrivateIpv4Subnet(privateIpv4, relayPrivateIpv4);
    const host =
      (mode !== "relay" &&
        privateIpv4 &&
        preferredLanIpv4 &&
        samePrivateIpv4Subnet(privateIpv4, preferredLanIpv4)) ||
      relayCanReachTargetPrivately
        ? privateIpv4
        : publicIpv4 || publicIpv6 || privateIpv4 || null;
    const port = Number(node?.facts?.ssh_port ?? 22) || 22;

    if (!host) {
      return null;
    }

    return {
      host,
      port,
      family: String(host).includes(":") ? "ipv6" : "ipv4",
      mode,
    };
  }

  function tcpProbeTimeoutMs() {
    return Number.isFinite(probeTcpTimeoutMsValue) && probeTcpTimeoutMsValue > 0
      ? probeTcpTimeoutMsValue
      : 4000;
  }

  function sshProbeTimeoutMs() {
    return Number.isFinite(probeSshTimeoutMsValue) && probeSshTimeoutMsValue > 0
      ? probeSshTimeoutMsValue
      : 12000;
  }

  function normalizeTcpProbeError(errorMessage) {
    const raw = String(errorMessage ?? "tcp_error").trim().toLowerCase();
    if (!raw) {
      return "tcp_error";
    }

    if (raw === "econnrefused") return "tcp_connection_refused";
    if (raw === "ehostunreach") return "tcp_host_unreachable";
    if (raw === "enetunreach") return "tcp_network_unreachable";
    if (raw === "econnreset") return "tcp_connection_reset";
    if (raw === "tcp_timeout") return "tcp_timeout";
    return raw;
  }

  function runTcpProbe(target) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const socket = new net.Socket();
      let settled = false;

      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(tcpProbeTimeoutMs());

      socket.once("connect", () => {
        finish({
          success: true,
          latency_ms: Date.now() - startedAt,
          error_message: null,
        });
      });

      socket.once("timeout", () => {
        finish({
          success: false,
          latency_ms: null,
          error_message: normalizeTcpProbeError("tcp_timeout"),
        });
      });

      socket.once("error", (error) => {
        finish({
          success: false,
          latency_ms: null,
          error_message: normalizeTcpProbeError(error?.code || error?.message || "tcp_error"),
        });
      });

      socket.connect({
        host: target.host,
        port: target.port,
        family: target.family === "ipv6" ? 6 : 4,
      });
    });
  }

  function probeLatencyScore(latencyMs) {
    const latency = Number(latencyMs);
    if (!Number.isFinite(latency) || latency < 0) {
      return 82;
    }
    if (latency <= 60) return 96;
    if (latency <= 120) return 90;
    if (latency <= 250) return 82;
    if (latency <= 500) return 72;
    if (latency <= 1000) return 60;
    return 50;
  }

  function compactProbeOutput(text) {
    const raw = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!raw) {
      return null;
    }

    const singleLine = raw.replace(/\s+/g, " ").trim();
    if (!singleLine) {
      return null;
    }

    return singleLine.length > 240 ? `${singleLine.slice(0, 237)}...` : singleLine;
  }

  function classifySshProbeError(output) {
    const text = String(output ?? "").toLowerCase();
    if (!text) {
      return "ssh_probe_failed";
    }
    if (text.includes("permission denied")) return "ssh_permission_denied";
    if (text.includes("connection timed out") || text.includes("operation timed out")) {
      return "ssh_timeout";
    }
    if (text.includes("connection refused")) return "ssh_connection_refused";
    if (text.includes("no route to host")) return "ssh_no_route";
    if (text.includes("could not resolve hostname")) return "ssh_dns_failed";
    if (text.includes("host key verification failed")) return "ssh_host_key_failed";
    if (text.includes("connection closed by remote host")) return "ssh_connection_closed";
    if (text.includes("kex_exchange_identification")) return "ssh_handshake_failed";
    return "ssh_probe_failed";
  }

  function skippedSshProbe(reasonCode, note, transport = null) {
    return {
      attempted: false,
      success: false,
      latency_ms: null,
      exit_code: null,
      signal: null,
      error_message: null,
      skipped_reason: reasonCode,
      skipped_note: note ?? null,
      output_excerpt: null,
      transport_kind: transport?.kind ?? null,
      transport_label: transport?.label ?? null,
    };
  }

  function runSshProbe(transportContext) {
    const marker = "__airport_probe_ok__";
    return new Promise((resolve) => {
      let output = "";
      let settled = false;
      let timedOut = false;
      let timer = null;
      const startedAt = Date.now();
      const child = spawn(
        transportContext.transport.command,
        [...transportContext.transport.args, `printf '${marker}'`],
        {
          cwd: cwdProvider(),
          env: transportContext.transport.env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolve(result);
      };

      const append = (chunk) => {
        output += chunk.toString();
      };

      child.stdout.on("data", append);
      child.stderr.on("data", append);

      child.on("error", (error) => {
        finish({
          attempted: true,
          success: false,
          latency_ms: Date.now() - startedAt,
          exit_code: null,
          signal: null,
          error_message: classifySshProbeError(error?.message),
          skipped_reason: null,
          skipped_note: null,
          output_excerpt: compactProbeOutput(error?.message),
          transport_kind: transportContext.transport.kind,
          transport_label: transportContext.transport.label,
        });
      });

      child.on("close", (code, signal) => {
        const latencyMs = Date.now() - startedAt;
        const success = !timedOut && code === 0 && output.includes(marker);
        finish({
          attempted: true,
          success,
          latency_ms: latencyMs,
          exit_code: code,
          signal,
          error_message: success
            ? null
            : timedOut
              ? "ssh_timeout"
              : classifySshProbeError(output),
          skipped_reason: null,
          skipped_note: null,
          output_excerpt: compactProbeOutput(output.replace(marker, " ")),
          transport_kind: transportContext.transport.kind,
          transport_label: transportContext.transport.label,
        });
      });

      timer = setTimeout(() => {
        timedOut = true;
        output += "\nssh probe timeout\n";
        terminateChildProcess(child);
      }, sshProbeTimeoutMs());
      timer.unref?.();
    });
  }

  function probeReasonCode(target, tcpProbe, sshProbe) {
    if (!tcpProbe?.success) {
      return normalizeTcpProbeError(tcpProbe?.error_message);
    }

    if (!sshProbe) {
      return "tcp_only_success";
    }

    if (sshProbe.attempted) {
      return sshProbe.success ? "ssh_control_ready" : sshProbe.error_message || "ssh_probe_failed";
    }

    return sshProbe.skipped_reason || "tcp_only_success";
  }

  function probeHealthScore(probe) {
    const mode = probe?.mode === "relay" ? "relay" : "direct";
    const tcp = probe?.tcp;
    const ssh = probe?.ssh;

    if (!tcp?.success) {
      return mode === "relay" ? 45 : 20;
    }

    const baseScore = probeLatencyScore(tcp.latency_ms);
    if (!ssh) {
      return baseScore;
    }

    if (!ssh.attempted) {
      return baseScore;
    }

    if (ssh.success) {
      return Math.min(100, baseScore + 4);
    }

    if (ssh.error_message === "ssh_timeout") {
      return mode === "relay" ? 50 : 34;
    }

    if (ssh.error_message === "ssh_permission_denied") {
      return mode === "relay" ? 52 : 40;
    }

    return mode === "relay" ? 50 : 36;
  }

  function probeStatusFromScore(node, probe, score) {
    const currentStatus = String(node?.status || "new").toLowerCase();
    if (currentStatus === "disabled" || currentStatus === "retired") {
      return node.status;
    }

    if (!probe?.tcp?.success) {
      return probe?.mode === "relay" ? "degraded" : "failed";
    }

    if (probe?.ssh?.attempted && !probe?.ssh?.success) {
      return "degraded";
    }

    if (score >= 80) {
      return "active";
    }

    return "degraded";
  }

  function probeSummary(node, probe, score) {
    const targetLabel = `${probe.host}:${probe.port}`;
    const tcp = probe.tcp;
    const ssh = probe.ssh;
    const transportLabel = ssh?.transport_label || probe.transport_label || "SSH";
    const reasonCode = probe.reason_code || probeReasonCode(probe, tcp, ssh);

    if (!tcp?.success) {
      if (probe.mode === "relay") {
        return `TCP 探测未连通 ${targetLabel}，当前节点标记为经中转，已先按降级处理。`;
      }
      return `TCP 探测未连通 ${targetLabel}，节点已按异常处理。`;
    }

    if (ssh?.attempted && ssh.success) {
      return `${transportLabel} 探测成功，平台已经可以接管该节点，端到端耗时 ${ssh.latency_ms}ms。`;
    }

    if (ssh?.attempted && !ssh.success) {
      if (reasonCode === "ssh_permission_denied") {
        return `TCP 已连通，但 SSH 公钥认证失败，平台暂时无法接管 ${targetLabel}。`;
      }
      if (reasonCode === "ssh_timeout") {
        return `TCP 已连通，但 SSH 握手超时，平台暂时无法完成对 ${targetLabel} 的接管验证。`;
      }
      return `TCP 已连通，但 SSH 接管验证失败，平台暂时无法直接接管 ${targetLabel}。`;
    }

    if (reasonCode === "platform_ssh_key_missing") {
      return `TCP 已连通，但平台尚未配置 SSH 私钥，当前只能确认 ${targetLabel} 端口可达。`;
    }

    if (reasonCode === "platform_ssh_key_invalid") {
      return `TCP 已连通，但平台 SSH 私钥文件不可用，当前只能确认 ${targetLabel} 端口可达。`;
    }

    if (score >= 80) {
      return `TCP 探测成功，${targetLabel} 延迟 ${tcp?.latency_ms}ms，节点保持可用。`;
    }

    return `TCP 探测成功，但 ${targetLabel} 延迟 ${tcp?.latency_ms}ms，节点按降级处理。`;
  }

  function buildProbeRecord(node, task, probe) {
    const tcp = probe.tcp ?? null;
    const ssh = probe.ssh ?? null;
    const reasonCode = probe.reason_code ?? probeReasonCode(probe, tcp, ssh);
    const summary = probe.summary ?? probeSummary(node, {
      ...probe,
      tcp,
      ssh,
      reason_code: reasonCode,
    }, probe.health_score);
    const latencyMs = ssh?.attempted && Number.isFinite(ssh?.latency_ms)
      ? ssh.latency_ms
      : tcp?.latency_ms ?? null;

    return {
      id: `probe_${randomUUID()}`,
      node_id: node.id,
      task_id: task.id,
      probe_type: ssh?.attempted ? "ssh_auth" : "tcp_ssh",
      target: `${probe.host}:${probe.port}`,
      target_host: probe.host,
      target_port: probe.port,
      access_mode: probe.mode,
      transport_kind: ssh?.transport_kind ?? null,
      transport_label: ssh?.transport_label ?? null,
      relay_node_id: node.networking?.relay_node_id ?? null,
      relay_target: probe.relay_target ?? null,
      ssh_user: defaultNodeSshUser,
      auth_method: "publickey",
      latency_ms: latencyMs,
      packet_loss_ratio: null,
      success: tcp?.success && (!ssh?.attempted || ssh.success),
      control_ready: Boolean(ssh?.attempted && ssh.success),
      reason_code: reasonCode,
      summary,
      exit_code: ssh?.attempted ? ssh.exit_code ?? null : null,
      error_stage:
        !tcp?.success
          ? "tcp_connect"
          : ssh?.attempted && !ssh.success
            ? reasonCode === "ssh_timeout"
              ? "timeout"
              : reasonCode === "ssh_permission_denied"
                ? "ssh_auth"
                : "ssh_handshake"
            : null,
      error_message:
        !tcp?.success
          ? tcp?.error_message ?? null
          : ssh?.attempted && !ssh.success
            ? ssh.error_message ?? null
            : null,
      stderr_excerpt: ssh?.attempted ? ssh.output_excerpt ?? null : null,
      stages: {
        tcp: {
          success: Boolean(tcp?.success),
          latency_ms: tcp?.latency_ms ?? null,
          error_message: tcp?.error_message ?? null,
        },
        ssh: ssh
          ? {
              attempted: Boolean(ssh.attempted),
              success: Boolean(ssh.success),
              latency_ms: ssh.latency_ms ?? null,
              exit_code: ssh.exit_code ?? null,
              error_message: ssh.error_message ?? null,
              skipped_reason: ssh.skipped_reason ?? null,
              skipped_note: ssh.skipped_note ?? null,
              transport_kind: ssh.transport_kind ?? null,
              transport_label: ssh.transport_label ?? null,
              output_excerpt: ssh.output_excerpt ?? null,
            }
          : null,
      },
      observed_at: nowIso(),
    };
  }

  function trimProbeStore() {
    if (probeStore.length > 500) {
      probeStore.length = 500;
    }
  }

  async function executeProbeTask(task, options = {}) {
    const node = getNodeById(task.node_id);
    if (!node) {
      task.status = "failed";
      task.finished_at = nowIso();
      task.note = "节点不存在，无法继续执行健康探测。";
      task.log_excerpt = [task.note];
      upsertTaskRecord(task);
      await persistTaskStore();
      return {
        task,
        node: null,
        probe: null,
      };
    }

    const target = resolveProbeTarget(node);
    if (!target) {
      task.status = "failed";
      task.finished_at = nowIso();
      task.note = "节点缺少可探测的地址，当前无法发起 TCP 健康探测。";
      task.log_excerpt = [task.note];
      upsertTaskRecord(task);

      const updatedNode = {
        ...node,
        status: String(node.status || "").toLowerCase() === "active" ? "degraded" : node.status,
        health_score: 0,
        last_probe_at: nowIso(),
      };
      setNodeRecord(updatedNode);

      await Promise.all([persistTaskStore(), persistNodeStore()]);
      return {
        task,
        node: updatedNode,
        probe: null,
      };
    }

    const requestedProbeType = String(task.payload?.probe_type || "ssh_auth").toLowerCase();
    task.status = "running";
    task.started_at = nowIso();
    task.finished_at = null;
    task.attempt = Number(task.attempt ?? 0) + 1;
    task.note = options.note ?? `控制面正在探测 ${target.host}:${target.port} 的连通性与 SSH 接管能力。`;
    upsertTaskRecord(task);
    await persistTaskStore();

    const tcpProbe = await runTcpProbe(target);
    let sshProbe = skippedSshProbe("tcp_unreachable", "TCP 未连通，已跳过 SSH 探测。");
    let sshContext = null;

    if (tcpProbe.success) {
      if (requestedProbeType === "tcp_ssh") {
        sshProbe = skippedSshProbe("tcp_only_requested", "当前任务仅要求执行 TCP 探测。");
      } else {
        sshContext = await resolveNodeSshTransport(node, {
          allowDemoFallback: false,
        });
        if (sshContext.status === "ready") {
          sshProbe = await runSshProbe(sshContext);
        } else {
          sshProbe = skippedSshProbe(
            sshContext.reason_code,
            sshContext.note,
            sshContext.transport,
          );
        }
      }
    }

    const probeMeta = {
      ...target,
      tcp: tcpProbe,
      ssh: sshProbe,
    };
    const healthScore = probeHealthScore(probeMeta);
    const reasonCode = probeReasonCode(target, tcpProbe, sshProbe);
    const summary = probeSummary(node, {
      ...probeMeta,
      reason_code: reasonCode,
    }, healthScore);
    const probe = buildProbeRecord(node, task, {
      ...probeMeta,
      relay_target:
        sshProbe?.attempted || sshProbe?.transport_kind
          ? sshContext?.relay_target ?? null
          : null,
      health_score: healthScore,
      reason_code: reasonCode,
      summary,
    });
    probeStore.unshift(probe);
    trimProbeStore();

    const nextStatus = probeStatusFromScore(node, {
      ...probeMeta,
    }, healthScore);
    const observedAt = probe.observed_at;

    const updatedNode = {
      ...node,
      status: nextStatus,
      health_score: healthScore,
      last_probe_at: observedAt,
    };
    setNodeRecord(updatedNode);

    task.status = probe.success ? "success" : "failed";
    task.finished_at = nowIso();
    task.note = summary;
    task.log_excerpt = [
      `目标 ${probe.target}`,
      tcpProbe.success
        ? `TCP 可达，延迟 ${tcpProbe.latency_ms}ms`
        : `TCP 失败，错误 ${probe.error_message || "unknown"}`,
      tcpProbe.success
        ? sshProbe.attempted
          ? sshProbe.success
            ? `SSH 接管验证成功，耗时 ${sshProbe.latency_ms}ms`
            : `SSH 接管验证失败，原因 ${sshProbe.error_message || "unknown"}`
          : `SSH 未执行，原因 ${sshProbe.skipped_reason || "not_requested"}`
        : "已跳过 SSH 接管验证",
      `健康分 ${healthScore}，节点状态 ${nextStatus}`,
    ];
    upsertTaskRecord(task);

    await Promise.all([persistProbeStore(), persistTaskStore(), persistNodeStore()]);

    return {
      task,
      node: updatedNode,
      probe,
      transport:
        probe.transport_kind || probe.transport_label
          ? {
              kind: probe.transport_kind,
              label: probe.transport_label,
              note:
                sshProbe?.attempted || sshProbe?.skipped_note
                  ? sshProbe?.skipped_note || summary
                  : summary,
            }
          : null,
      capability: {
        tcp_reachable: Boolean(tcpProbe.success),
        ssh_reachable: Boolean(sshProbe?.attempted && sshProbe.success),
        relay_used: probe.transport_kind === "ssh-relay" || target.mode === "relay",
      },
    };
  }

  return {
    buildProbeRecord,
    executeProbeTask,
    resolveProbeTarget,
    sleep,
    sshProbeTimeoutMs,
  };
}
