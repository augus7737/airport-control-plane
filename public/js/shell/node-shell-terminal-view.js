export function createNodeShellTerminalViewController(dependencies) {
  const {
    appState,
    documentRef = document,
    escapeHtml,
    formatRelativeTime,
    isWritable,
    onQueueInput,
    onDisposeTerminal = () => {},
    page,
    shellStatusClassName,
    shellStatusText,
    windowRef = window,
    getScreenContent,
  } = dependencies;

  let terminal = null;
  let fitAddon = null;
  let terminalHost = null;
  let renderedOutput = "";
  let renderedPlaceholder = false;
  let resizeHandler = null;

  function cleanTerminalScreenOutput(value) {
    return String(value || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  }

  function shellPageSupportsXterm() {
    return (
      page === "shell" &&
      typeof windowRef !== "undefined" &&
      typeof windowRef.Terminal === "function"
    );
  }

  function resetViewportCache() {
    renderedOutput = "";
    renderedPlaceholder = false;
  }

  function disposeTerminal() {
    if (typeof windowRef !== "undefined" && resizeHandler) {
      windowRef.removeEventListener("resize", resizeHandler);
    }
    resizeHandler = null;
    fitAddon = null;
    onDisposeTerminal();

    if (terminal) {
      terminal.dispose();
    }

    terminal = null;
    terminalHost = null;
    resetViewportCache();
  }

  function ensureTerminal() {
    const host = documentRef.getElementById("node-shell-terminal");
    const windowShell = host?.closest(".single-terminal-window");

    if (!host || !shellPageSupportsXterm()) {
      windowShell?.classList.remove("shell-xterm-ready");
      return null;
    }

    if (terminal && terminalHost === host) {
      windowShell?.classList.add("shell-xterm-ready");
      fitAddon?.fit();
      return terminal;
    }

    disposeTerminal();

    try {
      terminal = new windowRef.Terminal({
        convertEol: true,
        disableStdin: !isWritable(),
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily: '"JetBrains Mono", "SFMono-Regular", monospace',
        fontSize: 13,
        lineHeight: 1.45,
        scrollback: 5000,
        theme: {
          background: "#07111a",
          foreground: "#e4f7ff",
          cursor: "#5fd5d2",
          selectionBackground: "rgba(95, 213, 210, 0.22)",
          black: "#5f7388",
          brightBlack: "#93a7bc",
          red: "#ff6b7a",
          green: "#42c88a",
          yellow: "#f3bf4c",
          blue: "#61a8ff",
          magenta: "#ff7a45",
          cyan: "#5fd5d2",
          white: "#eef4fb",
        },
      });

      if (windowRef.FitAddon?.FitAddon) {
        fitAddon = new windowRef.FitAddon.FitAddon();
        terminal.loadAddon(fitAddon);
      }

      terminal.open(host);
      terminal.onData((data) => {
        const immediate = /[\r\n\u0003\u0004\u0009\u007f\u001b]/.test(data) || data.length > 24;
        onQueueInput(data, { immediate });
      });
      terminalHost = host;
      windowShell?.classList.add("shell-xterm-ready");

      resizeHandler = () => {
        fitAddon?.fit();
      };
      windowRef.addEventListener("resize", resizeHandler);

      fitAddon?.fit();
      return terminal;
    } catch {
      disposeTerminal();
      windowShell?.classList.remove("shell-xterm-ready");
      return null;
    }
  }

  function renderViewport(options = {}) {
    const screen = documentRef.getElementById("node-shell-screen");
    const term = ensureTerminal();
    const hasSessionOutput = Boolean(appState.nodeTerminal.sessionOutput);
    const nextOutput = hasSessionOutput
      ? String(appState.nodeTerminal.sessionOutput)
      : getScreenContent();
    const fallbackText = hasSessionOutput
      ? cleanTerminalScreenOutput(appState.nodeTerminal.sessionOutput)
      : nextOutput;

    if (!term) {
      if (screen) {
        screen.textContent = fallbackText;
      }
      return;
    }

    if (screen) {
      screen.textContent = fallbackText;
    }

    const isPlaceholder = !hasSessionOutput;
    const canAppendIncrementally =
      !options.forceReset &&
      !isPlaceholder &&
      !renderedPlaceholder &&
      nextOutput.startsWith(renderedOutput);

    if (canAppendIncrementally) {
      const delta = nextOutput.slice(renderedOutput.length);
      if (delta) {
        term.write(delta);
      }
    } else if (nextOutput !== renderedOutput || isPlaceholder !== renderedPlaceholder) {
      term.reset();
      term.write(nextOutput);
    }

    renderedOutput = nextOutput;
    renderedPlaceholder = isPlaceholder;
    fitAddon?.fit();

    if (options.focusTerminal && isWritable()) {
      term.focus();
    }

    if (options.forceScroll) {
      term.scrollToBottom();
    }
  }

  function patchDom(options = {}) {
    const forceScroll = options.forceScroll === true;
    const status = appState.nodeTerminal.sessionStatus;
    const sessionId = appState.nodeTerminal.sessionId;
    const writable = isWritable();
    const statusBadge = documentRef.getElementById("node-shell-status");
    const transport = documentRef.getElementById("node-shell-transport");
    const note = documentRef.getElementById("node-shell-note");
    const sessionIdEl = documentRef.getElementById("node-shell-session-id");
    const updatedAt = documentRef.getElementById("node-shell-updated-at");
    const headLeft = documentRef.getElementById("node-shell-head-left");
    const headRight = documentRef.getElementById("node-shell-head-right");
    const message = documentRef.getElementById("node-terminal-message");
    const openButton = documentRef.getElementById("node-shell-open");
    const closeButton = documentRef.getElementById("node-shell-close");
    const refreshButton = documentRef.getElementById("node-shell-refresh");
    const copyButton = documentRef.getElementById("node-shell-copy-output");
    const inputHint = documentRef.getElementById("node-shell-input-hint");
    const terminalWindow = documentRef.querySelector(".single-terminal-window");

    if (statusBadge) {
      statusBadge.className = shellStatusClassName(status);
      statusBadge.textContent = shellStatusText(status);
    }

    if (transport) {
      transport.textContent = appState.nodeTerminal.sessionTransportLabel;
    }

    if (note) {
      note.textContent = appState.nodeTerminal.sessionTransportNote;
    }

    if (sessionIdEl) {
      sessionIdEl.textContent = sessionId || "未创建";
    }

    if (updatedAt) {
      updatedAt.textContent = appState.nodeTerminal.sessionUpdatedAt
        ? formatRelativeTime(appState.nodeTerminal.sessionUpdatedAt)
        : "-";
    }

    if (headLeft) {
      headLeft.textContent = appState.nodeTerminal.sessionTransportLabel;
    }

    if (headRight) {
      headRight.textContent = sessionId || "未建立会话";
    }

    if (message) {
      message.innerHTML = appState.nodeTerminal.message
        ? `<div class="message ${appState.nodeTerminal.message.type}">${escapeHtml(
            appState.nodeTerminal.message.text,
          )}</div>`
        : "";
    }

    if (openButton) {
      openButton.disabled = status === "starting" || status === "open";
    }

    if (closeButton) {
      closeButton.disabled = !sessionId;
    }

    if (refreshButton) {
      refreshButton.disabled = !sessionId;
    }

    if (copyButton) {
      copyButton.disabled = !appState.nodeTerminal.sessionOutput && status !== "open";
    }

    if (inputHint) {
      inputHint.textContent = writable
        ? "点击上方终端后可直接输入，Enter 执行，Ctrl+C 中断；预设命令会直接发送到当前会话。"
        : sessionId
          ? "会话正在建立中，稍候即可直接在终端里输入。"
          : "请先打开 Web Shell，会话就绪后可直接在终端里操作。";
    }

    terminalWindow?.classList.toggle("shell-interactive", writable);
    if (terminal) {
      terminal.options.disableStdin = !writable;
    }

    renderViewport({
      forceScroll,
      focusTerminal: writable && forceScroll,
    });
  }

  function focusTerminal() {
    const term = ensureTerminal();
    if (!term || !isWritable()) {
      return false;
    }

    term.focus();
    return true;
  }

  return {
    cleanTerminalScreenOutput,
    disposeTerminal,
    focusTerminal,
    patchDom,
    resetViewportCache,
  };
}
