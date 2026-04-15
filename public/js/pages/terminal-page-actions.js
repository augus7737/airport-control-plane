export function createTerminalPageActions(dependencies) {
  const {
    appState,
    applyTerminalPreset,
    fetchImpl = fetch,
    getAccessMode,
    refreshOperations,
    renderCurrentContent,
    setOperations,
    windowRef = window,
  } = dependencies;

  function syncActiveOperationUrl(operationId) {
    if (!windowRef?.location || !windowRef?.history?.replaceState) {
      return;
    }

    const url = new URL(windowRef.location.href);
    if (operationId) {
      url.searchParams.set("operation_id", operationId);
    } else {
      url.searchParams.delete("operation_id");
    }
    windowRef.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function rerenderWithClearedMessage() {
    appState.terminal.message = null;
    renderCurrentContent();
  }

  function setTerminalMode(mode) {
    appState.terminal.mode = mode;
    rerenderWithClearedMessage();
  }

  function toggleNodeSelection(nodeId, checked) {
    if (!nodeId) return;

    const selected = new Set(appState.terminal.selectedNodeIds);
    if (checked) {
      selected.add(nodeId);
    } else {
      selected.delete(nodeId);
    }
    appState.terminal.selectedNodeIds = [...selected];
    rerenderWithClearedMessage();
  }

  function applyPreset(preset) {
    applyTerminalPreset(appState, preset);
    rerenderWithClearedMessage();
  }

  function setActiveOperation(operationId) {
    appState.terminal.activeOperationId = operationId;
    syncActiveOperationUrl(operationId);
    renderCurrentContent();
  }

  function setTerminalTitle(value) {
    appState.terminal.title = value;
  }

  function setTerminalCommand(value) {
    appState.terminal.command = value;
  }

  function setTerminalScriptName(value) {
    appState.terminal.script_name = value;
  }

  function setTerminalScriptBody(value) {
    appState.terminal.script_body = value;
  }

  function selectActiveNodes() {
    appState.terminal.selectedNodeIds = appState.nodes
      .filter((node) => String(node.status).toLowerCase() === "active")
      .map((node) => node.id);
    rerenderWithClearedMessage();
  }

  function selectRelayNodes() {
    appState.terminal.selectedNodeIds = appState.nodes
      .filter((node) => getAccessMode(node) === "relay")
      .map((node) => node.id);
    rerenderWithClearedMessage();
  }

  function selectAllNodes() {
    appState.terminal.selectedNodeIds = appState.nodes.map((node) => node.id);
    rerenderWithClearedMessage();
  }

  function clearSelectedNodes() {
    appState.terminal.selectedNodeIds = [];
    rerenderWithClearedMessage();
  }

  async function refreshExecutionRecords() {
    await refreshOperations();
    appState.terminal.message = {
      type: "success",
      text: "执行记录与回显已刷新。",
    };
    renderCurrentContent();
  }

  function buildExecutePayload() {
    return {
      mode: appState.terminal.mode,
      title: appState.terminal.title.trim() || null,
      node_ids: appState.terminal.selectedNodeIds,
      command: appState.terminal.mode === "command" ? appState.terminal.command.trim() : null,
      script_name:
        appState.terminal.mode === "script" ? appState.terminal.script_name.trim() || null : null,
      script_body: appState.terminal.mode === "script" ? appState.terminal.script_body.trim() : null,
    };
  }

  async function submitExecution() {
    const payload = buildExecutePayload();
    try {
      const response = await fetchImpl("/api/v1/operations/execute", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.details?.join("，") || result.message || "执行失败");
      }

      setOperations([
        result.operation,
        ...appState.operations.filter((item) => item.id !== result.operation.id),
      ]);
      appState.terminal.activeOperationId = result.operation.id;
      syncActiveOperationUrl(result.operation.id);
      appState.terminal.message = {
        type: "success",
        text: `任务已提交，正在等待节点回传${appState.terminal.mode === "script" ? "脚本" : "命令"}执行结果。`,
      };
      renderCurrentContent();
    } catch (error) {
      appState.terminal.message = {
        type: "error",
        text: error instanceof Error ? error.message : "执行失败",
      };
      renderCurrentContent();
    }
  }

  return {
    applyPreset,
    clearSelectedNodes,
    refreshExecutionRecords,
    selectActiveNodes,
    selectAllNodes,
    selectRelayNodes,
    setActiveOperation,
    setTerminalCommand,
    setTerminalMode,
    setTerminalScriptBody,
    setTerminalScriptName,
    setTerminalTitle,
    submitExecution,
    toggleNodeSelection,
  };
}
