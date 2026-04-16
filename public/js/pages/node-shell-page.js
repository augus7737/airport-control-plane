export function createNodeShellPageModule(dependencies = {}) {
  const {
    appState,
    escapeHtml,
    formatAccessMode,
    formatManagementAccessMode,
    formatNodeConfiguration,
    formatNodeSshPort,
    formatRelativeTime,
    getAccessMode,
    getCurrentNode,
    getNodeDisplayName,
    getNodeOperations,
    nodeDetailHref,
    nodeShellHref,
    renderNodeTerminalSection,
    shellStatusClassName,
    shellStatusText,
  } = dependencies;

  function renderNodeShellEntry(node, operations) {
    const nodeOperations = getNodeOperations(node, operations);
    const latestOperation = nodeOperations[0] || null;
    const sshPort = formatNodeSshPort(node);
    const sessionStatus = appState.nodeTerminal.sessionStatus;

    return `
      <section class="node-detail-shell-cta fade-up">
        <div class="node-detail-shell-cta-head">
          <div>
            <h4>实时终端</h4>
            <p>需要交互排障时，直接进入独立 Web Shell，不把终端输出塞进详情页正文。</p>
          </div>
          <div class="topbar-actions node-detail-shell-cta-actions">
            <span class="${shellStatusClassName(sessionStatus)}">${escapeHtml(shellStatusText(sessionStatus))}</span>
            <a class="button primary" href="${nodeShellHref(node.id)}">打开终端页</a>
          </div>
        </div>
        <div class="node-detail-shell-meta">
          <div class="pill"><span>节点</span><strong>${escapeHtml(getNodeDisplayName(node))}</strong></div>
          <div class="pill"><span>SSH</span><strong>${escapeHtml(sshPort)}</strong></div>
          <div class="pill"><span>最近任务</span><strong>${nodeOperations.length} 条</strong></div>
          <div class="pill"><span>最后执行</span><strong>${latestOperation ? formatRelativeTime(latestOperation.created_at) : "-"}</strong></div>
        </div>
      </section>
    `;
  }

  function renderNodeShellPage(nodes, operations) {
    const node = getCurrentNode(nodes);
    if (!node) {
      return '<div class="empty">当前还没有可打开终端的节点。先完成节点纳管，再进入独立终端页。</div>';
    }
    const sessionLabel = appState.nodeTerminal.sessionTransportLabel;
    const relayMode = formatManagementAccessMode(node);
    const sshPort = formatNodeSshPort(node);

    return `
      <section class="panel shell-page-head fade-up">
        <div class="panel-body">
          <div class="shell-page-head-main">
            <div>
              <div class="tiny shell-page-breadcrumb">
                <a href="/nodes.html">节点清单</a>
                <span>/</span>
                <a href="${nodeDetailHref(node.id)}">${escapeHtml(getNodeDisplayName(node))}</a>
                <span>/</span>
                <strong>Web Shell</strong>
              </div>
              <h3>${escapeHtml(getNodeDisplayName(node))}</h3>
              <p>这里是单节点独立终端页。后续如果接入 xterm.js 或 WebSocket，会直接升级这一页，不再受节点详情布局约束。</p>
            </div>
            <div class="shell-page-head-actions">
              <a class="button ghost" href="${nodeDetailHref(node.id)}">返回节点详情</a>
              <a class="button ghost" href="/terminal.html">批量终端</a>
            </div>
          </div>
          <div class="chips shell-page-chips">
            <div class="pill"><span>管理链路</span><strong>${escapeHtml(relayMode)}</strong></div>
            <div class="pill"><span>SSH 端口</span><strong>${escapeHtml(sshPort)}</strong></div>
            <div class="pill"><span>当前传输</span><strong>${escapeHtml(sessionLabel)}</strong></div>
            <div class="pill"><span>公网 IPv4</span><strong>${escapeHtml(node.facts?.public_ipv4 || "-")}</strong></div>
            <div class="pill"><span>配置</span><strong>${escapeHtml(formatNodeConfiguration(node))}</strong></div>
          </div>
        </div>
      </section>
      ${renderNodeTerminalSection(node, nodes, operations)}
    `;
  }

  return {
    renderNodeShellEntry,
    renderNodeShellPage,
  };
}
