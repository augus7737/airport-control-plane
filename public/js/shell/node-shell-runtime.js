import { createNodeShellBindingsModule } from "./node-shell-bindings.js";
import { createNodeShellInputQueueController } from "./node-shell-input-queue.js";
import { createNodeShellPollingController } from "./node-shell-polling.js";
import { createNodeShellTerminalViewController } from "./node-shell-terminal-view.js";

export function createNodeShellRuntimeModule(dependencies) {
  const {
    appState,
    documentRef = document,
    escapeHtml,
    fetchImpl = fetch,
    formatRelativeTime,
    getCurrentNode,
    getNodeDisplayName,
    getNodeTerminalPresetCommand,
    getNodeShellAutoLaunchHandled = () => false,
    navigatorRef = navigator,
    page,
    renderCurrentContent,
    setNodeShellAutoLaunchHandled = () => {},
    shellStatusClassName,
    shellStatusText,
    windowRef = window,
  } = dependencies;

  let nodeShellInputQueue = null;
  let nodeShellPolling = null;
  let nodeShellView = null;
  const {
    bindNodeShellEvents,
    handleNodeShellAutoOpen,
    handleNodeShellInitialFocus,
  } = createNodeShellBindingsModule({
    appState,
    documentRef,
    getNodeDisplayName,
    getNodeShellAutoLaunchHandled,
    getNodeTerminalPresetCommand,
    navigatorRef,
    page,
    renderCurrentContent,
    setNodeShellAutoLaunchHandled,
    windowRef,
  });

  function nodeShellWritable() {
    return appState.nodeTerminal.sessionStatus === "open" && Boolean(appState.nodeTerminal.sessionId);
  }

  function clearNodeShellInputState() {
    nodeShellInputQueue?.clear();
  }

  function resetNodeShellState() {
    appState.nodeTerminal.sessionId = null;
    appState.nodeTerminal.sessionStatus = "idle";
    appState.nodeTerminal.sessionTransportLabel = "未建立会话";
    appState.nodeTerminal.sessionTransportNote =
      "点击“打开 Web Shell”后，平台会尝试为当前节点建立一个实时会话。";
    appState.nodeTerminal.sessionOutput = "";
    appState.nodeTerminal.sessionUpdatedAt = null;
    appState.nodeTerminal.sessionClosedAt = null;
    appState.nodeTerminal.historyIndex = -1;
    clearNodeShellInputState();
    nodeShellPolling?.resetTracker();
    nodeShellView?.resetViewportCache();
  }

  function syncNodeShellSession(session) {
    if (!session) {
      resetNodeShellState();
      return;
    }

    if (appState.nodeTerminal.sessionId && session.id && appState.nodeTerminal.sessionId !== session.id) {
      clearNodeShellInputState();
      nodeShellPolling?.resetTracker();
      nodeShellView?.resetViewportCache();
    }

    appState.nodeTerminal.sessionId = session.id || null;
    appState.nodeTerminal.sessionStatus = session.status || "idle";
    appState.nodeTerminal.sessionTransportLabel = session.transport_label || "未建立会话";
    appState.nodeTerminal.sessionTransportNote =
      session.transport_note || "当前会话未返回额外说明。";
    appState.nodeTerminal.sessionOutput = session.output || "";
    appState.nodeTerminal.sessionUpdatedAt = session.updated_at || null;
    appState.nodeTerminal.sessionClosedAt = session.closed_at || null;
  }

  function captureNodeShellPollingSnapshot() {
    return JSON.stringify({
      sessionId: appState.nodeTerminal.sessionId || "",
      status: appState.nodeTerminal.sessionStatus || "idle",
      updatedAt: appState.nodeTerminal.sessionUpdatedAt || "",
      closedAt: appState.nodeTerminal.sessionClosedAt || "",
      outputLength: String(appState.nodeTerminal.sessionOutput || "").length,
    });
  }

  function recordNodeShellPollingActivity() {
    return nodeShellPolling?.recordActivity() ?? false;
  }

  function nodeShellScreenContent() {
    if (appState.nodeTerminal.sessionOutput) {
      return nodeShellView.cleanTerminalScreenOutput(appState.nodeTerminal.sessionOutput);
    }

    if (appState.nodeTerminal.sessionStatus === "starting") {
      return "正在建立 Web Shell 会话，请稍候...";
    }

    return "当前还没有打开实时 Web Shell。\n点击“打开 Web Shell”后，平台会先尝试 SSH；如果暂时无法建立真实会话，会显示原因并回退到本机兜底模式。";
  }

  function patchNodeShellDom(forceScroll = false) {
    if (!["node-detail", "shell"].includes(page)) {
      return;
    }

    nodeShellView.patchDom({ forceScroll });
  }

  function clearNodeShellPolling() {
    nodeShellPolling?.clear();
  }

  function scheduleNodeShellPolling(delay = 1200, options = {}) {
    nodeShellPolling?.schedule(delay, options);
  }

  async function loadNodeShellSession(sessionId, options = {}) {
    if (!sessionId) {
      return;
    }

    const response = await fetchImpl(`/api/v1/shell/sessions/${encodeURIComponent(sessionId)}`);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || result.error || "获取会话失败");
    }

    syncNodeShellSession(result.session);
    recordNodeShellPollingActivity();
    patchNodeShellDom(options.forceScroll === true);
  }

  async function createNodeShellSession(nodeId) {
    const response = await fetchImpl("/api/v1/shell/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        node_id: nodeId,
      }),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.details?.join("，") || result.message || "创建会话失败");
    }

    syncNodeShellSession(result.session);
    return result.session;
  }

  async function sendNodeShellInput(sessionId, data) {
    const response = await fetchImpl(`/api/v1/shell/sessions/${encodeURIComponent(sessionId)}/input`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        data,
      }),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.details?.join("，") || result.message || "发送命令失败");
    }

    syncNodeShellSession(result.session);
    return result.session;
  }

  async function closeNodeShellSession(sessionId) {
    const response = await fetchImpl(`/api/v1/shell/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || result.error || "关闭会话失败");
    }

    syncNodeShellSession(result.session);
    return result.session;
  }

  function queueNodeShellInput(data, options = {}) {
    return nodeShellInputQueue?.queue(data, options) ?? false;
  }

  function focusNodeShellTerminal() {
    return nodeShellView.focusTerminal();
  }

  async function queueNodeShellPresetCommand(command) {
    await sendNodeShellInput(appState.nodeTerminal.sessionId, `${command}\n`);
  }

  nodeShellInputQueue = createNodeShellInputQueueController({
    getSessionId: () => appState.nodeTerminal.sessionId,
    isWritable: nodeShellWritable,
    onError: (error) => {
      appState.nodeTerminal.message = {
        type: "error",
        text: error instanceof Error ? error.message : "发送输入失败",
      };
      patchNodeShellDom();
    },
    onSendSuccess: () => {
      patchNodeShellDom(true);
      scheduleNodeShellPolling(200, { resetTracker: true });
    },
    sendInput: sendNodeShellInput,
  });

  nodeShellView = createNodeShellTerminalViewController({
    appState,
    documentRef,
    escapeHtml,
    formatRelativeTime,
    getScreenContent: nodeShellScreenContent,
    isWritable: nodeShellWritable,
    onDisposeTerminal: clearNodeShellInputState,
    onQueueInput: queueNodeShellInput,
    page,
    shellStatusClassName,
    shellStatusText,
    windowRef,
  });

  nodeShellPolling = createNodeShellPollingController({
    getSessionId: () => appState.nodeTerminal.sessionId,
    getSessionStatus: () => appState.nodeTerminal.sessionStatus,
    getSnapshot: captureNodeShellPollingSnapshot,
    isContextActive: () => ["node-detail", "shell"].includes(page),
    loadSession: loadNodeShellSession,
    onError: (error) => {
      appState.nodeTerminal.message = {
        type: "error",
        text: error instanceof Error ? error.message : "获取会话失败",
      };
      patchNodeShellDom();
    },
  });

  function setupNodeTerminal() {
    if (!["node-detail", "shell"].includes(page)) {
      clearNodeShellPolling();
      clearNodeShellInputState();
      nodeShellView.disposeTerminal();
      return;
    }

    const node = getCurrentNode(appState.nodes);
    if (!node) {
      clearNodeShellPolling();
      clearNodeShellInputState();
      nodeShellView.disposeTerminal();
      return;
    }

    bindNodeShellEvents({
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
      queuePresetCommand: queueNodeShellPresetCommand,
      resetNodeShellState,
      scheduleNodeShellPolling,
    });

    patchNodeShellDom(true);

    handleNodeShellAutoOpen();
    handleNodeShellInitialFocus(Boolean(appState.nodeTerminal.sessionId), {
      clearNodeShellPolling,
      focusNodeShellTerminal,
      scheduleNodeShellPolling,
    });
  }

  return {
    nodeShellScreenContent,
    nodeShellWritable,
    setupNodeTerminal,
  };
}
