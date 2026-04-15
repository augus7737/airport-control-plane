export function createShellSessionsDomain(dependencies) {
  const {
    cwdProvider = () => process.cwd(),
    nowIso,
    randomUUID,
    resolveShellTransport,
    shellSessionClosedRetentionMs,
    shellSessionIdleMs,
    shellSessionOutputLimit,
    shellSessionStore,
    spawn,
  } = dependencies;

  function shellSessionLabel(node) {
    return node?.facts?.hostname || node?.id || "未命名节点";
  }

  function shellSessionOutput(session) {
    return session.output || "";
  }

  function appendShellOutput(session, chunk) {
    if (!chunk) {
      return;
    }

    session.output = `${shellSessionOutput(session)}${String(chunk)}`;
    if (session.output.length > shellSessionOutputLimit) {
      session.output = session.output.slice(-shellSessionOutputLimit);
    }

    const timestamp = nowIso();
    session.updated_at = timestamp;
    session.last_output_at = timestamp;
  }

  function serializeShellSession(session) {
    return {
      id: session.id,
      node_id: session.node_id,
      status: session.status,
      created_at: session.created_at,
      updated_at: session.updated_at,
      last_output_at: session.last_output_at,
      closed_at: session.closed_at,
      exit_code: session.exit_code,
      signal: session.signal,
      transport_kind: session.transport.kind,
      transport_label: session.transport.label,
      transport_note: session.transport.note,
      output: shellSessionOutput(session),
    };
  }

  function buildShellBanner(node, transport, sessionId) {
    return [
      `[control-plane] 已创建 Web Shell 会话 ${sessionId}`,
      `[node] ${shellSessionLabel(node)} / ${node.labels?.provider || "未标记"} / ${node.labels?.region || "-"}`,
      `[transport] ${transport.label}`,
      `[note] ${transport.note}`,
      "",
    ].join("\n");
  }

  function finalizeShellSession(session, status, suffix = "") {
    session.status = status;
    session.closed_at = session.closed_at ?? nowIso();
    session.updated_at = session.closed_at;
    if (suffix) {
      appendShellOutput(session, suffix);
    }
  }

  function launchShellSession(session, node) {
    appendShellOutput(session, `${buildShellBanner(node, session.transport, session.id)}\n`);

    const child = spawn(session.transport.command, session.transport.args, {
      cwd: cwdProvider(),
      env: session.transport.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    session.process = child;
    session.status = "open";
    session.updated_at = nowIso();

    child.stdout.on("data", (chunk) => {
      appendShellOutput(session, chunk.toString());
    });

    child.stderr.on("data", (chunk) => {
      appendShellOutput(session, chunk.toString());
    });

    child.on("error", (error) => {
      finalizeShellSession(session, "failed", `\n[error] 会话启动失败: ${error.message}\n`);
    });

    child.on("close", (code, signal) => {
      session.exit_code = code;
      session.signal = signal;
      const nextStatus = session.status === "closed" ? "closed" : code === 0 ? "closed" : "failed";
      finalizeShellSession(
        session,
        nextStatus,
        `\n[session] 会话已结束（exit=${code ?? "-"} signal=${signal ?? "-"}）\n`,
      );
    });
  }

  function reusableShellSession(nodeId) {
    for (const session of shellSessionStore.values()) {
      const processAlive =
        session.process &&
        !session.process.killed &&
        session.exit_code == null &&
        session.closed_at == null;
      if (
        session.node_id === nodeId &&
        (session.status === "starting" || (session.status === "open" && processAlive))
      ) {
        return session;
      }
    }

    return null;
  }

  async function createShellSession(node) {
    const existing = reusableShellSession(node.id);
    if (existing) {
      return existing;
    }

    const transport = await resolveShellTransport(node);
    if (!transport) {
      throw new Error("当前节点缺少可用 SSH 传输，暂时无法创建 Web Shell 会话。");
    }

    const timestamp = nowIso();
    const session = {
      id: `shell_${randomUUID()}`,
      node_id: node.id,
      status: "starting",
      created_at: timestamp,
      updated_at: timestamp,
      last_output_at: null,
      closed_at: null,
      exit_code: null,
      signal: null,
      output: "",
      transport,
      process: null,
    };

    shellSessionStore.set(session.id, session);
    launchShellSession(session, node);
    return session;
  }

  function closeShellSession(session, reason = "operator_closed") {
    if (!session) {
      return;
    }

    appendShellOutput(session, `\n[control-plane] 会话已由控制台结束（${reason}）。\n`);
    session.status = "closed";
    session.closed_at = nowIso();
    session.updated_at = session.closed_at;

    if (session.process && !session.process.killed) {
      session.process.kill("SIGTERM");
      setTimeout(() => {
        if (session.process && !session.process.killed) {
          session.process.kill("SIGKILL");
        }
      }, 1000).unref?.();
    }
  }

  function closeShellSessionsForNode(nodeId) {
    let changed = false;

    for (const [sessionId, session] of shellSessionStore.entries()) {
      if (session?.node_id !== nodeId) {
        continue;
      }

      closeShellSession(session, "node_deleted");
      shellSessionStore.delete(sessionId);
      changed = true;
    }

    return changed;
  }

  function cleanupShellSessions() {
    const now = Date.now();

    for (const [sessionId, session] of shellSessionStore.entries()) {
      const updatedAt = Date.parse(session.updated_at || session.created_at || nowIso());
      const age = Number.isFinite(updatedAt) ? now - updatedAt : 0;
      const retention =
        session.status === "closed" || session.status === "failed"
          ? shellSessionClosedRetentionMs
          : shellSessionIdleMs;

      if (age < retention) {
        continue;
      }

      if (session.status === "open" || session.status === "starting") {
        closeShellSession(session, "idle_timeout");
      }

      if (
        session.status === "closed" ||
        session.status === "failed" ||
        (session.process && session.process.killed)
      ) {
        shellSessionStore.delete(sessionId);
      }
    }
  }

  return {
    appendShellOutput,
    cleanupShellSessions,
    closeShellSession,
    closeShellSessionsForNode,
    createShellSession,
    serializeShellSession,
    shellSessionLabel,
  };
}
