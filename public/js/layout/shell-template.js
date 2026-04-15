export function createShellTemplateModule(dependencies) {
  const {
    assetModalTemplate,
    enrollModalTemplate,
    escapeHtml,
    getPlatformBaseUrl,
    manualModalTemplate,
    navItems,
    platformSshStatusLabel,
    renderBootstrapCommandPair,
    shouldShowBootstrapHero,
    shouldShowProvisioningChips,
    tokenModalTemplate,
  } = dependencies;

  function shellTemplate(meta, activeKey) {
    const navHtml = navItems
      .map((item) => `
      <a class="nav-item ${item.key === activeKey ? "active" : ""}" href="${item.href}">
        <span>${item.label}</span>
        <span>${item.key === "nodes" ? '<span id="nav-node-count">0</span>' : ""}</span>
      </a>
    `)
      .join("");

    const actionsHtml = meta.actions
      .map((action) => {
        const cls = action.kind === "primary" ? "button primary" : "button";
        const attrs = action.id ? ` id="${action.id}"` : "";
        if (action.href) {
          return `<a class="${cls}" href="${action.href}"${attrs}>${action.label}</a>`;
        }
        return `<button class="${cls}"${attrs}>${action.label}</button>`;
      })
      .join("");
    const showBootstrapHero = shouldShowBootstrapHero();
    const showProvisioningChips = shouldShowProvisioningChips();
    const topbarLeftChips = [
      '<div class="chip"><span>环境</span><strong>本地控制面</strong></div>',
      '<div class="chip"><span>控制面</span><strong id="service-state">在线</strong></div>',
    ];

    if (showProvisioningChips) {
      topbarLeftChips.push(
        '<div class="chip"><span>注册令牌</span><strong id="current-bootstrap-token">未配置</strong></div>',
      );
      topbarLeftChips.push(
        `<div class="chip"><span>纳管地址</span><strong id="current-bootstrap-base">${escapeHtml(getPlatformBaseUrl())}</strong></div>`,
      );
    }

    topbarLeftChips.push(
      `<div class="chip"><span>SSH 密钥</span><strong id="current-platform-ssh">${escapeHtml(platformSshStatusLabel())}</strong></div>`,
    );

    return `
    <div class="app">
      <aside class="sidebar fade-up">
        <div class="brand">
          <div class="brand-mark">AC</div>
          <div>
            <h1>机场控制台</h1>
            <p>节点台账、链路与纳管控制台</p>
          </div>
        </div>
        <div class="nav-group">
          <div class="nav-label">控制台</div>
          <div class="nav-list">${navHtml}</div>
        </div>
      </aside>
      <main class="content">
        <div class="topbar fade-up">
          <div class="topbar-left">${topbarLeftChips.join("")}</div>
          <div class="topbar-actions">
            <div class="topbar-actions-main">${actionsHtml}</div>
            <div class="topbar-auth" id="operator-session-bar">
              <div class="session-indicator" id="operator-session-pill" data-auth-state="pending">
                <span class="session-indicator-dot" aria-hidden="true"></span>
                <span id="operator-session-label">会话校验中</span>
              </div>
              <button class="button quiet" id="operator-logout-button" type="button" hidden>
                退出登录
              </button>
            </div>
          </div>
        </div>
        ${
          showBootstrapHero
            ? `<section class="page-hero fade-up">
          <span class="eyebrow">${meta.title}</span>
          <h2>${meta.title}</h2>
          <p>${meta.subtitle}</p>
          <div class="console">
            <div class="console-head">
              <div class="dots"><span></span><span></span><span></span></div>
              <span>默认纳管步骤</span>
            </div>
            <div id="bootstrap-command">${renderBootstrapCommandPair(null, {
              compact: true,
              mirrorId: "bootstrap-command-mirror",
              prepareId: "bootstrap-command-prepare",
              enrollId: "bootstrap-command-enroll",
            })}</div>
          </div>
        </section>`
            : ""
        }
        <div id="page-content"></div>
      </main>
    </div>
    ${enrollModalTemplate()}
    ${manualModalTemplate()}
    ${assetModalTemplate()}
    ${tokenModalTemplate()}
  `;
  }

  return {
    shellTemplate,
  };
}
