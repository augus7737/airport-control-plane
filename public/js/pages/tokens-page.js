export function createTokensPageModule(dependencies) {
  const {
    appState,
    daysUntil,
    documentRef,
    escapeHtml,
    fetchImpl = fetch,
    formatDate,
    formatRelativeTime,
    formatTokenUsage,
    getBootstrapCommand,
    getBootstrapEnrollCommand,
    getBootstrapMirrorCommand,
    getBootstrapPrepareCommand,
    getEffectiveTokenStatus,
    getPrimaryBootstrapToken,
    maskTokenValue,
    navigatorRef,
    page,
    renderBootstrapCommandPair,
    renderCurrentContent,
    renderPlatformSshPanel,
    statusClassName,
    statusText,
    upsertBootstrapToken,
    windowRef,
  } = dependencies;

  function renderTokensPage() {
    const tokens = appState.tokens;
    const activeTokens = tokens.filter((token) => getEffectiveTokenStatus(token) === "active");
    const disabledTokens = tokens.filter((token) => getEffectiveTokenStatus(token) === "disabled");
    const riskyTokens = tokens.filter((token) => {
      const status = getEffectiveTokenStatus(token);
      if (status === "expired" || status === "exhausted") {
        return true;
      }
      const days = daysUntil(token.expires_at);
      return days !== null && days <= 7;
    });
    const primaryToken = getPrimaryBootstrapToken();
    const lastCreatedToken = appState.tokenConsole.lastCreatedToken;

    const rows = tokens.length
      ? tokens.map((token) => {
          const effectiveStatus = getEffectiveTokenStatus(token);
          const actionLabel = effectiveStatus === "disabled" ? "重新启用" : "停用";
          const canToggle = ["active", "disabled"].includes(effectiveStatus);
          return `
          <tr>
            <td>
              <div class="node-meta">
                <span class="node-name">${escapeHtml(token.label || token.id)}</span>
                <span class="node-id mono">${escapeHtml(token.id)}</span>
              </div>
            </td>
            <td><span class="${statusClassName(effectiveStatus)}">${statusText(effectiveStatus)}</span></td>
            <td>${formatTokenUsage(token)}</td>
            <td>${formatDate(token.expires_at)}</td>
            <td>${token.last_used_at ? formatRelativeTime(token.last_used_at) : "未使用"}</td>
            <td>${escapeHtml(token.note || "-")}</td>
            <td>
              <div class="token-actions">
                <button class="button ghost token-table-button" type="button" data-token-copy="${escapeHtml(token.id)}">复制三步命令</button>
                ${
                  canToggle
                    ? `<button class="button ghost token-table-button" type="button" data-token-toggle="${escapeHtml(token.id)}" data-next-status="${effectiveStatus === "disabled" ? "active" : "disabled"}">${actionLabel}</button>`
                    : `<span class="tiny">需调整上限或重建令牌</span>`
                }
              </div>
              <div class="tiny token-inline-note">${escapeHtml(maskTokenValue(token.token))}</div>
            </td>
          </tr>
        `;
        }).join("")
      : `
      <tr>
        <td colspan="7">
          <div class="empty">当前还没有注册令牌。先创建一条，再把纳管命令发到新机器。</div>
        </td>
      </tr>
    `;

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">可用令牌</div><div class="stat-value">${activeTokens.length}</div><div class="stat-foot">当前还能直接用于节点纳管的入口令牌。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">已停用</div><div class="stat-value">${disabledTokens.length}</div><div class="stat-foot">人为收回或暂时冻结的令牌，不会再允许新节点注册。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">需关注</div><div class="stat-value">${riskyTokens.length}</div><div class="stat-foot">已过期、已用尽，或 7 天内到期的令牌数量。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">累计注册</div><div class="stat-value">${tokens.reduce((total, token) => total + Number(token.uses || 0), 0)}</div><div class="stat-foot">所有令牌历史触发过的纳管次数。</div></div></article>
      </section>
      <section class="workspace fade-up">
        <article class="panel">
          <div class="panel-body">
            <div class="panel-title"><div><h3>令牌列表</h3><p>把入口凭证的用途、状态和使用轨迹收在一起，避免“谁在随便注册节点”这件事失控。</p></div></div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>用途 / 范围</th><th>状态</th><th>已使用</th><th>到期时间</th><th>最近使用</th><th>备注</th><th>操作</th></tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </article>
        <aside class="aside-stack">
          ${renderPlatformSshPanel()}
          <article class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>当前默认纳管步骤</h3><p>${primaryToken ? "会优先使用第一条可用令牌，建议按步骤执行。" : "当前没有可用令牌，请先创建。"} </p></div></div>
              <div class="detail-kv">
                <div class="kv-row"><span>主令牌</span><strong>${primaryToken ? escapeHtml(primaryToken.label || primaryToken.id) : "未配置"}</strong></div>
                <div class="kv-row"><span>令牌值</span><strong class="mono">${primaryToken ? escapeHtml(maskTokenValue(primaryToken.token)) : "-"}</strong></div>
                <div class="kv-row"><span>有效期</span><strong>${primaryToken ? formatDate(primaryToken.expires_at) : "-"}</strong></div>
              </div>
              <div id="token-page-command">${renderBootstrapCommandPair(null, {
                mirrorId: "token-page-command-mirror",
                prepareId: "token-page-command-prepare",
                enrollId: "token-page-command-enroll",
                mirrorHint: "国内 Alpine 节点建议先切换到阿里云镜像。",
                prepareHint: "先补齐 curl、openssh 和证书。",
                enrollHint: "前两步完成后，再执行接管。",
              })}</div>
              <div class="modal-actions" style="margin-top:12px;">
                <button class="button primary" type="button" id="copy-primary-token-mirror"${primaryToken ? "" : " disabled"}>复制步骤 1</button>
                <button class="button ghost" type="button" id="copy-primary-token-prepare"${primaryToken ? "" : " disabled"}>复制步骤 2</button>
                <button class="button ghost" type="button" id="copy-primary-token-command"${primaryToken ? "" : " disabled"}>复制步骤 3</button>
                <button class="button ghost" type="button" id="copy-primary-token"${primaryToken ? "" : " disabled"}>复制令牌值</button>
              </div>
            </div>
          </article>
          <article class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>${lastCreatedToken ? "最近创建" : "设计重点"}</h3><p>${lastCreatedToken ? "方便你马上把三步发给新机器。" : "先把入口管理做好，后面纳管才不会乱。"} </p></div></div>
              ${
                lastCreatedToken
                  ? `
                    <div class="event-list">
                      <div class="event"><strong>${escapeHtml(lastCreatedToken.label || lastCreatedToken.id)}</strong><p>令牌值：<span class="mono">${escapeHtml(lastCreatedToken.token)}</span></p></div>
                      <div class="event"><strong>推荐用法</strong><p>新机器执行后会自动登记系统事实信息，再进入后续初始化流程。</p></div>
                    </div>
                  `
                  : `
                    <div class="event-list">
                      <div class="event"><strong>按场景发令牌</strong><p>比如默认边缘节点、人工补录、迁移批次分开管理。</p></div>
                      <div class="event"><strong>必须可失效</strong><p>令牌泄露或任务结束后，要能立即收回。</p></div>
                      <div class="event"><strong>必须有审计</strong><p>谁创建、谁使用、在哪台机器使用都应记录下来。</p></div>
                    </div>
                  `
              }
            </div>
          </article>
        </aside>
      </section>
    `;
  }

  function setupTokensPage() {
    if (page !== "tokens") {
      return;
    }

    documentRef.getElementById("copy-primary-token-mirror")?.addEventListener("click", async (event) => {
      const ok = await navigatorRef.clipboard.writeText(getBootstrapMirrorCommand()).then(() => true, () => false);
      event.currentTarget.textContent = ok ? "已复制步骤 1" : "复制失败";
    });

    documentRef.getElementById("copy-primary-token-prepare")?.addEventListener("click", async (event) => {
      const ok = await navigatorRef.clipboard.writeText(getBootstrapPrepareCommand()).then(() => true, () => false);
      event.currentTarget.textContent = ok ? "已复制步骤 2" : "复制失败";
    });

    documentRef.getElementById("copy-primary-token-command")?.addEventListener("click", async (event) => {
      const ok = await navigatorRef.clipboard.writeText(getBootstrapEnrollCommand()).then(() => true, () => false);
      event.currentTarget.textContent = ok ? "已复制步骤 3" : "复制失败";
    });

    documentRef.getElementById("copy-primary-token")?.addEventListener("click", async (event) => {
      const token = getPrimaryBootstrapToken();
      const ok = await navigatorRef.clipboard.writeText(token?.token || "").then(() => true, () => false);
      event.currentTarget.textContent = ok ? "已复制令牌" : "复制失败";
    });

    documentRef.querySelectorAll("[data-token-copy]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const tokenId = event.currentTarget.dataset.tokenCopy;
        const token = appState.tokens.find((item) => item.id === tokenId);
        const ok = await navigatorRef.clipboard
          .writeText(getBootstrapCommand(token?.token || ""))
          .then(() => true, () => false);
        event.currentTarget.textContent = ok ? "已复制三步" : "复制失败";
      });
    });

    documentRef.querySelectorAll("[data-token-toggle]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const tokenId = event.currentTarget.dataset.tokenToggle;
        const nextStatus = event.currentTarget.dataset.nextStatus || "disabled";
        const token = appState.tokens.find((item) => item.id === tokenId);
        if (!token) {
          return;
        }

        event.currentTarget.disabled = true;

        try {
          const response = await fetchImpl(`/api/v1/bootstrap-tokens/${encodeURIComponent(token.id)}`, {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              status: nextStatus,
            }),
          });

          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.details?.join("，") || result.message || "更新失败");
          }

          upsertBootstrapToken(result.token);
          renderCurrentContent();
        } catch (error) {
          event.currentTarget.disabled = false;
          windowRef.alert(error instanceof Error ? error.message : "更新失败");
        }
      });
    });
  }

  return {
    renderTokensPage,
    setupTokensPage,
  };
}
