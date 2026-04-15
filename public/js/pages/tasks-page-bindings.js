export function bindTasksPageEvents(dependencies) {
  const { actions, documentRef = document } = dependencies;

  documentRef.getElementById("task-query")?.addEventListener("input", (event) => {
    actions.setTaskQuery(event.currentTarget.value);
  });

  documentRef.getElementById("task-status")?.addEventListener("change", (event) => {
    actions.setTaskStatus(event.currentTarget.value);
  });

  documentRef.getElementById("task-type")?.addEventListener("change", (event) => {
    actions.setTaskType(event.currentTarget.value);
  });

  documentRef.getElementById("task-only-actionable")?.addEventListener("change", (event) => {
    actions.setOnlyActionable(Boolean(event.currentTarget.checked));
  });

  documentRef.getElementById("task-filters-reset")?.addEventListener("click", () => {
    actions.resetTaskFilters();
  });

  documentRef.getElementById("task-refresh")?.addEventListener("click", async () => {
    await actions.refreshTasksView();
  });

  documentRef.querySelectorAll("[data-task-select]").forEach((element) => {
    element.addEventListener("click", () => {
      actions.selectTask(element.getAttribute("data-task-select"));
    });
  });

  documentRef.querySelectorAll("[data-task-trigger]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (button.disabled || button.getAttribute("aria-busy") === "true") {
        return;
      }
      await actions.triggerTaskAction(button.getAttribute("data-task-trigger"));
    });
  });

  documentRef.querySelectorAll("[data-task-operation-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      actions.toggleOperationOutputExpanded();
    });
  });
}
