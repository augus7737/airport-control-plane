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
    tls_certificate_path: "",
    tls_key_path: "",
    tls_alpn: "",
    tls_min_version: "",
    tls_max_version: "",
    reality_private_key_path: "",
    reality_public_key: "",
    reality_client_fingerprint: "",
    reality_short_ids: "",
    reality_handshake_server: "",
    reality_handshake_server_port: "443",
    reality_max_time_difference: "",
    transport_path: "",
    transport_host: "",
    transport_headers: "",
    http_method: "",
    grpc_service_name: "",
    transport_idle_timeout: "",
    transport_ping_timeout: "",
    early_data_header_name: "",
    max_early_data: "",
    status: "active",
    note: "",
    template: "",
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeOptionalString(value) {
  const text = normalizeString(value);
  return text || null;
}

function splitListValue(value) {
  return [...new Set(
    String(value || "")
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function joinListValue(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(", ") : "";
}

function toPositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function pickEngineTemplate(value) {
  if (isPlainObject(value?.sing_box)) {
    return value.sing_box;
  }
  return isPlainObject(value) ? value : {};
}

function pickTlsTemplate(value) {
  const template = pickEngineTemplate(value);
  return isPlainObject(template.tls) ? template.tls : {};
}

function pickRealityTemplate(value) {
  const template = pickEngineTemplate(value);
  return isPlainObject(template.reality) ? template.reality : {};
}

function pickTransportTemplate(value) {
  const template = pickEngineTemplate(value);
  return isPlainObject(template.transport) ? template.transport : {};
}

function withoutHostHeader(headers) {
  if (!isPlainObject(headers)) {
    return null;
  }
  const next = { ...headers };
  delete next.Host;
  delete next.host;
  return Object.keys(next).length > 0 ? next : null;
}

function cleanConfigValue(value) {
  if (Array.isArray(value)) {
    const items = value.map((item) => cleanConfigValue(item)).filter((item) => item !== null);
    return items.length > 0 ? items : null;
  }

  if (isPlainObject(value)) {
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      const cleaned = cleanConfigValue(item);
      if (cleaned !== null) {
        next[key] = cleaned;
      }
    }
    return Object.keys(next).length > 0 ? next : null;
  }

  if (typeof value === "string") {
    const text = value.trim();
    return text ? text : null;
  }

  if (value === undefined) {
    return null;
  }

  return value;
}

function parseJsonObject(text, label) {
  const raw = normalizeString(text);
  if (!raw) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} 必须是合法 JSON 对象。`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象。`);
  }

  return parsed;
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
    const tlsTemplate = pickTlsTemplate(profile.template);
    const realityTemplate = pickRealityTemplate(profile.template);
    const transportTemplate = pickTransportTemplate(profile.template);
    const handshake = isPlainObject(realityTemplate.handshake) ? realityTemplate.handshake : {};
    const transportHeaders = isPlainObject(transportTemplate.headers) ? transportTemplate.headers : null;
    const httpHosts = Array.isArray(transportTemplate.host)
      ? transportTemplate.host
      : typeof transportTemplate.host === "string"
        ? [transportTemplate.host]
        : [];
    const transportHost =
      String(profile.transport || "tcp").toLowerCase() === "http"
        ? joinListValue(httpHosts)
        : normalizeString(transportHeaders?.Host || transportHeaders?.host || "");

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
      tls_certificate_path: String(tlsTemplate.certificate_path || ""),
      tls_key_path: String(tlsTemplate.key_path || ""),
      tls_alpn: joinListValue(tlsTemplate.alpn),
      tls_min_version: String(tlsTemplate.min_version || ""),
      tls_max_version: String(tlsTemplate.max_version || ""),
      reality_private_key_path: String(realityTemplate.private_key_path || ""),
      reality_public_key: String(realityTemplate.public_key || ""),
      reality_client_fingerprint: String(realityTemplate.client_fingerprint || ""),
      reality_short_ids: joinListValue(realityTemplate.short_ids ?? realityTemplate.short_id),
      reality_handshake_server: String(handshake.server || ""),
      reality_handshake_server_port: String(handshake.server_port || "443"),
      reality_max_time_difference: String(realityTemplate.max_time_difference || ""),
      transport_path: String(transportTemplate.path || ""),
      transport_host: transportHost,
      transport_headers: transportHeaders ? stringifyJsonBody(withoutHostHeader(transportHeaders)) : "",
      http_method: String(transportTemplate.method || ""),
      grpc_service_name: String(transportTemplate.service_name || ""),
      transport_idle_timeout: String(transportTemplate.idle_timeout || ""),
      transport_ping_timeout: String(transportTemplate.ping_timeout || ""),
      early_data_header_name: String(transportTemplate.early_data_header_name || ""),
      max_early_data:
        transportTemplate.max_early_data !== undefined && transportTemplate.max_early_data !== null
          ? String(transportTemplate.max_early_data)
          : "",
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

  function stringifyJsonBody(value) {
    if (!isPlainObject(value)) {
      return "";
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }

  function buildTemplatePayload(rawValue, fields) {
    const parsedTemplate = parseJsonObject(rawValue, "高级模板 JSON") || {};
    const hasSingBoxWrapper = isPlainObject(parsedTemplate?.sing_box);
    const existingRoot = hasSingBoxWrapper ? { ...parsedTemplate } : {};
    const existingEngineTemplate = pickEngineTemplate(parsedTemplate);
    const nextEngineTemplate = isPlainObject(existingEngineTemplate)
      ? { ...existingEngineTemplate }
      : {};

    const tlsTemplate = cleanConfigValue({
      ...pickTlsTemplate(parsedTemplate),
      certificate_path: normalizeOptionalString(fields.tls_certificate_path),
      key_path: normalizeOptionalString(fields.tls_key_path),
      alpn: splitListValue(fields.tls_alpn),
      min_version: normalizeOptionalString(fields.tls_min_version),
      max_version: normalizeOptionalString(fields.tls_max_version),
    });

    if (fields.security !== "none" || tlsTemplate) {
      nextEngineTemplate.tls = tlsTemplate || {};
    } else {
      delete nextEngineTemplate.tls;
    }

    if (fields.security === "reality") {
      const realityTemplate = cleanConfigValue({
        ...pickRealityTemplate(parsedTemplate),
        private_key_path: normalizeOptionalString(fields.reality_private_key_path),
        public_key: normalizeOptionalString(fields.reality_public_key),
        client_fingerprint: normalizeOptionalString(fields.reality_client_fingerprint),
        short_ids: splitListValue(fields.reality_short_ids),
        handshake: {
          ...(isPlainObject(pickRealityTemplate(parsedTemplate).handshake)
            ? pickRealityTemplate(parsedTemplate).handshake
            : {}),
          server: normalizeOptionalString(fields.reality_handshake_server),
          server_port: toPositiveInteger(fields.reality_handshake_server_port),
        },
        max_time_difference: normalizeOptionalString(fields.reality_max_time_difference),
      });
      nextEngineTemplate.reality = realityTemplate || {};
    } else {
      delete nextEngineTemplate.reality;
    }

    if (fields.transport !== "tcp") {
      const previousTransport = pickTransportTemplate(parsedTemplate);
      const transportHeaders = parseJsonObject(fields.transport_headers, "传输头 JSON") || {};
      const mergedHeaders =
        fields.transport === "ws" || fields.transport === "httpupgrade"
          ? cleanConfigValue({
              ...(isPlainObject(previousTransport.headers) ? previousTransport.headers : {}),
              ...transportHeaders,
              ...(normalizeOptionalString(fields.transport_host)
                ? { Host: normalizeOptionalString(fields.transport_host) }
                : {}),
            })
          : fields.transport === "http"
            ? cleanConfigValue({
                ...(isPlainObject(previousTransport.headers) ? previousTransport.headers : {}),
                ...transportHeaders,
              })
          : null;

      const transportTemplate = cleanConfigValue({
        ...(normalizeString(previousTransport.type) === fields.transport ? previousTransport : {}),
        type: fields.transport,
        path:
          ["ws", "httpupgrade", "http"].includes(fields.transport)
            ? normalizeOptionalString(fields.transport_path)
            : null,
        headers: mergedHeaders,
        host:
          fields.transport === "http"
            ? splitListValue(fields.transport_host)
            : null,
        method:
          fields.transport === "http"
            ? normalizeOptionalString(fields.http_method)
            : null,
        service_name:
          fields.transport === "grpc"
            ? normalizeOptionalString(fields.grpc_service_name)
            : null,
        idle_timeout:
          ["grpc", "http"].includes(fields.transport)
            ? normalizeOptionalString(fields.transport_idle_timeout)
            : null,
        ping_timeout:
          ["grpc", "http"].includes(fields.transport)
            ? normalizeOptionalString(fields.transport_ping_timeout)
            : null,
        early_data_header_name:
          fields.transport === "ws" || fields.transport === "httpupgrade"
            ? normalizeOptionalString(fields.early_data_header_name)
            : null,
        max_early_data:
          fields.transport === "ws" || fields.transport === "httpupgrade"
            ? toPositiveInteger(fields.max_early_data)
            : null,
      });

      nextEngineTemplate.transport = transportTemplate || { type: fields.transport };
    } else {
      delete nextEngineTemplate.transport;
    }

    const cleanedTemplate = cleanConfigValue(nextEngineTemplate);
    if (!cleanedTemplate) {
      if (hasSingBoxWrapper) {
        delete existingRoot.sing_box;
        return Object.keys(existingRoot).length > 0 ? existingRoot : null;
      }
      return null;
    }

    if (hasSingBoxWrapper) {
      existingRoot.sing_box = cleanedTemplate;
      return existingRoot;
    }

    return cleanedTemplate;
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
                  <p>${selectedProfile ? "先改模板，再去发布中心重新下发。" : "先把高频 TLS / Reality / 传输参数结构化，复杂边角继续留给高级 JSON。"} </p>
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
                    <option value="vmess"${draft.protocol === "vmess" ? " selected" : ""}>VMess</option>
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
                    <option value="http"${draft.transport === "http" ? " selected" : ""}>HTTP (H2)</option>
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
                  <div class="field-note">VLESS 常用该字段；如果选择 VMess，发布时会自动忽略。</div>
                </div>
                <div class="field">
                  <label for="proxy-profile-tag">模板标签</label>
                  <input id="proxy-profile-tag" name="tag" value="${escapeHtml(draft.tag)}" placeholder="hk-primary / cn-relay" />
                </div>
                <div class="field">
                  <label for="proxy-profile-tls-cert-path">证书路径</label>
                  <input id="proxy-profile-tls-cert-path" name="tls_certificate_path" value="${escapeHtml(draft.tls_certificate_path)}" placeholder="/etc/ssl/airport/fullchain.pem" />
                  <div class="field-note">推荐配合系统模板里的 ACME 证书申请，把证书统一落到固定路径后再在这里引用。</div>
                </div>
                <div class="field">
                  <label for="proxy-profile-tls-key-path">证书私钥路径</label>
                  <input id="proxy-profile-tls-key-path" name="tls_key_path" value="${escapeHtml(draft.tls_key_path)}" placeholder="/etc/ssl/airport/privkey.pem" />
                </div>
                <div class="field">
                  <label for="proxy-profile-tls-alpn">ALPN</label>
                  <input id="proxy-profile-tls-alpn" name="tls_alpn" value="${escapeHtml(draft.tls_alpn)}" placeholder="h2, http/1.1" />
                </div>
                <div class="field">
                  <label for="proxy-profile-tls-min-version">TLS 最低版本</label>
                  <input id="proxy-profile-tls-min-version" name="tls_min_version" value="${escapeHtml(draft.tls_min_version)}" placeholder="1.2" />
                </div>
                <div class="field">
                  <label for="proxy-profile-tls-max-version">TLS 最高版本</label>
                  <input id="proxy-profile-tls-max-version" name="tls_max_version" value="${escapeHtml(draft.tls_max_version)}" placeholder="1.3" />
                </div>
                <div class="field">
                  <label for="proxy-profile-reality-key-path">Reality 私钥路径</label>
                  <input id="proxy-profile-reality-key-path" name="reality_private_key_path" value="${escapeHtml(draft.reality_private_key_path)}" placeholder="/etc/airport/reality/private.key" />
                </div>
                <div class="field">
                  <label for="proxy-profile-reality-public-key">Reality 公钥</label>
                  <input id="proxy-profile-reality-public-key" name="reality_public_key" value="${escapeHtml(draft.reality_public_key)}" placeholder="分享链接需要的 public key，可后补" />
                </div>
                <div class="field">
                  <label for="proxy-profile-reality-client-fingerprint">Reality 客户端指纹</label>
                  <input id="proxy-profile-reality-client-fingerprint" name="reality_client_fingerprint" value="${escapeHtml(draft.reality_client_fingerprint)}" placeholder="例如 chrome / safari / edge" />
                </div>
                <div class="field">
                  <label for="proxy-profile-reality-short-ids">Reality Short IDs</label>
                  <input id="proxy-profile-reality-short-ids" name="reality_short_ids" value="${escapeHtml(draft.reality_short_ids)}" placeholder="0123abcd, 89ef4567" />
                </div>
                <div class="field-note full">
                  Reality 私钥仍然只建议存节点本地路径；这里新增的 public key / 客户端指纹主要用于后端生成订阅与直连分享链接。
                </div>
                <div class="field">
                  <label for="proxy-profile-reality-server">Reality 握手域名</label>
                  <input id="proxy-profile-reality-server" name="reality_handshake_server" value="${escapeHtml(draft.reality_handshake_server)}" placeholder="www.cloudflare.com" />
                </div>
                <div class="field">
                  <label for="proxy-profile-reality-port">Reality 握手端口</label>
                  <input id="proxy-profile-reality-port" name="reality_handshake_server_port" value="${escapeHtml(draft.reality_handshake_server_port)}" placeholder="443" />
                </div>
                <div class="field">
                  <label for="proxy-profile-reality-max-diff">Reality 时差容忍</label>
                  <input id="proxy-profile-reality-max-diff" name="reality_max_time_difference" value="${escapeHtml(draft.reality_max_time_difference)}" placeholder="1m" />
                </div>
                <div class="field">
                  <label for="proxy-profile-transport-path">传输 Path</label>
                  <input id="proxy-profile-transport-path" name="transport_path" value="${escapeHtml(draft.transport_path)}" placeholder="/ray / grpc / tunnel" />
                </div>
                <div class="field">
                  <label for="proxy-profile-transport-host">Host / H2 Host</label>
                  <input id="proxy-profile-transport-host" name="transport_host" value="${escapeHtml(draft.transport_host)}" placeholder="cdn.example.com, static.example.com" />
                </div>
                <div class="field">
                  <label for="proxy-profile-http-method">HTTP 方法</label>
                  <input id="proxy-profile-http-method" name="http_method" value="${escapeHtml(draft.http_method)}" placeholder="GET / POST / PUT" />
                </div>
                <div class="field">
                  <label for="proxy-profile-grpc-service">gRPC 服务名</label>
                  <input id="proxy-profile-grpc-service" name="grpc_service_name" value="${escapeHtml(draft.grpc_service_name)}" placeholder="GunService" />
                </div>
                <div class="field">
                  <label for="proxy-profile-transport-idle-timeout">连接空闲超时</label>
                  <input id="proxy-profile-transport-idle-timeout" name="transport_idle_timeout" value="${escapeHtml(draft.transport_idle_timeout)}" placeholder="15s" />
                </div>
                <div class="field">
                  <label for="proxy-profile-transport-ping-timeout">Ping 超时</label>
                  <input id="proxy-profile-transport-ping-timeout" name="transport_ping_timeout" value="${escapeHtml(draft.transport_ping_timeout)}" placeholder="15s" />
                </div>
                <div class="field">
                  <label for="proxy-profile-early-data-header">Early Data 请求头</label>
                  <input id="proxy-profile-early-data-header" name="early_data_header_name" value="${escapeHtml(draft.early_data_header_name)}" placeholder="Sec-WebSocket-Protocol" />
                </div>
                <div class="field">
                  <label for="proxy-profile-max-early-data">Early Data 上限</label>
                  <input id="proxy-profile-max-early-data" name="max_early_data" value="${escapeHtml(draft.max_early_data)}" placeholder="2048" />
                </div>
                <label class="check-row">
                  <input id="proxy-profile-mux-enabled" name="mux_enabled" type="checkbox"${draft.mux_enabled ? " checked" : ""} />
                  <span>开启 Mux</span>
                </label>
                <div class="field full">
                  <label for="proxy-profile-transport-headers">传输头 JSON（可选）</label>
                  <textarea id="proxy-profile-transport-headers" name="transport_headers" placeholder='例如：{"X-Forwarded-For":"cdn","User-Agent":"Mozilla/5.0"}' class="mono">${escapeHtml(draft.transport_headers)}</textarea>
                  <div class="field-note">
                    用于补充 WS / HTTP(H2) / HTTP Upgrade 的请求头。WS / HTTP Upgrade 的 Host 会自动写入 <span class="mono">headers.Host</span>，HTTP(H2) 则会写入 <span class="mono">host</span> 列表，这里更适合放其他头。
                  </div>
                </div>
                <div class="field full">
                  <label for="proxy-profile-note">备注</label>
                  <textarea id="proxy-profile-note" name="note" placeholder="记录适用地区、伪装策略、上线计划。">${escapeHtml(draft.note)}</textarea>
                </div>
                <div class="field full">
                  <label for="proxy-profile-template">高级模板 JSON（可选）</label>
                  <textarea id="proxy-profile-template" name="template" placeholder='例如：{"outbounds":[...],"route":{...},"tls":{"client_auth":{...}}}' class="mono">${escapeHtml(draft.template)}</textarea>
                  <div class="field-note">
                    上面的结构化字段会优先覆盖这里的同名键。这里更适合补充 <span class="mono">outbounds</span>、<span class="mono">route</span>、高级 <span class="mono">tls</span> / <span class="mono">reality</span> 选项，以及更细的传输参数。私钥仍然建议只放节点本地文件路径，不要把真实内容直接贴进 JSON。
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
                <div class="event"><strong>证书与伪装分层</strong><p>常用证书路径、SNI、Reality 握手参数放结构化字段，特殊站点伪装再放高级 JSON。</p></div>
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
      const security = String(formData.get("security") || "reality").trim() || "reality";
      const transport = String(formData.get("transport") || "tcp").trim() || "tcp";
      const protocol = String(formData.get("protocol") || "vless").trim() || "vless";
      const payload = {
        name: String(formData.get("name") || "").trim(),
        protocol,
        listen_port: Number(formData.get("listen_port")) || Number(formData.get("listen_port") || 0) || null,
        transport,
        security,
        tls_enabled: security !== "none",
        reality_enabled: protocol === "vless" && security === "reality",
        mux_enabled: formData.get("mux_enabled") === "on",
        server_name: String(formData.get("server_name") || "").trim() || null,
        flow:
          protocol === "vless"
            ? String(formData.get("flow") || "").trim() || null
            : null,
        tag: String(formData.get("tag") || "").trim() || null,
        status: String(formData.get("status") || "active").trim() || "active",
        note: String(formData.get("note") || "").trim() || null,
        template: null,
      };

      if (!payload.name) {
        windowRef.alert("请先填写模板名称。");
        return;
      }

      if (!payload.listen_port) {
        windowRef.alert("请先填写监听端口。");
        return;
      }

      if (protocol === "vmess" && security === "reality") {
        windowRef.alert("VMess 当前仅支持 TLS 或无加密，不支持 Reality。");
        return;
      }

      try {
        payload.template = buildTemplatePayload(formData.get("template"), {
          security,
          transport,
          tls_certificate_path: formData.get("tls_certificate_path"),
          tls_key_path: formData.get("tls_key_path"),
          tls_alpn: formData.get("tls_alpn"),
          tls_min_version: formData.get("tls_min_version"),
          tls_max_version: formData.get("tls_max_version"),
          reality_private_key_path: formData.get("reality_private_key_path"),
          reality_public_key: formData.get("reality_public_key"),
          reality_client_fingerprint: formData.get("reality_client_fingerprint"),
          reality_short_ids: formData.get("reality_short_ids"),
          reality_handshake_server: formData.get("reality_handshake_server"),
          reality_handshake_server_port: formData.get("reality_handshake_server_port"),
          reality_max_time_difference: formData.get("reality_max_time_difference"),
          transport_path: formData.get("transport_path"),
          transport_host: formData.get("transport_host"),
          transport_headers: formData.get("transport_headers"),
          http_method: formData.get("http_method"),
          grpc_service_name: formData.get("grpc_service_name"),
          transport_idle_timeout: formData.get("transport_idle_timeout"),
          transport_ping_timeout: formData.get("transport_ping_timeout"),
          early_data_header_name: formData.get("early_data_header_name"),
          max_early_data: formData.get("max_early_data"),
        });
      } catch (error) {
        windowRef.alert(error instanceof Error ? error.message : "高级模板 JSON 解析失败");
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
