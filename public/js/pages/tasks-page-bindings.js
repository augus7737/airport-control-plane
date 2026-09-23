export function bindTasksPageEvents(dependencies) {
  const { actions, documentRef = document } = dependencies;

  const queryInput = documentRef.getElementById("task-query");
  if (queryInput) {
    let composing = false;

    queryInput.addEventListener("compositionstart", () => {
      composing = true;
    });

    queryInput.addEventListener("compositionend", (event) => {
      composing = false;
      actions.setTaskQuery(event.currentTarget.value);
    });

    queryInput.addEventListener("input", (event) => {
      if (composing) {
        actions.setTaskQueryDraft(event.currentTarget.value);
        return;
      }
      actions.setTaskQuery(event.currentTarget.value);
    });
  }

  documentRef.getElementById("task-status")?.addEventListener("change", (event) => {
    actions.setTaskStatus(event.currentTarget.value);
  });

  documentRef.getElementById("task-type")?.addEventListener("change", (event) => {
    actions.setTaskType(event.currentTarget.value);
  });

  documentRef.getElementById("task-only-actionable")?.addEventListener("change", (event) => {
    actions.setOnlyActionable(Boolean(event.currentTarget.checked));
  });

  documentRef.getElementById("task-auto-refresh")?.addEventListener("change", (event) => {
    actions.setAutoRefresh(Boolean(event.currentTarget.checked));
  });

  documentRef.getElementById("task-filters-reset")?.addEventListener("click", () => {
    actions.resetTaskFilters();
  });

  documentRef.getElementById("task-filters-reset-inline")?.addEventListener("click", () => {
    actions.resetTaskFilters();
  });

  documentRef.getElementById("task-load-retry")?.addEventListener("click", async () => {
    await actions.refreshTasksView();
  });

  documentRef.getElementById("task-refresh")?.addEventListener("click", async () => {
    await actions.refreshTasksView();
  });

  documentRef.querySelectorAll("[data-task-select]").forEach((element) => {
    const taskId = element.getAttribute("data-task-select");

    element.addEventListener("click", () => {
      actions.selectTask(taskId);
    });

    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      actions.selectTask(taskId);
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

  documentRef.querySelectorAll("[data-task-init]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (button.disabled || button.getAttribute("aria-busy") === "true") {
        return;
      }
      await actions.triggerTaskAction(button.getAttribute("data-task-init"));
    });
  });

  documentRef.querySelectorAll("[data-task-operation-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      actions.toggleOperationOutputExpanded();
    });
  });
}
