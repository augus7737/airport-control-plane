function createEmptyProfileDraft() {
  return {
    name: "",
    protocol: "vless",
    listen_port: "443",
    transport: "tcp",
    security: "reality",
    tls_enabled: true,
    reality_enabled: true,
    server_name: "",
    flow: "xtls-rprx-vision",
    mux_enabled: false,
    tag: "",
    status: "active",
    note: "",
    template: "",
  };
}

function toTextareaTemplate(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function createProxyProfilesPageModule(dependencies) {
  const {
    appState,
    createProxyProfile,
    deleteProxyProfile,
    documentRef,
    escapeHtml,
    formatDate,
    formatRelativeTime,
    page,
    refreshRuntimeData,
    renderCurrentContent,
    statusClassName,
    statusText,
    updateProxyProfile,
    windowRef,
  } = dependencies;

  const state = {
    filter: "",
    selectedId: null,
    message: null,
  };

  function getSelectedProfile() {
    return appState.proxyProfiles.find((item) => item.id === state.selectedId) || null;
  }

  function getDraft(profile) {
    if (!profile) {
      return createEmptyProfileDraft();
    }
    return {
      name: String(profile.name || ""),
      protocol: String(profile.protocol || "vless"),
      listen_port: String(profile.listen_port || "443"),
      transport: String(profile.transport || "tcp"),
      security: String(profile.security || "reality"),
      tls_enabled: Boolean(profile.tls_enabled),
      reality_enabled: Boolean(profile.reality_enabled),
      server_name: String(profile.server_name || ""),
      flow: String(profile.flow || ""),
      mux_enabled: Boolean(profile.mux_enabled),
      tag: String(profile.tag || ""),
      status: String(profile.status || "active"),
      note: String(profile.note || ""),
      template: toTextareaTemplate(profile.template),
    };
  }

  function getFilteredProfiles() {
    const query = state.filter.trim().toLowerCase();
    if (!query) {
      return appState.proxyProfiles;
    }
    return appState.proxyProfiles.filter((profile) =>
      [
        profile.id,
        profile.name,
        profile.transport,
        profile.security,
        profile.note,
        profile.tag,
        profile.server_name,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }

  function scrollToForm() {
    documentRef.getElementById("proxy-profile-form-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function buildTemplatePayload(rawValue) {
    const text = String(rawValue || "").trim();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  async function handleDelete(id) {
    const profile = appState.proxyProfiles.find((item) => item.id === id);
    if (!profile) {
      return;
    }
    const confirmed = windowRef.confirm(`确认删除协议模板“${profile.name || profile.id}”吗？`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteProxyProfile(profile.id);
      if (state.selectedId === profile.id) {
        state.selectedId = null;
      }
      state.message = {
        type: "success",
        text: `已删除协议模板：${profile.name || profile.id}`,
      };
      await refreshRuntimeData();
      renderCurrentContent();
    } catch (error) {
      state.message = {
        type: "error",
        text: error instanceof Error ? error.message : "删除协议模板失败",
      };
      renderCurrentContent();
    }
  }

  function renderProxyProfilesPage() {
    const selectedProfile = getSelectedProfile();
    const draft = getDraft(selectedProfile);
    const filteredProfiles = getFilteredProfiles();
    const activeCount = appState.proxyProfiles.filter(
      (profile) => String(profile.status || "active") === "active",
    ).length;
    const realityCount = appState.proxyProfiles.filter((profile) => profile.reality_enabled).length;
    const muxCount = appState.proxyProfiles.filter((profile) => profile.mux_enabled).length;
    const rows = filteredProfiles.length
      ? filteredProfiles
          .map((profile) => {
            const assignedUsers = appState.accessUsers.filter(
              (user) => user.profile_id === profile.id,
            ).length;
            return `
              <tr>
                <td>
                  <div class="node-meta">
                    <span class="node-name">${escapeHtml(profile.name || profile.id)}</span>
                    <span class="node-id mono">${escapeHtml(profile.id || "-")}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-chip-list">
                    <span class="pill">${escapeHtml(String(profile.protocol || "vless").toUpperCase())}</span>
                    <span class="pill">${escapeHtml(String(profile.transport || "tcp").toUpperCase())}</span>
                    <span class="pill">${escapeHtml(String(profile.security || "reality").toUpperCase())}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${escapeHtml(String(profile.listen_port || "-"))}</strong>
                    <span class="tiny">${profile.server_name ? escapeHtml(profile.server_name) : "未设置域名"}</span>
                  </div>
                </td>
                <td><span class="${statusClassName(profile.status)}">${statusText(profile.status)}</span></td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${assignedUsers}</strong>
                    <span class="tiny">${profile.updated_at ? `更新于 ${formatRelativeTime(profile.updated_at)}` : "尚无接入用户"}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-table-actions">
                    <button class="button ghost" type="button" data-proxy-profile-edit="${escapeHtml(profile.id)}">编辑</button>
                    <button class="button ghost" type="button" data-proxy-profile-delete="${escapeHtml(profile.id)}">删除</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td colspan="6">
            <div class="empty">还没有符合条件的协议模板。先准备一套用于首批节点的模板。</div>
          </td>
        </tr>
      `;

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">协议模板</div><div class="stat-value">${appState.proxyProfiles.length}</div><div class="stat-foot">用于统一端口、传输、安全参数和节点侧配置结构。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">当前启用</div><div class="stat-value">${activeCount}</div><div class="stat-foot">状态为可用，可继续给接入用户绑定的模板数。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">Reality 模板</div><div class="stat-value">${realityCount}</div><div class="stat-foot">已启用 Reality 的模板数量。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">开启 Mux</div><div class="stat-value">${muxCount}</div><div class="stat-foot">已开启复用的模板，适合高并发场景统一切换。</div></div></article>
      </section>

      <section class="workspace fade-up ops-page-grid">
        <article class="panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>模板列表</h3>
                <p>模板把协议参数和节点侧配置统一抽象起来，后面发布只选模板不手填。</p>
              </div>
              <div class="ops-toolbar">
                <div class="field ops-inline-field">
                  <label for="proxy-profile-filter">筛选</label>
                  <input id="proxy-profile-filter" value="${escapeHtml(state.filter)}" placeholder="名称 / 端口 / 域名 / 标签 / 备注" />
                </div>
                <button class="button" type="button" id="proxy-profile-create-empty">新建空白模板</button>
              </div>
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>模板</th><th>协议栈</th><th>监听</th><th>状态</th><th>已挂用户</th><th>操作</th></tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </article>

        <aside class="aside-stack">
          <article class="panel" id="proxy-profile-form-panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>${selectedProfile ? "编辑协议模板" : "新建协议模板"}</h3>
                  <p>${selectedProfile ? "先改模板，再去发布中心重新下发。" : "第一版重点放在 VLESS 场景，不做复杂继承。"} </p>
                </div>
                ${selectedProfile ? `<span class="pill mono">${escapeHtml(selectedProfile.id)}</span>` : ""}
              </div>

              <form id="proxy-profile-form" class="ops-form-grid">
                <div class="field">
                  <label for="proxy-profile-name">模板名称</label>
                  <input id="proxy-profile-name" name="name" value="${escapeHtml(draft.name)}" placeholder="例如：VLESS-REALITY-HK-443" />
                </div>
                <div class="field">
                  <label for="proxy-profile-status">状态</label>
                  <select id="proxy-profile-status" name="status">
                    <option value="active"${draft.status === "active" ? " selected" : ""}>可用</option>
                    <option value="disabled"${draft.status === "disabled" ? " selected" : ""}>停用</option>
                  </select>
                </div>
                <div class="field">
                  <label for="proxy-profile-protocol">协议</label>
                  <select id="proxy-profile-protocol" name="protocol">
                    <option value="vless"${draft.protocol === "vless" ? " selected" : ""}>VLESS</option>
                  </select>
                </div>
                <div class="field">
                  <label for="proxy-profile-listen-port">监听端口</label>
                  <input id="proxy-profile-listen-port" name="listen_port" value="${escapeHtml(draft.listen_port)}" placeholder="443" />
                </div>
                <div class="field">
                  <label for="proxy-profile-transport">传输层</label>
                  <select id="proxy-profile-transport" name="transport">
                    <option value="tcp"${draft.transport === "tcp" ? " selected" : ""}>TCP</option>
                    <option value="ws"${draft.transport === "ws" ? " selected" : ""}>WebSocket</option>
                    <option value="grpc"${draft.transport === "grpc" ? " selected" : ""}>gRPC</option>
                    <option value="httpupgrade"${draft.transport === "httpupgrade" ? " selected" : ""}>HTTP Upgrade</option>
                  </select>
                </div>
                <div class="field">
                  <label for="proxy-profile-security">安全层</label>
                  <select id="proxy-profile-security" name="security">
                    <option value="reality"${draft.security === "reality" ? " selected" : ""}>Reality</option>
                    <option value="tls"${draft.security === "tls" ? " selected" : ""}>TLS</option>
                    <option value="none"${draft.security === "none" ? " selected" : ""}>无</option>
                  </select>
                </div>
                <div class="field">
                  <label for="proxy-profile-server-name">伪装域名 / SNI</label>
                  <input id="proxy-profile-server-name" name="server_name" value="${escapeHtml(draft.server_name)}" placeholder="cdn.example.com" />
                </div>
                <div class="field">
                  <label for="proxy-profile-flow">Flow</label>
                  <input id="proxy-profile-flow" name="flow" value="${escapeHtml(draft.flow)}" placeholder="xtls-rprx-vision" />
                </div>
                <div class="field">
                  <label for="proxy-profile-tag">模板标签</label>
                  <input id="proxy-profile-tag" name="tag" value="${escapeHtml(draft.tag)}" placeholder="hk-primary / cn-relay" />
                </div>
                <label class="check-row">
                  <input id="proxy-profile-tls-enabled" name="tls_enabled" type="checkbox"${draft.tls_enabled ? " checked" : ""} />
                  <span>启用 TLS</span>
                </label>
                <label class="check-row">
                  <input id="proxy-profile-reality-enabled" name="reality_enabled" type="checkbox"${draft.reality_enabled ? " checked" : ""} />
                  <span>启用 Reality</span>
                </label>
                <label class="check-row">
                  <input id="proxy-profile-mux-enabled" name="mux_enabled" type="checkbox"${draft.mux_enabled ? " checked" : ""} />
                  <span>开启 Mux</span>
                </label>
                <div class="field full">
                  <label for="proxy-profile-note">备注</label>
                  <textarea id="proxy-profile-note" name="note" placeholder="记录适用地区、伪装策略、上线计划。">${escapeHtml(draft.note)}</textarea>
                </div>
                <div class="field full">
                  <label for="proxy-profile-template">模板 JSON（可选）</label>
                  <textarea id="proxy-profile-template" name="template" placeholder='例如：{"inbounds":[...],"outbounds":[...]}' class="mono">${escapeHtml(draft.template)}</textarea>
                  <div class="field-note">
                    真实发布时会读取这里的 sing-box 参数。TLS 建议填写 <span class="mono">{"tls":{"certificate_path":"...","key_path":"..."}}</span>；Reality 建议填写 <span class="mono">{"reality":{"private_key_path":"...","short_id":"0123abcd","handshake":{"server":"cdn.example.com","server_port":443}}}</span>。私钥只放节点本地文件，不要直接贴进 JSON。
                  </div>
                </div>
                <div class="ops-action-row">
                  <button class="button primary" type="submit">${selectedProfile ? "保存模板" : "创建模板"}</button>
                  <button class="button" type="button" id="proxy-profile-form-reset">重置</button>
                  ${
                    selectedProfile
                      ? '<button class="button ghost" type="button" id="proxy-profile-delete-current">删除当前模板</button>'
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

          <article class="panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>模板使用建议</h3>
                  <p>把变化最频繁的参数留在模板层，节点只做执行和重载。</p>
                </div>
              </div>
              <div class="event-list">
                <div class="event"><strong>按区域拆模板</strong><p>香港入口、日本落地或中转链路可以独立维护。</p></div>
                <div class="event"><strong>模板先小后大</strong><p>第一版先覆盖主流节点，不要一开始做太多协议分支。</p></div>
                <div class="event"><strong>配合发布记录</strong><p>模板变更后建议立即走发布中心做一次可追踪下发。</p></div>
              </div>
            </div>
          </article>
        </aside>
      </section>
    `;
  }

  function setupProxyProfilesPage() {
    if (page !== "proxy-profiles") {
      return;
    }

    documentRef.getElementById("focus-proxy-profile-form")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      renderCurrentContent();
      scrollToForm();
    });

    documentRef.getElementById("proxy-profile-filter")?.addEventListener("input", (event) => {
      state.filter = event.currentTarget.value;
      renderCurrentContent();
    });

    documentRef.getElementById("proxy-profile-create-empty")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      renderCurrentContent();
      scrollToForm();
    });

    documentRef.getElementById("proxy-profile-form-reset")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      renderCurrentContent();
    });

    documentRef.querySelectorAll("[data-proxy-profile-edit]").forEach((button) => {
      button.addEventListener("click", (event) => {
        state.selectedId = event.currentTarget.dataset.proxyProfileEdit || null;
        state.message = null;
        renderCurrentContent();
        scrollToForm();
      });
    });

    documentRef.querySelectorAll("[data-proxy-profile-delete]").forEach((button) => {
      button.addEventListener("click", (event) => {
        handleDelete(event.currentTarget.dataset.proxyProfileDelete || "");
      });
    });

    documentRef.getElementById("proxy-profile-delete-current")?.addEventListener("click", () => {
      if (state.selectedId) {
        handleDelete(state.selectedId);
      }
    });

    documentRef.getElementById("proxy-profile-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const payload = {
        name: String(formData.get("name") || "").trim(),
        protocol: String(formData.get("protocol") || "vless").trim() || "vless",
        listen_port: Number(formData.get("listen_port")) || Number(formData.get("listen_port") || 0) || null,
        transport: String(formData.get("transport") || "tcp").trim() || "tcp",
        security: String(formData.get("security") || "reality").trim() || "reality",
        tls_enabled: formData.get("tls_enabled") === "on",
        reality_enabled: formData.get("reality_enabled") === "on",
        mux_enabled: formData.get("mux_enabled") === "on",
        server_name: String(formData.get("server_name") || "").trim() || null,
        flow: String(formData.get("flow") || "").trim() || null,
        tag: String(formData.get("tag") || "").trim() || null,
        status: String(formData.get("status") || "active").trim() || "active",
        note: String(formData.get("note") || "").trim() || null,
        template: buildTemplatePayload(formData.get("template")),
      };

      if (!payload.name) {
        windowRef.alert("请先填写模板名称。");
        return;
      }

      if (!payload.listen_port) {
        windowRef.alert("请先填写监听端口。");
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) {
        submitButton.disabled = true;
      }

      const isEditing = Boolean(state.selectedId);

      try {
        const result = isEditing
          ? await updateProxyProfile(state.selectedId, payload)
          : await createProxyProfile(payload);
        await refreshRuntimeData();
        state.selectedId = result?.id || state.selectedId;
        state.message = {
          type: "success",
          text: isEditing ? "协议模板已保存。" : "协议模板已创建。",
        };
        if (!isEditing && result?.id) {
          state.selectedId = result.id;
        }
        renderCurrentContent();
        scrollToForm();
      } catch (error) {
        state.message = {
          type: "error",
          text: error instanceof Error ? error.message : "保存协议模板失败",
        };
        renderCurrentContent();
        scrollToForm();
      }
    });
  }

  return {
    renderProxyProfilesPage,
    setupProxyProfilesPage,
  };
}
