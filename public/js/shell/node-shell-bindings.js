export function createNodeShellBindingsModule(dependencies) {
  const {
    appState,
    documentRef = document,
    getNodeDisplayName,
    getNodeShellAutoLaunchHandled = () => false,
    getNodeTerminalPresetCommand,
    navigatorRef = navigator,
    page,
    renderCurrentContent,
    setNodeShellAutoLaunchHandled = () => {},
    windowRef = window,
  } = dependencies;

  function bindNodeShellEvents(options) {
    const {
      clearNodeShellInputState,
      clearNodeShellPolling,
      closeNodeShellSession,
      createNodeShellSession,
      focusNodeShellTerminal,
      loadNodeShellSession,
      node,
      nodeShellScreenContent,
      nodeShellView,
      nodeShellWritable,
      patchNodeShellDom,
      queuePresetCommand,
      resetNodeShellState,
      scheduleNodeShellPolling,
    } = options;

    documentRef.querySelectorAll("[data-node-terminal-preset]").forEach((button) => {
      button.addEventListener("click", async () => {
        const command = getNodeTerminalPresetCommand(button.dataset.nodeTerminalPreset);
        if (!command) {
          return;
        }

        if (!nodeShellWritable()) {
          appState.nodeTerminal.message = {
            type: "error",
            text: "当前会话还未就绪，请先打开或刷新 Web Shell。",
          };
          patchNodeShellDom();
          return;
        }

        try {
          await queuePresetCommand(command);
          appState.nodeTerminal.history = [
            command,
            ...appState.nodeTerminal.history.filter((item) => item !== command),
          ].slice(0, 20);
          appState.nodeTerminal.historyIndex = -1;
          appState.nodeTerminal.message = {
            type: "success",
            text: `已将“${button.textContent.trim()}”发送到 ${getNodeDisplayName(node)}。`,
          };
          patchNodeShellDom(true);
          focusNodeShellTerminal();
          scheduleNodeShellPolling(200, { resetTracker: true });
        } catch (error) {
          appState.nodeTerminal.message = {
            type: "error",
            text: error instanceof Error ? error.message : "发送命令失败",
          };
          patchNodeShellDom();
        }
      });
    });

    documentRef.getElementById("node-shell-terminal")?.addEventListener("click", () => {
      focusNodeShellTerminal();
    });

    documentRef.getElementById("node-shell-open")?.addEventListener("click", async () => {
      appState.nodeTerminal.message = {
        type: "success",
        text: "正在建立会话，请稍候...",
      };
      appState.nodeTerminal.sessionStatus = "starting";
      patchNodeShellDom(true);

      try {
        const session = await createNodeShellSession(node.id);
        appState.nodeTerminal.message = {
          type: "success",
          text: `已为 ${getNodeDisplayName(node)} 建立 Web Shell 会话。`,
        };
        renderCurrentContent();
        windowRef.requestAnimationFrame(() => {
          focusNodeShellTerminal();
        });
        scheduleNodeShellPolling(session.status === "open" ? 600 : 200, { resetTracker: true });
      } catch (error) {
        resetNodeShellState();
        appState.nodeTerminal.message = {
          type: "error",
          text: error instanceof Error ? error.message : "创建会话失败",
        };
        renderCurrentContent();
      }
    });

    documentRef.getElementById("node-shell-refresh")?.addEventListener("click", async () => {
      if (!appState.nodeTerminal.sessionId) {
        return;
      }

      try {
        await loadNodeShellSession(appState.nodeTerminal.sessionId, { forceScroll: true });
        appState.nodeTerminal.message = {
          type: "success",
          text: "当前 Web Shell 会话已刷新。",
        };
        patchNodeShellDom(true);
        focusNodeShellTerminal();
        scheduleNodeShellPolling(600, { resetTracker: true });
      } catch (error) {
        appState.nodeTerminal.message = {
          type: "error",
          text: error instanceof Error ? error.message : "获取会话失败",
        };
        patchNodeShellDom();
      }
    });

    documentRef.getElementById("node-shell-close")?.addEventListener("click", async () => {
      if (!appState.nodeTerminal.sessionId) {
        return;
      }

      try {
        await closeNodeShellSession(appState.nodeTerminal.sessionId);
        clearNodeShellInputState();
        clearNodeShellPolling();
        appState.nodeTerminal.message = {
          type: "success",
          text: "当前 Web Shell 会话已结束。",
        };
        renderCurrentContent();
      } catch (error) {
        appState.nodeTerminal.message = {
          type: "error",
          text: error instanceof Error ? error.message : "关闭会话失败",
        };
        patchNodeShellDom();
      }
    });

    documentRef.getElementById("node-shell-copy-output")?.addEventListener("click", async (event) => {
      const text = nodeShellView.cleanTerminalScreenOutput(
        appState.nodeTerminal.sessionOutput || nodeShellScreenContent(),
      );
      const ok = await navigatorRef.clipboard.writeText(text).then(() => true, () => false);
      event.currentTarget.textContent = ok ? "已复制输出" : "复制失败";
    });
  }

  function handleNodeShellAutoOpen() {
    const params = new URLSearchParams(windowRef.location.search);
    if (page === "shell" && params.get("auto_open_shell") === "1" && !getNodeShellAutoLaunchHandled()) {
      setNodeShellAutoLaunchHandled(true);
      windowRef.setTimeout(() => {
        documentRef.getElementById("node-shell-open")?.click();
      }, 160);

      const cleanUrl = new URL(windowRef.location.href);
      cleanUrl.searchParams.delete("auto_open_shell");
      windowRef.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    }
  }

  function handleNodeShellInitialFocus(hasSession, callbacks) {
    const {
      clearNodeShellPolling,
      focusNodeShellTerminal,
      scheduleNodeShellPolling,
    } = callbacks;

    if (hasSession) {
      scheduleNodeShellPolling(1200);
      windowRef.requestAnimationFrame(() => {
        focusNodeShellTerminal();
      });
      return;
    }

    clearNodeShellPolling();
  }

  return {
    bindNodeShellEvents,
    handleNodeShellAutoOpen,
    handleNodeShellInitialFocus,
  };
}
