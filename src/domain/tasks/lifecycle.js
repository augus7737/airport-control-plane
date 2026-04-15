export function createTaskLifecycleDomain(dependencies) {
  const {
    bootstrapProbeTaskForInitTask,
    buildOperationRecord,
    buildTaskRecord,
    defaultNodeSshUser = "root",
    ensureNodeInitTask,
    executeProbeTask,
    getNodeById,
    getSshProbeTimeoutMs,
    hasUsablePlatformSshKey,
    latestNodeTask,
    latestNodeTaskByTrigger,
    listNodes,
    nowIso,
    operationStore,
    persistNodeStore,
    persistOperationStore,
    persistTaskStore,
    probeStore,
    pushOperationRecord,
    resolveInitTemplate,
    resolveProbeTarget,
    setNodeRecord,
    shellSessionLabel,
    taskStore,
    upsertTaskRecord,
  } = dependencies;

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function taskLogExcerpt(lines) {
    const entries = Array.isArray(lines) ? lines.filter(Boolean) : [];
    return entries.slice(-8);
  }

  function operationTargetForNode(operation, nodeId) {
    if (!operation || !Array.isArray(operation.targets)) {
      return null;
    }

    return operation.targets.find((target) => target.node_id === nodeId) || null;
  }

  function applyNodeInitStatus(node, taskStatus) {
    const normalizedStatus = String(taskStatus || "new").toLowerCase();
    const nextStatus =
      normalizedStatus === "success"
        ? "active"
        : normalizedStatus === "failed"
          ? "degraded"
          : node.status ?? "new";

    return {
      ...node,
      status: nextStatus,
      last_seen_at: nowIso(),
    };
  }

  function normalizeInitTaskStatus(taskStatus) {
    const normalizedStatus = String(taskStatus || "").toLowerCase();
    if (normalizedStatus === "success") {
      return "success";
    }

    if (["failed", "partial"].includes(normalizedStatus)) {
      return "failed";
    }

    return null;
  }

  function initTaskNote(taskStatus) {
    return taskStatus === "success"
      ? "初始化脚本已执行完成，节点进入可运维状态。"
      : "初始化脚本执行失败，请查看任务回显并决定是否重试。";
  }

  function operationTargetOutputText(target) {
    if (!target) {
      return "";
    }

    if (typeof target.output_text === "string" && target.output_text.trim()) {
      return target.output_text;
    }

    return Array.isArray(target.output) ? target.output.join("\n") : "";
  }

  function isRetryableBootstrapInitFailure(operation, nodeId) {
    const target = operationTargetForNode(operation, nodeId);
    const transportKind = String(target?.transport_kind || "");
    if (!transportKind.startsWith("ssh-")) {
      return false;
    }

    const output = operationTargetOutputText(target).toLowerCase();
    return [
      "connection refused",
      "connection timed out",
      "operation timed out",
      "connection reset by peer",
      "connection closed by remote host",
      "no route to host",
    ].some((pattern) => output.includes(pattern));
  }

  async function reconcileInitTaskFromOperation(task) {
    if (!task?.operation_id || task.type !== "init_alpine") {
      return {
        task_changed: false,
        node_changed: false,
      };
    }

    const operation = operationStore.find((item) => item.id === task.operation_id) || null;
    if (!operation?.finished_at) {
      return {
        task_changed: false,
        node_changed: false,
      };
    }

    const taskStartedAt = Date.parse(task.started_at ?? "");
    const operationFinishedAt = Date.parse(operation.finished_at ?? "");
    if (
      String(task.status || "").toLowerCase() === "running" &&
      Number.isFinite(taskStartedAt) &&
      Number.isFinite(operationFinishedAt) &&
      taskStartedAt > operationFinishedAt
    ) {
      return {
        task_changed: false,
        node_changed: false,
      };
    }

    const nextStatus = normalizeInitTaskStatus(
      operationTargetForNode(operation, task.node_id)?.status || operation.status,
    );
    if (!nextStatus) {
      return {
        task_changed: false,
        node_changed: false,
      };
    }

    let taskChanged = false;
    const nextExcerpt = taskLogExcerpt(
      operationTargetForNode(operation, task.node_id)?.output || [],
    );
    const nextNote = initTaskNote(nextStatus);

    if (String(task.status || "").toLowerCase() !== nextStatus) {
      task.status = nextStatus;
      taskChanged = true;
    }

    if (task.started_at !== (operation.started_at ?? task.started_at)) {
      task.started_at = operation.started_at ?? task.started_at ?? null;
      taskChanged = true;
    }

    if (task.finished_at !== (operation.finished_at ?? task.finished_at)) {
      task.finished_at = operation.finished_at ?? task.finished_at ?? null;
      taskChanged = true;
    }

    if (task.note !== nextNote) {
      task.note = nextNote;
      taskChanged = true;
    }

    if (JSON.stringify(task.log_excerpt || []) !== JSON.stringify(nextExcerpt)) {
      task.log_excerpt = nextExcerpt;
      taskChanged = true;
    }

    if (taskChanged) {
      upsertTaskRecord(task);
    }

    const node = getNodeById(task.node_id);
    let nodeChanged = false;
    if (node) {
      const latestInitTask = latestNodeTask(task.node_id, "init_alpine");
      const latestOperationFinishedAt = Date.parse(operation.finished_at ?? "");
      const lastProbeAt = Date.parse(node.last_probe_at ?? "");
      const canReconcileNodeStatus =
        latestInitTask?.id === task.id &&
        (!Number.isFinite(lastProbeAt) ||
          !Number.isFinite(latestOperationFinishedAt) ||
          latestOperationFinishedAt >= lastProbeAt);

      const nextNodeStatus = nextStatus === "success" ? "active" : "degraded";
      if (canReconcileNodeStatus && String(node.status || "").toLowerCase() !== nextNodeStatus) {
        setNodeRecord({
          ...node,
          status: nextNodeStatus,
          last_seen_at: operation.finished_at ?? node.last_seen_at ?? nowIso(),
        });
        nodeChanged = true;
      }
    }

    return {
      task_changed: taskChanged,
      node_changed: nodeChanged,
    };
  }

  async function reconcileTaskStoreFromOperations() {
    let taskChanged = false;
    let nodeChanged = false;

    for (const task of taskStore) {
      const result = await reconcileInitTaskFromOperation(task);
      taskChanged = taskChanged || result.task_changed;
      nodeChanged = nodeChanged || result.node_changed;
    }

    if (taskChanged || nodeChanged) {
      await Promise.all([
        taskChanged ? persistTaskStore() : Promise.resolve(),
        nodeChanged ? persistNodeStore() : Promise.resolve(),
      ]);
    }
  }

  function buildProbeTask(node, options = {}) {
    const target = resolveProbeTarget(node);
    const trigger = options.trigger ?? "manual_probe";
    const title =
      options.title ??
      (trigger === "bootstrap_complete"
        ? "自动首探"
        : trigger === "manual_probe"
          ? "手动复探"
          : "节点健康探测");
    const note =
      options.note ??
      (trigger === "bootstrap_complete"
        ? "节点已完成 bootstrap 回报，等待控制面执行首轮自动探测。"
        : "等待控制面对节点执行连通性与 SSH 接管探测。");

    return buildTaskRecord(node, {
      type: "probe_node",
      title,
      trigger,
      note,
      payload: {
        probe_type: options.probe_type ?? "ssh_auth",
        target_host: target?.host ?? null,
        target_port: target?.port ?? (Number(node?.facts?.ssh_port ?? 19822) || 19822),
        target_family: target?.family ?? null,
        access_mode: node?.networking?.access_mode ?? "direct",
        relay_node_id: node?.networking?.relay_node_id ?? null,
        relay_label: node?.networking?.relay_label ?? null,
        ssh_user: defaultNodeSshUser,
        timeout_ms: getSshProbeTimeoutMs(),
        init_task_id: options.init_task_id ?? null,
        reason: options.reason ?? "manual_probe",
      },
    });
  }

  function probeByTaskId(taskId) {
    return probeStore.find((probe) => probe.task_id === taskId) || null;
  }

  function probeCapabilityFromRecord(probe) {
    if (!probe) {
      return null;
    }

    return {
      tcp_reachable: Boolean(probe?.stages?.tcp?.success),
      ssh_reachable: Boolean(probe.control_ready),
      relay_used: probe.transport_kind === "ssh-relay" || probe.access_mode === "relay",
    };
  }

  function probeTransportFromRecord(probe, fallbackNote = null) {
    if (!probe?.transport_kind && !probe?.transport_label) {
      return null;
    }

    return {
      kind: probe.transport_kind ?? null,
      label: probe.transport_label ?? null,
      note: probe.summary ?? fallbackNote ?? null,
    };
  }

  function bootstrapAutoProbeState(node, initTaskId = null) {
    const task = initTaskId
      ? bootstrapProbeTaskForInitTask(node.id, initTaskId)
      : latestNodeTaskByTrigger(node.id, "probe_node", "bootstrap_auto_probe");
    const probe = task ? probeByTaskId(task.id) : null;

    return {
      task,
      probe,
      summary: probe?.summary ?? task?.note ?? null,
      capability: probeCapabilityFromRecord(probe),
      transport: probeTransportFromRecord(probe, task?.note ?? null),
      node: getNodeById(node.id) || node,
    };
  }

  async function ensureBootstrapAutoProbe(node, initTask, options = {}) {
    if (!node?.id || !initTask?.id) {
      return {
        task: null,
        probe: null,
        summary: null,
        capability: null,
        transport: null,
        node: node ?? null,
      };
    }

    const existingState = bootstrapAutoProbeState(node, initTask.id);
    const existingTask = existingState.task;
    const existingStatus = String(existingTask?.status || "").toLowerCase();

    if (existingTask && !["new", "queued"].includes(existingStatus)) {
      return existingState;
    }

    if (existingTask && ["new", "queued"].includes(existingStatus)) {
      const result = await executeProbeTask(existingTask, {
        note:
          options.note ??
          "节点已完成 bootstrap 回报，控制面开始执行首轮自动探测。",
      });
      return {
        task: result.task,
        probe: result.probe,
        summary: result.probe?.summary ?? result.task?.note ?? null,
        capability: result.capability ?? probeCapabilityFromRecord(result.probe),
        transport:
          result.transport ??
          probeTransportFromRecord(result.probe, result.task?.note ?? null),
        node: result.node ?? getNodeById(node.id) ?? node,
      };
    }

    const probeTask = buildProbeTask(node, {
      trigger: "bootstrap_auto_probe",
      reason: "bootstrap_auto_probe",
      probe_type: "ssh_auth",
      init_task_id: initTask.id,
      title: "自动首探",
      note: "节点已完成 bootstrap 回报，等待控制面执行首轮自动探测。",
    });
    upsertTaskRecord(probeTask);
    await persistTaskStore();

    const result = await executeProbeTask(probeTask, {
      note:
        options.note ??
        "节点已完成 bootstrap 回报，控制面开始执行首轮自动探测。",
    });
    return {
      task: result.task,
      probe: result.probe,
      summary: result.probe?.summary ?? result.task?.note ?? null,
      capability: result.capability ?? probeCapabilityFromRecord(result.probe),
      transport:
        result.transport ?? probeTransportFromRecord(result.probe, result.task?.note ?? null),
      node: result.node ?? getNodeById(node.id) ?? node,
    };
  }

  async function executeInitTask(task, options = {}) {
    const node = getNodeById(task.node_id);
    if (!node) {
      task.status = "failed";
      task.finished_at = nowIso();
      task.note = "节点不存在，无法继续执行初始化任务。";
      task.log_excerpt = [task.note];
      upsertTaskRecord(task);
      await persistTaskStore();
      return {
        task,
        node: null,
        operation: null,
      };
    }

    if (!(await hasUsablePlatformSshKey())) {
      task.status = "new";
      task.note = "平台尚未配置可用 SSH 私钥，初始化任务已保留，可稍后在节点详情页重试。";
      task.log_excerpt = [task.note];
      upsertTaskRecord(task);
      await persistTaskStore();
      return {
        task,
        node,
        operation: null,
        skipped: true,
      };
    }

    if (!node.facts?.public_ipv4 && !node.facts?.public_ipv6 && !node.facts?.private_ipv4) {
      task.status = "new";
      task.note = "节点还没有可用的公网或内网地址，暂时无法执行初始化。";
      task.log_excerpt = [task.note];
      upsertTaskRecord(task);
      await persistTaskStore();
      return {
        task,
        node,
        operation: null,
        skipped: true,
      };
    }

    const template = resolveInitTemplate({
      template: task.template || task.payload?.template,
      system_template_id: task.payload?.system_template_id,
      template_snapshot: task.payload?.template_snapshot,
    });
    task.status = "running";
    task.started_at = nowIso();
    task.finished_at = null;
    task.operation_id = null;
    task.log_excerpt = [];
    task.note =
      options.note ??
      "节点已完成平台注册回报，控制面开始通过 SSH 下发初始化模板。";
    task.attempt = Number(task.attempt ?? 0) + 1;
    upsertTaskRecord(task);
    await persistTaskStore();

    try {
      const operation = await buildOperationRecord({
        mode: "script",
        title: `${template.title} · ${shellSessionLabel(node)}`,
        node_ids: [node.id],
        script_name: template.script_name,
        script_body: template.script_body,
      });

      pushOperationRecord(operation);
      const target = operationTargetForNode(operation, node.id);
      const taskStatus = target?.status || operation.status || "failed";

      task.status = taskStatus;
      task.operation_id = operation.id;
      task.finished_at = nowIso();
      task.note = initTaskNote(taskStatus);
      task.log_excerpt = taskLogExcerpt(target?.output || []);
      upsertTaskRecord(task);

      const updatedNode = applyNodeInitStatus(node, taskStatus);
      setNodeRecord(updatedNode);

      await Promise.all([persistOperationStore(), persistTaskStore(), persistNodeStore()]);

      return {
        task,
        node: updatedNode,
        operation,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      task.status = "failed";
      task.finished_at = nowIso();
      task.note = `初始化执行器启动失败: ${message}`;
      task.log_excerpt = [task.note];
      upsertTaskRecord(task);
      await persistTaskStore();

      const updatedNode = applyNodeInitStatus(node, "failed");
      setNodeRecord(updatedNode);
      await persistNodeStore();

      return {
        task,
        node: updatedNode,
        operation: null,
      };
    }
  }

  async function executeBootstrapInitTask(task, payload = {}) {
    const baseNote =
      payload.installed_ssh_key === false
        ? "节点已回报 bootstrap 完成，但尚未确认 SSH 公钥写入。"
        : "节点已确认平台 SSH 公钥写入，控制面开始自动执行初始化模板。";
    const retryDelaysMs = [1500, 4000];
    let result = await executeInitTask(task, {
      note: baseNote,
    });

    for (let index = 0; index < retryDelaysMs.length; index += 1) {
      if (String(result.task?.status || "").toLowerCase() !== "failed") {
        break;
      }

      if (!isRetryableBootstrapInitFailure(result.operation, task.node_id)) {
        break;
      }

      await sleep(retryDelaysMs[index]);
      result = await executeInitTask(task, {
        note: `节点已完成 bootstrap 回报，SSH 服务仍在热启动，控制面正在发起第 ${index + 2} 次初始化尝试。`,
      });
    }

    return result;
  }

  async function ensureBootstrapInitTasks() {
    let changed = false;

    for (const node of listNodes()) {
      const nodeStatus = String(node.status || "new").toLowerCase();
      if (node.source !== "bootstrap" || !["new", "degraded"].includes(nodeStatus)) {
        continue;
      }

      const existingTask = latestNodeTask(node.id, "init_alpine");
      if (existingTask) {
        continue;
      }

      ensureNodeInitTask(node, {
        template: "alpine-base",
        trigger: "bootstrap_register",
        note: "历史 bootstrap 节点待补执行初始化，可在节点详情页重新触发。",
      });
      changed = true;
    }

    if (changed) {
      await persistTaskStore();
    }
  }

  return {
    applyNodeInitStatus,
    bootstrapAutoProbeState,
    buildProbeTask,
    ensureBootstrapAutoProbe,
    ensureBootstrapInitTasks,
    executeBootstrapInitTask,
    executeInitTask,
    initTaskNote,
    isRetryableBootstrapInitFailure,
    normalizeInitTaskStatus,
    probeByTaskId,
    probeCapabilityFromRecord,
    probeTransportFromRecord,
    reconcileInitTaskFromOperation,
    reconcileTaskStoreFromOperations,
  };
}
