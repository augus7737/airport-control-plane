const TASK_POLL_INTERVAL_MS = 15_000;

export function createTasksPageActions(dependencies) {
  const {
    appState,
    documentRef = document,
    fetchImpl = fetch,
    getNodeDisplayName = (node) => node?.id || "",
    refreshRuntimeData,
    renderCurrentContent,
    windowRef = window,
  } = dependencies;

  function clearTaskCenterMessage() {
    appState.taskCenter.message = null;
  }

  function getPendingActionTaskIds() {
    if (appState.taskCenter.pendingActionTaskIds instanceof Set) {
      return appState.taskCenter.pendingActionTaskIds;
    }

    const pending = Array.isArray(appState.taskCenter.pendingActionTaskIds)
      ? new Set(appState.taskCenter.pendingActionTaskIds)
      : new Set();
    appState.taskCenter.pendingActionTaskIds = pending;
    return pending;
  }

  const FOCUS_KEYS = ["data-task-select", "data-task-trigger", "data-task-init", "data-task-operation-toggle"];

  function captureFocusKey(active) {
    if (!active || active === documentRef.body) {
      return null;
    }
    if (active.id) {
      return { attr: "id", value: active.id };
    }
    for (const attr of FOCUS_KEYS) {
      const value = active.getAttribute?.(attr);
      if (value != null) {
        return { attr, value };
      }
    }
    return null;
  }

  function findFocusTarget(key) {
    if (!key) {
      return null;
    }
    if (key.attr === "id") {
      return documentRef.getElementById?.(key.value) || null;
    }
    return (
      [...documentRef.querySelectorAll(`[${key.attr}]`)].find(
        (element) => element.getAttribute(key.attr) === key.value,
      ) || null
    );
  }

  function captureViewport() {
    const tableShell = documentRef.querySelector?.(".tasks-table-shell");
    const active = documentRef.activeElement;
    return {
      scrollY: windowRef.scrollY ?? 0,
      tableScrollLeft: tableShell ? tableShell.scrollLeft : 0,
      focusKey: captureFocusKey(active),
      selectionStart:
        active?.id && typeof active.selectionStart === "number" ? active.selectionStart : null,
    };
  }

  function restoreViewport(snapshot) {
    const tableShell = documentRef.querySelector?.(".tasks-table-shell");
    if (tableShell) {
      tableShell.scrollLeft = snapshot.tableScrollLeft;
    }

    const active = findFocusTarget(snapshot.focusKey);
    if (active) {
      active.focus({ preventScroll: true });
      if (
        snapshot.selectionStart != null &&
        typeof active.setSelectionRange === "function" &&
        active.value != null
      ) {
        const caret = Math.min(snapshot.selectionStart, active.value.length);
        active.setSelectionRange(caret, caret);
      }
    }

    windowRef.scrollTo?.(0, snapshot.scrollY);
  }

  function rerender() {
    const snapshot = captureViewport();
    renderCurrentContent();
    restoreViewport(snapshot);
  }

  function rerenderPreservingScroll() {
    rerender();
  }

  function rerenderWithClearedMessage() {
    clearTaskCenterMessage();
    rerender();
  }

  function setTaskQuery(value) {
    appState.taskCenter.query = value;
    clearTaskCenterMessage();
    clearTimeout(appState.taskCenter._queryTimer);
    appState.taskCenter._queryTimer = setTimeout(() => {
      rerenderPreservingScroll();
    }, 260);
  }

  function setTaskQueryDraft(value) {
    // 输入法组字期间只记账，等 compositionend 再重绘，避免打断组字。
    appState.taskCenter.query = value;
  }

  function setTaskStatus(value) {
    appState.taskCenter.status = value;
    rerenderWithClearedMessage();
  }

  function setTaskType(value) {
    appState.taskCenter.type = value;
    rerenderWithClearedMessage();
  }

  function setOnlyActionable(value) {
    appState.taskCenter.onlyActionable = value;
    rerenderWithClearedMessage();
  }

  function selectTask(taskId) {
    if (!taskId) {
      return;
    }

    const previousSelectedId = appState.taskCenter.selectedTaskId;
    appState.taskCenter.selectedTaskId = taskId;
    appState.taskCenter.operationOutputExpanded = false;

    if (previousSelectedId && previousSelectedId !== taskId) {
      const snapshot = captureViewport();
      rerender();
      const rail = documentRef.querySelector?.(".tasks-detail-rail");
      if (rail && snapshot.scrollY === windowRef.scrollY) {
        rail.scrollIntoView({ block: "nearest" });
      }
      return;
    }

    rerender();

    if (!previousSelectedId) {
      const rail = documentRef.querySelector?.(".tasks-detail-rail");
      if (rail) {
        rail.scrollIntoView({ block: "nearest" });
      }
    }
  }

  function resetTaskFilters() {
    clearTimeout(appState.taskCenter._queryTimer);
    appState.taskCenter.query = "";
    appState.taskCenter.status = "all";
    appState.taskCenter.type = "all";
    appState.taskCenter.onlyActionable = false;
    appState.taskCenter.operationOutputExpanded = false;
    rerenderWithClearedMessage();
  }

  function toggleOperationOutputExpanded() {
    appState.taskCenter.operationOutputExpanded = !appState.taskCenter.operationOutputExpanded;
    rerender();
  }

  function hasInFlightTasks() {
    return appState.tasks.some((task) => {
      const status = String(task.status || "").toLowerCase();
      return status === "running" || status === "queued";
    });
  }

  function taskPoolSignature() {
    const scheduler = appState.platform?.probe_scheduler || {};
    const taskPart = appState.tasks
      .map((task) => `${task.id}:${task.status}:${task.attempt}:${task.finished_at || ""}`)
      .join("|");
    return `${taskPart}#${scheduler.last_finished_at || ""}#${scheduler.running ? 1 : 0}`;
  }

  async function refreshTasksView({ silent = false } = {}) {
    if (appState.taskCenter.isRefreshing) {
      return;
    }

    const before = taskPoolSignature();
    appState.taskCenter.isRefreshing = true;
    if (!silent) {
      rerender();
    }

    try {
      await refreshRuntimeData();
      appState.taskCenter.lastRefreshedAt = new Date().toISOString();
      if (!silent) {
        appState.taskCenter.message = {
          type: "success",
          text: "任务、节点和探测数据已刷新。",
        };
      } else if (before === taskPoolSignature()) {
        // 数据没变，保持当前滚动与焦点，不打断正在读的人。
        return;
      }
    } finally {
      appState.taskCenter.isRefreshing = false;
      rerender();
    }
  }

  function syncAutoRefreshPoll() {
    const shouldPoll = Boolean(appState.taskCenter.autoRefresh) && hasInFlightTasks();

    if (!shouldPoll) {
      if (appState.taskCenter._pollTimer) {
        windowRef.clearInterval(appState.taskCenter._pollTimer);
        appState.taskCenter._pollTimer = null;
      }
      return;
    }

    if (appState.taskCenter._pollTimer) {
      return;
    }

    appState.taskCenter._pollTimer = windowRef.setInterval(() => {
      if (documentRef.visibilityState === "hidden") {
        return;
      }
      if (!appState.taskCenter.autoRefresh || !hasInFlightTasks()) {
        return;
      }
      void refreshTasksView({ silent: true });
    }, TASK_POLL_INTERVAL_MS);
  }

  function setAutoRefresh(value) {
    appState.taskCenter.autoRefresh = Boolean(value);
    syncAutoRefreshPoll();
    rerender();
  }

  function resolveTaskActionRequest(task) {
    const nodeId = task?.node_id;
    if (!nodeId) {
      return null;
    }

    if (task.type === "init_alpine") {
      const templateKey = task.template || task.payload?.template || "alpine-base";
      const systemTemplateId =
        typeof task.payload?.system_template_id === "string" && task.payload.system_template_id.trim()
          ? task.payload.system_template_id.trim()
          : typeof templateKey === "string" && templateKey.startsWith("system-template:")
            ? templateKey.slice("system-template:".length).trim() || null
            : null;

      const node = appState.nodes.find((item) => item.id === nodeId);

      return {
        label: "重新初始化",
        successText: "已重新触发初始化任务。",
        confirmation: `重新初始化会在这台节点上重新执行装配脚本：会重启 sshd 服务、重写 /etc/airport/node.env，并可能覆盖已有配置。\n\n节点：${getNodeDisplayName(node)}\n模板：${systemTemplateId ? `系统模板 ${systemTemplateId}` : templateKey}`,
        url: `/api/v1/nodes/${encodeURIComponent(nodeId)}/init`,
        options: {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ...(systemTemplateId
              ? {
                  system_template_id: systemTemplateId,
                  ...(task.payload?.template_snapshot
                    ? {
                        template_snapshot: task.payload.template_snapshot,
                      }
                    : {}),
                }
              : {
                  template: templateKey,
                }),
          }),
        },
      };
    }

    if (task.type === "probe_node") {
      return {
        label: "立即复探",
        successText: "已重新触发节点复探。",
        url: `/api/v1/nodes/${encodeURIComponent(nodeId)}/probe`,
        options: {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            probe_type: task.payload?.probe_type || "full_stack",
          }),
        },
      };
    }

    return null;
  }

  async function triggerTaskAction(taskId) {
    if (!taskId) {
      return;
    }

    const pending = getPendingActionTaskIds();
    if (pending.has(taskId)) {
      return;
    }

    const task = appState.tasks.find((item) => item.id === taskId);
    if (!task) {
      appState.taskCenter.message = { type: "error", text: "当前任务不存在或已更新。" };
      rerender();
      return;
    }

    const actionRequest = resolveTaskActionRequest(task);
    if (!actionRequest) {
      appState.taskCenter.message = {
        type: "error",
        text: "当前任务暂不支持直接重试，请前往对应节点处理。",
      };
      rerender();
      return;
    }

    if (actionRequest.confirmation && !windowRef.confirm(actionRequest.confirmation)) {
      return;
    }

    pending.add(taskId);
    clearTaskCenterMessage();
    rerender();

    try {
      const response = await fetchImpl(actionRequest.url, actionRequest.options);
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result.details?.join("，") || result.message || `${actionRequest.label}失败`,
        );
      }

      await refreshRuntimeData();
      appState.taskCenter.lastRefreshedAt = new Date().toISOString();
      appState.taskCenter.selectedTaskId = result.task?.id || taskId;
      appState.taskCenter.message = {
        type: "success",
        text: actionRequest.successText,
      };
      rerender();
    } catch (error) {
      appState.taskCenter.message = {
        type: "error",
        text:
          error instanceof Error
            ? `${actionRequest.label}失败：${error.message}`
            : `${actionRequest.label}失败`,
      };
    } finally {
      pending.delete(taskId);
      rerender();
      syncAutoRefreshPoll();
    }
  }

  return {
    refreshTasksView,
    resetTaskFilters,
    selectTask,
    setAutoRefresh,
    setOnlyActionable,
    setTaskQuery,
    setTaskQueryDraft,
    setTaskStatus,
    setTaskType,
    syncAutoRefreshPoll,
    toggleOperationOutputExpanded,
    triggerTaskAction,
  };
}
