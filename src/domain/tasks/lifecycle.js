import { randomUUID } from "node:crypto";

import { isRelayTransportKind } from "../routes/management-strategies.js";
import {
  DEFAULT_NODE_SSH_PORT,
  normalizeSshPort,
} from "../nodes/management-defaults.js";

const INIT_EXECUTION_CLAIM_KEY = "init_execution_claim";

export function createTaskLifecycleDomain(dependencies) {
  const {
    bootstrapProbeTaskForInitTask,
    buildOperationRecord,
    buildTaskRecord,
    defaultInitTemplateForNode = () => "alpine-base",
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
    resolveBusinessProbeContext = () => null,
    resolveProbeTarget,
    setNodeRecord,
    shellSessionLabel,
    sleep: sleepImpl = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    taskStore,
    upsertTaskRecord,
  } = dependencies;

  function sleep(ms) {
    return sleepImpl(ms);
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

  function findTaskRecord(taskId) {
    return taskStore.find((item) => item.id === taskId) || null;
  }

  function taskOperation(task) {
    return task?.operation_id
      ? operationStore.find((item) => item.id === task.operation_id) || null
      : null;
  }

  function operationFinished(operation) {
    return Boolean(operation?.finished_at);
  }

  function replaceOperationRecord(operation) {
    const index = operationStore.findIndex((item) => item.id === operation.id);
    if (index >= 0) {
      operationStore[index] = operation;
      return operation;
    }

    pushOperationRecord(operation);
    return operation;
  }

  function buildPendingInitOperation(node, template, startedAt) {
    const output = [
      `[${startedAt}] 初始化任务已认领，控制面准备通过 SSH 下发初始化模板。`,
    ];

    return {
      id: `op_${randomUUID()}`,
      created_at: startedAt,
      started_at: startedAt,
      finished_at: null,
      duration_ms: null,
      operator: "当前会话",
      mode: "script",
      title: `${template.title} · ${shellSessionLabel(node)}`,
      command: null,
      script_name: template.script_name,
      script_body: template.script_body,
      node_payloads: null,
      status: "running",
      node_ids: [node.id],
      summary: {
        total: 1,
        success: 0,
        failed: 0,
      },
      targets: [
        {
          node_id: node.id,
          hostname: node.facts?.hostname || node.id,
          provider: node.labels?.provider || null,
          region: node.labels?.region || null,
          access_mode: null,
          management_access_mode: null,
          summary: template.script_name || template.title,
          status: "running",
          output,
          output_text: output.join("\n"),
          exit_code: null,
          signal: null,
          timed_out: false,
          output_truncated: false,
          mode: "script",
          command: null,
          script_name: template.script_name,
          script_body: template.script_body,
          transport_kind: null,
          transport_label: null,
          transport_note: null,
          started_at: startedAt,
          finished_at: null,
          duration_ms: null,
        },
      ],
    };
  }

  function completePendingOperation(pendingOperation, operation) {
    return {
      ...operation,
      id: pendingOperation.id,
      created_at: pendingOperation.created_at,
    };
  }

  function failPendingOperation(pendingOperation, node, message) {
    const finishedAt = nowIso();
    const startedAt = Date.parse(pendingOperation.started_at ?? "");
    const finished = Date.parse(finishedAt);
    const durationMs =
      Number.isFinite(startedAt) && Number.isFinite(finished)
        ? Math.max(0, finished - startedAt)
        : 0;
    const output = [
      ...(pendingOperation.targets?.[0]?.output || []),
      `初始化执行器启动失败: ${message}`,
    ];

    return {
      ...pendingOperation,
      status: "failed",
      finished_at: finishedAt,
      duration_ms: durationMs,
      summary: {
        total: 1,
        success: 0,
        failed: 1,
      },
      targets: [
        {
          ...(pendingOperation.targets?.[0] || {}),
          node_id: node.id,
          hostname: node.facts?.hostname || node.id,
          provider: node.labels?.provider || null,
          region: node.labels?.region || null,
          status: "failed",
          output,
          output_text: output.join("\n"),
          finished_at: finishedAt,
          duration_ms: durationMs,
        },
      ],
    };
  }

  function clearInitExecutionClaim(task) {
    if (!task?.payload || typeof task.payload !== "object") {
      return false;
    }

    if (!Object.hasOwn(task.payload, INIT_EXECUTION_CLAIM_KEY)) {
      return false;
    }

    const nextPayload = { ...task.payload };
    delete nextPayload[INIT_EXECUTION_CLAIM_KEY];
    task.payload = nextPayload;
    return true;
  }

  function initExecutionClaimOwner(task) {
    return typeof task?.payload?.[INIT_EXECUTION_CLAIM_KEY]?.owner === "string"
      ? task.payload[INIT_EXECUTION_CLAIM_KEY].owner
      : null;
  }

  function initTaskClaimStatus(task) {
    const status = String(task?.status || "new").toLowerCase();
    const operation = taskOperation(task);
    if (operation && !operationFinished(operation)) {
      return "idempotent";
    }

    if (status === "success" || status === "running") {
      return "idempotent";
    }

    const existingOwner = initExecutionClaimOwner(task);
    if (existingOwner) {
      return "owned";
    }

    return "claimable";
  }

  function claimInitTask(task, options = {}) {
    const freshTask = findTaskRecord(task.id) || task;
    const claimStatus = initTaskClaimStatus(freshTask);
    const existingOwner = initExecutionClaimOwner(freshTask);
    if (
      claimStatus === "idempotent" ||
      (claimStatus === "owned" && existingOwner !== options.claim_owner)
    ) {
      return {
        claimed: false,
        task: freshTask,
        owner: null,
      };
    }

    const claimedAt = nowIso();
    const owner = existingOwner || options.claim_owner || `init:${randomUUID()}`;
    freshTask.status = "running";
    freshTask.started_at = claimedAt;
    freshTask.finished_at = null;
    freshTask.operation_id = null;
    freshTask.log_excerpt = [];
    freshTask.note =
      options.note ??
      "节点已完成平台注册回报，控制面开始通过 SSH 下发初始化模板。";
    freshTask.payload = {
      ...(freshTask.payload && typeof freshTask.payload === "object" ? freshTask.payload : {}),
      [INIT_EXECUTION_CLAIM_KEY]: {
        owner,
        claimed_at: claimedAt,
      },
    };
    upsertTaskRecord(freshTask);

    return {
      claimed: true,
      task: freshTask,
      owner,
    };
  }

  function claimedInitTask(taskId, owner) {
    const freshTask = findTaskRecord(taskId);
    if (!freshTask || !owner || initExecutionClaimOwner(freshTask) !== owner) {
      return null;
    }

    return freshTask;
  }

  function releaseInitExecutionClaim(taskId, owner) {
    const task = claimedInitTask(taskId, owner);
    if (!task) {
      return null;
    }

    clearInitExecutionClaim(task);
    upsertTaskRecord(task);
    return task;
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

    if (nextStatus && clearInitExecutionClaim(task)) {
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
    const requestedProbeType = String(options.probe_type || "full_stack").trim().toLowerCase();
    const probeType = ["ssh_auth", "business_entry_tcp", "relay_upstream_tcp", "full_stack"].includes(
      requestedProbeType,
    )
      ? requestedProbeType
      : "full_stack";
    const managementTarget = resolveProbeTarget(node);
    const businessContext = resolveBusinessProbeContext(node, options);
    const businessEntryTarget = businessContext?.entry_target
      ? {
          host: businessContext.entry_target.host ?? null,
          port: businessContext.entry_target.port ?? null,
          family: businessContext.entry_target.family ?? null,
        }
      : null;
    const relayTarget = businessContext?.relay_upstream_target
      ? {
          host: businessContext.relay_upstream_target.host ?? null,
          port: businessContext.relay_upstream_target.port ?? null,
          family: businessContext.relay_upstream_target.family ?? null,
        }
      : null;
    const target =
      probeType === "business_entry_tcp"
        ? businessEntryTarget
        : probeType === "relay_upstream_tcp"
          ? relayTarget
          : probeType === "full_stack"
            ? businessEntryTarget ?? managementTarget
            : managementTarget;
    const trigger = options.trigger ?? "manual_probe";
    const title =
      options.title ??
      (trigger === "bootstrap_complete"
        ? "自动首探"
        : trigger === "manual_probe"
          ? probeType === "business_entry_tcp"
            ? "业务入口复探"
            : probeType === "relay_upstream_tcp"
              ? "入口上游复探"
              : probeType === "ssh_auth"
                ? "SSH 接管复探"
                : "手动复探"
          : trigger === "scheduled_probe"
            ? "周期巡检"
            : probeType === "business_entry_tcp"
              ? "业务入口探测"
              : probeType === "relay_upstream_tcp"
                ? "入口上游探测"
                : probeType === "ssh_auth"
                  ? "SSH 接管探测"
                  : "节点健康探测");
    const note =
      options.note ??
      (trigger === "bootstrap_complete"
        ? "节点已完成 bootstrap 回报，等待控制面执行首轮综合巡检。"
        : probeType === "business_entry_tcp"
          ? "等待控制面对节点执行业务入口 TCP 探测。"
          : probeType === "relay_upstream_tcp"
            ? "等待控制面通过入口节点校验到落地节点的上游链路。"
            : probeType === "ssh_auth"
              ? "等待控制面对节点执行管理链路与 SSH 接管探测。"
              : "等待控制面对节点执行综合巡检，校验管理链路、业务入口与 relay 上游状态。");

    return buildTaskRecord(node, {
      type: "probe_node",
      title,
      trigger,
      note,
      payload: {
        probe_type: probeType,
        target_host: target?.host ?? null,
        target_port:
          target?.port ??
          (probeType === "ssh_auth"
            ? normalizeSshPort(node?.facts?.ssh_port, DEFAULT_NODE_SSH_PORT)
            : null),
        target_family: target?.family ?? null,
        access_mode:
          probeType === "ssh_auth"
            ? managementTarget?.mode ?? "direct"
            : businessContext?.access_mode ?? "direct",
        business_access_mode: probeType === "ssh_auth" ? null : businessContext?.access_mode ?? "direct",
        management_access_mode: managementTarget?.mode ?? "direct",
        requested_management_access_mode:
          managementTarget?.requested_mode ?? managementTarget?.mode ?? "direct",
        relay_strategy: managementTarget?.relay_strategy ?? null,
        strategy_candidates: managementTarget?.strategy_candidates ?? [],
        relay_node_id: managementTarget?.relay_node_id ?? null,
        relay_label: node?.management?.relay_label ?? node?.networking?.relay_label ?? null,
        route_label: businessContext?.route_label ?? null,
        entry_node_id: businessContext?.entry_node_id ?? null,
        release_id: businessContext?.release_id ?? null,
        upstream_host: relayTarget?.host ?? null,
        upstream_port: relayTarget?.port ?? null,
        upstream_family: relayTarget?.family ?? null,
        ssh_user: managementTarget?.ssh_user ?? defaultNodeSshUser,
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
        tcp_reachable: Boolean(probe?.stages?.management_tcp?.success || probe?.stages?.business_entry_tcp?.success),
        ssh_reachable: Boolean(probe.control_ready),
        business_entry_reachable: toCapabilityFlag(probe.business_ready),
        relay_upstream_reachable: toCapabilityFlag(probe.relay_upstream_ready),
        relay_used: isRelayTransportKind(probe.transport_kind),
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
      probe_type: "full_stack",
      init_task_id: initTask.id,
      title: "自动首探",
      note: "节点已完成 bootstrap 回报，等待控制面执行首轮综合巡检。",
    });
    upsertTaskRecord(probeTask);
    await persistTaskStore();

    const result = await executeProbeTask(probeTask, {
      note:
        options.note ??
        "节点已完成 bootstrap 回报，控制面开始执行首轮综合巡检。",
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
    const claim = claimInitTask(task, options);
    const currentNode = getNodeById(claim.task.node_id);
    if (!claim.claimed) {
      return {
        task: claim.task,
        node: currentNode,
        operation: taskOperation(claim.task),
        idempotent: true,
      };
    }

    await persistTaskStore();

    const taskId = claim.task.id;
    const node = getNodeById(task.node_id);
    if (!node) {
      const claimedTask = claimedInitTask(taskId, claim.owner);
      if (!claimedTask) {
        return {
          task: findTaskRecord(taskId) || claim.task,
          node: null,
          operation: null,
          idempotent: true,
        };
      }

      claimedTask.status = "failed";
      claimedTask.finished_at = nowIso();
      claimedTask.note = "节点不存在，无法继续执行初始化任务。";
      claimedTask.log_excerpt = [claimedTask.note];
      if (options.retain_claim_on_failure !== true) {
        clearInitExecutionClaim(claimedTask);
      }
      upsertTaskRecord(claimedTask);
      await persistTaskStore();
      return {
        task: claimedTask,
        node: null,
        operation: null,
        claim_owner: claim.owner,
      };
    }

    if (!(await hasUsablePlatformSshKey())) {
      const claimedTask = claimedInitTask(taskId, claim.owner);
      if (!claimedTask) {
        return {
          task: findTaskRecord(taskId) || claim.task,
          node,
          operation: null,
          idempotent: true,
        };
      }

      claimedTask.status = "new";
      claimedTask.note = "平台尚未配置可用 SSH 私钥，初始化任务已保留，可稍后在节点详情页重试。";
      claimedTask.log_excerpt = [claimedTask.note];
      claimedTask.finished_at = null;
      clearInitExecutionClaim(claimedTask);
      upsertTaskRecord(claimedTask);
      await persistTaskStore();
      return {
        task: claimedTask,
        node,
        operation: null,
        claim_owner: claim.owner,
        skipped: true,
      };
    }

    if (!node.facts?.public_ipv4 && !node.facts?.public_ipv6 && !node.facts?.private_ipv4) {
      const claimedTask = claimedInitTask(taskId, claim.owner);
      if (!claimedTask) {
        return {
          task: findTaskRecord(taskId) || claim.task,
          node,
          operation: null,
          idempotent: true,
        };
      }

      claimedTask.status = "new";
      claimedTask.note = "节点还没有可用的公网或内网地址，暂时无法执行初始化。";
      claimedTask.log_excerpt = [claimedTask.note];
      claimedTask.finished_at = null;
      clearInitExecutionClaim(claimedTask);
      upsertTaskRecord(claimedTask);
      await persistTaskStore();
      return {
        task: claimedTask,
        node,
        operation: null,
        claim_owner: claim.owner,
        skipped: true,
      };
    }

    const template = resolveInitTemplate({
      template: task.template || task.payload?.template,
      system_template_id: task.payload?.system_template_id,
      template_snapshot: task.payload?.template_snapshot,
    });
    const executionTask = claimedInitTask(taskId, claim.owner);
    if (!executionTask) {
      return {
        task: findTaskRecord(taskId) || claim.task,
        node: getNodeById(node.id) || node,
        operation: null,
        idempotent: true,
      };
    }

    executionTask.attempt = Number(executionTask.attempt ?? 0) + 1;
    const pendingOperation = buildPendingInitOperation(node, template, nowIso());
    executionTask.operation_id = pendingOperation.id;
    upsertTaskRecord(executionTask);
    pushOperationRecord(pendingOperation);
    await Promise.all([persistTaskStore(), persistOperationStore()]);

    try {
      const operation = await buildOperationRecord({
        mode: "script",
        title: `${template.title} · ${shellSessionLabel(node)}`,
        node_ids: [node.id],
        script_name: template.script_name,
        script_body: template.script_body,
      });

      const claimedTask = claimedInitTask(taskId, claim.owner);
      if (!claimedTask) {
        return {
          task: findTaskRecord(taskId) || claim.task,
          node: getNodeById(node.id) || node,
          operation: pendingOperation,
          idempotent: true,
        };
      }

      const completedOperation = completePendingOperation(pendingOperation, operation);
      replaceOperationRecord(completedOperation);
      const target = operationTargetForNode(completedOperation, node.id);
      const taskStatus = target?.status || operation.status || "failed";

      claimedTask.status = taskStatus;
      claimedTask.operation_id = completedOperation.id;
      claimedTask.finished_at = nowIso();
      claimedTask.note = initTaskNote(taskStatus);
      claimedTask.log_excerpt = taskLogExcerpt(target?.output || []);
      if (taskStatus === "success" || options.retain_claim_on_failure !== true) {
        clearInitExecutionClaim(claimedTask);
      }
      upsertTaskRecord(claimedTask);

      const updatedNode = applyNodeInitStatus(node, taskStatus);
      setNodeRecord(updatedNode);

      await Promise.all([persistOperationStore(), persistTaskStore(), persistNodeStore()]);

      return {
        task: claimedTask,
        node: updatedNode,
        operation: completedOperation,
        claim_owner: claim.owner,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      const claimedTask = claimedInitTask(taskId, claim.owner);
      if (!claimedTask) {
        return {
          task: findTaskRecord(taskId) || claim.task,
          node: getNodeById(node.id) || node,
          operation: pendingOperation,
          idempotent: true,
        };
      }

      const failedOperation = failPendingOperation(pendingOperation, node, message);
      replaceOperationRecord(failedOperation);
      claimedTask.status = "failed";
      claimedTask.operation_id = failedOperation.id;
      claimedTask.finished_at = nowIso();
      claimedTask.note = `初始化执行器启动失败: ${message}`;
      claimedTask.log_excerpt = [claimedTask.note];
      if (options.retain_claim_on_failure !== true) {
        clearInitExecutionClaim(claimedTask);
      }
      upsertTaskRecord(claimedTask);
      await Promise.all([persistTaskStore(), persistOperationStore()]);

      const updatedNode = applyNodeInitStatus(node, "failed");
      setNodeRecord(updatedNode);
      await persistNodeStore();

      return {
        task: claimedTask,
        node: updatedNode,
        operation: failedOperation,
        claim_owner: claim.owner,
      };
    }
  }

  async function executeBootstrapInitTask(task, payload = {}) {
    const baseNote =
      payload.installed_ssh_key === false
        ? "节点已回报 bootstrap 完成，但尚未确认 SSH 公钥写入。"
        : "节点已确认平台 SSH 公钥写入，控制面开始自动执行初始化模板。";
    const retryDelaysMs = [1500, 4000];
    let claimOwner = null;
    let result = await executeInitTask(task, {
      note: baseNote,
      retain_claim_on_failure: true,
    });
    if (result.idempotent) {
      return result;
    }
    claimOwner = result.claim_owner ?? null;

    for (let index = 0; index < retryDelaysMs.length; index += 1) {
      if (String(result.task?.status || "").toLowerCase() !== "failed") {
        break;
      }

      if (!isRetryableBootstrapInitFailure(result.operation, result.task?.node_id || task.node_id)) {
        break;
      }

      await sleep(retryDelaysMs[index]);
      result = await executeInitTask(result.task || task, {
        claim_owner: claimOwner,
        note: `节点已完成 bootstrap 回报，SSH 服务仍在热启动，控制面正在发起第 ${index + 2} 次初始化尝试。`,
        retain_claim_on_failure: true,
      });
      claimOwner = result.claim_owner ?? claimOwner;
    }

    if (claimOwner && String(result.task?.status || "").toLowerCase() === "failed") {
      const releasedTask = releaseInitExecutionClaim(result.task.id, claimOwner);
      if (releasedTask) {
        await persistTaskStore();
        result = {
          ...result,
          task: releasedTask,
        };
      }
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
        template: defaultInitTemplateForNode(node),
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
