import { applyTerminalPreset, getNodeTerminalPresetCommand } from "./terminal-page-presets.js";
import { createTerminalPageActions } from "./terminal-page-actions.js";
import { bindTerminalPageEvents } from "./terminal-page-bindings.js";
import { createTerminalPageStateModule } from "./terminal-page-state.js";

export function createTerminalPageModule(dependencies) {
  const {
    appState,
    escapeHtml,
    fetchImpl = fetch,
    formatAccessMode,
    formatDateTime,
    formatDuration,
    formatExitCode,
    formatNodeSshPort,
    formatOperationMode,
    formatRelativeTime,
    formatRouteSummary,
    getAccessMode,
    getNodeDisplayName,
    getRelayDisplayName,
    nodeShellScreenContent,
    nodeShellWritable,
    normalizeOperationOutput,
    page,
    refreshOperations,
    renderCurrentContent,
    resolveDurationMs,
    resolveRelayNode,
    resolveTransportLabel,
    setOperations,
    shellStatusClassName,
    shellStatusText,
    statusClassName,
    statusText,
    summarizeOperationExitCode,
    summarizeOperationTransport,
    windowRef = window,
  } = dependencies;
  let initialOperationSelectionHandled = false;
  const {
    formatOperationSubject,
    getActiveNodeOperation,
    getActiveOperation,
    getNodeOperationTarget,
    getNodeOperations,
  } = createTerminalPageStateModule({
    appState,
  });

  function syncTerminalOperationFromUrl(operations) {
    if (page !== "terminal" || initialOperationSelectionHandled || !windowRef?.location) {
      return;
    }

    const operationId = new URLSearchParams(windowRef.location.search).get("operation_id");
    if (!operationId) {
      initialOperationSelectionHandled = true;
      return;
    }

    const operation = operations.find((item) => item.id === operationId);
    if (!operation) {
      return;
    }

    appState.terminal.activeOperationId = operation.id;
    if (Array.isArray(operation.node_ids) && operation.node_ids.length > 0) {
      appState.terminal.selectedNodeIds = operation.node_ids.filter((nodeId) =>
        appState.nodes.some((node) => node.id === nodeId),
      );
    }
    initialOperationSelectionHandled = true;
  }

  function renderTerminalPage(nodes, operations) {
    syncTerminalOperationFromUrl(operations);
    const selectedIds = new Set(appState.terminal.selectedNodeIds);
    const selectedNodes = nodes.filter((node) => selectedIds.has(node.id));
    const selectedRelayCount = selectedNodes.filter(
      (node) => String(getAccessMode(node) || "").toLowerCase() === "relay",
    ).length;
    const selectedDirectCount = Math.max(selectedNodes.length - selectedRelayCount, 0);
    const activeOperation = getActiveOperation(operations);
    const successfulOperations = operations.filter((item) => item.status === "success").length;
    const partialOperations = operations.filter((item) => item.status === "partial").length;
    const pendingOperations = operations.filter((item) => ["queued", "running"].includes(item.status)).length;

    const selectedNodeCards = nodes.map((node) => `
    <label class="terminal-node-card ${selectedIds.has(node.id) ? "selected" : ""}">
      <input
        class="terminal-node-check"
        type="checkbox"
        data-terminal-node-id="${node.id}"
        ${selectedIds.has(node.id) ? "checked" : ""}
      />
      <div class="terminal-node-head">
        <div>
          <strong>${escapeHtml(getNodeDisplayName(node))}</strong>
          <p>${escapeHtml(node.labels?.provider || "未标记")} / ${escapeHtml(node.labels?.region || "-")}</p>
        </div>
        <span class="${statusClassName(node.status)}">${statusText(node.status)}</span>
      </div>
      <div class="terminal-node-meta">
        <span>${formatAccessMode(getAccessMode(node))}</span>
        <span>${escapeHtml(formatRouteSummary(node, nodes))}</span>
      </div>
    </label>
  `).join("");

    const operationItems = operations
      .map((operation) => {
        const total = Number(operation.summary?.total ?? operation.targets?.length ?? 0);
        const success = Number(operation.summary?.success ?? 0);
        const failed = Number(operation.summary?.failed ?? Math.max(total - success, 0));
        const durationText = formatDuration(
          resolveDurationMs(operation, operation.created_at, operation.finished_at),
        );
        const finishedText = operation.finished_at
          ? formatDateTime(operation.finished_at)
          : "未回传";

        return `
        <button
          class="terminal-run-item ${appState.terminal.activeOperationId === operation.id ? "active" : ""}"
          type="button"
          data-operation-id="${operation.id}"
        >
          <div class="terminal-run-item-head">
            <strong>${escapeHtml(operation.title)}</strong>
            <span class="${statusClassName(operation.status)}">${statusText(operation.status)}</span>
          </div>
          <p>${formatOperationMode(operation.mode)} / ${total} 台节点 / ${formatRelativeTime(operation.created_at)}</p>
          <div class="terminal-run-meta">
            <span>传输：${escapeHtml(summarizeOperationTransport(operation))}</span>
            <span>退出码：${escapeHtml(summarizeOperationExitCode(operation))}</span>
            <span>耗时：${escapeHtml(durationText)}</span>
            <span>完成：${escapeHtml(finishedText)}</span>
            <span>结果：${success} 成功 / ${failed} 失败</span>
          </div>
        </button>
      `;
      })
      .join("");

    const activeOutputs =
      activeOperation && Array.isArray(activeOperation.targets) && activeOperation.targets.length > 0
        ? activeOperation.targets
            .map((target) => {
              const outputText = normalizeOperationOutput(target.output);
              const targetDuration = formatDuration(
                resolveDurationMs(
                  target,
                  activeOperation.created_at,
                  target.finished_at || activeOperation.finished_at,
                ),
              );
              const targetFinished = target.finished_at || activeOperation.finished_at || null;
              const finishedText = targetFinished ? formatDateTime(targetFinished) : "未回传";
              const transportText = resolveTransportLabel(target, activeOperation);
              const exitCodeText = formatExitCode(target);

              return `
              <article class="terminal-output-card">
                <div class="panel-title">
                  <div>
                    <h3>${escapeHtml(target.hostname)}</h3>
                    <p>${escapeHtml(target.provider || "未标记")} / ${escapeHtml(target.region || "-")} / ${escapeHtml(transportText)}</p>
                  </div>
                  <span class="${statusClassName(target.status)}">${statusText(target.status)}</span>
                </div>
                <div class="terminal-output-meta">
                  <div class="terminal-output-kv"><span>传输</span><strong>${escapeHtml(transportText)}</strong></div>
                  <div class="terminal-output-kv"><span>退出码</span><strong class="mono">${escapeHtml(exitCodeText)}</strong></div>
                  <div class="terminal-output-kv"><span>耗时</span><strong>${escapeHtml(targetDuration)}</strong></div>
                  <div class="terminal-output-kv"><span>完成时间</span><strong>${escapeHtml(finishedText)}</strong></div>
                </div>
                <div class="terminal-window">
                  <div class="terminal-window-head">
                    <span>${escapeHtml(target.summary || activeOperation.title)}</span>
                    <span>${escapeHtml(activeOperation.id)}</span>
                  </div>
                  <pre class="terminal-screen">${escapeHtml(
                    outputText || "[无输出] 后端未返回标准输出/错误输出内容。",
                  )}</pre>
                </div>
              </article>
            `;
            })
            .join("")
        : '<div class="empty">还没有执行记录。你可以先在左侧选择节点并发起一轮批量命令或脚本。</div>';

    return `
    <section class="metrics-grid fade-up">
      <article class="panel"><div class="panel-body"><div class="stat-label">已选节点</div><div class="stat-value">${selectedNodes.length}</div><div class="stat-foot">本轮准备执行命令或脚本的节点数量。</div></div></article>
      <article class="panel"><div class="panel-body"><div class="stat-label">执行记录</div><div class="stat-value">${operations.length}</div><div class="stat-foot">最近保留的批量执行历史，可回看每台节点回显。</div></div></article>
      <article class="panel"><div class="panel-body"><div class="stat-label">全部成功</div><div class="stat-value">${successfulOperations}</div><div class="stat-foot">所有目标节点都完成执行的批次。</div></div></article>
      <article class="panel"><div class="panel-body"><div class="stat-label">部分成功</div><div class="stat-value">${partialOperations}</div><div class="stat-foot">有部分节点执行异常，后续适合接自动重试或隔离逻辑。</div></div></article>
    </section>
    <section class="workspace fade-up">
      <article class="panel">
        <div class="panel-body">
          <div class="panel-title">
            <div>
              <h3>批量执行面板</h3>
              <p>像运维控制台一样，先挑节点，再决定发一条命令还是一段脚本。</p>
            </div>
            <div class="provider-pill">当前已选 ${selectedNodes.length} 台</div>
          </div>
          <div class="terminal-operations-overview">
            <div class="terminal-operation-focus">
              <span>当前工作流</span>
              <strong>${appState.terminal.mode === "script" ? "脚本批量下发" : "命令批量执行"}</strong>
              <p>先整理执行目标，再发命令或脚本；真正的终端深色只保留给日志回显。</p>
            </div>
            <div class="terminal-selection-summary">
              <div class="terminal-selection-stat">
                <span>执行目标</span>
                <strong>${selectedNodes.length} 台</strong>
                <p>已选直连 ${selectedDirectCount} / 中转 ${selectedRelayCount}</p>
              </div>
              <div class="terminal-selection-stat">
                <span>当前模式</span>
                <strong>${appState.terminal.mode === "script" ? "脚本模式" : "命令模式"}</strong>
                <p>${appState.terminal.mode === "script" ? "适合初始化与重复运维动作" : "适合快速诊断和短命令"}</p>
              </div>
              <div class="terminal-selection-stat">
                <span>在途批次</span>
                <strong>${pendingOperations}</strong>
                <p>排队或运行中的批量执行任务。</p>
              </div>
            </div>
          </div>
          <form id="terminal-form" class="terminal-form-stack">
            <div class="terminal-composer-grid">
              <section class="terminal-composer-card">
                <div class="terminal-section-head">
                  <div>
                    <h4>执行内容</h4>
                    <p>先确定模式和标题，再写命令或脚本内容。</p>
                  </div>
                </div>
                <div class="mode-toggle">
                  <button class="mode-chip ${appState.terminal.mode === "command" ? "active" : ""}" type="button" data-terminal-mode="command">命令模式</button>
                  <button class="mode-chip ${appState.terminal.mode === "script" ? "active" : ""}" type="button" data-terminal-mode="script">脚本模式</button>
                </div>
                <div class="field">
                  <label for="terminal-title">任务标题</label>
                  <input id="terminal-title" name="title" value="${escapeHtml(appState.terminal.title)}" placeholder="例如：批量安装 curl / 批量重启 sing-box" />
                </div>
                ${
                  appState.terminal.mode === "command"
                    ? `
                      <div class="field full">
                        <label for="terminal-command">Shell 命令</label>
                        <textarea id="terminal-command" name="command" placeholder="例如：apk update && apk add curl bash">${escapeHtml(appState.terminal.command)}</textarea>
                      </div>
                    `
                    : `
                      <div class="field">
                        <label for="terminal-script-name">脚本名称</label>
                        <input id="terminal-script-name" name="script_name" value="${escapeHtml(appState.terminal.script_name)}" placeholder="例如：Alpine 节点基础初始化（含目录/计划任务）" />
                      </div>
                      <div class="field full">
                        <label for="terminal-script-body">脚本内容</label>
                        <textarea id="terminal-script-body" name="script_body" placeholder="#!/bin/sh&#10;set -eu">${escapeHtml(appState.terminal.script_body)}</textarea>
                      </div>
                    `
                }
                <div class="terminal-section-head terminal-section-head-inline">
                  <div>
                    <h4>常用预设</h4>
                    <p>把高频动作收成按钮，减少重复手敲。</p>
                  </div>
                </div>
                <div class="terminal-presets">
                  <button class="button ghost" type="button" data-terminal-preset="apk">安装基础依赖</button>
                  <button class="button ghost" type="button" data-terminal-preset="restart">重启代理服务</button>
                  <button class="button ghost" type="button" data-terminal-preset="probe">网络自检</button>
                  <button class="button ghost" type="button" data-terminal-preset="bootstrap">Alpine 初始化（推荐）</button>
                </div>
              </section>
              <section class="terminal-composer-card terminal-selection-card">
                <div class="terminal-section-head">
                  <div>
                    <h4>执行目标</h4>
                    <p>先按节点类型筛一轮，再确认本次执行范围。</p>
                  </div>
                  <span class="provider-pill">直连 ${selectedDirectCount} / 中转 ${selectedRelayCount}</span>
                </div>
                <div class="terminal-toolbar">
                  <button class="button ghost" type="button" id="terminal-select-active">选择可用节点</button>
                  <button class="button ghost" type="button" id="terminal-select-relay">只选经中转</button>
                  <button class="button ghost" type="button" id="terminal-select-all">全选</button>
                  <button class="button ghost" type="button" id="terminal-clear-selection">清空选择</button>
                </div>
                <div class="terminal-node-grid">${selectedNodeCards}</div>
              </section>
            </div>
            <div class="modal-actions">
              <button class="button primary" type="submit" id="terminal-run-button">批量执行</button>
              <button class="button ghost" type="button" id="terminal-refresh">刷新执行记录</button>
            </div>
            <div id="terminal-message">${
              appState.terminal.message
                ? `<div class="message ${appState.terminal.message.type}">${escapeHtml(appState.terminal.message.text)}</div>`
                : ""
            }</div>
          </form>
        </div>
      </article>
      <aside class="aside-stack">
        <section class="panel">
          <div class="panel-body">
            <div class="panel-title"><div><h3>执行策略</h3><p>把批量终端当成运维编排台来用，不只是一个大文本框。</p></div></div>
            <div class="terminal-guide-grid">
              <article class="terminal-guide-card"><strong>命令模式</strong><p>适合快速执行诊断、重启服务、看进程和安装少量依赖。</p></article>
              <article class="terminal-guide-card"><strong>脚本模式</strong><p>适合做初始化、部署模板和面板接入动作，支持复用同一份标准脚本。</p></article>
              <article class="terminal-guide-card"><strong>入口 / 中转分批</strong><p>如果一批节点都挂在同一台跳板下，后续最好支持限流并发，避免链路被打爆。</p></article>
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-body">
            <div class="panel-title"><div><h3>最近执行</h3><p>点击一条记录，右侧会切换到对应的节点回显。</p></div></div>
            <div class="terminal-run-list">
              ${operationItems || '<div class="empty">暂无执行记录。</div>'}
            </div>
          </div>
        </section>
      </aside>
    </section>
    <section class="panel fade-up" id="terminal-output-panel" style="margin-top:18px;scroll-margin-top:24px;">
      <div class="panel-body">
        <div class="panel-title">
          <div>
            <h3>终端回显</h3>
            <p>${
              activeOperation
                ? `${formatOperationMode(activeOperation.mode)} · ${escapeHtml(activeOperation.title)} · ${
                    Number(activeOperation.summary?.total ?? activeOperation.targets?.length ?? 0)
                  } 台节点`
                : "当前还没有选中的执行记录"
            }</p>
          </div>
          ${
            activeOperation
              ? `<span class="${statusClassName(activeOperation.status)}">${statusText(activeOperation.status)}</span>`
              : ""
          }
        </div>
        <div class="terminal-output-grid">${activeOutputs}</div>
      </div>
    </section>
  `;
  }

  function renderNodeTerminalSection(node, nodes, operations) {
    const hostname = getNodeDisplayName(node);
    const nodeOperations = getNodeOperations(node, operations);
    const historyItems = nodeOperations
      .slice(0, 8)
      .map((operation) => {
        const target = getNodeOperationTarget(operation, node.id);
        return `
        <article class="terminal-run-item">
          <div class="terminal-run-item-head">
            <strong>${escapeHtml(formatOperationSubject(operation))}</strong>
            <span class="${statusClassName(target?.status || operation.status)}">${statusText(target?.status || operation.status)}</span>
          </div>
          <p>${formatOperationMode(operation.mode)} / ${escapeHtml(target?.summary || operation.title || "单机执行")} / ${formatRelativeTime(operation.created_at)}</p>
        </article>
      `;
      })
      .join("");
    const sessionOutput = escapeHtml(nodeShellScreenContent());
    const sessionStatus = shellStatusText(appState.nodeTerminal.sessionStatus);
    const sessionLabel = appState.nodeTerminal.sessionTransportLabel;
    const sshPort = formatNodeSshPort(node);
    const writable = nodeShellWritable();
    const relayNode = resolveRelayNode(node, nodes);
    const relayLabel = relayNode ? getNodeDisplayName(relayNode) : getRelayDisplayName(node, nodes);
    const relayHint =
      getAccessMode(node) === "relay"
        ? `当前标记为经中转，链路为 ${formatRouteSummary(node, nodes)}。`
        : "当前标记为直连，后续接 SSH 时会优先尝试直连当前节点。";
    const sessionUpdatedLabel = appState.nodeTerminal.sessionUpdatedAt
      ? formatRelativeTime(appState.nodeTerminal.sessionUpdatedAt)
      : "-";

    return `
    <section class="workspace fade-up" id="node-terminal" style="scroll-margin-top:24px;">
      <article class="panel">
        <div class="panel-body">
          <div class="panel-title">
            <div>
              <h3>实时 Web Shell</h3>
              <p>为当前节点建立一条持续复用的命令会话，链路信息压缩到工具带里，进入页面先看到终端本身。</p>
            </div>
            <span class="${shellStatusClassName(appState.nodeTerminal.sessionStatus)}" id="node-shell-status">${sessionStatus}</span>
          </div>
          <div class="terminal-shell-toolbar">
            <div class="chips terminal-shell-inline-meta">
              <div class="pill"><span>目标</span><strong>${escapeHtml(hostname)}</strong></div>
              <div class="pill"><span>SSH</span><strong>${escapeHtml(sshPort)}</strong></div>
              <div class="pill"><span>链路</span><strong>${escapeHtml(formatRouteSummary(node, nodes))}</strong></div>
            </div>
            <div class="modal-actions terminal-shell-actions">
            <button class="button primary" type="button" id="node-shell-open"${
              ["starting", "open"].includes(appState.nodeTerminal.sessionStatus) ? " disabled" : ""
            }>打开 Web Shell</button>
            <button class="button ghost" type="button" id="node-shell-refresh"${
              appState.nodeTerminal.sessionId ? "" : " disabled"
            }>刷新会话</button>
            <button class="button ghost" type="button" id="node-shell-close"${
              appState.nodeTerminal.sessionId ? "" : " disabled"
            }>结束会话</button>
            <button class="button ghost" type="button" id="node-shell-copy-output"${
              appState.nodeTerminal.sessionOutput ? "" : " disabled"
            }>复制输出</button>
            <a class="button ghost" href="/terminal.html">切到批量终端</a>
          </div>
          </div>
          <p class="field-note" id="node-shell-note">${escapeHtml(appState.nodeTerminal.sessionTransportNote)}</p>
          <div id="node-terminal-message">${
            appState.nodeTerminal.message
              ? `<div class="message ${appState.nodeTerminal.message.type}">${escapeHtml(
                  appState.nodeTerminal.message.text,
                )}</div>`
              : ""
          }</div>
          <div class="terminal-window single-terminal-window">
            <div class="terminal-window-head">
              <span id="node-shell-head-left">${escapeHtml(sessionLabel)}</span>
              <div class="terminal-window-head-meta">
                <span id="node-shell-transport">${escapeHtml(sessionLabel)}</span>
                <span id="node-shell-session-id">${escapeHtml(appState.nodeTerminal.sessionId || "未建立会话")}</span>
                <span id="node-shell-updated-at">${escapeHtml(sessionUpdatedLabel)}</span>
              </div>
            </div>
            <div class="terminal-screen terminal-screen-xterm" id="node-shell-terminal" role="application" aria-label="节点 Web Shell"></div>
            <pre class="terminal-screen" id="node-shell-screen">${sessionOutput}</pre>
          </div>
          <div class="single-terminal-direct-bar">
            <div class="single-terminal-direct-copy">
              <strong>直接交互</strong>
              <p id="node-shell-input-hint">${
                writable
                  ? "点击上方终端后可直接输入，Enter 执行，Ctrl+C 中断；预设命令会直接发送到当前会话。"
                  : appState.nodeTerminal.sessionId
                    ? "会话正在建立中，稍候即可直接在终端里输入。"
                    : "请先打开 Web Shell，会话就绪后可直接在终端里操作。"
              }</p>
            </div>
            <div class="terminal-presets">
              <button class="button ghost" type="button" data-node-terminal-preset="system">系统概览</button>
              <button class="button ghost" type="button" data-node-terminal-preset="disk">磁盘容量</button>
              <button class="button ghost" type="button" data-node-terminal-preset="network">网络监听</button>
              <button class="button ghost" type="button" data-node-terminal-preset="proxy">代理状态</button>
            </div>
          </div>
        </div>
      </article>
      <aside class="aside-stack">
        <section class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>接入说明</h3><p>先把传输方式、链路依赖和当前回退策略解释清楚。</p></div></div>
              <div class="detail-kv">
                <div class="kv-row"><span>节点状态</span><strong>${statusText(node.status)}</strong></div>
                <div class="kv-row"><span>接入方式</span><strong>${formatAccessMode(getAccessMode(node))}</strong></div>
                <div class="kv-row"><span>SSH 端口</span><strong>${escapeHtml(sshPort)}</strong></div>
                <div class="kv-row"><span>中转节点</span><strong>${
                  getAccessMode(node) === "relay" ? relayLabel : "无需中转"
                }</strong></div>
                <div class="kv-row"><span>链路摘要</span><strong>${formatRouteSummary(node, nodes)}</strong></div>
              </div>
            <div class="event-list" style="margin-top:14px;">
              <div class="event"><strong>传输策略</strong><p>当前会优先尝试真实 SSH；若节点地址或密钥暂时不可用，平台会明确提示原因并使用本机兜底模式。</p></div>
              <div class="event"><strong>链路提示</strong><p>${escapeHtml(relayHint)}</p></div>
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-body">
            <div class="panel-title"><div><h3>历史任务回显</h3><p>这里保留当前节点过去的初始化、批量脚本和命令记录。</p></div></div>
            <div class="terminal-run-list">
              ${
                historyItems ||
                '<div class="empty">这台节点还没有历史任务记录。后续初始化、批量脚本和修复动作都会沉淀在这里。</div>'
              }
            </div>
          </div>
        </section>
      </aside>
    </section>
  `;
  }

  function setupTerminalPage() {
    if (page !== "terminal") {
      return;
    }

    const actions = createTerminalPageActions({
      appState,
      applyTerminalPreset,
      fetchImpl,
      getAccessMode,
      refreshOperations,
      renderCurrentContent,
      setOperations,
      windowRef,
    });

    bindTerminalPageEvents({
      actions,
      documentRef: document,
    });
  }

  return {
    applyTerminalPreset,
    formatOperationSubject,
    getActiveNodeOperation,
    getActiveOperation,
    getNodeOperationTarget,
    getNodeOperations,
    getNodeTerminalPresetCommand,
    renderNodeTerminalSection,
    renderTerminalPage,
    setupTerminalPage,
  };
}
