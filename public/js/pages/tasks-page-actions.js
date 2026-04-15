export function createTasksPageActions(dependencies) {
  const {
    appState,
    fetchImpl = fetch,
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

  function rerender() {
    renderCurrentContent();
  }

  function rerenderWithClearedMessage() {
    clearTaskCenterMessage();
    rerender();
  }

  function setTaskQuery(value) {
    appState.taskCenter.query = value;
    rerenderWithClearedMessage();
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

    appState.taskCenter.selectedTaskId = taskId;
    appState.taskCenter.operationOutputExpanded = false;
    rerender();
  }

  function resetTaskFilters() {
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

  async function refreshTasksView() {
    await refreshRuntimeData();
    appState.taskCenter.message = {
      type: "success",
      text: "任务、节点和探测数据已刷新。",
    };
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

      return {
        label: "重新初始化",
        successText: "已重新触发初始化任务。",
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
            probe_type: task.payload?.probe_type || "ssh_auth",
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
      windowRef.alert("当前任务不存在或已更新。");
      return;
    }

    const actionRequest = resolveTaskActionRequest(task);
    if (!actionRequest) {
      windowRef.alert("当前任务暂不支持直接重试，请前往对应节点处理。");
      return;
    }

    pending.add(taskId);
    clearTaskCenterMessage();
    rerender();

    try {
      const response = await fetchImpl(actionRequest.url, actionRequest.options);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.details?.join("，") || result.message || `${actionRequest.label}失败`);
      }

      await refreshRuntimeData();
      appState.taskCenter.selectedTaskId = result.task?.id || taskId;
      appState.taskCenter.message = {
        type: "success",
        text: actionRequest.successText,
      };
      rerender();
    } catch (error) {
      appState.taskCenter.message = {
        type: "error",
        text: error instanceof Error ? error.message : `${actionRequest.label}失败`,
      };
    } finally {
      pending.delete(taskId);
      rerender();
    }
  }

  return {
    refreshTasksView,
    resetTaskFilters,
    selectTask,
    setOnlyActionable,
    setTaskQuery,
    setTaskStatus,
    setTaskType,
    toggleOperationOutputExpanded,
    triggerTaskAction,
  };
}
