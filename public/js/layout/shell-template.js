export function createShellTemplateModule(dependencies) {
  const {
    assetModalTemplate,
    enrollModalTemplate,
    escapeHtml,
    getPlatformBaseUrl,
    manualModalTemplate,
    navGroups,
    platformSshStatusLabel,
    renderBootstrapCommandPair,
    shouldShowBootstrapHero,
    shouldShowProvisioningChips,
    tokenModalTemplate,
  } = dependencies;

  function renderNavGroups(activeKey) {
    return navGroups
      .map(
        (group) => `
        <div class="nav-group">
          <div class="nav-label">${group.label}</div>
          <div class="nav-list">
            ${group.items
              .map(
                (item) => `
                <a class="nav-item ${item.key === activeKey ? "active" : ""}" href="${item.href}">
                  <span>${item.label}</span>
                  <span>${item.key === "nodes" ? '<span id="nav-node-count">0</span>' : ""}</span>
                </a>
              `,
              )
              .join("")}
          </div>
        </div>
      `,
      )
      .join("");
  }

  function shellTemplate(meta, activeKey) {
    const navHtml = renderNavGroups(activeKey);

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
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path
                d="M4 12.5 9.2 6a2.2 2.2 0 0 1 3.44 0l1.2 1.48 1.77-2.2a2.2 2.2 0 0 1 3.43 0L20 6.4v11.1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"
                fill="currentColor"
                opacity=".18"
              />
              <path
                d="m6.6 14.2 3.14-3.9a1.2 1.2 0 0 1 1.87 0l1.85 2.27 2.8-3.48"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </svg>
          </div>
          <div>
            <h1>机场控制台</h1>
            <p>节点台账、链路与纳管控制台</p>
          </div>
        </div>
        ${navHtml}
      </aside>
      <main class="content">
        <div class="topbar fade-up">
          <div class="topbar-left">${topbarLeftChips.join("")}</div>
          <div class="topbar-actions">
            <div class="topbar-actions-main">${actionsHtml}</div>
            <div class="topbar-auth" id="operator-session-bar">
              <details class="node-row-menu theme-preference-menu" id="theme-preference-menu">
                <summary
                  class="button quiet"
                  id="theme-preference-trigger"
                  aria-haspopup="menu"
                  aria-expanded="false"
                  aria-label="主题：浅色"
                  title="主题：浅色"
                >
                  <span id="theme-preference-icon" aria-hidden="true">☀</span>
                </summary>
                <div class="node-row-menu-panel" role="menu" aria-label="主题偏好">
                  <button
                    class="node-row-menu-item"
                    type="button"
                    role="menuitemradio"
                    aria-checked="true"
                    data-theme-preference-option="light"
                    title="切换到浅色主题"
                  >✓ 浅色</button>
                  <button
                    class="node-row-menu-item"
                    type="button"
                    role="menuitemradio"
                    aria-checked="false"
                    data-theme-preference-option="dark"
                    title="切换到深色主题"
                  >深色</button>
                  <button
                    class="node-row-menu-item"
                    type="button"
                    role="menuitemradio"
                    aria-checked="false"
                    data-theme-preference-option="system"
                    title="切换到跟随系统主题"
                  >跟随系统</button>
                </div>
              </details>
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
              singleScript: true,
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
