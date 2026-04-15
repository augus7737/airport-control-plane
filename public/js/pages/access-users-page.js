function createEmptyDraft() {
  return {
    name: "",
    protocol: "vless",
    uuid: "",
    alter_id: "0",
    status: "active",
    expires_at: "",
    profile_id: "",
    node_group_ids: [],
    note: "",
  };
}

function toDateInputValue(value) {
  if (!value) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return String(value);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function resolveUserUuid(user) {
  if (typeof user?.credential === "string") {
    return user.credential;
  }
  return String(user?.credential?.uuid || user?.uuid || "");
}

function resolveUserAlterId(user) {
  if (user?.credential?.alter_id === undefined || user?.credential?.alter_id === null) {
    return "";
  }
  return String(user.credential.alter_id);
}

function toSafeFileName(value) {
  return String(value || "share")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "share";
}

export function createAccessUsersPageModule(dependencies) {
  const {
    appState,
    createAccessUser,
    deleteAccessUser,
    documentRef,
    escapeHtml,
    formatDate,
    formatRelativeTime,
    getAccessUserShare,
    page,
    refreshRuntimeData,
    regenerateAccessUserShareToken,
    renderCurrentContent,
    statusClassName,
    statusText,
    updateAccessUser,
    windowRef,
  } = dependencies;

  const state = {
    filter: "",
    selectedId: null,
    message: null,
    shareData: null,
    shareUserId: null,
    shareLoading: false,
    shareError: null,
    shareFeedback: null,
    shareRequestKey: null,
    queryHydrated: false,
    pendingQueryShareUserId: null,
  };

  function getSelectedUser() {
    return appState.accessUsers.find((item) => item.id === state.selectedId) || null;
  }

  function clearShareState(options = {}) {
    const { preserveData = false, preserveUserId = false } = options;
    state.shareLoading = false;
    state.shareError = null;
    state.shareFeedback = null;
    state.shareRequestKey = null;
    if (!preserveData) {
      state.shareData = null;
    }
    if (!preserveUserId) {
      state.shareUserId = null;
    }
  }

  function getVisibleShareData(selectedUser) {
    if (!selectedUser || state.shareUserId !== selectedUser.id) {
      return null;
    }
    return state.shareData;
  }

  function getDraft(user) {
    if (!user) {
      return createEmptyDraft();
    }
    return {
      name: String(user.name || ""),
      protocol: String(user.protocol || "vless"),
      uuid: resolveUserUuid(user),
      alter_id: resolveUserAlterId(user) || "0",
      status: String(user.status || "active"),
      expires_at: toDateInputValue(user.expires_at),
      profile_id: String(user.profile_id || ""),
      node_group_ids: Array.isArray(user.node_group_ids) ? user.node_group_ids : [],
      note: String(user.note || ""),
    };
  }

  function getProfileName(profileId) {
    return appState.proxyProfiles.find((profile) => profile.id === profileId)?.name || "未绑定";
  }

  function getGroupName(groupId) {
    return appState.nodeGroups.find((group) => group.id === groupId)?.name || groupId;
  }

  function getFilteredUsers() {
    const query = state.filter.trim().toLowerCase();
    if (!query) {
      return appState.accessUsers;
    }
    return appState.accessUsers.filter((user) => {
      const searchText = [
        user.id,
        user.name,
        user.note,
        user.profile_id,
        resolveUserUuid(user),
        resolveUserAlterId(user),
      ]
        .join(" ")
        .toLowerCase();
      return searchText.includes(query);
    });
  }

  function scrollToForm() {
    documentRef.getElementById("access-user-form-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function scrollToSharePanel() {
    documentRef.getElementById("access-user-share-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function setShareFeedback(type, text) {
    state.shareFeedback = {
      type,
      text,
    };
    renderCurrentContent();
  }

  function hydrateFromQuery() {
    if (state.queryHydrated) {
      return;
    }

    state.queryHydrated = true;
    const params = new windowRef.URLSearchParams(windowRef.location.search || "");
    const userId = String(params.get("user_id") || "").trim();
    const shouldOpenShare = String(params.get("share") || "").trim() === "1";

    if (userId && appState.accessUsers.some((item) => item.id === userId)) {
      state.selectedId = userId;
      if (shouldOpenShare) {
        state.pendingQueryShareUserId = userId;
      }
    }
  }

  async function loadShareData(userId, options = {}) {
    const selectedUser =
      appState.accessUsers.find((item) => item.id === userId) ||
      appState.accessUsers.find((item) => item.id === state.selectedId);
    if (!selectedUser || !getAccessUserShare) {
      return;
    }

    const requestKey = `${selectedUser.id}:${Date.now()}`;
    state.selectedId = selectedUser.id;
    state.shareUserId = selectedUser.id;
    state.shareRequestKey = requestKey;
    state.shareLoading = true;
    state.shareError = null;
    state.shareFeedback = null;
    if (!options.keepCurrentData) {
      state.shareData = null;
    }
    renderCurrentContent();
    if (options.scroll !== false) {
      scrollToSharePanel();
    }

    try {
      const result = await getAccessUserShare(selectedUser.id);
      if (state.shareRequestKey !== requestKey) {
        return;
      }

      state.shareData = result;
      state.shareLoading = false;
      state.shareError = null;
      renderCurrentContent();
      if (options.scroll !== false) {
        scrollToSharePanel();
      }
    } catch (error) {
      if (state.shareRequestKey !== requestKey) {
        return;
      }

      state.shareLoading = false;
      state.shareError = error instanceof Error ? error.message : "加载分享信息失败";
      renderCurrentContent();
      if (options.scroll !== false) {
        scrollToSharePanel();
      }
    }
  }

  async function handleRegenerateShareToken() {
    const selectedUser = getSelectedUser();
    if (!selectedUser || !regenerateAccessUserShareToken) {
      return;
    }

    const confirmed = windowRef.confirm(
      `确认重置“${selectedUser.name || selectedUser.id}”的订阅令牌吗？旧订阅链接会立即失效。`,
    );
    if (!confirmed) {
      return;
    }

    try {
      await regenerateAccessUserShareToken(selectedUser.id);
      await refreshRuntimeData();
      await loadShareData(selectedUser.id, { keepCurrentData: false, scroll: true });
      state.message = {
        type: "success",
        text: "订阅令牌已重置，新的聚合订阅与节点订阅已刷新。",
      };
      renderCurrentContent();
      scrollToSharePanel();
    } catch (error) {
      setShareFeedback("error", error instanceof Error ? error.message : "重置订阅令牌失败");
    }
  }

  async function handleDelete(id) {
    const user = appState.accessUsers.find((item) => item.id === id);
    if (!user) {
      return;
    }
    const confirmed = windowRef.confirm(`确认删除接入用户“${user.name || user.id}”吗？`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteAccessUser(user.id);
      if (state.selectedId === user.id) {
        state.selectedId = null;
      }
      if (state.shareUserId === user.id) {
        clearShareState();
      }
      state.message = {
        type: "success",
        text: `已删除接入用户：${user.name || user.id}`,
      };
      await refreshRuntimeData();
      renderCurrentContent();
    } catch (error) {
      state.message = {
        type: "error",
        text: error instanceof Error ? error.message : "删除接入用户失败",
      };
      renderCurrentContent();
    }
  }

  function renderUserGroupSummary(groupIds = []) {
    if (!groupIds.length) {
      return '<span class="tiny">未绑定节点组</span>';
    }
    return `
      <div class="ops-chip-list">
        ${groupIds
          .slice(0, 3)
          .map((groupId) => `<span class="pill">${escapeHtml(getGroupName(groupId))}</span>`)
          .join("")}
        ${groupIds.length > 3 ? `<span class="pill">+${groupIds.length - 3}</span>` : ""}
      </div>
    `;
  }

  function renderShareLinkBlock(options) {
    const {
      title,
      description,
      value,
      qrSvg,
      copyKind,
      targetIndex = "",
      emptyText = "当前暂无可用链接。",
    } = options;
    const safeValue = value || "";
    const hasValue = Boolean(safeValue);
    const hasQr = Boolean(qrSvg);
    const dataTargetIndex = targetIndex === "" ? "" : ` data-target-index="${targetIndex}"`;

    return `
      <section class="share-link-block">
        <div class="share-link-head">
          <strong>${escapeHtml(title)}</strong>
          ${description ? `<span class="tiny">${escapeHtml(description)}</span>` : ""}
        </div>
        <textarea class="share-readonly mono" readonly rows="${copyKind === "aggregate_subscription" ? 3 : 2}">${escapeHtml(
          hasValue ? safeValue : emptyText,
        )}</textarea>
        <div class="ops-table-actions share-action-row">
          <button class="button ghost" type="button" data-share-copy="${escapeHtml(copyKind)}"${dataTargetIndex}${
            hasValue ? "" : " disabled"
          }>复制链接</button>
          <button class="button ghost" type="button" data-share-download-qr="${escapeHtml(copyKind)}"${dataTargetIndex}${
            hasQr ? "" : " disabled"
          }>下载二维码</button>
          ${
            hasValue
              ? `<a class="button ghost" href="${escapeHtml(safeValue)}" target="_blank" rel="noreferrer">打开</a>`
              : '<button class="button ghost" type="button" disabled>打开</button>'
          }
        </div>
        <div class="share-qr-shell">
          ${
            hasQr
              ? `<div class="share-qr-svg">${qrSvg}</div>`
              : `<div class="share-qr-empty">${escapeHtml(emptyText)}</div>`
          }
        </div>
      </section>
    `;
  }

  function renderTargetShareCard(target, index) {
    return `
      <article class="share-target-card">
        <div class="share-target-head">
          <div class="share-target-title">
            <strong>${escapeHtml(target.node_name || target.node_id || "未命名节点")}</strong>
            <span class="tiny mono">${escapeHtml(target.node_id || "-")}</span>
          </div>
          <div class="ops-chip-list">
            <span class="pill">${escapeHtml(String(target.protocol || "vless").toUpperCase())}</span>
            <span class="pill">${escapeHtml(String(target.security || "none").toUpperCase())}</span>
            <span class="pill">${escapeHtml(String(target.transport || "tcp").toUpperCase())}</span>
          </div>
        </div>

        <div class="share-target-meta">
          <div><span>线路</span><strong>${escapeHtml(target.route_label || target.node_name || "-")}</strong></div>
          <div><span>区域</span><strong>${escapeHtml(target.region || "未标记")}</strong></div>
          <div><span>厂商</span><strong>${escapeHtml(target.provider || "未标记")}</strong></div>
          <div><span>业务入口</span><strong class="mono">${escapeHtml(
            target.endpoint_host ? `${target.endpoint_host}:${target.endpoint_port || "-"}` : "未识别",
          )}</strong></div>
          <div><span>生效发布</span><strong>${escapeHtml(target.latest_release_id || "-")}</strong></div>
        </div>

        <div class="share-link-grid">
          ${renderShareLinkBlock({
            title: "节点订阅链接",
            description: "这个节点当前生效配置的单节点订阅入口。",
            value: target.subscription_url,
            qrSvg: target.subscription_qr_svg,
            copyKind: "target_subscription",
            targetIndex: index,
            emptyText: "当前暂无单节点订阅链接。",
          })}
          ${renderShareLinkBlock({
            title: "直连分享链接",
            description: "直接投给客户端的单条 vless:// / vmess://。",
            value: target.share_url,
            qrSvg: target.share_qr_svg,
            copyKind: "target_share",
            targetIndex: index,
            emptyText: "当前模板参数不足，暂无法生成直连分享链接。",
          })}
        </div>
      </article>
    `;
  }

  function renderSharePanel(selectedUser) {
    const shareData = getVisibleShareData(selectedUser);
    const warnings = Array.isArray(shareData?.warnings) ? shareData.warnings : [];
    const targets = Array.isArray(shareData?.targets) ? shareData.targets : [];

    if (!selectedUser) {
      return `
        <article class="panel" id="access-user-share-panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>分享与订阅</h3>
                <p>选中一个接入用户后，这里会展示聚合订阅和节点级分享结果。</p>
              </div>
            </div>
            <div class="ops-empty-block">先从左侧选择一个接入用户，或者点击列表里的“订阅”按钮。</div>
          </div>
        </article>
      `;
    }

    return `
      <article class="panel" id="access-user-share-panel">
        <div class="panel-body">
          <div class="panel-title">
            <div>
              <h3>分享与订阅</h3>
              <p>按“当前各节点最近一次成功发布”回溯这个用户的真实生效结果，不按理论节点组猜测。</p>
            </div>
            <div class="ops-table-actions">
              <button class="button ghost" type="button" id="access-user-share-refresh">刷新结果</button>
              <button class="button ghost" type="button" id="access-user-share-regenerate">重置令牌</button>
            </div>
          </div>

          <div class="share-summary-strip">
            <div>
              <span>当前用户</span>
              <strong>${escapeHtml(selectedUser.name || selectedUser.id)}</strong>
            </div>
            <div>
              <span>当前模板</span>
              <strong>${escapeHtml(getProfileName(selectedUser.profile_id))}</strong>
            </div>
            <div>
              <span>当前生效节点</span>
              <strong>${shareData ? String(shareData.aggregate?.target_count ?? 0) : "-"}</strong>
            </div>
          </div>

          ${
            state.shareFeedback
              ? `<div class="message ${escapeHtml(state.shareFeedback.type)}">${escapeHtml(
                  state.shareFeedback.text,
                )}</div>`
              : ""
          }
          ${
            state.shareError
              ? `<div class="message error">${escapeHtml(state.shareError)}</div>`
              : ""
          }

          ${
            state.shareLoading
              ? '<div class="ops-empty-block">正在从后端加载聚合订阅、节点订阅和直连分享结果…</div>'
              : shareData
                ? `
                  ${renderShareLinkBlock({
                    title: "聚合订阅链接",
                    description: `当前共 ${shareData.aggregate?.target_count ?? 0} 个生效节点，聚合订阅会一次返回所有可生成的直连链接。`,
                    value: shareData.aggregate?.subscription_url,
                    qrSvg: shareData.aggregate?.subscription_qr_svg,
                    copyKind: "aggregate_subscription",
                    emptyText: "当前暂无聚合订阅链接。",
                  })}

                  ${
                    warnings.length
                      ? `
                        <div class="share-warning-list">
                          ${warnings
                            .map(
                              (warning) =>
                                `<div class="share-warning-item">${escapeHtml(String(warning))}</div>`,
                            )
                            .join("")}
                        </div>
                      `
                      : ""
                  }

                  ${
                    targets.length
                      ? `<div class="share-target-list">${targets
                          .map((target, index) => renderTargetShareCard(target, index))
                          .join("")}</div>`
                      : '<div class="ops-empty-block">这个接入用户当前没有任何生效节点，所以暂时不会生成节点级订阅结果。</div>'
                  }
                `
                : `
                  <div class="ops-empty-block">
                    还没加载当前用户的订阅结果。点击下面按钮后，后端会统一生成聚合订阅、节点订阅、直连分享链接和二维码。
                  </div>
                  <div class="ops-action-row">
                    <button class="button primary" type="button" id="access-user-share-load">加载分享结果</button>
                  </div>
                `
          }
        </div>
      </article>
    `;
  }

  function resolveCopyValue(kind, targetIndex) {
    const shareData = getVisibleShareData(getSelectedUser());
    if (!shareData) {
      return "";
    }

    if (kind === "aggregate_subscription") {
      return String(shareData.aggregate?.subscription_url || "");
    }

    const target = Array.isArray(shareData.targets) ? shareData.targets[targetIndex] : null;
    if (!target) {
      return "";
    }

    if (kind === "target_subscription") {
      return String(target.subscription_url || "");
    }

    if (kind === "target_share") {
      return String(target.share_url || "");
    }

    return "";
  }

  function resolveQrSvg(kind, targetIndex) {
    const shareData = getVisibleShareData(getSelectedUser());
    if (!shareData) {
      return "";
    }

    if (kind === "aggregate_subscription") {
      return String(shareData.aggregate?.subscription_qr_svg || "");
    }

    const target = Array.isArray(shareData.targets) ? shareData.targets[targetIndex] : null;
    if (!target) {
      return "";
    }

    if (kind === "target_subscription") {
      return String(target.subscription_qr_svg || "");
    }

    if (kind === "target_share") {
      return String(target.share_qr_svg || "");
    }

    return "";
  }

  function buildQrFileName(kind, targetIndex) {
    const selectedUser = getSelectedUser();
    const shareData = getVisibleShareData(selectedUser);
    const userName = toSafeFileName(selectedUser?.name || selectedUser?.id || "access-user");

    if (kind === "aggregate_subscription") {
      return `${userName}-aggregate-subscription.svg`;
    }

    const target = Array.isArray(shareData?.targets) ? shareData.targets[targetIndex] : null;
    const nodeName = toSafeFileName(target?.node_name || target?.node_id || `target-${targetIndex + 1}`);

    if (kind === "target_subscription") {
      return `${userName}-${nodeName}-subscription.svg`;
    }

    return `${userName}-${nodeName}-share.svg`;
  }

  async function copyShareValue(kind, targetIndex) {
    const value = resolveCopyValue(kind, targetIndex);
    if (!value) {
      setShareFeedback("error", "当前没有可复制的链接。");
      return;
    }

    if (!windowRef.navigator?.clipboard?.writeText) {
      setShareFeedback("error", "当前浏览器环境不支持剪贴板复制。");
      return;
    }

    try {
      await windowRef.navigator.clipboard.writeText(value);
      setShareFeedback("success", "链接已复制到剪贴板。");
      scrollToSharePanel();
    } catch (error) {
      setShareFeedback("error", error instanceof Error ? error.message : "复制链接失败");
    }
  }

  function downloadQrSvg(kind, targetIndex) {
    const svgText = resolveQrSvg(kind, targetIndex);
    if (!svgText) {
      setShareFeedback("error", "当前没有可下载的二维码。");
      return;
    }

    if (!windowRef.URL?.createObjectURL) {
      setShareFeedback("error", "当前浏览器环境不支持下载二维码。");
      return;
    }

    const blob = new windowRef.Blob([svgText], {
      type: "image/svg+xml;charset=utf-8",
    });
    const objectUrl = windowRef.URL.createObjectURL(blob);
    const anchor = documentRef.createElement("a");
    anchor.href = objectUrl;
    anchor.download = buildQrFileName(kind, targetIndex);
    documentRef.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    windowRef.setTimeout(() => {
      windowRef.URL.revokeObjectURL(objectUrl);
    }, 0);
    setShareFeedback("success", "二维码 SVG 已开始下载。");
    scrollToSharePanel();
  }

  function renderAccessUsersPage() {
    hydrateFromQuery();

    const selectedUser = getSelectedUser();
    const draft = getDraft(selectedUser);
    const filteredUsers = getFilteredUsers();
    const activeCount = appState.accessUsers.filter((user) => String(user.status || "active") === "active").length;
    const expiringSoonCount = appState.accessUsers.filter((user) => {
      if (!user.expires_at) {
        return false;
      }
      const diff = new Date(user.expires_at).getTime() - Date.now();
      return Number.isFinite(diff) && diff > 0 && diff <= 7 * 24 * 60 * 60 * 1000;
    }).length;
    const linkedProfilesCount = new Set(
      appState.accessUsers.map((user) => user.profile_id).filter(Boolean),
    ).size;
    const rows = filteredUsers.length
      ? filteredUsers
          .map((user) => {
            const uuid = resolveUserUuid(user);
            const alterId = resolveUserAlterId(user);
            const displayName = user.name || user.id;
            return `
              <tr class="${state.selectedId === user.id ? "is-selected" : ""}">
                <td>
                  <div class="node-meta">
                    <span class="node-name">${escapeHtml(displayName)}</span>
                    <span class="node-id mono">${escapeHtml(user.id || "-")}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${escapeHtml(getProfileName(user.profile_id))}</strong>
                    <span class="tiny">协议 ${escapeHtml(String(user.protocol || "vless").toUpperCase())}</span>
                  </div>
                </td>
                <td>${renderUserGroupSummary(user.node_group_ids)}</td>
                <td><span class="${statusClassName(user.status)}">${statusText(user.status)}</span></td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${formatDate(user.expires_at)}</strong>
                    <span class="tiny">${user.updated_at ? `更新于 ${formatRelativeTime(user.updated_at)}` : "未设置到期"}</span>
                  </div>
                </td>
                <td title="${escapeHtml(uuid || "未填写 UUID")}">
                  <div class="ops-inline-meta">
                    <span class="mono">${escapeHtml(uuid ? `${uuid.slice(0, 8)}...${uuid.slice(-6)}` : "-")}</span>
                    ${
                      String(user.protocol || "vless").toLowerCase() === "vmess"
                        ? `<span class="tiny">alterId ${escapeHtml(alterId || "0")}</span>`
                        : `<span class="tiny">UUID</span>`
                    }
                  </div>
                </td>
                <td>
                  <div class="ops-table-actions">
                    <button class="button ghost" type="button" data-access-user-edit="${escapeHtml(user.id)}">编辑</button>
                    <button class="button ghost" type="button" data-access-user-share="${escapeHtml(user.id)}">订阅</button>
                    <button class="button ghost" type="button" data-access-user-delete="${escapeHtml(user.id)}">删除</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td colspan="7">
            <div class="empty">还没有符合条件的接入用户。先建一个内部用户，再给它挂模板和节点组。</div>
          </td>
        </tr>
      `;

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">接入用户</div><div class="stat-value">${appState.accessUsers.length}</div><div class="stat-foot">内部管理视角的代理接入身份台账。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">当前可用</div><div class="stat-value">${activeCount}</div><div class="stat-foot">状态为可用，且可继续参与发布的用户数。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">7 天内到期</div><div class="stat-value">${expiringSoonCount}</div><div class="stat-foot">适合提前做续期或替换，避免发布后很快失效。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">已关联模板</div><div class="stat-value">${linkedProfilesCount}</div><div class="stat-foot">当前接入用户绑定过的协议模板数量。</div></div></article>
      </section>

      <section class="workspace fade-up ops-page-grid">
        <article class="panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>接入用户列表</h3>
                <p>先把可发布的逻辑用户建好，后面模板切换和批量发布才会更稳。</p>
              </div>
              <div class="ops-toolbar">
                <div class="field ops-inline-field">
                  <label for="access-user-filter">筛选</label>
                  <input id="access-user-filter" value="${escapeHtml(state.filter)}" placeholder="名称 / UUID / 备注 / 绑定模板" />
                </div>
                <button class="button" type="button" id="access-user-create-empty">新建空白用户</button>
              </div>
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>用户</th><th>协议模板</th><th>节点范围</th><th>状态</th><th>到期</th><th>凭证</th><th>操作</th></tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </article>

        <aside class="aside-stack">
          <article class="panel" id="access-user-form-panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>${selectedUser ? "编辑接入用户" : "新建接入用户"}</h3>
                  <p>${selectedUser ? "直接调整到期、状态、模板和投放节点组。" : "第一版先服务内部运维，不做套餐和计费。"} </p>
                </div>
                ${selectedUser ? `<span class="pill mono">${escapeHtml(selectedUser.id)}</span>` : ""}
              </div>

              <form id="access-user-form" class="ops-form-grid">
                <div class="field">
                  <label for="access-user-name">名称</label>
                  <input id="access-user-name" name="name" value="${escapeHtml(draft.name)}" placeholder="例如：HK-Core-A" />
                </div>
                <div class="field">
                  <label for="access-user-status">状态</label>
                  <select id="access-user-status" name="status">
                    <option value="active"${draft.status === "active" ? " selected" : ""}>可用</option>
                    <option value="disabled"${draft.status === "disabled" ? " selected" : ""}>停用</option>
                    <option value="expired"${draft.status === "expired" ? " selected" : ""}>已过期</option>
                  </select>
                </div>
                <div class="field">
                  <label for="access-user-protocol">协议</label>
                  <select id="access-user-protocol" name="protocol">
                    <option value="vless"${draft.protocol === "vless" ? " selected" : ""}>VLESS</option>
                    <option value="vmess"${draft.protocol === "vmess" ? " selected" : ""}>VMess</option>
                  </select>
                </div>
                <div class="field">
                  <label for="access-user-expires-at">到期时间</label>
                  <input id="access-user-expires-at" name="expires_at" type="date" value="${escapeHtml(draft.expires_at)}" />
                </div>
                <div class="field full">
                  <label for="access-user-uuid">UUID</label>
                  <input id="access-user-uuid" name="uuid" value="${escapeHtml(draft.uuid)}" placeholder="例如：c8c4516d-bf1b-4aa0-bfd9-..." />
                </div>
                <div class="field">
                  <label for="access-user-alter-id">alterId</label>
                  <input id="access-user-alter-id" name="alter_id" value="${escapeHtml(draft.alter_id)}" placeholder="VMess 常用 0" />
                </div>
                <div class="field full">
                  <label for="access-user-profile-id">协议模板</label>
                  <select id="access-user-profile-id" name="profile_id">
                    <option value="">暂不绑定</option>
                    ${appState.proxyProfiles
                      .map(
                        (profile) => `
                          <option value="${escapeHtml(profile.id)}"${draft.profile_id === profile.id ? " selected" : ""}>
                            [${escapeHtml(String(profile.protocol || "vless").toUpperCase())}] ${escapeHtml(profile.name || profile.id)}
                          </option>
                        `,
                      )
                      .join("")}
                  </select>
                </div>
                <div class="field full">
                  <label for="access-user-note">备注</label>
                  <textarea id="access-user-note" name="note" placeholder="记录用途、来源、用户归属或迁移计划。">${escapeHtml(draft.note)}</textarea>
                </div>
                <div class="field full">
                  <label>投放节点组</label>
                  <div class="ops-check-grid">
                    ${
                      appState.nodeGroups.length
                        ? appState.nodeGroups
                            .map(
                              (group) => `
                                <label class="ops-check-card">
                                  <input
                                    type="checkbox"
                                    name="node_group_ids"
                                    value="${escapeHtml(group.id)}"
                                    ${draft.node_group_ids.includes(group.id) ? "checked" : ""}
                                  />
                                  <span>
                                    <strong>${escapeHtml(group.name || group.id)}</strong>
                                    <span class="tiny">${Array.isArray(group.node_ids) ? group.node_ids.length : 0} 台节点</span>
                                  </span>
                                </label>
                              `,
                            )
                            .join("")
                        : '<div class="ops-empty-block">还没有节点组。可以先到发布中心创建静态节点组。</div>'
                    }
                  </div>
                </div>
                <div class="ops-action-row">
                  <button class="button primary" type="submit">${selectedUser ? "保存修改" : "创建用户"}</button>
                  <button class="button" type="button" id="access-user-form-reset">重置</button>
                  ${
                    selectedUser
                      ? '<button class="button ghost" type="button" id="access-user-delete-current">删除当前用户</button>'
                      : ""
                  }
                </div>
              </form>

              ${
                state.message
                  ? `<div class="message ${state.message.type}">${escapeHtml(state.message.text)}</div>`
                  : ""
              }
            </div>
          </article>

          ${renderSharePanel(selectedUser)}

          <article class="panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>内管规则</h3>
                  <p>这层是统一配置下发的入口，不是终端用户面板。</p>
                </div>
              </div>
              <div class="event-list">
                <div class="event"><strong>先建接入身份</strong><p>把 UUID、有效期、启停状态和备注统一记录；VMess 可额外维护 alterId。</p></div>
                <div class="event"><strong>再挂协议模板</strong><p>把协议参数统一从模板继承，避免逐台节点手写。</p></div>
                <div class="event"><strong>最后走发布</strong><p>用户、模板和节点组组合完成后，再去发布中心统一下发。</p></div>
              </div>
            </div>
          </article>
        </aside>
      </section>
    `;
  }

  function setupAccessUsersPage() {
    if (page !== "access-users") {
      return;
    }

    documentRef.getElementById("focus-access-user-form")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      clearShareState();
      renderCurrentContent();
      scrollToForm();
    });

    documentRef.getElementById("access-user-filter")?.addEventListener("input", (event) => {
      state.filter = event.currentTarget.value;
      renderCurrentContent();
    });

    documentRef.getElementById("access-user-create-empty")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      clearShareState();
      renderCurrentContent();
      scrollToForm();
    });

    documentRef.getElementById("access-user-form-reset")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      clearShareState();
      renderCurrentContent();
    });

    documentRef.querySelectorAll("[data-access-user-edit]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const nextSelectedId = event.currentTarget.dataset.accessUserEdit || null;
        if (state.selectedId !== nextSelectedId) {
          clearShareState();
        }
        state.selectedId = nextSelectedId;
        state.message = null;
        renderCurrentContent();
        scrollToForm();
      });
    });

    documentRef.querySelectorAll("[data-access-user-share]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const userId = event.currentTarget.dataset.accessUserShare || "";
        void loadShareData(userId, { scroll: true });
      });
    });

    documentRef.querySelectorAll("[data-access-user-delete]").forEach((button) => {
      button.addEventListener("click", (event) => {
        handleDelete(event.currentTarget.dataset.accessUserDelete || "");
      });
    });

    documentRef.getElementById("access-user-delete-current")?.addEventListener("click", () => {
      if (state.selectedId) {
        handleDelete(state.selectedId);
      }
    });

    documentRef.getElementById("access-user-share-load")?.addEventListener("click", () => {
      if (state.selectedId) {
        void loadShareData(state.selectedId, { scroll: true });
      }
    });

    documentRef.getElementById("access-user-share-refresh")?.addEventListener("click", () => {
      if (state.selectedId) {
        void loadShareData(state.selectedId, { scroll: true, keepCurrentData: true });
      }
    });

    documentRef.getElementById("access-user-share-regenerate")?.addEventListener("click", () => {
      void handleRegenerateShareToken();
    });

    documentRef.querySelectorAll("[data-share-copy]").forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.shareCopy || "";
        const targetIndex = Number.parseInt(button.dataset.targetIndex || "-1", 10);
        void copyShareValue(kind, Number.isInteger(targetIndex) && targetIndex >= 0 ? targetIndex : null);
      });
    });

    documentRef.querySelectorAll("[data-share-download-qr]").forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.shareDownloadQr || "";
        const targetIndex = Number.parseInt(button.dataset.targetIndex || "-1", 10);
        downloadQrSvg(kind, Number.isInteger(targetIndex) && targetIndex >= 0 ? targetIndex : null);
      });
    });

    documentRef.getElementById("access-user-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const payload = {
        name: String(formData.get("name") || "").trim(),
        protocol: String(formData.get("protocol") || "vless").trim() || "vless",
        status: String(formData.get("status") || "active").trim() || "active",
        expires_at: String(formData.get("expires_at") || "").trim() || null,
        profile_id: String(formData.get("profile_id") || "").trim() || null,
        node_group_ids: formData.getAll("node_group_ids").map((item) => String(item)),
        note: String(formData.get("note") || "").trim() || null,
        credential: {
          uuid: String(formData.get("uuid") || "").trim(),
          alter_id: Number.parseInt(String(formData.get("alter_id") || "0").trim() || "0", 10),
        },
      };

      if (!payload.name) {
        windowRef.alert("请先填写接入用户名称。");
        return;
      }

      if (!payload.credential.uuid) {
        windowRef.alert("请先填写 UUID。");
        return;
      }

      if (!Number.isInteger(payload.credential.alter_id) || payload.credential.alter_id < 0) {
        windowRef.alert("alterId 必须是大于等于 0 的整数。");
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) {
        submitButton.disabled = true;
      }

      const isEditing = Boolean(state.selectedId);
      const previousShareUserId = state.shareUserId;

      try {
        const result = isEditing
          ? await updateAccessUser(state.selectedId, payload)
          : await createAccessUser(payload);
        state.message = {
          type: "success",
          text: isEditing ? "接入用户已保存。" : "接入用户已创建。",
        };
        await refreshRuntimeData();
        if (result?.id) {
          state.selectedId = result.id;
        }
        const savedUserId = result?.id || state.selectedId;
        if (savedUserId && previousShareUserId === savedUserId) {
          await loadShareData(savedUserId, { keepCurrentData: false, scroll: false });
        } else {
          clearShareState();
        }
        renderCurrentContent();
        scrollToForm();
      } catch (error) {
        state.message = {
          type: "error",
          text: error instanceof Error ? error.message : "保存接入用户失败",
        };
        renderCurrentContent();
        scrollToForm();
      }
    });

    if (state.pendingQueryShareUserId) {
      const userId = state.pendingQueryShareUserId;
      state.pendingQueryShareUserId = null;
      void loadShareData(userId, { scroll: false });
    }
  }

  return {
    renderAccessUsersPage,
    setupAccessUsersPage,
  };
}
