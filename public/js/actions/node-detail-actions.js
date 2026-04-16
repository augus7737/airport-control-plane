export function createNodeDetailActionsModule(dependencies) {
  const {
    appState,
    documentRef = document,
    fetchImpl = fetch,
    getCurrentNode,
    getDiagnosticsForNode = () => [],
    getNodeDisplayName,
    getNodeShellAutoLaunchHandled = () => false,
    nodeShellHref,
    page,
    refreshRuntimeData,
    runNodeDiagnostic,
    renderCurrentContent,
    setNodeShellAutoLaunchHandled = () => {},
    setDiagnostics,
    setOperations,
    setProbes,
    sortDiagnostics = (items) => items,
    statusText,
    upsertDiagnostic,
    upsertNode,
    upsertTask,
    windowRef = window,
  } = dependencies;

  let diagnosticPollTimer = null;

  function clearDiagnosticPoll() {
    if (diagnosticPollTimer) {
      windowRef.clearTimeout(diagnosticPollTimer);
      diagnosticPollTimer = null;
    }
  }

  function getNodeDiagnostics(node) {
    return getDiagnosticsForNode(node, appState.diagnostics, sortDiagnostics);
  }

  function hasRunningDiagnostic(node) {
    return getNodeDiagnostics(node).some((item) =>
      ["queued", "running"].includes(String(item?.status || "").toLowerCase()),
    );
  }

  function scheduleDiagnosticPoll(nodeId, remaining = 60) {
    clearDiagnosticPoll();
    if (remaining <= 0) {
      return;
    }

    diagnosticPollTimer = windowRef.setTimeout(async () => {
      const currentNode = appState.nodes.find((item) => item.id === nodeId);
      if (!currentNode) {
        clearDiagnosticPoll();
        return;
      }

      await refreshRuntimeData();
      renderCurrentContent();

      const refreshedNode = appState.nodes.find((item) => item.id === nodeId);
      if (refreshedNode && hasRunningDiagnostic(refreshedNode)) {
        scheduleDiagnosticPoll(nodeId, remaining - 1);
      } else {
        clearDiagnosticPoll();
      }
    }, 5000);
  }

  async function deleteManagedNode(nodeId, options = {}) {
    const node = appState.nodes.find((item) => item.id === nodeId);
    if (!node) {
      windowRef.alert("当前节点不存在或已删除。");
      return false;
    }

    const confirmed = windowRef.confirm(
      `确定删除节点 ${getNodeDisplayName(node)} 吗？\n\n这会同时移除该节点的探测记录、任务记录、关联终端会话，以及相关执行历史中的该节点条目。此操作不可恢复。`,
    );
    if (!confirmed) {
      return false;
    }

    try {
      const response = await fetchImpl(`/api/v1/nodes/${encodeURIComponent(nodeId)}`, {
        method: "DELETE",
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.details?.join("，") || result.message || "删除失败");
      }

      if (options.redirectOnSuccess) {
        windowRef.location.href = "/nodes.html";
        return true;
      }

      await refreshRuntimeData();
      renderCurrentContent();
      windowRef.alert("节点已删除，列表与关联记录已同步更新。");
      return true;
    } catch (error) {
      windowRef.alert(error instanceof Error ? error.message : "删除失败");
      return false;
    }
  }

  function setupNodeDeleteActions() {
    const topbarDeleteButton = documentRef.getElementById("delete-node");
    if (topbarDeleteButton && page === "node-detail") {
      topbarDeleteButton.onclick = async () => {
        const node = getCurrentNode(appState.nodes);
        if (!node) {
          windowRef.alert("当前节点不存在。");
          return;
        }

        const originalLabel = topbarDeleteButton.textContent;
        topbarDeleteButton.disabled = true;
        topbarDeleteButton.textContent = "删除中...";
        const deleted = await deleteManagedNode(node.id, { redirectOnSuccess: true });
        if (!deleted) {
          topbarDeleteButton.disabled = false;
          topbarDeleteButton.textContent = originalLabel;
        }
      };
    }

    documentRef.querySelectorAll("[data-delete-node]").forEach((button) => {
      button.onclick = async () => {
        const nodeId = button.getAttribute("data-delete-node");
        if (!nodeId) {
          return;
        }

        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = "删除中...";
        const deleted = await deleteManagedNode(nodeId, { redirectOnSuccess: false });
        if (!deleted) {
          button.disabled = false;
          button.textContent = originalLabel;
        }
      };
    });
  }

  function getNodeDetailState() {
    if (!appState.nodeDetail || typeof appState.nodeDetail !== "object") {
      appState.nodeDetail = {
        initTemplateValue: "",
        applyTemplateId: "",
        pendingAction: null,
        message: null,
      };
    }

    return appState.nodeDetail;
  }

  function resolveInitTemplateRequest(templateValue) {
    const normalized = String(templateValue || "").trim() || "alpine-base";
    if (normalized.startsWith("system-template:")) {
      const systemTemplateId = normalized.slice("system-template:".length).trim();
      return systemTemplateId
        ? {
            system_template_id: systemTemplateId,
          }
        : {
            template: "alpine-base",
          };
    }

    return {
      template: normalized,
    };
  }

  function setupNodeDetailActions() {
    if (page !== "node-detail") {
      return;
    }

    const node = getCurrentNode(appState.nodes);
    const shellShortcutButton = documentRef.getElementById("open-node-shell-shortcut");
    const probeButton = documentRef.getElementById("probe-node");
    const lightDiagnosticButton = documentRef.getElementById("run-light-diagnostic");
    const deepDiagnosticButton = documentRef.getElementById("run-deep-diagnostic");
    const initTemplateSelect = documentRef.getElementById("node-init-template-select");
    const applyTemplateSelect = documentRef.getElementById("node-apply-template-select");
    const runInitButton = documentRef.getElementById("run-node-init-template");
    const runApplyButton = documentRef.getElementById("run-node-apply-template");
    const deleteButton = documentRef.getElementById("delete-node");
    const nodeDetailState = getNodeDetailState();
    if (!node) {
      return;
    }

    if (hasRunningDiagnostic(node)) {
      scheduleDiagnosticPoll(node.id);
    } else {
      clearDiagnosticPoll();
    }

    const focusNodeShell = (options = {}) => {
      windowRef.location.href = nodeShellHref(node.id, {
        autoOpen: options.autoOpen !== false,
      });
    };

    shellShortcutButton?.addEventListener("click", () => {
      focusNodeShell({ autoOpen: true });
    });

    initTemplateSelect?.addEventListener("change", (event) => {
      nodeDetailState.initTemplateValue = String(event.currentTarget.value || "").trim();
      nodeDetailState.message = null;
      renderCurrentContent();
    });

    applyTemplateSelect?.addEventListener("change", (event) => {
      nodeDetailState.applyTemplateId = String(event.currentTarget.value || "").trim();
      nodeDetailState.message = null;
      renderCurrentContent();
    });

    const params = new URLSearchParams(windowRef.location.search);
    if (params.get("focus") === "shell" && !getNodeShellAutoLaunchHandled()) {
      setNodeShellAutoLaunchHandled(true);
      focusNodeShell({
        autoOpen: params.get("auto_open_shell") === "1",
      });

      const cleanUrl = new URL(windowRef.location.href);
      cleanUrl.searchParams.delete("focus");
      cleanUrl.searchParams.delete("auto_open_shell");
      windowRef.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    }

    probeButton?.addEventListener("click", async () => {
      const originalLabel = probeButton.textContent;
      probeButton.disabled = true;
      probeButton.textContent = "探测中...";

      try {
        const response = await fetchImpl(`/api/v1/nodes/${encodeURIComponent(node.id)}/probe`, {
          method: "POST",
        });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.details?.join("，") || result.message || "探测失败");
        }

        if (result.node) {
          upsertNode(result.node);
        }
        if (result.task) {
          upsertTask(result.task);
        }
        if (result.probe) {
          setProbes([
            result.probe,
            ...appState.probes.filter((item) => item.id !== result.probe.id),
          ]);
        } else {
          await refreshRuntimeData();
        }

        renderCurrentContent();
        windowRef.alert(
          result.summary ||
            `手动复探完成：${statusText(result.node?.status)} / 健康分 ${result.node?.health_score ?? "-"}`,
        );
      } catch (error) {
        probeButton.disabled = false;
        probeButton.textContent = originalLabel;
        windowRef.alert(error instanceof Error ? error.message : "探测失败");
      }
    });

    const bindDiagnosticAction = (button, profile) => {
      button?.addEventListener("click", async () => {
        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = profile === "deep" ? "深度诊断中..." : "轻量诊断中...";

        try {
          const result = await runNodeDiagnostic(node.id, { profile });
          if (result.task) {
            upsertTask(result.task);
          }
          if (result.diagnostic) {
            upsertDiagnostic(result.diagnostic);
            setDiagnostics([
              result.diagnostic,
              ...appState.diagnostics.filter((item) => item.id !== result.diagnostic.id),
            ]);
          }

          renderCurrentContent();
          scheduleDiagnosticPoll(node.id);
          windowRef.alert(
            profile === "deep"
              ? "深度诊断已提交，控制面会先做资源保护预检，再尝试生成网络质量报告。"
              : "轻量诊断已提交，控制面会尝试生成硬件和 IP 质量报告。",
          );
        } catch (error) {
          button.disabled = false;
          button.textContent = originalLabel;
          windowRef.alert(error instanceof Error ? error.message : "诊断提交失败");
        }
      });
    };

    bindDiagnosticAction(lightDiagnosticButton, "light");
    bindDiagnosticAction(deepDiagnosticButton, "deep");

    documentRef.querySelectorAll("[data-node-detail-command]").forEach((button) => {
      button.addEventListener("click", () => {
        const command = button.getAttribute("data-node-detail-command");
        if (!command) {
          return;
        }

        if (command === "open-shell") {
          shellShortcutButton?.click();
          return;
        }

        if (command === "probe") {
          probeButton?.click();
          return;
        }

        if (command === "retry-init") {
          runInitButton?.click();
          return;
        }

        if (command === "edit-asset") {
          documentRef.querySelector(`[data-open-asset-modal="${node.id}"]`)?.click();
          return;
        }

        if (command === "delete") {
          deleteButton?.click();
        }
      });
    });

    runInitButton?.addEventListener("click", async () => {
      const selectedValue =
        String(initTemplateSelect?.value || nodeDetailState.initTemplateValue || "alpine-base").trim() ||
        "alpine-base";
      const selectedLabel =
        String(initTemplateSelect?.selectedOptions?.[0]?.textContent || selectedValue).trim() ||
        selectedValue;
      nodeDetailState.initTemplateValue = selectedValue;
      nodeDetailState.pendingAction = "init";
      nodeDetailState.message = null;
      renderCurrentContent();

      try {
        const response = await fetchImpl(`/api/v1/nodes/${encodeURIComponent(node.id)}/init`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(resolveInitTemplateRequest(selectedValue)),
        });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.details?.join("，") || result.message || "重新初始化失败");
        }

        await refreshRuntimeData();
        nodeDetailState.pendingAction = null;
        nodeDetailState.message = {
          type: "success",
          text: `${selectedLabel} 已开始执行，当前任务状态：${statusText(
            result.task?.status || result.node?.status,
          )}`,
        };
        renderCurrentContent();
      } catch (error) {
        nodeDetailState.pendingAction = null;
        nodeDetailState.message = {
          type: "error",
          text: error instanceof Error ? error.message : "重新初始化失败",
        };
        renderCurrentContent();
      }
    });

    runApplyButton?.addEventListener("click", async () => {
      const templateId =
        String(applyTemplateSelect?.value || nodeDetailState.applyTemplateId || "").trim();
      if (!templateId) {
        nodeDetailState.message = {
          type: "error",
          text: "请先选择一个可下发的系统模板。",
        };
        renderCurrentContent();
        return;
      }

      const templateLabel =
        String(applyTemplateSelect?.selectedOptions?.[0]?.textContent || templateId).trim() ||
        templateId;
      nodeDetailState.applyTemplateId = templateId;
      nodeDetailState.pendingAction = "apply";
      nodeDetailState.message = null;
      renderCurrentContent();

      try {
        const response = await fetchImpl("/api/v1/system-templates/apply", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            template_id: templateId,
            node_ids: [node.id],
            title: `${getNodeDisplayName(node)} · ${templateLabel}`,
          }),
        });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.details?.join("，") || result.message || "模板下发失败");
        }

        await refreshRuntimeData();
        nodeDetailState.pendingAction = null;
        nodeDetailState.message = {
          type: "success",
          text: `${templateLabel} 已开始下发${
            result.operation?.id ? `，执行回显 ID：${result.operation.id}` : "。"
          }`,
        };
        renderCurrentContent();
      } catch (error) {
        nodeDetailState.pendingAction = null;
        nodeDetailState.message = {
          type: "error",
          text: error instanceof Error ? error.message : "模板下发失败",
        };
        renderCurrentContent();
      }
    });
  }

  return {
    deleteManagedNode,
    setupNodeDeleteActions,
    setupNodeDetailActions,
  };
}
