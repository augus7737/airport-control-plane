import { createTasksPageActions } from "./tasks-page-actions.js";
import { bindTasksPageEvents } from "./tasks-page-bindings.js";

export function createTasksPageModule(dependencies) {
  const {
    appState,
    documentRef = document,
    escapeHtml,
    fetchImpl = fetch,
    formatRelativeTime,
    formatTaskAttempt,
    getNodeDisplayName,
    getTaskDisplayTitle,
    getTaskSummary,
    nodeDetailHref = (nodeId) => `/node.html?id=${encodeURIComponent(nodeId)}`,
    page,
    refreshRuntimeData,
    renderCurrentContent,
    resolveTaskNode,
    statusClassName,
    statusText,
    terminalOperationHref = (operationId) =>
      `/terminal.html?operation_id=${encodeURIComponent(operationId)}#terminal-output-panel`,
    windowRef = window,
  } = dependencies;
  const actions = createTasksPageActions({
    appState,
    fetchImpl,
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

    return tasks.filter((task) => {
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

    appState.taskCenter.selectedTaskId = filteredTasks[0]?.id || null;
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

  function renderTaskActionButton(task) {
    const pending = isTaskActionPending(task.id);

    if (task.type === "init_alpine") {
      return `<button class="button ghost task-action-button${pending ? " is-loading" : ""}" type="button" data-task-trigger="${escapeHtml(task.id)}"${pending ? ' disabled aria-busy="true"' : ""}>${pending ? "初始化中..." : "重新初始化"}</button>`;
    }

    if (task.type === "probe_node") {
      return `<button class="button ghost task-action-button${pending ? " is-loading" : ""}" type="button" data-task-trigger="${escapeHtml(task.id)}"${pending ? ' disabled aria-busy="true"' : ""}>${pending ? "复探中..." : "立即复探"}</button>`;
    }

    return '<span class="tiny">暂不支持</span>';
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

  function formatDurationCompact(milliseconds) {
    const value = Number(milliseconds || 0);
    if (!Number.isFinite(value) || value <= 0) {
      return "未设置";
    }

    const totalSeconds = Math.round(value / 1000);
    if (totalSeconds < 60) {
      return `${totalSeconds} 秒`;
    }

    const totalMinutes = Math.round(totalSeconds / 60);
    if (totalMinutes < 60) {
      return `${totalMinutes} 分钟`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  }

  function getProbeSchedulerPresentation(probeScheduler) {
    if (!probeScheduler?.enabled) {
      return {
        scheduleTone: "muted",
        scheduleLabel: "未启用",
        runtimeTone: "muted",
        runtimeLabel: "已暂停",
      };
    }

    if (probeScheduler.running) {
      return {
        scheduleTone: "success",
        scheduleLabel: "已启用",
        runtimeTone: "running",
        runtimeLabel: "巡检中",
      };
    }

    if (probeScheduler.last_error) {
      return {
        scheduleTone: "success",
        scheduleLabel: "已启用",
        runtimeTone: "failed",
        runtimeLabel: "最近异常",
      };
    }

    return {
      scheduleTone: "success",
      scheduleLabel: "已启用",
      runtimeTone: "success",
      runtimeLabel: "空闲",
    };
  }

  function getScheduledProbeTaskStats(tasks) {
    const scheduledTasks = tasks.filter((task) => String(task.trigger || "") === "scheduled_probe");
    return {
      total: scheduledTasks.length,
      running: scheduledTasks.filter(
        (task) => String(task.status || "").toLowerCase() === "running",
      ).length,
      failed: scheduledTasks.filter(
        (task) => String(task.status || "").toLowerCase() === "failed",
      ).length,
      success: scheduledTasks.filter(
        (task) => String(task.status || "").toLowerCase() === "success",
      ).length,
      pending: scheduledTasks.filter((task) => {
        const status = String(task.status || "new").toLowerCase();
        return status === "new" || status === "queued";
      }).length,
      latest: scheduledTasks[0] || null,
    };
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

  function renderTasksPage() {
    const tasks = appState.tasks;
    const probeScheduler = appState.platform?.probe_scheduler || null;
    const probeSchedulerView = getProbeSchedulerPresentation(probeScheduler);
    const scheduledProbeStats = getScheduledProbeTaskStats(tasks);
    const latestScheduledProbeTask = scheduledProbeStats.latest;
    const runningCount = tasks.filter((task) => String(task.status || "").toLowerCase() === "running").length;
    const successCount = tasks.filter((task) => String(task.status || "").toLowerCase() === "success").length;
    const failedCount = tasks.filter((task) => String(task.status || "").toLowerCase() === "failed").length;
    const pendingCount = tasks.filter((task) => {
      const status = String(task.status || "new").toLowerCase();
      return status === "new" || status === "queued";
    }).length;
    const actionableCount = tasks.filter((task) => isActionableTask(task)).length;
    const filteredTasks = filterTasks(tasks);
    ensureSelectedTask(filteredTasks);
    const selectedTask = filteredTasks.find((task) => task.id === appState.taskCenter.selectedTaskId) || null;

    const rows = filteredTasks.length
      ? filteredTasks
          .map((task) => {
            const node = resolveTaskNode(task, appState.nodes);
            const selected = selectedTask?.id === task.id;
            return `
              <tr class="${selected ? "task-row-selected" : ""}" data-task-select="${escapeHtml(task.id)}">
                <td><div class="node-meta"><span class="node-name">${escapeHtml(getTaskDisplayTitle(task))}</span><span class="node-id mono">${escapeHtml(task.id)}</span></div></td>
                <td>${escapeHtml(node ? getNodeDisplayName(node) : task.node_id || "-")}</td>
                <td>${escapeHtml(taskTypeLabel(task))}</td>
                <td><span class="${statusClassName(task.status)}">${statusText(task.status)}</span></td>
                <td>${escapeHtml(formatTaskAttempt(task))}</td>
                <td>${formatRelativeTime(task.started_at || task.scheduled_at || task.created_at)}</td>
                <td>${escapeHtml(getTaskSummary(task))}</td>
                <td>${renderTaskActionButton(task)}</td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td colspan="8">
            <div class="empty">${
              tasks.length > 0
                ? "当前筛选条件下没有匹配任务。"
                : "当前还没有真实任务。下一台新节点完成 bootstrap 后，这里会自动出现初始化和首探任务。"
            }</div>
          </td>
        </tr>
      `;

    const selectedNode = selectedTask ? resolveTaskNode(selectedTask, appState.nodes) : null;
    const selectedOperation = selectedTask ? getLinkedOperation(selectedTask) : null;
    const selectedOperationTarget =
      selectedTask && selectedOperation
        ? getLinkedOperationTarget(selectedOperation, selectedTask)
        : null;
    const selectedOperationOutput = normalizeTaskOperationOutput(
      selectedOperationTarget?.output_text ||
        selectedOperationTarget?.output?.join("\n") ||
        "",
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
    const detailRows = selectedTask
      ? [
          ["任务类型", taskTypeLabel(selectedTask)],
          ["触发方式", selectedTask.trigger || "-"],
          ["目标节点", selectedNode ? getNodeDisplayName(selectedNode) : selectedTask.node_id || "-"],
          ["当前状态", statusText(selectedTask.status)],
          ["重试次数", formatTaskAttempt(selectedTask)],
          ["计划时间", formatRelativeTime(selectedTask.scheduled_at || selectedTask.created_at)],
          ["关联执行", selectedTask.operation_id || "无"],
        ]
      : [];
    const payloadRows = selectedTask
      ? Object.entries(selectedTask.payload || {})
          .filter(([, value]) => value !== null && value !== "" && value !== false)
          .slice(0, 8)
      : [];
    const logItems = Array.isArray(selectedTask?.log_excerpt) ? selectedTask.log_excerpt : [];

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">待执行</div><div class="stat-value">${pendingCount}</div><div class="stat-foot">刚注册、等待进入初始化或等待人工重试的任务。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">执行中</div><div class="stat-value">${runningCount}</div><div class="stat-foot">当前正在运行的初始化或修复任务。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">已成功</div><div class="stat-value">${successCount}</div><div class="stat-foot">已经完成并落账到节点生命周期里的任务。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">失败</div><div class="stat-value">${failedCount}</div><div class="stat-foot">需要人工确认或点击重试的任务。</div></div></article>
      </section>
      <section class="panel fade-up tasks-probe-panel" style="margin-top:18px;">
        <div class="panel-body tasks-probe-body">
          <div class="panel-title tasks-probe-title">
            <div>
              <h3>自动巡检</h3>
              <p>集中查看周期调度状态、最近一轮结果，以及 <code>scheduled_probe</code> 任务积压。</p>
            </div>
            <div class="tasks-probe-badges">
              <span class="${statusClassName(probeSchedulerView.scheduleTone)}">${probeSchedulerView.scheduleLabel}</span>
              <span class="${statusClassName(probeSchedulerView.runtimeTone)}">${probeSchedulerView.runtimeLabel}</span>
            </div>
          </div>
          <div class="tasks-probe-strip">
            <div class="tasks-probe-item">
              <span>调度节奏</span>
              <strong>${escapeHtml(formatDurationCompact(probeScheduler?.interval_ms))}</strong>
              <small>每轮 ${escapeHtml(String(probeScheduler?.batch_size || 0))} 台，最小间隔 ${escapeHtml(
                formatDurationCompact(probeScheduler?.min_probe_gap_ms),
              )}</small>
            </div>
            <div class="tasks-probe-item">
              <span>下一轮</span>
              <strong>${escapeHtml(
                probeScheduler?.enabled && probeScheduler?.next_run_at
                  ? formatRelativeTime(probeScheduler.next_run_at)
                  : "未安排",
              )}</strong>
              <small>${escapeHtml(
                probeScheduler?.last_run_at
                  ? `上次启动 ${formatRelativeTime(probeScheduler.last_run_at)}`
                  : "尚未进入自动巡检",
              )}</small>
            </div>
            <div class="tasks-probe-item">
              <span>最近一轮</span>
              <strong>${escapeHtml(formatProbeRunSummary(probeScheduler?.last_run_summary))}</strong>
              <small>${escapeHtml(
                probeScheduler?.last_finished_at
                  ? `完成于 ${formatRelativeTime(probeScheduler.last_finished_at)}`
                  : "还没有完成记录",
              )}</small>
            </div>
            <div class="tasks-probe-item">
              <span>周期任务</span>
              <strong>${escapeHtml(String(scheduledProbeStats.total))} 条</strong>
              <small>${escapeHtml(
                `失败 ${scheduledProbeStats.failed} / 运行中 ${scheduledProbeStats.running} / 待执行 ${scheduledProbeStats.pending}`,
              )}</small>
            </div>
          </div>
          <div class="chips tasks-probe-chips">
            <div class="pill"><span>成功沉淀</span><strong>${scheduledProbeStats.success} 条</strong></div>
            <div class="pill"><span>最近周期任务</span><strong>${escapeHtml(
              latestScheduledProbeTask
                ? formatRelativeTime(
                    latestScheduledProbeTask.started_at ||
                      latestScheduledProbeTask.scheduled_at ||
                      latestScheduledProbeTask.created_at,
                  )
                : "暂无",
            )}</strong></div>
            ${
              probeScheduler?.jitter_ms
                ? `<div class="pill"><span>抖动保护</span><strong>${escapeHtml(
                    formatDurationCompact(probeScheduler.jitter_ms),
                  )}</strong></div>`
                : ""
            }
            ${
              probeScheduler?.last_error
                ? `<div class="pill danger"><span>最近异常</span><strong>${escapeHtml(probeScheduler.last_error)}</strong></div>`
                : ""
            }
          </div>
        </div>
      </section>
      <section class="panel fade-up tasks-filter-panel" style="margin-top:18px;">
        <div class="panel-body">
          <div class="panel-title"><div><h3>任务筛选</h3><p>先按状态、任务类型和关键字收敛，再进入单条任务的摘要和动作。</p></div></div>
          <div class="form-grid tasks-filter-grid">
            <div class="field full-row">
              <label for="task-query">搜索任务</label>
              <input id="task-query" value="${escapeHtml(appState.taskCenter.query)}" placeholder="任务名 / 节点名 / 任务 ID / 触发方式" />
            </div>
            <div class="field">
              <label for="task-status">状态</label>
              <select id="task-status">
                <option value="all"${appState.taskCenter.status === "all" ? " selected" : ""}>全部</option>
                <option value="new"${appState.taskCenter.status === "new" ? " selected" : ""}>待执行</option>
                <option value="running"${appState.taskCenter.status === "running" ? " selected" : ""}>执行中</option>
                <option value="success"${appState.taskCenter.status === "success" ? " selected" : ""}>已成功</option>
                <option value="failed"${appState.taskCenter.status === "failed" ? " selected" : ""}>失败</option>
              </select>
            </div>
            <div class="field">
              <label for="task-type">任务类型</label>
              <select id="task-type">
                <option value="all"${appState.taskCenter.type === "all" ? " selected" : ""}>全部</option>
                <option value="init_alpine"${appState.taskCenter.type === "init_alpine" ? " selected" : ""}>初始化</option>
                <option value="probe_node"${appState.taskCenter.type === "probe_node" ? " selected" : ""}>探测</option>
              </select>
            </div>
            <label class="tasks-actionable-toggle">
              <input id="task-only-actionable" type="checkbox"${appState.taskCenter.onlyActionable ? " checked" : ""} />
              <span>只看可直接处置的任务</span>
            </label>
          </div>
          <div class="chips tasks-filter-summary">
            <div class="pill"><span>当前筛选</span><strong>${filteredTasks.length} 条</strong></div>
            <div class="pill"><span>可处置</span><strong>${actionableCount} 条</strong></div>
            <button class="button ghost" type="button" id="task-filters-reset">清空筛选</button>
            <button class="button ghost" type="button" id="task-refresh">刷新任务</button>
          </div>
          ${
            appState.taskCenter.message
              ? `<div class="message ${appState.taskCenter.message.type}" style="margin-top:12px;">${escapeHtml(appState.taskCenter.message.text)}</div>`
              : ""
          }
        </div>
      </section>
      <section class="workspace fade-up" style="margin-top:18px;">
        <article class="panel">
          <div class="panel-body">
            <div class="panel-title"><div><h3>任务列表</h3><p>初始化、自动首探、修复和面板同步等动作都会在这里持续追踪。</p></div><div class="provider-pill">共 ${filteredTasks.length} 条</div></div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>任务</th><th>目标节点</th><th>类型</th><th>状态</th><th>重试</th><th>计划时间</th><th>说明</th><th>动作</th></tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </article>
        <aside class="aside-stack">
          <section class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>任务摘要</h3><p>${selectedTask ? "把当前任务的上下文、触发参数和动作收在一侧。" : "先从左侧选择一条任务。"} </p></div></div>
              ${
                selectedTask
                  ? `
                    <div class="detail-kv task-detail-kv">
                      ${detailRows
                        .map(
                          ([label, value]) => `
                            <div class="kv-row">
                              <span>${escapeHtml(label)}</span>
                              <strong>${escapeHtml(value)}</strong>
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
                        isActionableTask(selectedTask)
                          ? `<button class="button primary task-action-button${isTaskActionPending(selectedTask.id) ? " is-loading" : ""}" type="button" data-task-trigger="${escapeHtml(selectedTask.id)}"${isTaskActionPending(selectedTask.id) ? ' disabled aria-busy="true"' : ""}>${selectedTask.type === "init_alpine" ? (isTaskActionPending(selectedTask.id) ? "初始化中..." : "重新初始化") : isTaskActionPending(selectedTask.id) ? "复探中..." : "立即复探"}</button>`
                          : ""
                      }
                    </div>
                  `
                  : '<div class="empty">当前没有可查看的任务摘要。</div>'
              }
            </div>
          </section>
          <section class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>触发参数</h3><p>方便确认这条任务到底在探什么、跑什么、会落到哪台机器上。</p></div></div>
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
                  `
                  : '<div class="empty">当前任务没有额外参数。</div>'
              }
            </div>
          </section>
          <section class="panel task-operation-panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>关联执行回显</h3>
                  <p>${
                    selectedOperation
                      ? "这里展示当前任务绑定的真实执行结果，完整视图可跳到运维终端。"
                      : "当前任务还没有绑定执行记录，通常表示它还未真正下发到节点。"
                  }</p>
                </div>
                ${
                  selectedOperation
                    ? `<span class="${statusClassName(selectedOperationTarget?.status || selectedOperation.status)}">${statusText(selectedOperationTarget?.status || selectedOperation.status)}</span>`
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
                  : '<div class="empty">当前任务还没有可查看的关联执行回显。</div>'
              }
            </div>
          </section>
          <section class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>任务摘要日志</h3><p>这里保留任务侧的摘要日志，适合快速扫一眼状态变化。</p></div></div>
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
                    : '<div class="event"><strong>暂无任务日志</strong><p>后续任务开始执行后，这里会继续显示摘录内容。</p></div>'
                }
              </div>
            </div>
          </section>
        </aside>
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
  }

  return {
    renderTasksPage,
    setupTasksPage,
  };
}
