function createEmptyDraft() {
  return {
    name: "",
    username: "",
    uid: "",
    groups: "",
    sudo_enabled: false,
    shell: "/bin/sh",
    home_dir: "",
    ssh_authorized_keys: "",
    status: "active",
    node_group_ids: [],
    note: "",
  };
}

function createEmptyApplyDraft() {
  return {
    title: "",
    system_user_ids: [],
    node_group_ids: [],
    node_ids: [],
    note: "",
  };
}

function splitCommaList(value) {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function splitLineList(value) {
  return [...new Set(
    String(value || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function joinCommaList(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(", ") : "";
}

function joinLineList(value) {
  return Array.isArray(value) ? value.filter(Boolean).join("\n") : "";
}

export function createSystemUsersPageModule(dependencies) {
  const {
    appState,
    applySystemUsers,
    createSystemUser,
    deleteSystemUser,
    documentRef,
    escapeHtml,
    formatDateTime,
    formatRelativeTime,
    page,
    refreshRuntimeData,
    renderCurrentContent,
    statusClassName,
    statusText,
    updateSystemUser,
    windowRef,
  } = dependencies;

  const state = {
    filter: "",
    selectedId: null,
    message: null,
    applyMessage: null,
    applyDraft: createEmptyApplyDraft(),
  };

  function getSelectedSystemUser() {
    return appState.systemUsers.find((item) => item.id === state.selectedId) || null;
  }

  function getDraft(systemUser) {
    if (!systemUser) {
      return createEmptyDraft();
    }

    return {
      name: String(systemUser.name || ""),
      username: String(systemUser.username || ""),
      uid: Number.isInteger(systemUser.uid) ? String(systemUser.uid) : "",
      groups: joinCommaList(systemUser.groups),
      sudo_enabled: Boolean(systemUser.sudo_enabled),
      shell: String(systemUser.shell || "/bin/sh"),
      home_dir: String(systemUser.home_dir || ""),
      ssh_authorized_keys: joinLineList(systemUser.ssh_authorized_keys),
      status: String(systemUser.status || "active"),
      node_group_ids: Array.isArray(systemUser.node_group_ids) ? systemUser.node_group_ids : [],
      note: String(systemUser.note || ""),
    };
  }

  function getFilteredSystemUsers() {
    const query = state.filter.trim().toLowerCase();
    if (!query) {
      return appState.systemUsers;
    }

    return appState.systemUsers.filter((systemUser) =>
      [
        systemUser.id,
        systemUser.name,
        systemUser.username,
        joinCommaList(systemUser.groups),
        joinLineList(systemUser.ssh_authorized_keys),
        systemUser.note,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }

  function getNodeGroupName(groupId) {
    return appState.nodeGroups.find((group) => group.id === groupId)?.name || groupId;
  }

  function getNodeName(nodeId) {
    const node = appState.nodes.find((item) => item.id === nodeId);
    return node?.facts?.hostname || node?.name || node?.id || nodeId;
  }

  function renderGroupSummary(groupIds = []) {
    if (!groupIds.length) {
      return '<span class="tiny">未绑定默认节点组</span>';
    }

    return `
      <div class="ops-chip-list">
        ${groupIds
          .slice(0, 3)
          .map((groupId) => `<span class="pill">${escapeHtml(getNodeGroupName(groupId))}</span>`)
          .join("")}
        ${groupIds.length > 3 ? `<span class="pill">+${groupIds.length - 3}</span>` : ""}
      </div>
    `;
  }

  function renderApplyTargetSummary(release) {
    const groupCount = Array.isArray(release?.node_group_ids) ? release.node_group_ids.length : 0;
    const nodeCount = Array.isArray(release?.node_ids) ? release.node_ids.length : 0;
    return `${groupCount} 个节点组 / ${nodeCount} 台节点`;
  }

  function scrollToForm() {
    documentRef.getElementById("system-user-form-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function scrollToApply() {
    documentRef.getElementById("system-user-apply-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function updateApplyDraftField(field, value) {
    state.applyDraft = {
      ...state.applyDraft,
      [field]: value,
    };
  }

  function toggleApplyDraftList(field, value, checked) {
    const nextValues = new Set(Array.isArray(state.applyDraft[field]) ? state.applyDraft[field] : []);
    if (checked) {
      nextValues.add(value);
    } else {
      nextValues.delete(value);
    }

    updateApplyDraftField(field, [...nextValues]);
  }

  async function handleDelete(id) {
    const systemUser = appState.systemUsers.find((item) => item.id === id);
    if (!systemUser) {
      return;
    }

    const confirmed = windowRef.confirm(`确认删除系统用户“${systemUser.name || systemUser.username || systemUser.id}”吗？`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteSystemUser(systemUser.id);
      if (state.selectedId === systemUser.id) {
        state.selectedId = null;
      }
      state.message = {
        type: "success",
        text: `已删除系统用户：${systemUser.name || systemUser.username || systemUser.id}`,
      };
      state.applyDraft = {
        ...state.applyDraft,
        system_user_ids: state.applyDraft.system_user_ids.filter((item) => item !== systemUser.id),
      };
      await refreshRuntimeData();
      renderCurrentContent();
    } catch (error) {
      state.message = {
        type: "error",
        text: error instanceof Error ? error.message : "删除系统用户失败",
      };
      renderCurrentContent();
    }
  }

  function renderSystemUsersPage() {
    const selectedSystemUser = getSelectedSystemUser();
    const draft = getDraft(selectedSystemUser);
    const filteredSystemUsers = getFilteredSystemUsers();
    const activeCount = appState.systemUsers.filter((item) => item.status === "active").length;
    const sudoCount = appState.systemUsers.filter((item) => item.sudo_enabled).length;
    const keyedCount = appState.systemUsers.filter(
      (item) => Array.isArray(item.ssh_authorized_keys) && item.ssh_authorized_keys.length > 0,
    ).length;
    const recentReleases = appState.systemUserReleases.slice(0, 8);
    const selectedUserKeyCount = Array.isArray(selectedSystemUser?.ssh_authorized_keys)
      ? selectedSystemUser.ssh_authorized_keys.length
      : 0;
    const selectedUserGroupSummary = joinCommaList(selectedSystemUser?.groups) || "无附加组";
    const selectedUserScopeCount = Array.isArray(selectedSystemUser?.node_group_ids)
      ? selectedSystemUser.node_group_ids.length
      : 0;
    const systemUserRows = filteredSystemUsers.length
      ? filteredSystemUsers
          .map((systemUser) => {
            const keysCount = Array.isArray(systemUser.ssh_authorized_keys)
              ? systemUser.ssh_authorized_keys.length
              : 0;
            return `
              <tr>
                <td>
                  <div class="node-meta">
                    <span class="node-name">${escapeHtml(systemUser.name || systemUser.username || systemUser.id)}</span>
                    <span class="node-id mono">${escapeHtml(systemUser.id || "-")}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-inline-meta">
                    <strong class="mono">${escapeHtml(systemUser.username || "-")}</strong>
                    <span class="tiny">${escapeHtml(systemUser.shell || "/bin/sh")} / ${systemUser.uid ? `UID ${escapeHtml(String(systemUser.uid))}` : "自动 UID"}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${escapeHtml(joinCommaList(systemUser.groups) || "无附加组")}</strong>
                    <span class="tiny">${systemUser.sudo_enabled ? "自动 sudo" : "不附带 sudo"}</span>
                  </div>
                </td>
                <td>${renderGroupSummary(systemUser.node_group_ids)}</td>
                <td><span class="${statusClassName(systemUser.status)}">${statusText(systemUser.status)}</span></td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${escapeHtml(String(keysCount))} 把密钥</strong>
                    <span class="tiny">${systemUser.updated_at ? `更新于 ${formatRelativeTime(systemUser.updated_at)}` : "尚未下发"}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-table-actions">
                    <button class="button ghost" type="button" data-system-user-edit="${escapeHtml(systemUser.id)}">编辑</button>
                    <button class="button ghost" type="button" data-system-user-delete="${escapeHtml(systemUser.id)}">删除</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td colspan="7">
            <div class="empty">还没有符合条件的系统用户。先建一个统一运维账号，再批量下发到节点。</div>
          </td>
        </tr>
      `;

    const releaseItems = recentReleases.length
      ? recentReleases
          .map(
            (release) => `
              <article class="ops-soft-item">
                <div class="ops-soft-main">
                  <strong>${escapeHtml(release.title || release.id)}</strong>
                  <span class="tiny">${escapeHtml(String(release.summary?.system_user_count || 0))} 个系统用户 · ${escapeHtml(renderApplyTargetSummary(release))}</span>
                  <span class="tiny">${escapeHtml(
                    `${Number(release.summary?.apply_summary?.success || 0)} / ${Number(release.summary?.apply_summary?.total || 0)}`,
                  )} · ${formatDateTime(release.created_at)}</span>
                </div>
                <div class="ops-table-actions">
                  <span class="${statusClassName(release.status)}">${statusText(release.status)}</span>
                  ${
                    release.operation_id
                      ? `<a class="button ghost" href="/terminal.html?operation_id=${encodeURIComponent(release.operation_id)}">查看回显</a>`
                      : '<span class="tiny">等待执行链路</span>'
                  }
                </div>
              </article>
            `,
          )
          .join("")
      : '<div class="empty">还没有系统用户下发记录。创建用户后就可以直接批量应用到节点。</div>';

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">系统用户</div><div class="stat-value">${appState.systemUsers.length}</div><div class="stat-foot">这层管理的是 Linux 系统账号，不是代理接入用户。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">当前启用</div><div class="stat-value">${activeCount}</div><div class="stat-foot">状态可直接参与批量下发的账号数。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">附带 sudo</div><div class="stat-value">${sudoCount}</div><div class="stat-foot">平台会按需补齐 sudo 并写入免密规则。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">已带密钥</div><div class="stat-value">${keyedCount}</div><div class="stat-foot">至少配置过一把 SSH 公钥的系统账号数。</div></div></article>
      </section>

      <section class="workspace fade-up ops-control-stage">
        <article class="panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>系统用户列表</h3>
                <p>统一维护 SSH 登录账号、附加组、sudo 和默认投放范围，避免每台节点手工建号。</p>
              </div>
              <div class="ops-toolbar">
                <div class="field ops-inline-field">
                  <label for="system-user-filter">筛选</label>
                  <input id="system-user-filter" value="${escapeHtml(state.filter)}" placeholder="名称 / 用户名 / 分组 / 备注" />
                </div>
                <button class="button" type="button" id="system-user-create-empty">新建空白系统用户</button>
              </div>
            </div>

            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>系统用户</th><th>账号</th><th>权限与分组</th><th>默认范围</th><th>状态</th><th>SSH</th><th>操作</th></tr>
                </thead>
                <tbody>${systemUserRows}</tbody>
              </table>
            </div>
          </div>
        </article>

        <aside class="aside-stack ops-control-rail">
          <article class="panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>${selectedSystemUser ? "当前焦点" : "桌面工作流"}</h3>
                  <p>${selectedSystemUser ? "先确认账号语义和范围，再进入编辑或批量下发。" : "先从列表里选中一个账号，或者直接创建新的统一运维账号。"}</p>
                </div>
              </div>
              ${
                selectedSystemUser
                  ? `
                    <div class="ops-focus-summary">
                      <div class="ops-focus-strip">
                        <span class="eyebrow">当前账号</span>
                        <strong>${escapeHtml(selectedSystemUser.name || selectedSystemUser.username || selectedSystemUser.id)}</strong>
                        <p class="tiny mono">${escapeHtml(selectedSystemUser.username || "-")} / ${escapeHtml(selectedSystemUser.shell || "/bin/sh")}</p>
                      </div>
                      <div class="detail-kv">
                        <div class="kv-row"><span>状态</span><strong>${statusText(selectedSystemUser.status)}</strong></div>
                        <div class="kv-row"><span>附加分组</span><strong>${escapeHtml(selectedUserGroupSummary)}</strong></div>
                        <div class="kv-row"><span>SSH 公钥</span><strong>${escapeHtml(String(selectedUserKeyCount))} 把</strong></div>
                        <div class="kv-row"><span>默认范围</span><strong>${escapeHtml(String(selectedUserScopeCount))} 个节点组</strong></div>
                      </div>
                    </div>
                  `
                  : `
                    <div class="event-list">
                      <div class="event"><strong>先定义账号语义</strong><p>把统一运维账号、只读账号、临时应急账号拆开，不要把所有节点都混成一个 root 入口。</p></div>
                      <div class="event"><strong>把默认范围提前建好</strong><p>把常用节点组和系统用户绑定，后续下发时就不用每次重新勾选。</p></div>
                    </div>
                  `
              }
              <div class="ops-action-row">
                <button class="button primary" type="button" id="focus-system-user-form">${selectedSystemUser ? "编辑当前用户" : "新建系统用户"}</button>
                <button class="button ghost" type="button" id="focus-system-user-apply">去批量下发</button>
              </div>
            </div>
          </article>

          <article class="panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>最近下发记录</h3>
                  <p>先看最近 8 次真实落地结果，方便回放节点回显。</p>
                </div>
              </div>
              <div class="ops-soft-list">${releaseItems}</div>
            </div>
          </article>
        </aside>
      </section>

      <section class="workspace fade-up ops-editor-stage">
        <article class="panel" id="system-user-form-panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>${selectedSystemUser ? "编辑系统用户" : "新建系统用户"}</h3>
                <p>${selectedSystemUser ? "修改后可直接再次批量下发覆盖到节点。" : "建议先从统一运维账号开始，例如 vell。"} </p>
              </div>
              ${selectedSystemUser ? `<span class="pill mono">${escapeHtml(selectedSystemUser.id)}</span>` : ""}
            </div>

            <form id="system-user-form" class="ops-form-grid">
              <div class="field">
                <label for="system-user-name">显示名称</label>
                <input id="system-user-name" name="name" value="${escapeHtml(draft.name)}" placeholder="例如：统一运维账号" />
              </div>
              <div class="field">
                <label for="system-user-username">用户名</label>
                <input id="system-user-username" name="username" value="${escapeHtml(draft.username)}" placeholder="例如：vell" />
              </div>
              <div class="field">
                <label for="system-user-status">状态</label>
                <select id="system-user-status" name="status">
                  <option value="active"${draft.status === "active" ? " selected" : ""}>启用</option>
                  <option value="disabled"${draft.status === "disabled" ? " selected" : ""}>停用并锁定</option>
                </select>
              </div>
              <div class="field">
                <label for="system-user-uid">UID</label>
                <input id="system-user-uid" name="uid" type="number" min="1" value="${escapeHtml(draft.uid)}" placeholder="留空则自动分配" />
              </div>
              <div class="field">
                <label for="system-user-shell">Shell</label>
                <input id="system-user-shell" name="shell" value="${escapeHtml(draft.shell)}" placeholder="/bin/sh" />
              </div>
              <div class="field">
                <label for="system-user-home-dir">Home 目录</label>
                <input id="system-user-home-dir" name="home_dir" value="${escapeHtml(draft.home_dir)}" placeholder="例如：/home/vell" />
              </div>
              <div class="field full">
                <label for="system-user-groups">附加用户组</label>
                <input id="system-user-groups" name="groups" value="${escapeHtml(draft.groups)}" placeholder="例如：wheel, docker" />
              </div>
              <div class="field full">
                <label class="checkbox-row">
                  <input id="system-user-sudo-enabled" name="sudo_enabled" type="checkbox"${draft.sudo_enabled ? " checked" : ""} />
                  <span>启用 sudo（平台会按需补齐 sudo 包并写入规则）</span>
                </label>
              </div>
              <div class="field full">
                <label>默认节点组范围</label>
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
                      : '<div class="ops-empty-block">还没有节点组。可以先到发布中心创建节点组。</div>'
                  }
                </div>
              </div>
              <div class="field full">
                <label for="system-user-ssh-authorized-keys">SSH 公钥（每行一把）</label>
                <textarea id="system-user-ssh-authorized-keys" name="ssh_authorized_keys" placeholder="ssh-ed25519 AAAA...">${escapeHtml(draft.ssh_authorized_keys)}</textarea>
              </div>
              <div class="field full">
                <label for="system-user-note">备注</label>
                <textarea id="system-user-note" name="note" placeholder="记录账号用途、适用范围和风控说明。">${escapeHtml(draft.note)}</textarea>
              </div>
              <div class="ops-action-row">
                <button class="button primary" type="submit">${selectedSystemUser ? "保存修改" : "创建系统用户"}</button>
                <button class="button" type="button" id="system-user-form-reset">重置</button>
                ${
                  selectedSystemUser
                    ? '<button class="button ghost" type="button" id="system-user-delete-current">删除当前用户</button>'
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

        <article class="panel" id="system-user-apply-panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>批量下发</h3>
                <p>把系统用户配置批量写到节点。未显式选择节点时，会回落到系统用户自身绑定的默认节点组。</p>
              </div>
            </div>

            <form id="system-user-apply-form" class="ops-form-grid">
              <div class="field full">
                <label for="system-user-apply-title">下发标题</label>
                <input id="system-user-apply-title" name="title" value="${escapeHtml(state.applyDraft.title)}" placeholder="例如：统一下发 vell 运维账号" />
              </div>
              <div class="field full">
                <label>选择系统用户</label>
                <div class="ops-check-grid">
                  ${
                    appState.systemUsers.length
                      ? appState.systemUsers
                          .map(
                            (systemUser) => `
                              <label class="ops-check-card">
                                <input
                                  type="checkbox"
                                  data-system-user-apply-user="true"
                                  value="${escapeHtml(systemUser.id)}"
                                  ${state.applyDraft.system_user_ids.includes(systemUser.id) ? "checked" : ""}
                                />
                                <span>
                                  <strong>${escapeHtml(systemUser.name || systemUser.username || systemUser.id)}</strong>
                                  <span class="tiny mono">${escapeHtml(systemUser.username || "-")}</span>
                                </span>
                              </label>
                            `,
                          )
                          .join("")
                      : '<div class="ops-empty-block">还没有系统用户，先在上方创建一个。</div>'
                  }
                </div>
              </div>
              <div class="field full">
                <label>目标节点组</label>
                <div class="ops-check-grid">
                  ${
                    appState.nodeGroups.length
                      ? appState.nodeGroups
                          .map(
                            (group) => `
                              <label class="ops-check-card">
                                <input
                                  type="checkbox"
                                  data-system-user-apply-group="true"
                                  value="${escapeHtml(group.id)}"
                                  ${state.applyDraft.node_group_ids.includes(group.id) ? "checked" : ""}
                                />
                                <span>
                                  <strong>${escapeHtml(group.name || group.id)}</strong>
                                  <span class="tiny">${Array.isArray(group.node_ids) ? group.node_ids.length : 0} 台节点</span>
                                </span>
                              </label>
                            `,
                          )
                          .join("")
                      : '<div class="ops-empty-block">当前还没有节点组，可直接勾选下面的单台节点。</div>'
                  }
                </div>
              </div>
              <div class="field full">
                <label>直接节点</label>
                <div class="ops-check-grid">
                  ${
                    appState.nodes.length
                      ? appState.nodes
                          .map(
                            (node) => `
                              <label class="ops-check-card">
                                <input
                                  type="checkbox"
                                  data-system-user-apply-node="true"
                                  value="${escapeHtml(node.id)}"
                                  ${state.applyDraft.node_ids.includes(node.id) ? "checked" : ""}
                                />
                                <span>
                                  <strong>${escapeHtml(getNodeName(node.id))}</strong>
                                  <span class="tiny">${escapeHtml(node.labels?.region || "-")} / ${escapeHtml((node.management?.access_mode || "direct") === "relay" ? (node.management?.proxy_host ? "SSH 经代理" : "SSH 经跳板") : "SSH 直连")}</span>
                                </span>
                              </label>
                            `,
                          )
                          .join("")
                      : '<div class="ops-empty-block">当前没有可选节点。</div>'
                  }
                </div>
              </div>
              <div class="field full">
                <label for="system-user-apply-note">备注</label>
                <textarea id="system-user-apply-note" name="note" placeholder="记录本次账号调整、目标范围和验证方式。">${escapeHtml(state.applyDraft.note)}</textarea>
              </div>
              <div class="ops-action-row">
                <button class="button primary" type="submit">开始下发</button>
                <button class="button" type="button" id="system-user-apply-reset">重置选择</button>
              </div>
            </form>

            ${
              state.applyMessage
                ? `<div class="message ${state.applyMessage.type}">${escapeHtml(state.applyMessage.text)}</div>`
                : ""
            }
          </div>
        </article>
      </section>
    `;
  }

  function setupSystemUsersPage() {
    if (page !== "system-users") {
      return;
    }

    documentRef.getElementById("focus-system-user-form")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      renderCurrentContent();
      scrollToForm();
    });

    documentRef.getElementById("focus-system-user-apply")?.addEventListener("click", () => {
      state.applyMessage = null;
      renderCurrentContent();
      scrollToApply();
    });

    documentRef.getElementById("system-user-filter")?.addEventListener("input", (event) => {
      state.filter = event.currentTarget.value;
      renderCurrentContent();
    });

    documentRef.getElementById("system-user-create-empty")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      renderCurrentContent();
      scrollToForm();
    });

    documentRef.getElementById("system-user-form-reset")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      renderCurrentContent();
    });

    documentRef.querySelectorAll("[data-system-user-edit]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const systemUserId = event.currentTarget.dataset.systemUserEdit || null;
        state.selectedId = systemUserId;
        state.message = null;
        if (systemUserId) {
          state.applyDraft = {
            ...state.applyDraft,
            system_user_ids: [systemUserId],
          };
        }
        renderCurrentContent();
        scrollToForm();
      });
    });

    documentRef.querySelectorAll("[data-system-user-delete]").forEach((button) => {
      button.addEventListener("click", (event) => {
        handleDelete(event.currentTarget.dataset.systemUserDelete || "");
      });
    });

    documentRef.getElementById("system-user-delete-current")?.addEventListener("click", () => {
      if (state.selectedId) {
        handleDelete(state.selectedId);
      }
    });

    documentRef.getElementById("system-user-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const payload = {
        name: String(formData.get("name") || "").trim(),
        username: String(formData.get("username") || "").trim(),
        uid: String(formData.get("uid") || "").trim()
          ? Number.parseInt(String(formData.get("uid")).trim(), 10)
          : null,
        groups: splitCommaList(formData.get("groups")),
        sudo_enabled: formData.get("sudo_enabled") === "on",
        shell: String(formData.get("shell") || "").trim() || "/bin/sh",
        home_dir: String(formData.get("home_dir") || "").trim() || null,
        ssh_authorized_keys: splitLineList(formData.get("ssh_authorized_keys")),
        status: String(formData.get("status") || "active").trim() || "active",
        node_group_ids: formData.getAll("node_group_ids").map((item) => String(item)),
        note: String(formData.get("note") || "").trim() || null,
      };

      if (!payload.name) {
        windowRef.alert("请先填写系统用户名称。");
        return;
      }

      if (!payload.username) {
        windowRef.alert("请先填写系统用户名。");
        return;
      }

      const isEditing = Boolean(state.selectedId);

      try {
        const result = isEditing
          ? await updateSystemUser(state.selectedId, payload)
          : await createSystemUser(payload);
        state.message = {
          type: "success",
          text: isEditing ? "系统用户已保存。" : "系统用户已创建。",
        };
        await refreshRuntimeData();
        if (result?.id) {
          state.selectedId = result.id;
          state.applyDraft = {
            ...state.applyDraft,
            system_user_ids: state.applyDraft.system_user_ids.length
              ? state.applyDraft.system_user_ids
              : [result.id],
          };
        }
        renderCurrentContent();
        scrollToForm();
      } catch (error) {
        state.message = {
          type: "error",
          text: error instanceof Error ? error.message : "保存系统用户失败",
        };
        renderCurrentContent();
        scrollToForm();
      }
    });

    documentRef.getElementById("system-user-apply-title")?.addEventListener("input", (event) => {
      updateApplyDraftField("title", event.currentTarget.value);
    });

    documentRef.getElementById("system-user-apply-note")?.addEventListener("input", (event) => {
      updateApplyDraftField("note", event.currentTarget.value);
    });

    documentRef.querySelectorAll("[data-system-user-apply-user]").forEach((input) => {
      input.addEventListener("change", (event) => {
        toggleApplyDraftList("system_user_ids", event.currentTarget.value, event.currentTarget.checked);
      });
    });

    documentRef.querySelectorAll("[data-system-user-apply-group]").forEach((input) => {
      input.addEventListener("change", (event) => {
        toggleApplyDraftList("node_group_ids", event.currentTarget.value, event.currentTarget.checked);
      });
    });

    documentRef.querySelectorAll("[data-system-user-apply-node]").forEach((input) => {
      input.addEventListener("change", (event) => {
        toggleApplyDraftList("node_ids", event.currentTarget.value, event.currentTarget.checked);
      });
    });

    documentRef.getElementById("system-user-apply-reset")?.addEventListener("click", () => {
      state.applyDraft = createEmptyApplyDraft();
      state.applyMessage = null;
      renderCurrentContent();
      scrollToApply();
    });

    documentRef.getElementById("system-user-apply-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();

      const payload = {
        title: state.applyDraft.title.trim() || null,
        system_user_ids: state.applyDraft.system_user_ids,
        node_group_ids: state.applyDraft.node_group_ids,
        node_ids: state.applyDraft.node_ids,
        note: state.applyDraft.note.trim() || null,
      };

      if (!payload.system_user_ids.length) {
        windowRef.alert("请至少选择一个系统用户。");
        return;
      }

      try {
        const result = await applySystemUsers(payload);
        state.applyMessage = {
          type: "success",
          text: result?.operation?.id
            ? `系统用户已开始下发，执行回显 ID：${result.operation.id}`
            : "系统用户下发任务已创建。",
        };
        state.applyDraft = {
          ...createEmptyApplyDraft(),
          system_user_ids: payload.system_user_ids,
        };
        await refreshRuntimeData();
        renderCurrentContent();
        scrollToApply();
      } catch (error) {
        state.applyMessage = {
          type: "error",
          text: error instanceof Error ? error.message : "系统用户下发失败",
        };
        renderCurrentContent();
        scrollToApply();
      }
    });
  }

  return {
    renderSystemUsersPage,
    setupSystemUsersPage,
  };
}
