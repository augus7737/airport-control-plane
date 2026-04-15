function createEmptyDraft() {
  return {
    name: "",
    protocol: "vless",
    uuid: "",
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

export function createAccessUsersPageModule(dependencies) {
  const {
    appState,
    createAccessUser,
    deleteAccessUser,
    documentRef,
    escapeHtml,
    formatDate,
    formatRelativeTime,
    page,
    refreshRuntimeData,
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
  };

  function getSelectedUser() {
    return appState.accessUsers.find((item) => item.id === state.selectedId) || null;
  }

  function getDraft(user) {
    if (!user) {
      return createEmptyDraft();
    }
    return {
      name: String(user.name || ""),
      protocol: String(user.protocol || "vless"),
      uuid: resolveUserUuid(user),
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

  function renderAccessUsersPage() {
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
            const displayName = user.name || user.id;
            return `
              <tr>
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
                  <span class="mono">${escapeHtml(uuid ? `${uuid.slice(0, 8)}...${uuid.slice(-6)}` : "-")}</span>
                </td>
                <td>
                  <div class="ops-table-actions">
                    <button class="button ghost" type="button" data-access-user-edit="${escapeHtml(user.id)}">编辑</button>
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
                <div class="field full">
                  <label for="access-user-profile-id">协议模板</label>
                  <select id="access-user-profile-id" name="profile_id">
                    <option value="">暂不绑定</option>
                    ${appState.proxyProfiles
                      .map(
                        (profile) => `
                          <option value="${escapeHtml(profile.id)}"${draft.profile_id === profile.id ? " selected" : ""}>
                            ${escapeHtml(profile.name || profile.id)}
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

          <article class="panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>内管规则</h3>
                  <p>这层是统一配置下发的入口，不是终端用户面板。</p>
                </div>
              </div>
              <div class="event-list">
                <div class="event"><strong>先建接入身份</strong><p>把 UUID、有效期、启停状态和备注统一记录。</p></div>
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
      renderCurrentContent();
      scrollToForm();
    });

    documentRef.getElementById("access-user-form-reset")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      renderCurrentContent();
    });

    documentRef.querySelectorAll("[data-access-user-edit]").forEach((button) => {
      button.addEventListener("click", (event) => {
        state.selectedId = event.currentTarget.dataset.accessUserEdit || null;
        state.message = null;
        renderCurrentContent();
        scrollToForm();
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

      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) {
        submitButton.disabled = true;
      }

      const isEditing = Boolean(state.selectedId);

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
  }

  return {
    renderAccessUsersPage,
    setupAccessUsersPage,
  };
}
