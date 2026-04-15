export function createTerminalPageStateModule(dependencies) {
  const {
    appState,
  } = dependencies;

  function getActiveOperation(operations) {
    return (
      operations.find((item) => item.id === appState.terminal.activeOperationId) ||
      operations[0] ||
      null
    );
  }

  function getNodeOperations(node, operations) {
    if (!node) return [];
    return operations.filter((operation) =>
      Array.isArray(operation.targets)
        ? operation.targets.some((target) => target.node_id === node.id)
        : false,
    );
  }

  function getNodeOperationTarget(operation, nodeId) {
    if (!operation || !Array.isArray(operation.targets)) {
      return null;
    }

    return operation.targets.find((target) => target.node_id === nodeId) || null;
  }

  function getActiveNodeOperation(node, operations) {
    const nodeOperations = getNodeOperations(node, operations);
    return (
      nodeOperations.find((item) => item.id === appState.nodeTerminal.activeOperationId) ||
      nodeOperations[0] ||
      null
    );
  }

  function formatOperationSubject(operation) {
    if (!operation) return "未命名操作";
    if (operation.mode === "command") {
      return operation.command || operation.title || "Shell 命令";
    }
    return operation.script_name || operation.title || "脚本执行";
  }

  return {
    formatOperationSubject,
    getActiveNodeOperation,
    getActiveOperation,
    getNodeOperationTarget,
    getNodeOperations,
  };
}
