function createEmptyGroupDraft() {
  return {
    name: "",
    note: "",
    node_ids: [],
  };
}

export function createReleasesPageModule(dependencies) {
  const {
    appState,
    createConfigRelease,
    createNodeGroup,
    deleteNodeGroup,
    documentRef,
    escapeHtml,
    formatDate,
    formatDateTime,
    formatRelativeTime,
    page,
    refreshRuntimeData,
    renderCurrentContent,
    statusClassName,
    statusText,
    updateNodeGroup,
    windowRef,
  } = dependencies;

  const state = {
    filter: "",
    selectedGroupId: null,
    releaseMessage: null,
    groupMessage: null,
  };

  function getSelectedGroup() {
    return appState.nodeGroups.find((item) => item.id === state.selectedGroupId) || null;
  }

  function getGroupDraft(group) {
    if (!group) {
      return createEmptyGroupDraft();
    }
    return {
      name: String(group.name || ""),
      note: String(group.note || ""),
      node_ids: Array.isArray(group.node_ids) ? group.node_ids : [],
    };
  }

  function getNodeName(nodeId) {
    const node = appState.nodes.find((item) => item.id === nodeId);
    return node?.name || node?.hostname || node?.id || nodeId;
  }

  function getProfileName(profileId) {
    return appState.proxyProfiles.find((profile) => profile.id === profileId)?.name || "未指定";
  }

  function getReleaseSummary(release) {
    return release?.summary && typeof release.summary === "object" ? release.summary : {};
  }

  function shortDigest(value) {
    const text = String(value || "").trim();
    return text ? text.slice(0, 8) : "未生成";
  }

  function formatApplySummary(summary) {
    const apply = summary.apply_summary || {};
    const landingCount = Number(summary.landing_node_count || summary.total_nodes || 0);
    const entryCount = Number(summary.entry_node_count || 0);
    const scopeSummary =
      entryCount > 0 ? `落地 ${landingCount} / 入口 ${entryCount}` : `节点 ${landingCount}`;
    return `${scopeSummary} · 成功 ${Number(apply.success || 0)} / 失败 ${Number(apply.failed || 0)} / 已应用 ${Number(apply.applied || 0)} / 仅渲染 ${Number(apply.rendered_only || 0)}`;
  }

  function renderReleaseMetaBadges(summary) {
    return `
      <div class="ops-chip-list">
        <span class="pill">${escapeHtml(String(summary.engine || "managed").toUpperCase())}</span>
        <span class="pill">${escapeHtml(String(summary.action_type || "publish").toUpperCase())}</span>
        ${
          summary.rollbackable
            ? '<span class="pill">自动回滚</span>'
            : ""
        }
      </div>
    `;
  }

  function formatFailedNodesSample(summary) {
    const sample = Array.isArray(summary.failed_nodes_sample) ? summary.failed_nodes_sample : [];
    if (!sample.length) {
      return "";
    }

    return sample
      .map((item) => `${item.hostname || item.node_id || "unknown"} · ${item.reason_code || "publish_failed"}`)
      .join("；");
  }

  function getFilteredReleases() {
    const query = state.filter.trim().toLowerCase();
    if (!query) {
      return appState.configReleases;
    }
    return appState.configReleases.filter((release) =>
      [
        release.id,
        release.title,
        release.status,
        release.profile_id,
        release.operation_id,
        JSON.stringify(release.summary || {}),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }

  function scrollToReleaseBuilder() {
    documentRef.getElementById("release-builder-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function scrollToGroupForm() {
    documentRef.getElementById("node-group-form-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  async function handleDeleteGroup(id) {
    const group = appState.nodeGroups.find((item) => item.id === id);
    if (!group) {
      return;
    }
    const confirmed = windowRef.confirm(`确认删除节点组“${group.name || group.id}”吗？`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteNodeGroup(group.id);
      if (state.selectedGroupId === group.id) {
        state.selectedGroupId = null;
      }
      state.groupMessage = {
        type: "success",
        text: `已删除节点组：${group.name || group.id}`,
      };
      await refreshRuntimeData();
      renderCurrentContent();
    } catch (error) {
      state.groupMessage = {
        type: "error",
        text: error instanceof Error ? error.message : "删除节点组失败",
      };
      renderCurrentContent();
    }
  }

  function renderGroupSummary(groupIds = []) {
    if (!groupIds.length) {
      return '<span class="tiny">未选择节点组</span>';
    }
    return `
      <div class="ops-chip-list">
        ${groupIds
          .slice(0, 3)
          .map((groupId) => `<span class="pill">${escapeHtml(appState.nodeGroups.find((group) => group.id === groupId)?.name || groupId)}</span>`)
          .join("")}
        ${groupIds.length > 3 ? `<span class="pill">+${groupIds.length - 3}</span>` : ""}
      </div>
    `;
  }

  function renderReleasesPage() {
    const selectedGroup = getSelectedGroup();
    const groupDraft = getGroupDraft(selectedGroup);
    const filteredReleases = getFilteredReleases();
    const runningCount = appState.configReleases.filter(
      (release) => String(release.status || "new") === "running",
    ).length;
    const nodeCoverage = new Set(
      appState.nodeGroups.flatMap((group) => (Array.isArray(group.node_ids) ? group.node_ids : [])),
    ).size;
    const rows = filteredReleases.length
      ? filteredReleases
          .map((release) => {
            const summary = getReleaseSummary(release);
            const accessUserCount = Array.isArray(release.access_user_ids)
              ? release.access_user_ids.length
              : 0;
            const nodeGroupCount = Array.isArray(release.node_group_ids)
              ? release.node_group_ids.length
              : 0;
            return `
              <tr>
                <td>
                  <div class="node-meta">
                    <span class="node-name">${escapeHtml(release.title || release.id)}</span>
                    <span class="node-id mono">${escapeHtml(release.id || "-")}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-inline-meta">
                    <span class="${statusClassName(release.status)}">${statusText(release.status)}</span>
                    <span class="tiny">${escapeHtml(summary.delivery_mode || "snapshot_only")}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${escapeHtml(getProfileName(release.profile_id))}</strong>
                    <span class="tiny">${escapeHtml(summary.change_summary || `${accessUserCount} 个接入用户 / ${nodeGroupCount} 个节点组`)}</span>
                  </div>
                  ${renderReleaseMetaBadges(summary)}
                </td>
                <td>
                  ${renderGroupSummary(release.node_group_ids)}
                  <div class="ops-inline-meta">
                    <span class="tiny">${escapeHtml(formatApplySummary(summary))}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${escapeHtml(String(release.version || "v1"))}</strong>
                    <span class="tiny">${formatDateTime(release.created_at)} · digest ${escapeHtml(shortDigest(summary.config_digest_after))}</span>
                    ${
                      summary.based_on_release_id
                        ? `<span class="tiny">基线 ${escapeHtml(summary.based_on_release_id)}</span>`
                        : ""
                    }
                  </div>
                </td>
                <td>
                  ${
                    release.operation_id
                      ? `<a class="button ghost" href="/terminal.html?operation_id=${encodeURIComponent(release.operation_id)}">查看回显</a>`
                      : '<span class="tiny">等待执行链路</span>'
                  }
                  ${
                    formatFailedNodesSample(summary)
                      ? `<div class="ops-inline-meta"><span class="tiny">失败样本：${escapeHtml(formatFailedNodesSample(summary))}</span></div>`
                      : ""
                  }
                </td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td colspan="6">
            <div class="empty">还没有符合条件的发布记录。先选模板、用户和节点组发一版试试。</div>
          </td>
        </tr>
      `;

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">发布记录</div><div class="stat-value">${appState.configReleases.length}</div><div class="stat-foot">每次配置下发都会在这里留下可追踪记录。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">执行中</div><div class="stat-value">${runningCount}</div><div class="stat-foot">正在走任务 / SSH 执行链路的发布次数。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">节点组</div><div class="stat-value">${appState.nodeGroups.length}</div><div class="stat-foot">当前第一版先支持静态节点组。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">覆盖节点</div><div class="stat-value">${nodeCoverage}</div><div class="stat-foot">当前所有节点组覆盖到的唯一节点数。</div></div></article>
      </section>

      <section class="workspace fade-up ops-release-layout">
        <div class="stack">
          <article class="panel" id="release-builder-panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>发起一次发布</h3>
                  <p>把接入用户、协议模板和节点组组合起来，形成一条可追踪的发布动作。</p>
                </div>
                <span class="pill">内部发布</span>
              </div>
              <div class="field-note">
                当前第一版真实发布会渲染 sing-box VLESS 配置，自动做节点侧校验、备份和重启；若节点还没装 sing-box，则先只落渲染产物。
              </div>

              <form id="config-release-form" class="ops-form-grid">
                <div class="field full">
                  <label for="config-release-title">发布标题</label>
                  <input id="config-release-title" name="title" placeholder="例如：香港入口 VLESS 用户首批下发" />
                </div>
                <div class="field full">
                  <label for="config-release-profile-id">协议模板</label>
                  <select id="config-release-profile-id" name="profile_id">
                    <option value="">请选择模板</option>
                    ${appState.proxyProfiles
                      .map(
                        (profile) => `
                          <option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name || profile.id)}</option>
                        `,
                      )
                      .join("")}
                  </select>
                </div>
                <div class="field full">
                  <label>接入用户</label>
                  <div class="ops-check-grid">
                    ${
                      appState.accessUsers.length
                        ? appState.accessUsers
                            .map(
                              (user) => `
                                <label class="ops-check-card">
                                  <input type="checkbox" name="access_user_ids" value="${escapeHtml(user.id)}" />
                                  <span>
                                    <strong>${escapeHtml(user.name || user.id)}</strong>
                                    <span class="tiny">${escapeHtml(getProfileName(user.profile_id))}</span>
                                  </span>
                                </label>
                              `,
                            )
                            .join("")
                        : '<div class="ops-empty-block">还没有接入用户，请先到“接入用户”页面创建。</div>'
                    }
                  </div>
                </div>
                <div class="field full">
                  <label>节点组</label>
                  <div class="ops-check-grid">
                    ${
                      appState.nodeGroups.length
                        ? appState.nodeGroups
                            .map(
                              (group) => `
                                <label class="ops-check-card">
                                  <input type="checkbox" name="node_group_ids" value="${escapeHtml(group.id)}" />
                                  <span>
                                    <strong>${escapeHtml(group.name || group.id)}</strong>
                                    <span class="tiny">${Array.isArray(group.node_ids) ? group.node_ids.length : 0} 台节点</span>
                                  </span>
                                </label>
                              `,
                            )
                            .join("")
                        : '<div class="ops-empty-block">还没有节点组，请先在右侧创建。</div>'
                    }
                  </div>
                </div>
                <div class="field full">
                  <label for="config-release-note">发布备注</label>
                  <textarea id="config-release-note" name="note" placeholder="记录本次调整的范围、风险点和回滚说明。"></textarea>
                </div>
                <div class="ops-action-row">
                  <button class="button primary" type="submit">立即发布</button>
                  <a class="button" href="/access-users.html">去管理接入用户</a>
                  <a class="button" href="/proxy-profiles.html">去管理模板</a>
                </div>
              </form>

              ${
                state.releaseMessage
                  ? `
                    <div class="message ${state.releaseMessage.type}">
                      <div class="release-message-row">
                        <span>${escapeHtml(state.releaseMessage.text)}</span>
                        ${
                          state.releaseMessage.href
                            ? `<a class="button ghost" href="${escapeHtml(state.releaseMessage.href)}">${escapeHtml(
                                state.releaseMessage.actionLabel || "查看",
                              )}</a>`
                            : ""
                        }
                      </div>
                    </div>
                  `
                  : ""
              }
            </div>
          </article>

          <article class="panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>发布记录</h3>
                  <p>已经触发过的配置发布会在这里沉淀，并可直接跳回运维回显。</p>
                </div>
                <div class="field ops-inline-field">
                  <label for="release-filter">筛选</label>
                  <input id="release-filter" value="${escapeHtml(state.filter)}" placeholder="标题 / 状态 / Operation ID" />
                </div>
              </div>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr><th>发布</th><th>状态</th><th>模板 / 用户</th><th>节点组</th><th>版本 / 时间</th><th>动作</th></tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
            </div>
          </article>
        </div>

        <aside class="aside-stack">
          <article class="panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>节点组清单</h3>
                  <p>第一版先用静态分组，把发布范围和中转链路显式收进控制台。</p>
                </div>
                <button class="button" type="button" id="node-group-create-empty">新建节点组</button>
              </div>
              <div class="ops-soft-list">
                ${
                  appState.nodeGroups.length
                    ? appState.nodeGroups
                        .map(
                          (group) => `
                            <button class="ops-soft-item" type="button" data-node-group-edit="${escapeHtml(group.id)}">
                              <span class="ops-soft-main">
                                <strong>${escapeHtml(group.name || group.id)}</strong>
                                <span class="tiny">${Array.isArray(group.node_ids) ? group.node_ids.length : 0} 台节点</span>
                              </span>
                              <span class="${statusClassName(group.status || "active")}">${statusText(group.status || "active")}</span>
                            </button>
                          `,
                        )
                        .join("")
                    : '<div class="ops-empty-block">还没有节点组，建议先按入口地区、中转用途或供应商批次分组。</div>'
                }
              </div>
            </div>
          </article>

          <article class="panel" id="node-group-form-panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>${selectedGroup ? "编辑节点组" : "新建节点组"}</h3>
                  <p>${selectedGroup ? "调整组内节点后，后续发布会直接使用最新范围。" : "静态节点组先够用，后面再补自动规则。"} </p>
                </div>
                ${selectedGroup ? `<span class="pill mono">${escapeHtml(selectedGroup.id)}</span>` : ""}
              </div>

              <form id="node-group-form" class="ops-form-grid">
                <div class="field full">
                  <label for="node-group-name">节点组名称</label>
                  <input id="node-group-name" name="name" value="${escapeHtml(groupDraft.name)}" placeholder="例如：香港入口 / 日本落地 / 需中转节点" />
                </div>
                <div class="field full">
                  <label for="node-group-note">备注</label>
                  <textarea id="node-group-note" name="note" placeholder="记录用途、地域或链路角色。">${escapeHtml(groupDraft.note)}</textarea>
                </div>
                <div class="field full">
                  <label>节点范围</label>
                  <div class="ops-check-grid ops-node-check-grid">
                    ${
                      appState.nodes.length
                        ? appState.nodes
                            .map(
                              (node) => `
                                <label class="ops-check-card">
                                  <input
                                    type="checkbox"
                                    name="node_ids"
                                    value="${escapeHtml(node.id)}"
                                    ${groupDraft.node_ids.includes(node.id) ? "checked" : ""}
                                  />
                                  <span>
                                    <strong>${escapeHtml(node.name || node.hostname || node.id)}</strong>
                                    <span class="tiny">${escapeHtml(node.labels?.country || node.networking?.entry_region || "未标记区域")}</span>
                                  </span>
                                </label>
                              `,
                            )
                            .join("")
                        : '<div class="ops-empty-block">当前还没有纳管节点，节点组会在接管更多机器后变得更有用。</div>'
                    }
                  </div>
                </div>
                <div class="ops-action-row">
                  <button class="button primary" type="submit">${selectedGroup ? "保存节点组" : "创建节点组"}</button>
                  <button class="button" type="button" id="node-group-form-reset">重置</button>
                  ${
                    selectedGroup
                      ? '<button class="button ghost" type="button" id="node-group-delete-current">删除当前节点组</button>'
                      : ""
                  }
                </div>
              </form>

              ${
                state.groupMessage
                  ? `<div class="message ${state.groupMessage.type}">${escapeHtml(state.groupMessage.text)}</div>`
                  : ""
              }
            </div>
          </article>

          <article class="panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>发布节奏建议</h3>
                  <p>先从小范围节点组验证，再逐步扩大覆盖面。</p>
                </div>
              </div>
              <div class="event-list">
                <div class="event"><strong>先分节点组</strong><p>直连、中转、落地机分开管理，发布出错时更容易止损。</p></div>
                <div class="event"><strong>先少量试发</strong><p>每次模板大改，先挑 1 个节点组验证再全量推进。</p></div>
                <div class="event"><strong>回显直达终端</strong><p>发布成功后可直接跳转到批量执行回显，检查哪台节点掉队。</p></div>
              </div>
            </div>
          </article>
        </aside>
      </section>
    `;
  }

  function setupReleasesPage() {
    if (page !== "releases") {
      return;
    }

    documentRef.getElementById("focus-release-builder")?.addEventListener("click", () => {
      scrollToReleaseBuilder();
    });

    documentRef.getElementById("focus-node-group-form")?.addEventListener("click", () => {
      state.selectedGroupId = null;
      state.groupMessage = null;
      renderCurrentContent();
      scrollToGroupForm();
    });

    documentRef.getElementById("release-filter")?.addEventListener("input", (event) => {
      state.filter = event.currentTarget.value;
      renderCurrentContent();
    });

    documentRef.getElementById("node-group-create-empty")?.addEventListener("click", () => {
      state.selectedGroupId = null;
      state.groupMessage = null;
      renderCurrentContent();
      scrollToGroupForm();
    });

    documentRef.querySelectorAll("[data-node-group-edit]").forEach((button) => {
      button.addEventListener("click", (event) => {
        state.selectedGroupId = event.currentTarget.dataset.nodeGroupEdit || null;
        state.groupMessage = null;
        renderCurrentContent();
        scrollToGroupForm();
      });
    });

    documentRef.getElementById("node-group-form-reset")?.addEventListener("click", () => {
      state.selectedGroupId = null;
      state.groupMessage = null;
      renderCurrentContent();
    });

    documentRef.getElementById("node-group-delete-current")?.addEventListener("click", () => {
      if (state.selectedGroupId) {
        handleDeleteGroup(state.selectedGroupId);
      }
    });

    documentRef.getElementById("node-group-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const payload = {
        name: String(formData.get("name") || "").trim(),
        type: "static",
        node_ids: formData.getAll("node_ids").map((item) => String(item)),
        note: String(formData.get("note") || "").trim() || null,
      };

      if (!payload.name) {
        windowRef.alert("请先填写节点组名称。");
        return;
      }

      const isEditing = Boolean(state.selectedGroupId);

      try {
        const result = isEditing
          ? await updateNodeGroup(state.selectedGroupId, payload)
          : await createNodeGroup(payload);
        await refreshRuntimeData();
        state.selectedGroupId = result?.id || state.selectedGroupId;
        state.groupMessage = {
          type: "success",
          text: isEditing ? "节点组已保存。" : "节点组已创建。",
        };
        if (!isEditing && result?.id) {
          state.selectedGroupId = result.id;
        }
        renderCurrentContent();
        scrollToGroupForm();
      } catch (error) {
        state.groupMessage = {
          type: "error",
          text: error instanceof Error ? error.message : "保存节点组失败",
        };
        renderCurrentContent();
        scrollToGroupForm();
      }
    });

    documentRef.getElementById("config-release-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const payload = {
        title: String(formData.get("title") || "").trim(),
        profile_id: String(formData.get("profile_id") || "").trim() || null,
        access_user_ids: formData.getAll("access_user_ids").map((item) => String(item)),
        node_group_ids: formData.getAll("node_group_ids").map((item) => String(item)),
        note: String(formData.get("note") || "").trim() || null,
        operator: "console",
      };

      if (!payload.title) {
        windowRef.alert("请先填写发布标题。");
        return;
      }

      if (!payload.profile_id) {
        windowRef.alert("请先选择协议模板。");
        return;
      }

      if (!payload.access_user_ids.length) {
        windowRef.alert("请至少选择一个接入用户。");
        return;
      }

      if (!payload.node_group_ids.length) {
        windowRef.alert("请至少选择一个节点组。");
        return;
      }

      try {
        const result = await createConfigRelease(payload);
        await refreshRuntimeData();
        const onlyAccessUserId =
          payload.access_user_ids.length === 1 ? payload.access_user_ids[0] : null;
        state.releaseMessage = {
          type: "success",
          text: result?.operation?.id
            ? `发布已创建，执行回显 ID：${result.operation.id}`
            : "发布已创建，等待执行链路返回。",
          actionLabel: onlyAccessUserId ? "查看订阅" : null,
          href: onlyAccessUserId
            ? `/access-users.html?user_id=${encodeURIComponent(onlyAccessUserId)}&share=1`
            : null,
        };
        form.reset();
        renderCurrentContent();
        scrollToReleaseBuilder();
      } catch (error) {
        state.releaseMessage = {
          type: "error",
          text: error instanceof Error ? error.message : "触发发布失败",
        };
        renderCurrentContent();
        scrollToReleaseBuilder();
      }
    });
  }

  return {
    renderReleasesPage,
    setupReleasesPage,
  };
}
