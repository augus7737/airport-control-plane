import { isRelayTransportKind } from "../routes/management-strategies.js";

export function createOperationsExecutorDomain(dependencies) {
  const {
    cwdProvider = () => process.cwd(),
    formatTimeLabel,
    getNodeById,
    nowIso,
    operationExecutionTimeoutMs,
    randomUUID,
    resolveExecutionTransport,
    spawn,
  } = dependencies;

  function resolveNodePayload(node, payload) {
    const nodePayloads =
      payload?.node_payloads && typeof payload.node_payloads === "object"
        ? payload.node_payloads
        : {};
    const nodePayload =
      node?.id && nodePayloads[node.id] && typeof nodePayloads[node.id] === "object"
        ? nodePayloads[node.id]
        : null;

    if (!nodePayload) {
      return payload;
    }

    return {
      ...payload,
      ...nodePayload,
    };
  }

  function inferOperationSummary(node, payload) {
    if (payload.mode === "script") {
      return payload.script_name || "自定义脚本";
    }

    const command = String(payload.command || "").trim();
    if (command.includes("apk add")) return "安装基础依赖";
    if (command.includes("systemctl restart")) return "重启服务";
    if (command.includes("sing-box") || command.includes("xray")) return "部署代理服务";
    if (command.includes("curl")) return "拉取远端资源";
    return `执行命令: ${node.facts?.hostname || node.id}`;
  }

  function buildOperationScript(payload) {
    if (payload.mode === "script") {
      return `${String(payload.script_body || "").replace(/\r\n/g, "\n")}\n`;
    }

    return `${String(payload.command || "").replace(/\r\n/g, "\n").trim()}\n`;
  }

  function operationLogLine(timestamp, message) {
    return `[${formatTimeLabel(timestamp)}] ${message}`;
  }

  function normalizeOperationOutput(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  function outputLinesFromText(text) {
    const normalized = normalizeOperationOutput(text);
    if (!normalized) {
      return [];
    }

    const lines = normalized.split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines;
  }

  function buildOperationSpawnSpec(transport) {
    if (transport.kind === "local-demo") {
      return {
        command: transport.command,
        args: ["-s"],
        env: {
          ...transport.env,
          AIRPORT_EXECUTION_CONTEXT: "batch-operation",
        },
      };
    }

    return {
      command: transport.command,
      args: [...transport.args, "sh", "-s", "--"],
      env: transport.env,
    };
  }

  function terminateChildProcess(child) {
    if (!child || child.killed) {
      return;
    }

    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 1000).unref?.();
  }

  function executeSpawnedScript(spawnSpec, scriptBody, timeoutMs) {
    return new Promise((resolve) => {
      let output = "";
      let settled = false;
      let timedOut = false;
      let timer = null;

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

      const child = spawn(spawnSpec.command, spawnSpec.args, {
        cwd: cwdProvider(),
        env: spawnSpec.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const append = (chunk) => {
        output += chunk.toString();
      };

      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.stdin.on("error", () => {});

      child.on("error", (error) => {
        finish({
          output: `${output}\n[control-plane] 执行器启动失败: ${error.message}\n`,
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
        output += `\n[control-plane] 执行超时，已在 ${timeoutMs}ms 后终止进程。\n`;
        terminateChildProcess(child);
      }, timeoutMs);
      timer.unref?.();
    });
  }

  async function executeOperationTarget(node, payload, timeoutMs) {
    const startedAt = nowIso();
    const effectivePayload = resolveNodePayload(node, payload);
    const transport = await resolveExecutionTransport(node);
    if (!transport) {
      throw new Error("当前节点缺少可用执行通道，暂时无法下发命令。");
    }
    const spawnSpec = buildOperationSpawnSpec(transport);
    const scriptBody = buildOperationScript(effectivePayload);
    const banner = [];

    banner.push(
      operationLogLine(
        startedAt,
        `建立连接 ${node.facts?.hostname || node.id} (${transport.label})`,
      ),
    );
    banner.push(
      operationLogLine(
        startedAt,
        `目标区域 ${node.labels?.region || "-"} / 厂商 ${node.labels?.provider || "未标记"}`,
      ),
    );
    banner.push(operationLogLine(startedAt, `传输说明 ${transport.note}`));
    banner.push(
      effectivePayload.mode === "script"
        ? operationLogLine(startedAt, `下发脚本 ${effectivePayload.script_name || "自定义脚本"}`)
        : operationLogLine(startedAt, `执行命令 ${String(effectivePayload.command || "").trim()}`),
    );

    if (isRelayTransportKind(transport.kind)) {
      banner.push(
        operationLogLine(
          startedAt,
          `管理链路 ${transport.note || `${node.facts?.hostname || node.id} 通过 SSH 中转接入`}`,
        ),
      );
    }

    const execution = await executeSpawnedScript(spawnSpec, scriptBody, timeoutMs);
    const finishedAt = nowIso();
    const durationMs = Math.max(
      0,
      Date.parse(finishedAt) - Date.parse(startedAt),
    );
    const status =
      execution.timed_out || execution.exit_code !== 0 ? "failed" : "success";
    const output = [
      ...banner,
      ...outputLinesFromText(execution.output),
      operationLogLine(
        finishedAt,
        `执行结束 exit=${execution.exit_code ?? "-"} signal=${execution.signal ?? "-"} duration=${durationMs}ms`,
      ),
    ];

    return {
      node_id: node.id,
      hostname: node.facts?.hostname || node.id,
      provider: node.labels?.provider || null,
      region: node.labels?.region || null,
      access_mode: isRelayTransportKind(transport.kind) ? "relay" : "direct",
      management_access_mode: isRelayTransportKind(transport.kind) ? "relay" : "direct",
      summary: inferOperationSummary(node, effectivePayload),
      status,
      output,
      output_text: output.join("\n"),
      exit_code: execution.exit_code,
      signal: execution.signal,
      timed_out: execution.timed_out,
      mode: effectivePayload.mode ?? payload.mode ?? "command",
      command: effectivePayload.command ?? null,
      script_name: effectivePayload.script_name ?? null,
      script_body: effectivePayload.script_body ?? null,
      transport_kind: transport.kind,
      transport_label: transport.label,
      transport_note: transport.note,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: durationMs,
    };
  }

  async function buildOperationRecord(payload) {
    const startedAt = nowIso();
    const timeoutMs = Number.isFinite(operationExecutionTimeoutMs) && operationExecutionTimeoutMs > 0
      ? operationExecutionTimeoutMs
      : 120000;
    const nodes = payload.node_ids
      .map((nodeId) => getNodeById(nodeId))
      .filter(Boolean);
    const targets = await Promise.all(
      nodes.map((node) => executeOperationTarget(node, payload, timeoutMs)),
    );

    const successCount = targets.filter((item) => item.status === "success").length;
    const failedCount = targets.length - successCount;
    const finishedAt = nowIso();
    const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));

    let status = "success";
    if (successCount === 0) {
      status = "failed";
    } else if (failedCount > 0) {
      status = "partial";
    }

    return {
      id: `op_${randomUUID()}`,
      created_at: startedAt,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: durationMs,
      operator: "当前会话",
      mode: payload.mode ?? "command",
      title:
        payload.title ||
        (payload.mode === "script"
          ? payload.script_name || "批量脚本执行"
          : "批量 Shell 命令"),
      command: payload.command ?? null,
      script_name: payload.script_name ?? null,
      script_body: payload.script_body ?? null,
      node_payloads:
        payload.node_payloads && typeof payload.node_payloads === "object"
          ? payload.node_payloads
          : null,
      status,
      node_ids: payload.node_ids,
      summary: {
        total: targets.length,
        success: successCount,
        failed: failedCount,
      },
      targets,
    };
  }

  return {
    buildOperationRecord,
    executeOperationTarget,
    terminateChildProcess,
  };
}
