export function bindTerminalPageEvents(dependencies) {
  const { actions, documentRef = document } = dependencies;

  documentRef.querySelectorAll("[data-terminal-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      actions.setTerminalMode(button.dataset.terminalMode);
    });
  });

  documentRef.querySelectorAll("[data-terminal-node-id]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const nodeId = event.currentTarget.dataset.terminalNodeId;
      actions.toggleNodeSelection(nodeId, Boolean(event.currentTarget.checked));
    });
  });

  documentRef.querySelectorAll("[data-terminal-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      actions.applyPreset(button.dataset.terminalPreset);
    });
  });

  documentRef.querySelectorAll("[data-operation-id]").forEach((button) => {
    button.addEventListener("click", () => {
      actions.setActiveOperation(button.dataset.operationId);
    });
  });

  documentRef.getElementById("terminal-title")?.addEventListener("input", (event) => {
    actions.setTerminalTitle(event.currentTarget.value);
  });

  documentRef.getElementById("terminal-command")?.addEventListener("input", (event) => {
    actions.setTerminalCommand(event.currentTarget.value);
  });

  documentRef.getElementById("terminal-script-name")?.addEventListener("input", (event) => {
    actions.setTerminalScriptName(event.currentTarget.value);
  });

  documentRef.getElementById("terminal-script-body")?.addEventListener("input", (event) => {
    actions.setTerminalScriptBody(event.currentTarget.value);
  });

  documentRef.getElementById("terminal-select-active")?.addEventListener("click", () => {
    actions.selectActiveNodes();
  });

  documentRef.getElementById("terminal-select-relay")?.addEventListener("click", () => {
    actions.selectRelayNodes();
  });

  documentRef.getElementById("terminal-select-all")?.addEventListener("click", () => {
    actions.selectAllNodes();
  });

  documentRef.getElementById("terminal-clear-selection")?.addEventListener("click", () => {
    actions.clearSelectedNodes();
  });

  documentRef.getElementById("terminal-refresh")?.addEventListener("click", async () => {
    await actions.refreshExecutionRecords();
  });

  documentRef.getElementById("terminal-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await actions.submitExecution();
  });
}
