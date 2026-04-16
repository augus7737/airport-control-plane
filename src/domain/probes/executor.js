import net from "node:net";

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function inferFamily(host, fallback = "ipv4") {
  const normalized = normalizeString(host);
  if (!normalized) {
    return fallback;
  }

  return normalized.includes(":") ? "ipv6" : "ipv4";
}

function formatEndpoint(target) {
  if (!target?.host || !target?.port) {
    return "-";
  }

  return target.family === "ipv6" ? `[${target.host}]:${target.port}` : `${target.host}:${target.port}`;
}

function buildSkippedStage(reasonCode, note, extra = {}) {
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
    transport_kind: extra.transport_kind ?? null,
    transport_label: extra.transport_label ?? null,
    transport_note: extra.transport_note ?? null,
    target_host: extra.target_host ?? null,
    target_port: extra.target_port ?? null,
    target_family: extra.target_family ?? null,
    source: extra.source ?? null,
  };
}

function buildTcpStage(result, target, extra = {}) {
  return {
    attempted: true,
    success: Boolean(result?.success),
    latency_ms: result?.latency_ms ?? null,
    exit_code: null,
    signal: null,
    error_message: result?.error_message ?? null,
    skipped_reason: null,
    skipped_note: null,
    output_excerpt: null,
    transport_kind: extra.transport_kind ?? null,
    transport_label: extra.transport_label ?? null,
    transport_note: extra.transport_note ?? null,
    target_host: target?.host ?? null,
    target_port: target?.port ?? null,
    target_family: target?.family ?? null,
    source: target?.source ?? null,
  };
}

function toCapabilityFlag(value) {
  if (value === true) {
    return true;
  }

  if (value === false) {
    return false;
  }

  return null;
}

export function createProbeExecutorDomain(dependencies) {
  const {
    cwdProvider = () => process.cwd(),
    defaultNodeSshUser = "root",
    getNodeById,
    nowIso,
    persistNodeStore,
    persistProbeStore,
    persistTaskStore,
    probeSshTimeoutMsValue,
    probeStore,
    probeTcpTimeoutMsValue,
    randomUUID,
    resolveBusinessProbeContext = () => null,
    resolveManagementRoute,
    resolveNodeSshTransport,
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

  function resolveManagementProbeTarget(node, options = {}) {
    const route = resolveManagementRoute(node, options);
    if (!route?.target?.host) {
      return null;
    }

    return {
      host: route.target.host,
      port: route.target.port,
      family: route.target.family,
      mode: route.access_mode,
      requested_mode: route.requested_access_mode,
      relay_node_id: route.relay_node?.id ?? route.config?.relay_node_id ?? null,
      relay_target: route.relay_target ?? null,
      route_label: route.route_label ?? null,
      ssh_user: route.ssh_user ?? defaultNodeSshUser,
      problems: route.problems ?? [],
      source: route.target.source ?? null,
    };
  }

  function resolveProbeTarget(node, options = {}) {
    return resolveManagementProbeTarget(node, options);
  }

  function resolveBusinessProbeTarget(node, options = {}) {
    const context = resolveBusinessProbeContext(node, options);
    if (!context?.entry_target?.host) {
      return null;
    }

    return {
      host: context.entry_target.host,
      port: context.entry_target.port,
      family: context.entry_target.family ?? inferFamily(context.entry_target.host, "ipv4"),
      access_mode: context.access_mode ?? "direct",
      route_label: context.route_label ?? null,
      entry_node_id: context.entry_node_id ?? null,
      release_id: context.release_id ?? null,
      source: context.entry_target.source ?? null,
      problems: context.problems ?? [],
    };
  }

  function resolveRelayUpstreamTarget(node, options = {}) {
    const context = resolveBusinessProbeContext(node, options);
    if (!context?.relay_upstream_target?.host) {
      return null;
    }

    return {
      host: context.relay_upstream_target.host,
      port: context.relay_upstream_target.port,
      family:
        context.relay_upstream_target.family ??
        inferFamily(context.relay_upstream_target.host, "ipv4"),
      access_mode: context.access_mode ?? "relay",
      route_label: context.route_label ?? null,
      entry_node_id: context.entry_node_id ?? null,
      release_id: context.release_id ?? null,
      source: context.relay_upstream_target.source ?? null,
      problems: context.problems ?? [],
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
    if (raw.includes("connection refused")) return "tcp_connection_refused";
    if (raw.includes("host unreachable")) return "tcp_host_unreachable";
    if (raw.includes("network unreachable")) return "tcp_network_unreachable";
    if (raw.includes("timed out")) return "tcp_timeout";
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

  function classifyRemoteTcpProbeError(output, timedOut = false, exitCode = null) {
    if (timedOut) {
      return "relay_upstream_timeout";
    }

    if (exitCode === 127) {
      return "relay_probe_tool_missing";
    }

    const normalized = normalizeTcpProbeError(output);
    if (
      [
        "tcp_connection_refused",
        "tcp_host_unreachable",
        "tcp_network_unreachable",
        "tcp_connection_reset",
        "tcp_timeout",
      ].includes(normalized)
    ) {
      return normalized;
    }

    return "relay_upstream_probe_failed";
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
          transport_note: transportContext.transport.note,
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
          transport_note: transportContext.transport.note,
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

  function executeRemoteShellProbe(transport, scriptBody, args = []) {
    return new Promise((resolve) => {
      let output = "";
      let settled = false;
      let timedOut = false;
      let timer = null;
      const child = spawn(
        transport.command,
        [...transport.args, "sh", "-s", "--", ...args.map((item) => String(item))],
        {
          cwd: cwdProvider(),
          env: transport.env,
          stdio: ["pipe", "pipe", "pipe"],
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
      child.stdin.on("error", () => {});

      child.on("error", (error) => {
        finish({
          output: `${output}\n${error.message}\n`,
          exit_code: null,
          signal: null,
          timed_out: false,
        });
      });

      child.on("close", (code, signal) => {
        finish({
          output,
          exit_code: timedOut ? 124 : code,
          signal,
          timed_out: timedOut,
        });
      });

      child.stdin.write(scriptBody);
      child.stdin.end();

      timer = setTimeout(() => {
        timedOut = true;
        output += "\nremote tcp probe timeout\n";
        terminateChildProcess(child);
      }, sshProbeTimeoutMs());
      timer.unref?.();
    });
  }

  async function runRelayUpstreamProbe(entryNode, upstreamTarget) {
    const sshContext = await resolveNodeSshTransport(entryNode, {
      allowDemoFallback: false,
    });

    if (sshContext.status !== "ready") {
      return {
        attempted: false,
        success: false,
        latency_ms: null,
        exit_code: null,
        signal: null,
        error_message: null,
        skipped_reason: sshContext.reason_code || "relay_transport_unavailable",
        skipped_note: sshContext.note ?? null,
        output_excerpt: null,
        transport_kind: sshContext.transport?.kind ?? null,
        transport_label: sshContext.transport?.label ?? null,
        transport_note: sshContext.transport?.note ?? null,
        target_host: upstreamTarget?.host ?? null,
        target_port: upstreamTarget?.port ?? null,
        target_family: upstreamTarget?.family ?? null,
      };
    }

    const startedAt = Date.now();
    const timeoutSeconds = Math.max(3, Math.min(15, Math.ceil(tcpProbeTimeoutMs() / 1000)));
    const scriptBody = `#!/bin/sh
set -eu
HOST="$1"
PORT="$2"
TIMEOUT="$3"

if command -v nc >/dev/null 2>&1; then
  nc -z -w "$TIMEOUT" "$HOST" "$PORT"
  exit $?
fi

if command -v busybox >/dev/null 2>&1; then
  busybox nc -z -w "$TIMEOUT" "$HOST" "$PORT"
  exit $?
fi

echo "nc missing" >&2
exit 127
`;
    const execution = await executeRemoteShellProbe(sshContext.transport, scriptBody, [
      upstreamTarget.host,
      String(upstreamTarget.port),
      String(timeoutSeconds),
    ]);
    const latencyMs = Date.now() - startedAt;
    const success = !execution.timed_out && execution.exit_code === 0;

    return {
      attempted: true,
      success,
      latency_ms: latencyMs,
      exit_code: execution.exit_code,
      signal: execution.signal,
      error_message: success
        ? null
        : classifyRemoteTcpProbeError(
            execution.output,
            execution.timed_out,
            execution.exit_code,
          ),
      skipped_reason: null,
      skipped_note: null,
      output_excerpt: compactProbeOutput(execution.output),
      transport_kind: sshContext.transport.kind,
      transport_label: sshContext.transport.label,
      transport_note: sshContext.transport.note,
      target_host: upstreamTarget.host,
      target_port: upstreamTarget.port,
      target_family: upstreamTarget.family,
    };
  }

  function managementReasonCode(tcpProbe, sshProbe) {
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

  async function performManagementProbe(node, options = {}) {
    const managementRoute = resolveManagementRoute(node, options);
    const target = resolveManagementProbeTarget(node, options);

    if (!target) {
      const note =
        managementRoute?.problems?.length > 0
          ? `节点缺少可探测的管理地址（${managementRoute.problems.join(", ")}）。`
          : "节点缺少可探测的管理地址。";
      const skippedTcp = buildSkippedStage("probe_target_missing", note);
      const skippedSsh = buildSkippedStage("probe_target_missing", note);
      return {
        route: managementRoute,
        target: null,
        tcp: skippedTcp,
        ssh: skippedSsh,
        success: false,
        control_ready: false,
        reason_code: "probe_target_missing",
        relay_node_id: null,
        relay_target: null,
      };
    }

    const tcpProbe = runTcpProbe(target);
    let sshProbe = buildSkippedStage("tcp_unreachable", "管理 TCP 未连通，已跳过 SSH 探测。");
    let sshContext = null;

    const tcpResult = await tcpProbe;
    if (tcpResult.success) {
      sshContext = await resolveNodeSshTransport(node, {
        allowDemoFallback: false,
      });
      if (sshContext.status === "ready") {
        sshProbe = await runSshProbe(sshContext);
      } else {
        sshProbe = buildSkippedStage(sshContext.reason_code, sshContext.note, {
          transport_kind: sshContext.transport?.kind ?? null,
          transport_label: sshContext.transport?.label ?? null,
          transport_note: sshContext.transport?.note ?? null,
        });
      }
    }

    const reasonCode = managementReasonCode(tcpResult, sshProbe);
    return {
      route: managementRoute,
      target,
      tcp: buildTcpStage(tcpResult, target),
      ssh: sshProbe,
      success: Boolean(tcpResult.success && sshProbe.attempted && sshProbe.success),
      control_ready: Boolean(sshProbe.attempted && sshProbe.success),
      reason_code: reasonCode,
      relay_node_id: target.relay_node_id ?? null,
      relay_target:
        sshProbe?.attempted || sshProbe?.transport_kind
          ? sshContext?.relay_target ?? target.relay_target ?? null
          : target.relay_target ?? null,
    };
  }

  async function performBusinessEntryProbe(node, options = {}, settings = {}) {
    const context = resolveBusinessProbeContext(node, options);
    const target = resolveBusinessProbeTarget(node, options);
    const allowSkippedSuccess = settings.allowSkippedSuccess === true;

    if (!context?.published || !target) {
      const reasonCode =
        context?.problems?.includes("business_route_unpublished")
          ? "business_route_unpublished"
          : context?.problems?.includes("entry_endpoint_missing")
            ? "business_entry_target_missing"
            : context?.problems?.includes("entry_port_missing")
              ? "business_entry_port_missing"
              : "business_entry_target_missing";
      const note =
        reasonCode === "business_route_unpublished"
          ? "当前节点还没有成功发布的业务线路，已跳过业务入口探测。"
          : "当前业务线路缺少可探测的入口地址或端口。";
      return {
        context,
        target: null,
        tcp: buildSkippedStage(reasonCode, note),
        success: allowSkippedSuccess,
        applicable: false,
        reason_code: reasonCode,
      };
    }

    const tcpResult = await runTcpProbe(target);
    return {
      context,
      target,
      tcp: buildTcpStage(tcpResult, target),
      success: Boolean(tcpResult.success),
      applicable: true,
      reason_code: tcpResult.success ? "business_entry_ready" : normalizeTcpProbeError(tcpResult.error_message),
    };
  }

  async function performRelayUpstreamCheck(node, options = {}, settings = {}) {
    const context = resolveBusinessProbeContext(node, options);
    const target = resolveRelayUpstreamTarget(node, options);
    const allowSkippedSuccess = settings.allowSkippedSuccess === true;

    if (!context?.published) {
      return {
        context,
        target: null,
        stage: buildSkippedStage(
          "business_route_unpublished",
          "当前节点还没有成功发布的业务线路，已跳过入口上游探测。",
        ),
        success: allowSkippedSuccess,
        applicable: false,
        reason_code: "business_route_unpublished",
      };
    }

    if (String(context?.access_mode || "direct") !== "relay") {
      return {
        context,
        target: null,
        stage: buildSkippedStage(
          "relay_not_applicable",
          "当前线路为直连模式，无需执行入口到落地上游探测。",
        ),
        success: allowSkippedSuccess,
        applicable: false,
        reason_code: "relay_not_applicable",
      };
    }

    if (!context?.entry_node || !target) {
      return {
        context,
        target: null,
        stage: buildSkippedStage(
          "relay_upstream_missing",
          "当前 relay 线路缺少入口节点或上游地址，无法继续验证入口到落地链路。",
        ),
        success: false,
        applicable: true,
        reason_code: "relay_upstream_missing",
      };
    }

    const stage = await runRelayUpstreamProbe(context.entry_node, target);
    return {
      context,
      target,
      stage,
      success: Boolean(stage.attempted && stage.success),
      applicable: true,
      reason_code:
        stage.attempted && stage.success
          ? "relay_upstream_ready"
          : stage.error_message || stage.skipped_reason || "relay_upstream_probe_failed",
    };
  }

  function managementScore(result) {
    if (result.control_ready) {
      return Math.min(100, probeLatencyScore(result.ssh?.latency_ms) + 4);
    }

    if (result.tcp?.success) {
      if (result.reason_code === "platform_ssh_key_missing") {
        return 62;
      }
      if (result.reason_code === "platform_ssh_key_invalid") {
        return 56;
      }
      if (result.reason_code === "ssh_permission_denied") {
        return 44;
      }
      return 36;
    }

    return result.target?.mode === "relay" ? 30 : 16;
  }

  function businessEntryScore(result) {
    if (!result.applicable) {
      return null;
    }

    if (result.success) {
      return probeLatencyScore(result.tcp?.latency_ms);
    }

    return 12;
  }

  function relayUpstreamScore(result) {
    if (!result.applicable) {
      return null;
    }

    if (!result.success) {
      return 10;
    }

    return result.target?.family === "ipv6" ? 92 : 84;
  }

  function combineScores(parts = []) {
    const applicableParts = parts.filter((part) => part && Number.isFinite(part.score) && part.weight > 0);
    if (applicableParts.length === 0) {
      return 0;
    }

    const totalWeight = applicableParts.reduce((sum, part) => sum + part.weight, 0);
    const weighted = applicableParts.reduce((sum, part) => sum + part.score * part.weight, 0);
    return Math.max(0, Math.min(100, Math.round(weighted / totalWeight)));
  }

  function buildManagementSummary(result) {
    const targetLabel = formatEndpoint(result.target);
    if (!result.target) {
      return result.tcp?.skipped_note || "节点缺少管理地址。";
    }

    if (!result.tcp?.success) {
      if (result.target.mode === "relay") {
        return `管理链路 TCP 未连通 ${targetLabel}，当前节点需要经 SSH 中转接入。`;
      }
      return `管理链路 TCP 未连通 ${targetLabel}。`;
    }

    if (result.ssh?.attempted && result.ssh.success) {
      return `${result.ssh.transport_label || "SSH"} 接管验证成功，${targetLabel} 端到端耗时 ${result.ssh.latency_ms}ms。`;
    }

    if (result.ssh?.attempted && !result.ssh.success) {
      return `管理链路 TCP 已通，但 SSH 接管验证失败：${result.ssh.error_message || "unknown"}。`;
    }

    return result.ssh?.skipped_note || `管理链路 TCP 已通，当前仅确认 ${targetLabel} 可达。`;
  }

  function buildBusinessSummary(result) {
    const targetLabel = formatEndpoint(result.target);
    if (!result.applicable) {
      return result.tcp?.skipped_note || "当前未配置业务入口探测。";
    }

    if (result.success) {
      return `业务入口 ${targetLabel} 可达，控制面探测延迟 ${result.tcp?.latency_ms}ms。`;
    }

    if (!result.target) {
      return result.tcp?.skipped_note || "业务入口缺少地址或端口。";
    }

    return `业务入口 ${targetLabel} 不可达，原因 ${result.reason_code || result.tcp?.error_message || "unknown"}。`;
  }

  function buildRelaySummary(result) {
    const targetLabel = formatEndpoint(result.target);
    const entryNodeName =
      result.context?.entry_node?.name ??
      result.context?.entry_node?.facts?.hostname ??
      result.context?.entry_node_id ??
      "入口节点";

    if (!result.applicable) {
      return result.stage?.skipped_note || "当前无需执行 relay 上游探测。";
    }

    if (result.success) {
      return `已通过入口节点 ${entryNodeName} 验证上游 ${targetLabel} 可达（${String(
        result.target?.family || "ipv4",
      ).toUpperCase()}）。`;
    }

    if (!result.target) {
      return result.stage?.skipped_note || "relay 上游探测缺少目标。";
    }

    if (result.stage?.attempted) {
      return `入口节点 ${entryNodeName} 无法连通上游 ${targetLabel}，原因 ${
        result.stage.error_message || "unknown"
      }。`;
    }

    return result.stage?.skipped_note || `入口节点 ${entryNodeName} 当前无法执行上游探测。`;
  }

  function buildFullStackSummary(management, business, relay) {
    const parts = [buildManagementSummary(management)];
    if (business.applicable || business.reason_code === "business_route_unpublished") {
      parts.push(buildBusinessSummary(business));
    }
    if (relay.applicable || relay.reason_code === "relay_not_applicable") {
      parts.push(buildRelaySummary(relay));
    }
    return parts.filter(Boolean).join(" ");
  }

  function buildCompositeProbe(node, task, outcomes) {
    const { management, business, relay } = outcomes;
    const businessFailure = business.applicable && !business.success;
    const relayFailure = relay.applicable && !relay.success;
    const managementFailure = !management.control_ready;
    const overallStatus = businessFailure || relayFailure
      ? "failed"
      : managementFailure
        ? "degraded"
        : "active";
    const success = overallStatus === "active";
    const reasonCode = businessFailure
      ? business.reason_code
      : relayFailure
        ? relay.reason_code
        : managementFailure
          ? management.reason_code
          : business.applicable
            ? "business_route_ready"
            : "management_only_ready";
    const target = business.target ?? management.target ?? relay.target ?? null;
    const healthScore = combineScores([
      { score: managementScore(management), weight: 35 },
      { score: businessEntryScore(business), weight: business.applicable ? 40 : 0 },
      { score: relayUpstreamScore(relay), weight: relay.applicable ? 25 : 0 },
    ]);
    const summary = buildFullStackSummary(management, business, relay);
    const failedStage = businessFailure
      ? "business_entry_tcp"
      : relayFailure
        ? "relay_upstream_tcp"
        : managementFailure
          ? management.tcp?.success
            ? "ssh_auth"
            : "management_tcp"
          : null;
    const errorMessage = businessFailure
      ? business.reason_code
      : relayFailure
        ? relay.stage?.error_message || relay.reason_code
        : managementFailure
          ? management.ssh?.error_message || management.reason_code
          : null;
    const stderrExcerpt = businessFailure
      ? business.tcp?.output_excerpt ?? null
      : relayFailure
        ? relay.stage?.output_excerpt ?? null
        : managementFailure
          ? management.ssh?.output_excerpt ?? null
          : null;

    return {
      nodeStatus: overallStatus,
      healthScore,
      probe: {
        id: `probe_${randomUUID()}`,
        node_id: node.id,
        task_id: task.id,
        probe_type: "full_stack",
        target: formatEndpoint(target),
        target_host: target?.host ?? null,
        target_port: target?.port ?? null,
        access_mode: business.context?.access_mode ?? management.target?.mode ?? "direct",
        business_access_mode: business.context?.access_mode ?? null,
        management_access_mode: management.target?.mode ?? "direct",
        requested_management_access_mode: management.target?.requested_mode ?? management.target?.mode ?? "direct",
        transport_kind:
          management.ssh?.transport_kind ??
          relay.stage?.transport_kind ??
          null,
        transport_label:
          management.ssh?.transport_label ??
          relay.stage?.transport_label ??
          null,
        relay_node_id: management.relay_node_id ?? null,
        relay_target: management.relay_target ?? null,
        entry_node_id: business.context?.entry_node_id ?? relay.context?.entry_node_id ?? null,
        entry_node_name:
          business.context?.entry_node?.name ??
          business.context?.entry_node?.facts?.hostname ??
          relay.context?.entry_node?.name ??
          relay.context?.entry_node?.facts?.hostname ??
          null,
        route_label: business.context?.route_label ?? relay.context?.route_label ?? null,
        upstream_host: relay.target?.host ?? null,
        upstream_port: relay.target?.port ?? null,
        upstream_family: relay.target?.family ?? null,
        release_id: business.context?.release_id ?? relay.context?.release_id ?? null,
        ssh_user: management.target?.ssh_user ?? defaultNodeSshUser,
        auth_method: "publickey",
        latency_ms:
          business.tcp?.latency_ms ??
          relay.stage?.latency_ms ??
          management.ssh?.latency_ms ??
          management.tcp?.latency_ms ??
          null,
        packet_loss_ratio: null,
        success,
        control_ready: Boolean(management.control_ready),
        business_ready: business.applicable ? Boolean(business.success) : null,
        relay_upstream_ready: relay.applicable ? Boolean(relay.success) : null,
        health_score: healthScore,
        reason_code: reasonCode,
        summary,
        exit_code: management.ssh?.attempted ? management.ssh.exit_code ?? null : relay.stage?.exit_code ?? null,
        error_stage: failedStage,
        error_message: errorMessage,
        stderr_excerpt: stderrExcerpt,
        stages: {
          tcp: management.tcp,
          ssh: management.ssh,
          management_tcp: management.tcp,
          business_entry_tcp: business.tcp,
          relay_upstream_tcp: relay.stage,
        },
        observed_at: nowIso(),
      },
    };
  }

  function buildStandaloneProbe(node, task, probeType, outcome) {
    let nodeStatus = "active";
    let healthScore = 100;
    let target = null;
    let summary = "";
    let success = false;
    let reasonCode = outcome.reason_code;
    let errorStage = null;
    let errorMessage = null;
    let stderrExcerpt = null;
    let latencyMs = null;
    let controlReady = false;
    let businessReady = null;
    let relayUpstreamReady = null;
    let transportKind = null;
    let transportLabel = null;
    let stages = {};

    if (probeType === "ssh_auth") {
      target = outcome.target;
      success = outcome.success;
      controlReady = outcome.control_ready;
      summary = buildManagementSummary(outcome);
      healthScore = managementScore(outcome);
      nodeStatus = outcome.control_ready ? "active" : outcome.tcp?.success ? "degraded" : "failed";
      errorStage = !success ? (outcome.tcp?.success ? "ssh_auth" : "management_tcp") : null;
      errorMessage = !success
        ? outcome.ssh?.error_message || outcome.reason_code || outcome.tcp?.error_message
        : null;
      stderrExcerpt = outcome.ssh?.output_excerpt ?? null;
      latencyMs = outcome.ssh?.latency_ms ?? outcome.tcp?.latency_ms ?? null;
      transportKind = outcome.ssh?.transport_kind ?? null;
      transportLabel = outcome.ssh?.transport_label ?? null;
      stages = {
        tcp: outcome.tcp,
        ssh: outcome.ssh,
        management_tcp: outcome.tcp,
      };
    } else if (probeType === "business_entry_tcp") {
      target = outcome.target;
      success = outcome.success;
      businessReady = outcome.applicable ? Boolean(outcome.success) : null;
      summary = buildBusinessSummary(outcome);
      healthScore = businessEntryScore(outcome) ?? 78;
      nodeStatus = outcome.success ? "active" : "failed";
      errorStage = !success ? "business_entry_tcp" : null;
      errorMessage = !success ? outcome.reason_code || outcome.tcp?.error_message : null;
      latencyMs = outcome.tcp?.latency_ms ?? null;
      stages = {
        tcp: outcome.tcp,
        business_entry_tcp: outcome.tcp,
      };
    } else {
      target = outcome.target;
      success = outcome.success;
      relayUpstreamReady = outcome.applicable ? Boolean(outcome.success) : null;
      summary = buildRelaySummary(outcome);
      healthScore = relayUpstreamScore(outcome) ?? 74;
      nodeStatus = outcome.success ? "active" : "failed";
      errorStage = !success ? "relay_upstream_tcp" : null;
      errorMessage = !success ? outcome.stage?.error_message || outcome.reason_code : null;
      stderrExcerpt = outcome.stage?.output_excerpt ?? null;
      latencyMs = outcome.stage?.latency_ms ?? null;
      transportKind = outcome.stage?.transport_kind ?? null;
      transportLabel = outcome.stage?.transport_label ?? null;
      stages = {
        relay_upstream_tcp: outcome.stage,
      };
    }

    return {
      nodeStatus,
      healthScore,
      probe: {
        id: `probe_${randomUUID()}`,
        node_id: node.id,
        task_id: task.id,
        probe_type: probeType,
        target: formatEndpoint(target),
        target_host: target?.host ?? null,
        target_port: target?.port ?? null,
        access_mode:
          probeType === "ssh_auth"
            ? outcome.target?.mode ?? "direct"
            : outcome.context?.access_mode ?? "direct",
        business_access_mode:
          probeType === "ssh_auth" ? null : outcome.context?.access_mode ?? "direct",
        management_access_mode: probeType === "ssh_auth" ? outcome.target?.mode ?? "direct" : null,
        requested_management_access_mode:
          probeType === "ssh_auth"
            ? outcome.target?.requested_mode ?? outcome.target?.mode ?? "direct"
            : null,
        transport_kind: transportKind,
        transport_label: transportLabel,
        relay_node_id: probeType === "ssh_auth" ? outcome.relay_node_id ?? null : null,
        relay_target: probeType === "ssh_auth" ? outcome.relay_target ?? null : null,
        entry_node_id: outcome.context?.entry_node_id ?? null,
        entry_node_name:
          outcome.context?.entry_node?.name ??
          outcome.context?.entry_node?.facts?.hostname ??
          null,
        route_label: outcome.context?.route_label ?? outcome.target?.route_label ?? null,
        upstream_host: probeType === "relay_upstream_tcp" ? outcome.target?.host ?? null : null,
        upstream_port: probeType === "relay_upstream_tcp" ? outcome.target?.port ?? null : null,
        upstream_family: probeType === "relay_upstream_tcp" ? outcome.target?.family ?? null : null,
        release_id: outcome.context?.release_id ?? null,
        ssh_user: outcome.target?.ssh_user ?? defaultNodeSshUser,
        auth_method: probeType === "ssh_auth" ? "publickey" : null,
        latency_ms: latencyMs,
        packet_loss_ratio: null,
        success,
        control_ready: controlReady,
        business_ready: businessReady,
        relay_upstream_ready: relayUpstreamReady,
        health_score: healthScore,
        reason_code: reasonCode,
        summary,
        exit_code:
          probeType === "ssh_auth"
            ? outcome.ssh?.attempted
              ? outcome.ssh.exit_code ?? null
              : null
            : probeType === "relay_upstream_tcp"
              ? outcome.stage?.exit_code ?? null
              : null,
        error_stage: errorStage,
        error_message: errorMessage,
        stderr_excerpt: stderrExcerpt,
        stages,
        observed_at: nowIso(),
      },
    };
  }

  function trimProbeStore() {
    if (probeStore.length > 500) {
      probeStore.length = 500;
    }
  }

  function taskExecutionNote(probeType, targetLabel = "") {
    if (probeType === "business_entry_tcp") {
      return `控制面正在探测业务入口 ${targetLabel || ""} 的 TCP 可达性。`.trim();
    }
    if (probeType === "relay_upstream_tcp") {
      return `控制面正在通过入口节点验证上游 ${targetLabel || ""} 的连通性。`.trim();
    }
    if (probeType === "full_stack") {
      return "控制面正在执行综合巡检，校验管理链路、业务入口与 relay 上游状态。";
    }
    return `控制面正在探测 ${targetLabel || "管理链路"} 的连通性与 SSH 接管能力。`.trim();
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

    const requestedProbeType = String(task.payload?.probe_type || "full_stack").toLowerCase();
    const businessTarget = resolveBusinessProbeTarget(node, options);
    const relayTarget = resolveRelayUpstreamTarget(node, options);
    const managementTarget = resolveManagementProbeTarget(node, options);
    const targetLabel = requestedProbeType === "business_entry_tcp"
      ? formatEndpoint(businessTarget)
      : requestedProbeType === "relay_upstream_tcp"
        ? formatEndpoint(relayTarget)
        : requestedProbeType === "full_stack"
          ? formatEndpoint(businessTarget ?? managementTarget)
          : formatEndpoint(managementTarget);

    task.status = "running";
    task.started_at = nowIso();
    task.finished_at = null;
    task.attempt = Number(task.attempt ?? 0) + 1;
    task.note = options.note ?? taskExecutionNote(requestedProbeType, targetLabel);
    upsertTaskRecord(task);
    await persistTaskStore();

    let built = null;
    if (requestedProbeType === "business_entry_tcp") {
      const outcome = await performBusinessEntryProbe(node, options, {
        allowSkippedSuccess: false,
      });
      built = buildStandaloneProbe(node, task, "business_entry_tcp", outcome);
    } else if (requestedProbeType === "relay_upstream_tcp") {
      const outcome = await performRelayUpstreamCheck(node, options, {
        allowSkippedSuccess: false,
      });
      built = buildStandaloneProbe(node, task, "relay_upstream_tcp", outcome);
    } else if (requestedProbeType === "full_stack") {
      const management = await performManagementProbe(node, options);
      const business = await performBusinessEntryProbe(node, options, {
        allowSkippedSuccess: true,
      });
      const relay = await performRelayUpstreamCheck(node, options, {
        allowSkippedSuccess: true,
      });
      built = buildCompositeProbe(node, task, {
        management,
        business,
        relay,
      });
    } else {
      const outcome = await performManagementProbe(node, options);
      built = buildStandaloneProbe(node, task, "ssh_auth", outcome);
    }

    const probe = built.probe;
    probeStore.unshift(probe);
    trimProbeStore();

    const updatedNode = {
      ...node,
      status: built.nodeStatus,
      health_score: built.healthScore,
      last_probe_at: probe.observed_at,
    };
    setNodeRecord(updatedNode);

    task.status = probe.success ? "success" : "failed";
    task.finished_at = nowIso();
    task.note = probe.summary;
    task.log_excerpt = [
      `探测类型 ${probe.probe_type}`,
      `目标 ${probe.target || "-"}`,
      probe.summary,
      `健康分 ${built.healthScore}，节点状态 ${built.nodeStatus}`,
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
              note: probe.summary,
            }
          : null,
      capability: {
        tcp_reachable: Boolean(probe.stages?.management_tcp?.success || probe.stages?.business_entry_tcp?.success),
        ssh_reachable: Boolean(probe.control_ready),
        business_entry_reachable: toCapabilityFlag(probe.business_ready),
        relay_upstream_reachable: toCapabilityFlag(probe.relay_upstream_ready),
        relay_used: ["ssh-relay", "ssh-proxy"].includes(probe.transport_kind),
      },
    };
  }

  function buildProbeRecord(node, task, probe) {
    const currentTask = task ?? { id: null };
    const currentNode = node ?? { id: null };
    const payload = probe ?? {};
    return {
      id: payload.id ?? `probe_${randomUUID()}`,
      node_id: payload.node_id ?? currentNode.id ?? null,
      task_id: payload.task_id ?? currentTask.id ?? null,
      ...payload,
    };
  }

  return {
    buildProbeRecord,
    executeProbeTask,
    resolveBusinessProbeTarget,
    resolveProbeTarget,
    resolveRelayUpstreamTarget,
    sleep,
    sshProbeTimeoutMs,
  };
}
