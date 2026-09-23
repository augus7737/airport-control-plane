import { createTasksPageActions } from "./tasks-page-actions.js";
import { bindTasksPageEvents } from "./tasks-page-bindings.js";

const TASK_URGENCY = {
  failed: 0,
  running: 1,
  queued: 2,
  new: 3,
  partial: 4,
  success: 5,
};

const PAYLOAD_LABELS = {
  access_mode: "接入方式",
  business_access_mode: "业务链路",
  entry_node_id: "入口节点",
  init_task_id: "初始化任务",
  management_access_mode: "管理链路",
  node_group_id: "节点组",
  profile_id: "协议模板",
  probe_type: "探测类型",
  reason: "触发原因",
  relay_label: "中转标签",
  relay_node_id: "中转节点",
  relay_strategy: "中转策略",
  release_id: "发布记录",
  requested_management_access_mode: "申请的管理链路",
  route_label: "链路标签",
  ssh_user: "SSH 用户",
  strategy_candidates: "候选策略",
  system_template_id: "系统模板",
  template: "初始化模板",
  template_snapshot: "模板快照",
  target_family: "目标地址族",
  target_host: "目标地址",
  target_port: "目标端口",
  timeout_ms: "超时",
  upstream_host: "上游地址",
  upstream_port: "上游端口",
  user_ids: "用户列表",
};

const PAYLOAD_VALUE_LABELS = {
  direct: "直连",
  relay: "中转",
  full_stack: "全链路",
  tcp: "TCP",
  ssh: "SSH",
  http: "HTTP",
  https: "HTTPS",
  ipv4: "IPv4",
  ipv6: "IPv6",
  manual_probe: "手动复探",
};

const PROBE_MAX_VISIBLE_ROWS = 6;

const STALE_DATA_SECONDS = 300;

export function createTasksPageModule(dependencies) {
  const {
    appState,
    documentRef = document,
    escapeHtml,
    fetchImpl = fetch,
    formatDateTime,
    formatDuration,
    formatRelativeTime,
    formatTaskRound,
    getCollectionHealth = () => null,
    getNodeDisplayName,
    getTaskDisplayTitle,
    getTaskSummary,
    isUnauthorizedError = () => false,
    nodeDetailHref = (nodeId) => `/node.html?id=${encodeURIComponent(nodeId)}`,
    page,
    probeReasonLabel,
    probeStageLabel,
    refreshRuntimeData,
    renderCurrentContent,
    resolveDurationMs,
    resolveTaskNode,
    statusClassName,
    statusText,
    taskStatusClassName,
    taskStatusText,
    terminalOperationHref = (operationId) =>
      `/terminal.html?operation_id=${encodeURIComponent(operationId)}#terminal-output-panel`,
    windowRef = window,
  } = dependencies;
  const actions = createTasksPageActions({
    appState,
    documentRef,
    fetchImpl,
    getCollectionHealth,
    getNodeDisplayName,
    isUnauthorizedError,
    refreshRuntimeData,
    renderCurrentContent,
    windowRef,
  });

  function isActionableTask(task) {
    return task?.type === "init_alpine" || task?.type === "probe_node";
  }

  function taskTypeLabel(task) {
    if (task?.type === "init_alpine") {
      return "初始化";
    }
    if (task?.type === "probe_node") {
      return "探测";
    }
    return task?.type || "任务";
  }

  function filterTasks(tasks) {
    const query = String(appState.taskCenter.query || "").trim().toLowerCase();
    const statusFilter = String(appState.taskCenter.status || "all").toLowerCase();
    const typeFilter = String(appState.taskCenter.type || "all").toLowerCase();
    const onlyActionable = Boolean(appState.taskCenter.onlyActionable);

    return tasks
      .filter((task) => {
        const node = resolveTaskNode(task, appState.nodes);
        const status = String(task.status || "new").toLowerCase();
        const type = String(task.type || "").toLowerCase();
        const haystack = [
          task.id,
          getTaskDisplayTitle(task),
          getTaskSummary(task),
          node ? getNodeDisplayName(node) : task.node_id || "",
          task.trigger || "",
        ]
          .join(" ")
          .toLowerCase();

        if (query && !haystack.includes(query)) {
          return false;
        }

        if (statusFilter !== "all" && status !== statusFilter) {
          return false;
        }

        if (typeFilter !== "all" && type !== typeFilter) {
          return false;
        }

        if (onlyActionable && !isActionableTask(task)) {
          return false;
        }

        return true;
      })
      .sort((left, right) => {
        const leftTier = TASK_URGENCY[String(left.status || "new").toLowerCase()] ?? 9;
        const rightTier = TASK_URGENCY[String(right.status || "new").toLowerCase()] ?? 9;
        if (leftTier !== rightTier) {
          return leftTier - rightTier;
        }
        return String(right.scheduled_at || right.created_at || "").localeCompare(
          String(left.scheduled_at || left.created_at || ""),
        );
      });
  }

  function ensureSelectedTask(filteredTasks) {
    if (filteredTasks.length === 0) {
      appState.taskCenter.selectedTaskId = null;
      appState.taskCenter.operationOutputExpanded = false;
      return;
    }

    const selectedTaskId = appState.taskCenter.selectedTaskId;
    if (selectedTaskId && filteredTasks.some((task) => task.id === selectedTaskId)) {
      return;
    }

    appState.taskCenter.selectedTaskId = null;
    appState.taskCenter.operationOutputExpanded = false;
  }

  function isTaskActionPending(taskId) {
    const pending = appState.taskCenter.pendingActionTaskIds;
    if (pending instanceof Set) {
      return pending.has(taskId);
    }
    if (Array.isArray(pending)) {
      return pending.includes(taskId);
    }
    return false;
  }

  function renderProbeRetryButton(task, { fullLabel }) {
    const pending = isTaskActionPending(task.id);
    const label = pending ? "复探中" : fullLabel ? "立即复探" : "复探";
    return `<button class="button ghost task-action-button${pending ? " is-loading" : ""}" type="button" data-task-trigger="${escapeHtml(task.id)}"${pending ? ' disabled aria-busy="true"' : ""}>${label}</button>`;
  }

  function renderTaskActionButton(task) {
    if (task.type === "probe_node") {
      return renderProbeRetryButton(task, { fullLabel: false });
    }

    if (task.type === "init_alpine") {
      return '<span class="tiny muted">选中查看处置</span>';
    }

    return '<span class="tiny muted">无直接动作</span>';
  }

  function normalizeTaskOperationOutput(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  }

  function getLinkedOperation(task) {
    if (!task?.operation_id) {
      return null;
    }

    return appState.operations.find((operation) => operation.id === task.operation_id) || null;
  }

  function getLinkedOperationTarget(operation, task) {
    if (!operation || !Array.isArray(operation.targets)) {
      return null;
    }

    return (
      operation.targets.find((target) => target.node_id === task?.node_id) ||
      operation.targets[0] ||
      null
    );
  }

  function getLinkedProbe(task) {
    if (!task?.id || !Array.isArray(appState.probes)) {
      return null;
    }

    return appState.probes.find((probe) => probe.task_id === task.id) || null;
  }

  function formatTaskDuration(task) {
    const durationMs = resolveDurationMs(task);
    if (durationMs == null) {
      return null;
    }
    return formatDuration(durationMs);
  }

  function renderTaskTime(task) {
    const value = task.scheduled_at || task.created_at;
    if (!value) {
      return "<span>-</span>";
    }
    const date = new Date(value);
    const iso = Number.isNaN(date.getTime()) ? "" : date.toISOString();
    return `<time datetime="${escapeHtml(iso)}" title="${escapeHtml(formatDateTime(value))}">${escapeHtml(formatRelativeTime(value))}</time>`;
  }

  function formatProbeBatchSize(batchSize) {
    const numericBatchSize = Number(batchSize || 0);
    return numericBatchSize > 0 ? `每轮 ${numericBatchSize} 台` : "每轮覆盖全部符合条件节点";
  }

  function getProbeSchedulerPresentation(probeScheduler, platformHealth) {
    if (platformHealth?.status === "error") {
      return {
        tone: "badge badge-degraded",
        label: "巡检状态未知",
        detail: `平台上下文读取失败（${platformHealth.error || "未知原因"}），此处的启用状态不可信。${
          platformHealth.ok_at
            ? `最近成功读取：${formatRelativeTime(platformHealth.ok_at)}。`
            : "尚无成功读取记录。"
        }`,
      };
    }

    if (!probeScheduler?.enabled) {
      return {
        tone: "badge badge-new",
        label: "周期巡检未启用",
        detail: `关闭状态下任务只来自节点注册和你手动触发的复探。${
          probeScheduler?.interval_ms
            ? `（节奏 ${formatDuration(probeScheduler.interval_ms)}，${formatProbeBatchSize(
                probeScheduler.batch_size,
              )}）`
            : ""
        }`,
      };
    }

    if (probeScheduler.running) {
      return {
        tone: "badge badge-running",
        label: "巡检进行中",
        detail: describeLastProbeRun(probeScheduler),
      };
    }

    if (probeScheduler.last_error) {
      return {
        tone: "badge badge-degraded",
        label: "巡检最近异常",
        detail: `${probeScheduler.last_error}。${describeLastProbeRun(probeScheduler)}`,
      };
    }

    return {
      tone: "badge badge-active",
      label: "巡检空闲",
      detail: describeLastProbeRun(probeScheduler),
    };
  }

  function describeLastProbeRun(probeScheduler) {
    const parts = [];
    if (probeScheduler?.last_run_summary) {
      parts.push(formatProbeRunSummary(probeScheduler.last_run_summary));
    }
    if (probeScheduler?.last_finished_at) {
      parts.push(`完成于 ${formatRelativeTime(probeScheduler.last_finished_at)}`);
    }
    if (probeScheduler?.next_run_at) {
      parts.push(`下一轮 ${formatRelativeTime(probeScheduler.next_run_at)}`);
    }
    if (parts.length === 0) {
      return `还没有周期巡检记录，${formatProbeBatchSize(probeScheduler?.batch_size)}。`;
    }
    return `${parts.join(" · ")}。`;
  }

  function formatProbeRunSummary(summary) {
    if (!summary || typeof summary !== "object") {
      return "还没有周期巡检记录";
    }

    const total = Number(summary.total || 0);
    const success = Number(summary.success || 0);
    const failed = Number(summary.failed || 0);
    const skipped = Number(summary.skipped || 0);

    if (total <= 0 && failed <= 0 && skipped <= 0) {
      return "最近一轮没有可巡检节点";
    }

    const parts = [`巡检 ${total} 台`, `成功 ${success} 台`];
    if (failed > 0) {
      parts.push(`失败 ${failed} 台`);
    }
    if (skipped > 0) {
      parts.push(`跳过 ${skipped} 台`);
    }
    return parts.join(" · ");
  }

  function taskTriggerLabel(trigger) {
    const value = String(trigger || "").toLowerCase();
    const labels = {
      bootstrap_register: "bootstrap 注册",
      bootstrap_refresh: "bootstrap 刷新",
      bootstrap_auto_probe: "注册后自动首探",
      scheduled_probe: "周期巡检调度",
      manual_probe: "手动复探",
      manual: "手动触发",
      init_alpine: "初始化任务",
      publish_proxy_config: "代理配置发布",
      restart_service: "服务重启",
      system_user_apply: "系统用户下发",
      system_template_apply: "系统模板下发",
    };
    return labels[value] || value || "-";
  }

  function renderPayloadValue(key, value) {
    const normalizedKey = String(key || "").toLowerCase();
    if (typeof value === "boolean") {
      return value ? "是" : "否";
    }
    if (Array.isArray(value)) {
      return value.length > 0 ? value.map((item) => renderPayloadValue(normalizedKey, item)).join(" / ") : "空";
    }
    if (value !== null && typeof value === "object") {
      return JSON.stringify(value);
    }
    const text = String(value ?? "");
    if (normalizedKey === "timeout_ms") {
      return formatDuration(Number(text) || 0);
    }
    if (normalizedKey.endsWith("access_mode") || normalizedKey === "probe_type" || normalizedKey === "reason") {
      return PAYLOAD_VALUE_LABELS[text.toLowerCase()] || text;
    }
    return text;
  }

  function renderProbeEvidence(probe, { escapeHtmlFn }) {
    const reasonCode = probe.reason_code || probe.error_message;
    const reasonText = reasonCode ? probeReasonLabel(reasonCode) : null;
    const rows = [
      ["原因", reasonText],
      ["失败阶段", probe.error_stage ? probeStageLabel(probe.error_stage) : null],
      ["探测目标", probe.target || null],
      ["耗时", Number.isFinite(Number(probe.latency_ms)) ? formatDuration(Number(probe.latency_ms)) : null],
      ["健康分", probe.health_score == null ? null : `${probe.health_score} / 100`],
      [
        "原始错误",
        probe.error_message && probeReasonLabel(probe.error_message) !== reasonText
          ? probe.error_message
          : null,
      ],
    ].filter(([, value]) => value != null && value !== "");

    return `
      <div class="task-probe-evidence">
        ${rows
          .map(
            ([label, value]) => `
              <div class="kv-row">
                <span>${escapeHtmlFn(label)}</span>
                <strong>${escapeHtmlFn(String(value))}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderTasksPage() {
    const tasks = appState.tasks;
    const probeScheduler = appState.platform?.probe_scheduler || null;
    const tasksHealth = getCollectionHealth("tasks");
    const platformHealth = getCollectionHealth("platform-context");
    const probeSchedulerView = getProbeSchedulerPresentation(probeScheduler, platformHealth);
    const statusOf = (task) => String(task.status || "new").toLowerCase();
    const failedCount = tasks.filter((task) => statusOf(task) === "failed").length;
    const runningCount = tasks.filter((task) => statusOf(task) === "running").length;
    const successCount = tasks.filter((task) => statusOf(task) === "success").length;
    const pendingCount = tasks.filter((task) => statusOf(task) === "new" || statusOf(task) === "queued").length;
    const filteredTasks = filterTasks(tasks);
    ensureSelectedTask(filteredTasks);
    const selectedTask =
      filteredTasks.find((task) => task.id === appState.taskCenter.selectedTaskId) || null;

    const rows = filteredTasks.length
      ? filteredTasks
          .map((task) => {
            const node = resolveTaskNode(task, appState.nodes);
            const selected = selectedTask?.id === task.id;
            const duration = formatTaskDuration(task);
            return `
              <tr class="${selected ? "task-row-selected" : ""}" data-task-select="${escapeHtml(task.id)}" tabindex="0" aria-label="${escapeHtml(`${getTaskDisplayTitle(task)}，${node ? getNodeDisplayName(node) : "未关联节点"}，${taskStatusText(task.status)}${selected ? "，已选中" : "，回车查看处置详情"}`)}">
                <td><div class="node-meta"><span class="node-name">${escapeHtml(getTaskDisplayTitle(task))}</span><span class="node-id mono">${escapeHtml(task.id)}</span></div></td>
                <td class="task-node-cell">${escapeHtml(node ? getNodeDisplayName(node) : task.node_id || "-")}</td>
                <td><div class="task-status-cell"><span class="${taskStatusClassName(task.status)}">${taskStatusText(task.status)}</span><span class="tiny muted">${escapeHtml(formatTaskRound(task))}${duration ? ` · ${escapeHtml(duration)}` : ""}</span></div></td>
                <td>${renderTaskTime(task)}</td>
                <td class="task-summary-cell task-col-summary"><span class="task-summary-text">${escapeHtml(getTaskSummary(task))}</span></td>
                <td>${renderTaskActionButton(task)}</td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td colspan="6">
            <div class="empty">${
              tasks.length > 0
                ? "当前筛选条件下没有匹配任务。<button class=\"button ghost link-like\" type=\"button\" id=\"task-filters-reset-inline\">清空筛选</button>"
                : tasksHealth?.status === "error"
                  ? `任务数据读取失败（${escapeHtml(tasksHealth.error || "未知原因")}），这里的 0 条不代表没有任务。<button class=\"button ghost link-like\" type=\"button\" id=\"task-load-retry\">重试</button>`
                  : "当前还没有真实任务。下一台新节点完成 bootstrap 后，这里会自动出现初始化和首探任务。"
            }</div>
          </td>
        </tr>
      `;

    const selectedNode = selectedTask ? resolveTaskNode(selectedTask, appState.nodes) : null;
    const selectedOperation = selectedTask ? getLinkedOperation(selectedTask) : null;
    const selectedProbe = selectedTask ? getLinkedProbe(selectedTask) : null;
    const selectedOperationTarget =
      selectedTask && selectedOperation
        ? getLinkedOperationTarget(selectedOperation, selectedTask)
        : null;
    const selectedOperationOutput = normalizeTaskOperationOutput(
      selectedOperationTarget?.output_text || selectedOperationTarget?.output?.join("\n") || "",
    );
    const selectedOperationOutputLines = selectedOperationOutput
      ? selectedOperationOutput.split("\n")
      : [];
    const operationOutputExpanded = Boolean(appState.taskCenter.operationOutputExpanded);
    const operationOutputLimit = 40;
    const visibleOperationOutput =
      operationOutputExpanded || selectedOperationOutputLines.length <= operationOutputLimit
        ? selectedOperationOutput
        : selectedOperationOutputLines.slice(-operationOutputLimit).join("\n");
    const selectedStatus = String(selectedTask?.status || "new").toLowerCase();
    const isSettled = ["success", "failed", "partial"].includes(selectedStatus);
    const selectedDuration = selectedTask ? formatTaskDuration(selectedTask) : null;
    const detailRows = selectedTask
      ? [
          ["任务类型", taskTypeLabel(selectedTask)],
          ["触发方式", taskTriggerLabel(selectedTask.trigger)],
          ["目标节点", selectedNode ? getNodeDisplayName(selectedNode) : selectedTask.node_id || "-"],
          ["当前状态", taskStatusText(selectedTask.status)],
          ["执行轮次", formatTaskRound(selectedTask)],
          ["计划时间", formatDateTime(selectedTask.scheduled_at || selectedTask.created_at)],
          selectedDuration ? ["本次耗时", selectedDuration] : null,
          ["关联执行", selectedTask.operation_id || "无"],
        ].filter(Boolean)
      : [];
    const payloadEntries = selectedTask
      ? Object.entries(selectedTask.payload || {}).filter(
          ([, value]) => value !== null && value !== "" && value !== false,
        )
      : [];
    const payloadRows = payloadEntries
      .slice(0, PROBE_MAX_VISIBLE_ROWS * 2)
      .map(([label, value]) => [PAYLOAD_LABELS[String(label).toLowerCase()] || label, renderPayloadValue(label, value)]);
    const logItems = Array.isArray(selectedTask?.log_excerpt) ? selectedTask.log_excerpt : [];
    const selectedTaskLabel = selectedTask ? getTaskDisplayTitle(selectedTask) : null;

    const diagnosisCopy = (() => {
      if (selectedOperation) {
        return {
          title: "关联执行回显",
          lead: "这里展示当前任务绑定的真实执行结果，完整视图可跳到运维终端。",
        };
      }
      if (selectedProbe) {
        return {
          title: "探测结论",
          lead: "这条任务由控制面直接探测完成，下面是探测记录里的结论。",
        };
      }
      if (selectedStatus === "running") {
        return {
          title: "执行回显",
          lead: "任务正在执行，控制面会在拿到结果后刷新这一栏。",
        };
      }
      if (isSettled) {
        return {
          title: "执行回显",
          lead: "这类任务由控制面直接执行，没有生成执行或探测记录；失败原因看下方任务摘要日志。",
        };
      }
      return {
        title: "执行回显",
        lead: "任务还没开始执行，暂时没有可看的回显。",
      };
    })();

    const detailRail = selectedTask
      ? `
        <aside class="aside-stack tasks-detail-rail">
          <section class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>任务摘要</h3><p>把当前任务的上下文和处置入口收在一侧。</p></div></div>
              <div class="detail-kv task-detail-kv">
                ${detailRows
                  .map(
                    ([label, value]) => `
                      <div class="kv-row">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(String(value))}</strong>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
              <div class="task-detail-actions">
                ${
                  selectedNode
                    ? `<a class="button ghost" href="${nodeDetailHref(selectedNode.id)}">前往节点</a>`
                    : ""
                }
                ${
                  selectedOperation
                    ? `<a class="button ghost" href="${terminalOperationHref(selectedOperation.id)}">查看完整执行</a>`
                    : ""
                }
                ${
                  selectedTask.type === "probe_node"
                    ? renderProbeRetryButton(selectedTask, { fullLabel: true })
                    : ""
                }
                ${
                  selectedTask.type === "init_alpine"
                    ? `<button class="button ghost task-action-button${isTaskActionPending(selectedTask.id) ? " is-loading" : ""}" type="button" data-task-init="${escapeHtml(selectedTask.id)}"${isTaskActionPending(selectedTask.id) ? ' disabled aria-busy="true"' : ""}>${isTaskActionPending(selectedTask.id) ? "初始化中..." : "重新初始化"}</button>`
                    : ""
                }
              </div>
            </div>
          </section>
          <section class="panel task-operation-panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>${escapeHtml(diagnosisCopy.title)}</h3>
                  <p>${escapeHtml(diagnosisCopy.lead)}</p>
                </div>
                ${
                  selectedOperation
                    ? `<span class="${statusClassName(selectedOperationTarget?.status || selectedOperation.status)}">${statusText(selectedOperationTarget?.status || selectedOperation.status)}</span>`
                    : selectedProbe
                      ? `<span class="${selectedProbe.success ? "badge badge-active" : "badge badge-degraded"}">${selectedProbe.success ? "探测通过" : "探测失败"}</span>`
                      : ""
                }
              </div>
              ${
                selectedOperation
                  ? `
                    <div class="task-operation-meta">
                      <div class="task-operation-kv"><span>执行方式</span><strong>${escapeHtml(selectedOperation.mode === "script" ? "脚本" : "命令")}</strong></div>
                      <div class="task-operation-kv"><span>执行记录</span><strong class="mono">${escapeHtml(selectedOperation.id)}</strong></div>
                      <div class="task-operation-kv"><span>目标回显</span><strong>${escapeHtml(selectedOperationTarget?.hostname || selectedTask?.node_id || "-")}</strong></div>
                      <div class="task-operation-kv"><span>完成时间</span><strong>${escapeHtml(
                        selectedOperationTarget?.finished_at
                          ? formatRelativeTime(selectedOperationTarget.finished_at)
                          : selectedOperation.finished_at
                            ? formatRelativeTime(selectedOperation.finished_at)
                            : "未完成",
                      )}</strong></div>
                    </div>
                    ${
                      selectedOperationOutputLines.length > operationOutputLimit
                        ? `
                          <div class="task-operation-toggle-row">
                            <span class="tiny">当前共有 ${selectedOperationOutputLines.length} 行回显</span>
                            <button class="button ghost" type="button" data-task-operation-toggle="true">
                              ${operationOutputExpanded ? "收起回显" : `展开全部（显示 ${selectedOperationOutputLines.length} 行）`}
                            </button>
                          </div>
                        `
                        : ""
                    }
                    <div class="task-operation-window">
                      <div class="task-operation-window-head">
                        <span>${escapeHtml(selectedOperationTarget?.summary || selectedOperation.title || "执行回显")}</span>
                        <span>${escapeHtml(selectedOperationTarget?.transport_label || "-")}</span>
                      </div>
                      <pre class="task-linked-output">${escapeHtml(
                        visibleOperationOutput || "[无完整输出] 当前执行记录未返回标准输出或错误输出。",
                      )}</pre>
                    </div>
                  `
                  : selectedProbe
                    ? renderProbeEvidence(selectedProbe, { escapeHtmlFn: escapeHtml })
                    : '<div class="empty">当前任务没有可展示的执行或探测记录。</div>'
              }
            </div>
          </section>
          <section class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>任务摘要日志</h3><p>任务侧留下的摘录，通常是判断失败原因最直接的一手信息。</p></div></div>
              <div class="event-list task-log-list">
                ${
                  logItems.length > 0
                    ? logItems
                        .map(
                          (line) => `
                            <div class="event">
                              <p>${escapeHtml(line)}</p>
                            </div>
                          `,
                        )
                        .join("")
                    : '<div class="event"><strong>暂无任务日志</strong><p>任务开始执行后，这里会继续显示摘录内容。</p></div>'
                }
              </div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>触发参数</h3><p>确认这条任务在探什么、跑什么、会落到哪台机器上。</p></div></div>
              ${
                payloadRows.length > 0
                  ? `
                    <div class="detail-kv task-detail-kv">
                      ${payloadRows
                        .map(
                          ([label, value]) => `
                            <div class="kv-row">
                              <span>${escapeHtml(label)}</span>
                              <strong>${escapeHtml(String(value))}</strong>
                            </div>
                          `,
                        )
                        .join("")}
                    </div>
                    ${
                      payloadEntries.length > payloadRows.length
                        ? `<p class="tiny muted">另有 ${payloadEntries.length - payloadRows.length} 项空值或重复参数未展示。</p>`
                        : ""
                    }
                  `
                  : '<div class="empty">当前任务没有额外参数。</div>'
              }
            </div>
          </section>
        </aside>
      `
      : "";

    if (!appState.taskCenter.lastRefreshedAt) {
      appState.taskCenter.lastRefreshedAt = new Date().toISOString();
    }
    const dataTime = formatDateTime(appState.taskCenter.lastRefreshedAt);
    const dataAgeSeconds = appState.taskCenter.lastRefreshedAt
      ? Math.max(
          0,
          Math.round((Date.now() - new Date(appState.taskCenter.lastRefreshedAt).getTime()) / 1000),
        )
      : null;
    const dataStale = dataAgeSeconds != null && dataAgeSeconds > STALE_DATA_SECONDS;

    return `
      <section class="panel fade-up tasks-list-panel">
        <div class="panel-body">
          <div class="panel-title">
            <div>
              <h3>任务池</h3>
              <p>按处置优先级排序：失败和在执行的任务排在最前。</p>
            </div>
            <div class="provider-pill">${selectedTaskLabel ? `已选：${escapeHtml(selectedTaskLabel)}` : `共 ${filteredTasks.length} 条${tasksHealth?.status === "error" ? " · 未确认" : ""}`}</div>
          </div>
          <div class="tasks-status-bar">
            <div class="tasks-counts">
              <span class="tasks-count${failedCount > 0 ? " danger" : ""}"><span>失败</span><strong>${failedCount}</strong></span>
              <span class="tasks-count"><span>待处理</span><strong>${pendingCount}</strong></span>
              <span class="tasks-count${runningCount > 0 ? " running" : ""}"><span>执行中</span><strong>${runningCount}</strong></span>
              <span class="tasks-count${successCount > 0 ? " success" : ""}"><span>已成功</span><strong>${successCount}</strong></span>
              <span class="tasks-count muted"><span>筛选后</span><strong>${filteredTasks.length} / ${tasks.length}</strong></span>
            </div>
            <div class="tasks-scheduler-note">
              <span class="${probeSchedulerView.tone}">${escapeHtml(probeSchedulerView.label)}</span>
              <span class="tiny">${escapeHtml(probeSchedulerView.detail)}</span>
            </div>
          </div>
          <div class="tasks-filter-toolbar">
            <div class="field tasks-filter-toolbar-search">
              <label for="task-query">搜索任务</label>
              <input id="task-query" value="${escapeHtml(appState.taskCenter.query)}" placeholder="任务名 / 节点名 / 任务 ID / 触发方式" />
            </div>
            <div class="field tasks-filter-toolbar-field">
              <label for="task-status">状态</label>
              <select id="task-status">
                <option value="all"${appState.taskCenter.status === "all" ? " selected" : ""}>全部</option>
                <option value="new"${appState.taskCenter.status === "new" ? " selected" : ""}>待执行</option>
                <option value="queued"${appState.taskCenter.status === "queued" ? " selected" : ""}>排队中</option>
                <option value="running"${appState.taskCenter.status === "running" ? " selected" : ""}>执行中</option>
                <option value="success"${appState.taskCenter.status === "success" ? " selected" : ""}>已成功</option>
                <option value="failed"${appState.taskCenter.status === "failed" ? " selected" : ""}>失败</option>
                <option value="partial"${appState.taskCenter.status === "partial" ? " selected" : ""}>部分成功</option>
              </select>
            </div>
            <div class="field tasks-filter-toolbar-field">
              <label for="task-type">任务类型</label>
              <select id="task-type">
                <option value="all"${appState.taskCenter.type === "all" ? " selected" : ""}>全部</option>
                <option value="init_alpine"${appState.taskCenter.type === "init_alpine" ? " selected" : ""}>初始化</option>
                <option value="probe_node"${appState.taskCenter.type === "probe_node" ? " selected" : ""}>探测</option>
              </select>
            </div>
            <label class="tasks-actionable-toggle">
              <input id="task-only-actionable" type="checkbox"${appState.taskCenter.onlyActionable ? " checked" : ""} />
              <span>只看可重试的任务</span>
            </label>
            <div class="tasks-filter-toolbar-actions">
              <button class="button ghost" type="button" id="task-filters-reset">清空筛选</button>
              <button class="button ghost task-refresh-button${appState.taskCenter.isRefreshing ? " is-loading" : ""}" type="button" id="task-refresh"${appState.taskCenter.isRefreshing ? ' disabled aria-busy="true"' : ""}>${appState.taskCenter.isRefreshing ? "刷新中..." : "刷新任务"}</button>
            </div>
          </div>
          <div class="tasks-refresh-meta">
            <label class="tasks-auto-refresh-toggle">
              <input id="task-auto-refresh" type="checkbox"${appState.taskCenter.autoRefresh ? " checked" : ""} />
              <span>有任务未完成或巡检在跑时自动刷新</span>
            </label>
            <span class="tiny muted${dataStale ? " is-stale" : ""}" id="task-data-time">数据时间 ${escapeHtml(dataTime)}${
              dataStale ? ` · 已 ${Math.floor(dataAgeSeconds / 60)} 分钟未刷新，可能已过期` : ""
            }</span>
          </div>
          ${
            appState.taskCenter.message
              ? `<div class="message ${appState.taskCenter.message.type}" role="status" aria-live="polite">${escapeHtml(appState.taskCenter.message.text)}</div>`
              : ""
          }
          <div class="tasks-workspace${selectedTask ? " has-selection" : ""}">
            <div class="table-shell tasks-table-shell">
              <table class="list-table" aria-label="任务列表">
                <colgroup>
                  <col class="task-col-task">
                  <col class="task-col-node">
                  <col class="task-col-status">
                  <col class="task-col-time">
                  <col class="task-col-summary">
                  <col class="task-col-action">
                </colgroup>
                <thead>
                  <tr><th scope="col">任务</th><th scope="col">目标节点</th><th scope="col">状态</th><th scope="col">计划时间</th><th scope="col" class="task-col-summary">说明</th><th scope="col">动作</th></tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            ${detailRail}
          </div>
        </div>
      </section>
    `;
  }

  function setupTasksPage() {
    if (page !== "tasks") {
      return;
    }

    bindTasksPageEvents({
      actions,
      documentRef,
    });
    actions.syncAutoRefreshPoll();
  }

  return {
    renderTasksPage,
    setupTasksPage,
  };
}
