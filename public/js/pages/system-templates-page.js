function createEmptyDraft() {
  return {
    name: "",
    category: "baseline",
    status: "active",
    script_name: "运行系统模板",
    script_body: "#!/bin/sh\nset -eu\n\necho \"hello from system template\"",
    tags: "",
    node_group_ids: [],
    note: "",
  };
}

function createEmptyApplyDraft() {
  return {
    title: "",
    template_id: "",
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

function joinCommaList(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(", ") : "";
}

export function createSystemTemplatesPageModule(dependencies) {
  const {
    appState,
    applySystemTemplate,
    createSystemTemplate,
    deleteSystemTemplate,
    documentRef,
    escapeHtml,
    formatDateTime,
    formatRelativeTime,
    page,
    refreshRuntimeData,
    renderCurrentContent,
    statusClassName,
    statusText,
    updateSystemTemplate,
    windowRef,
  } = dependencies;

  const state = {
    filter: "",
    selectedId: null,
    message: null,
    applyMessage: null,
    applyDraft: createEmptyApplyDraft(),
    queryHydrated: false,
  };

  function getSelectedTemplate() {
    return appState.systemTemplates.find((item) => item.id === state.selectedId) || null;
  }

  function getDraft(template) {
    if (!template) {
      return createEmptyDraft();
    }

    return {
      name: String(template.name || ""),
      category: String(template.category || "baseline"),
      status: String(template.status || "active"),
      script_name: String(template.script_name || "运行系统模板"),
      script_body: String(template.script_body || ""),
      tags: joinCommaList(template.tags),
      node_group_ids: Array.isArray(template.node_group_ids) ? template.node_group_ids : [],
      note: String(template.note || ""),
    };
  }

  function getTemplateName(templateId) {
    return (
      appState.systemTemplates.find((item) => item.id === templateId)?.name ||
      templateId ||
      "未选择模板"
    );
  }

  function getNodeName(nodeId) {
    const node = appState.nodes.find((item) => item.id === nodeId);
    return node?.facts?.hostname || node?.name || node?.id || nodeId;
  }

  function hydrateApplyDraftFromQuery() {
    if (state.queryHydrated) {
      return false;
    }

    state.queryHydrated = true;
    const params = new URLSearchParams(windowRef.location.search);
    const nodeId = String(params.get("node_id") || "").trim();
    const templateId = String(params.get("template_id") || "").trim();
    let changed = false;

    if (nodeId && appState.nodes.some((item) => item.id === nodeId)) {
      state.applyDraft = {
        ...state.applyDraft,
        node_ids: [nodeId],
        node_group_ids: [],
      };
      state.applyMessage = {
        type: "success",
        text: `已从节点详情带入目标节点：${getNodeName(nodeId)}`,
      };
      changed = true;
    }

    if (templateId && appState.systemTemplates.some((item) => item.id === templateId)) {
      state.applyDraft = {
        ...state.applyDraft,
        template_id: templateId,
      };
      changed = true;
    }

    return changed;
  }

  function renderGroupSummary(groupIds = []) {
    if (!groupIds.length) {
      return '<span class="tiny">未绑定默认节点组</span>';
    }

    return `
      <div class="ops-chip-list">
        ${groupIds
          .map((groupId) => {
            const group = appState.nodeGroups.find((item) => item.id === groupId);
            return `<span class="pill">${escapeHtml(group?.name || groupId)}</span>`;
          })
          .join("")}
      </div>
    `;
  }

  function renderApplyTargetSummary(release) {
    const groupCount = Array.isArray(release.node_group_ids) ? release.node_group_ids.length : 0;
    const nodeCount = Array.isArray(release.node_ids) ? release.node_ids.length : 0;
    return `${groupCount} 个节点组 / ${nodeCount} 台节点`;
  }

  function filteredTemplates() {
    const query = state.filter.trim().toLowerCase();
    if (!query) {
      return appState.systemTemplates;
    }

    return appState.systemTemplates.filter((template) =>
      [
        template.id,
        template.name,
        template.category,
        template.script_name,
        template.note,
        joinCommaList(template.tags),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }

  function scrollToForm() {
    documentRef.getElementById("system-template-form-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function scrollToApply() {
    documentRef.getElementById("system-template-apply-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  async function handleDelete(templateId) {
    if (!templateId) {
      return;
    }

    const template = appState.systemTemplates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    const confirmed = windowRef.confirm(`确认删除系统模板“${template.name || template.id}”吗？`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteSystemTemplate(templateId);
      state.selectedId = state.selectedId === templateId ? null : state.selectedId;
      state.message = {
        type: "success",
        text: `已删除系统模板：${template.name || template.id}`,
      };
      if (state.applyDraft.template_id === templateId) {
        state.applyDraft = createEmptyApplyDraft();
      }
      await refreshRuntimeData();
      renderCurrentContent();
    } catch (error) {
      state.message = {
        type: "error",
        text: error instanceof Error ? error.message : "删除系统模板失败",
      };
      renderCurrentContent();
    }
  }

  function renderSystemTemplatesPage() {
    const selectedTemplate = getSelectedTemplate();
    const draft = getDraft(selectedTemplate);
    const templates = filteredTemplates();
    const activeCount = appState.systemTemplates.filter((item) => item.status === "active").length;
    const defaultScopedCount = appState.systemTemplates.filter(
      (item) => Array.isArray(item.node_group_ids) && item.node_group_ids.length > 0,
    ).length;
    const recentReleases = appState.systemTemplateReleases.slice(0, 8);

    const templateRows = templates.length
      ? templates
          .map((template) => {
            const scriptLineCount = String(template.script_body || "")
              .split(/\r?\n/)
              .filter((line) => line.trim()).length;
            return `
              <tr>
                <td>
                  <div class="node-meta">
                    <span class="node-name">${escapeHtml(template.name || template.id)}</span>
                    <span class="node-id mono">${escapeHtml(template.id || "-")}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${escapeHtml(template.category || "baseline")}</strong>
                    <span class="tiny">${escapeHtml(template.script_name || "运行系统模板")}</span>
                  </div>
                </td>
                <td>${renderGroupSummary(template.node_group_ids)}</td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${escapeHtml(String(scriptLineCount))} 行脚本</strong>
                    <span class="tiny">${escapeHtml(joinCommaList(template.tags) || "无标签")}</span>
                  </div>
                </td>
                <td><span class="${statusClassName(template.status)}">${statusText(template.status)}</span></td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${formatRelativeTime(template.updated_at || template.created_at)}</strong>
                    <span class="tiny">${formatDateTime(template.updated_at || template.created_at)}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-table-actions">
                    <button class="button ghost" type="button" data-system-template-edit="${escapeHtml(template.id)}">编辑</button>
                    <button class="button ghost" type="button" data-system-template-delete="${escapeHtml(template.id)}">删除</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td colspan="7"><div class="empty">还没有系统模板。先沉淀一份标准初始化脚本，再批量下发。</div></td>
        </tr>
      `;

    const releaseRows = recentReleases.length
      ? recentReleases
          .map(
            (release) => `
              <tr>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${escapeHtml(release.title || release.id)}</strong>
                    <span class="tiny mono">${escapeHtml(release.id || "-")}</span>
                  </div>
                </td>
                <td><span class="${statusClassName(release.status)}">${statusText(release.status)}</span></td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${escapeHtml(release.template_name || getTemplateName(release.template_id))}</strong>
                    <span class="tiny">${escapeHtml(renderApplyTargetSummary(release))}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${escapeHtml(
                      `${Number(release.summary?.apply_summary?.success || 0)} / ${Number(release.summary?.apply_summary?.total || 0)}`,
                    )}</strong>
                    <span class="tiny">${formatDateTime(release.created_at)}</span>
                  </div>
                </td>
                <td>
                  ${
                    release.operation_id
                      ? `<a class="button ghost" href="/terminal.html?operation_id=${encodeURIComponent(release.operation_id)}">查看回显</a>`
                      : '<span class="tiny">等待执行链路</span>'
                  }
                </td>
              </tr>
            `,
          )
          .join("")
      : `
        <tr>
          <td colspan="5"><div class="empty">还没有系统模板下发记录。</div></td>
        </tr>
      `;

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">系统模板</div><div class="stat-value">${appState.systemTemplates.length}</div><div class="stat-foot">沉淀标准初始化、系统基线和批量运维脚本。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">当前启用</div><div class="stat-value">${activeCount}</div><div class="stat-foot">可直接参与下发的脚本模板数量。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">默认范围</div><div class="stat-value">${defaultScopedCount}</div><div class="stat-foot">已经预绑定节点组的模板数量。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">最近下发</div><div class="stat-value">${recentReleases.length}</div><div class="stat-foot">最近 8 次模板执行记录，可回看终端回显。</div></div></article>
      </section>

      <section class="workspace fade-up ops-page-grid">
        <article class="panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>系统模板列表</h3>
                <p>把 Alpine 初始化、常用依赖、硬化动作和平台脚本沉淀成统一模板。</p>
              </div>
              <div class="ops-toolbar">
                <div class="field ops-inline-field">
                  <label for="system-template-filter">筛选</label>
                  <input id="system-template-filter" value="${escapeHtml(state.filter)}" placeholder="名称 / 分类 / 标签 / 备注" />
                </div>
                <button class="button" type="button" id="system-template-create-empty">新建空白系统模板</button>
              </div>
            </div>

            <div class="table-shell">
              <table>
                <thead>
                  <tr><th>模板</th><th>分类</th><th>默认范围</th><th>脚本</th><th>状态</th><th>更新时间</th><th>操作</th></tr>
                </thead>
                <tbody>${templateRows}</tbody>
              </table>
            </div>
          </div>
        </article>

        <aside class="aside-stack">
          <article class="panel" id="system-template-form-panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>${selectedTemplate ? "编辑系统模板" : "新建系统模板"}</h3>
                  <p>${selectedTemplate ? "修改后可再次下发覆盖到节点。" : "建议先把 Alpine 初始化和常用硬化动作沉淀成模板。"} </p>
                </div>
                ${selectedTemplate ? `<span class="pill mono">${escapeHtml(selectedTemplate.id)}</span>` : ""}
              </div>

              <form id="system-template-form" class="ops-form-grid">
                <div class="field">
                  <label for="system-template-name">模板名称</label>
                  <input id="system-template-name" name="name" value="${escapeHtml(draft.name)}" placeholder="例如：Alpine 基线初始化" />
                </div>
                <div class="field">
                  <label for="system-template-script-name">脚本名称</label>
                  <input id="system-template-script-name" name="script_name" value="${escapeHtml(draft.script_name)}" placeholder="例如：Alpine 节点基础初始化" />
                </div>
                <div class="field">
                  <label for="system-template-category">分类</label>
                  <select id="system-template-category" name="category">
                    <option value="baseline"${draft.category === "baseline" ? " selected" : ""}>基线</option>
                    <option value="bootstrap"${draft.category === "bootstrap" ? " selected" : ""}>初始化</option>
                    <option value="hardening"${draft.category === "hardening" ? " selected" : ""}>加固</option>
                    <option value="custom"${draft.category === "custom" ? " selected" : ""}>自定义</option>
                  </select>
                </div>
                <div class="field">
                  <label for="system-template-status">状态</label>
                  <select id="system-template-status" name="status">
                    <option value="active"${draft.status === "active" ? " selected" : ""}>启用</option>
                    <option value="draft"${draft.status === "draft" ? " selected" : ""}>草稿</option>
                    <option value="disabled"${draft.status === "disabled" ? " selected" : ""}>停用</option>
                  </select>
                </div>
                <div class="field full">
                  <label for="system-template-tags">标签</label>
                  <input id="system-template-tags" name="tags" value="${escapeHtml(draft.tags)}" placeholder="例如：alpine, baseline, ssh" />
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
                                  <input type="checkbox" name="node_group_ids" value="${escapeHtml(group.id)}" ${draft.node_group_ids.includes(group.id) ? "checked" : ""} />
                                  <span>
                                    <strong>${escapeHtml(group.name || group.id)}</strong>
                                    <span class="tiny">${Array.isArray(group.node_ids) ? group.node_ids.length : 0} 台节点</span>
                                  </span>
                                </label>
                              `,
                            )
                            .join("")
                        : '<div class="ops-empty-block">当前还没有节点组，可以先去发布中心创建。</div>'
                    }
                  </div>
                </div>
                <div class="field full">
                  <label for="system-template-script-body">脚本内容</label>
                  <textarea id="system-template-script-body" name="script_body" placeholder="#!/bin/sh&#10;set -eu">${escapeHtml(draft.script_body)}</textarea>
                </div>
                <div class="field full">
                  <label for="system-template-note">备注</label>
                  <textarea id="system-template-note" name="note" placeholder="记录模板用途、适用节点和执行注意事项。">${escapeHtml(draft.note)}</textarea>
                </div>
                <div class="ops-action-row">
                  <button class="button primary" type="submit">${selectedTemplate ? "保存修改" : "创建模板"}</button>
                  <button class="button" type="button" id="system-template-form-reset">重置</button>
                  ${selectedTemplate ? '<button class="button ghost" type="button" id="system-template-delete-current">删除当前模板</button>' : ""}
                </div>
              </form>

              ${state.message ? `<div class="message ${state.message.type}">${escapeHtml(state.message.text)}</div>` : ""}
            </div>
          </article>

          <article class="panel" id="system-template-apply-panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>批量下发</h3>
                  <p>把选中的系统模板下发到节点。未显式选择目标范围时，会回落到模板自身绑定的默认节点组。</p>
                </div>
              </div>

              <form id="system-template-apply-form" class="ops-form-grid">
                <div class="field full">
                  <label for="system-template-apply-title">下发标题</label>
                  <input id="system-template-apply-title" name="title" value="${escapeHtml(state.applyDraft.title)}" placeholder="例如：批量执行 Alpine 基线初始化" />
                </div>
                <div class="field full">
                  <label for="system-template-apply-template">选择模板</label>
                  <select id="system-template-apply-template" name="template_id">
                    <option value="">请选择系统模板</option>
                    ${appState.systemTemplates
                      .map(
                        (template) => `<option value="${escapeHtml(template.id)}"${state.applyDraft.template_id === template.id ? " selected" : ""}>${escapeHtml(template.name || template.id)} / ${escapeHtml(template.category || "baseline")}</option>`,
                      )
                      .join("")}
                  </select>
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
                                  <input type="checkbox" data-system-template-apply-group="true" value="${escapeHtml(group.id)}" ${state.applyDraft.node_group_ids.includes(group.id) ? "checked" : ""} />
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
                                  <input type="checkbox" data-system-template-apply-node="true" value="${escapeHtml(node.id)}" ${state.applyDraft.node_ids.includes(node.id) ? "checked" : ""} />
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
                  <label for="system-template-apply-note">备注</label>
                  <textarea id="system-template-apply-note" name="note" placeholder="记录本次执行目的、回滚方式和验收标准。">${escapeHtml(state.applyDraft.note)}</textarea>
                </div>
                <div class="ops-action-row">
                  <button class="button primary" type="submit">开始下发</button>
                  <button class="button" type="button" id="system-template-apply-reset">重置选择</button>
                </div>
              </form>

              ${state.applyMessage ? `<div class="message ${state.applyMessage.type}">${escapeHtml(state.applyMessage.text)}</div>` : ""}
            </div>
          </article>

          <article class="panel">
            <div class="panel-body">
              <div class="panel-title">
                <div>
                  <h3>最近下发记录</h3>
                  <p>每次模板执行都会沉淀为独立记录，方便回放真实节点回显。</p>
                </div>
              </div>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr><th>记录</th><th>状态</th><th>模板与范围</th><th>结果</th><th>回显</th></tr>
                  </thead>
                  <tbody>${releaseRows}</tbody>
                </table>
              </div>
            </div>
          </article>
        </aside>
      </section>
    `;
  }

  function setupSystemTemplatesPage() {
    if (page !== "system-templates") {
      return;
    }

    if (hydrateApplyDraftFromQuery()) {
      renderCurrentContent();
      scrollToApply();
      return;
    }

    documentRef.getElementById("focus-system-template-form")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      renderCurrentContent();
      scrollToForm();
    });

    documentRef.getElementById("focus-system-template-apply")?.addEventListener("click", () => {
      state.applyMessage = null;
      renderCurrentContent();
      scrollToApply();
    });

    documentRef.getElementById("system-template-filter")?.addEventListener("input", (event) => {
      state.filter = event.currentTarget.value;
      renderCurrentContent();
    });

    documentRef.getElementById("system-template-create-empty")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      renderCurrentContent();
      scrollToForm();
    });

    documentRef.getElementById("system-template-form-reset")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      renderCurrentContent();
    });

    documentRef.querySelectorAll("[data-system-template-edit]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const templateId = event.currentTarget.dataset.systemTemplateEdit || null;
        state.selectedId = templateId;
        state.message = null;
        if (templateId) {
          state.applyDraft = {
            ...state.applyDraft,
            template_id: templateId,
          };
        }
        renderCurrentContent();
        scrollToForm();
      });
    });

    documentRef.querySelectorAll("[data-system-template-delete]").forEach((button) => {
      button.addEventListener("click", (event) => {
        handleDelete(event.currentTarget.dataset.systemTemplateDelete || "");
      });
    });

    documentRef.getElementById("system-template-delete-current")?.addEventListener("click", () => {
      if (state.selectedId) {
        handleDelete(state.selectedId);
      }
    });

    documentRef.getElementById("system-template-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const payload = {
        name: String(formData.get("name") || "").trim(),
        category: String(formData.get("category") || "baseline").trim() || "baseline",
        status: String(formData.get("status") || "active").trim() || "active",
        script_name: String(formData.get("script_name") || "").trim() || "运行系统模板",
        script_body: String(formData.get("script_body") || "").trim(),
        tags: splitCommaList(formData.get("tags")),
        node_group_ids: formData.getAll("node_group_ids").map((item) => String(item)),
        note: String(formData.get("note") || "").trim() || null,
      };

      if (!payload.name) {
        windowRef.alert("请先填写系统模板名称。");
        return;
      }

      if (!payload.script_body) {
        windowRef.alert("请先填写脚本内容。");
        return;
      }

      const isEditing = Boolean(state.selectedId);

      try {
        const result = isEditing
          ? await updateSystemTemplate(state.selectedId, payload)
          : await createSystemTemplate(payload);
        state.message = {
          type: "success",
          text: isEditing ? "系统模板已保存。" : "系统模板已创建。",
        };
        await refreshRuntimeData();
        if (result?.id) {
          state.selectedId = result.id;
          state.applyDraft = {
            ...state.applyDraft,
            template_id: state.applyDraft.template_id || result.id,
          };
        }
        renderCurrentContent();
        scrollToForm();
      } catch (error) {
        state.message = {
          type: "error",
          text: error instanceof Error ? error.message : "保存系统模板失败",
        };
        renderCurrentContent();
        scrollToForm();
      }
    });

    documentRef.getElementById("system-template-apply-title")?.addEventListener("input", (event) => {
      state.applyDraft = {
        ...state.applyDraft,
        title: event.currentTarget.value,
      };
    });

    documentRef.getElementById("system-template-apply-template")?.addEventListener("change", (event) => {
      state.applyDraft = {
        ...state.applyDraft,
        template_id: event.currentTarget.value,
      };
    });

    documentRef.getElementById("system-template-apply-note")?.addEventListener("input", (event) => {
      state.applyDraft = {
        ...state.applyDraft,
        note: event.currentTarget.value,
      };
    });

    documentRef.querySelectorAll("[data-system-template-apply-group]").forEach((input) => {
      input.addEventListener("change", (event) => {
        const value = event.currentTarget.value;
        state.applyDraft = {
          ...state.applyDraft,
          node_group_ids: event.currentTarget.checked
            ? [...new Set([...state.applyDraft.node_group_ids, value])]
            : state.applyDraft.node_group_ids.filter((item) => item !== value),
        };
      });
    });

    documentRef.querySelectorAll("[data-system-template-apply-node]").forEach((input) => {
      input.addEventListener("change", (event) => {
        const value = event.currentTarget.value;
        state.applyDraft = {
          ...state.applyDraft,
          node_ids: event.currentTarget.checked
            ? [...new Set([...state.applyDraft.node_ids, value])]
            : state.applyDraft.node_ids.filter((item) => item !== value),
        };
      });
    });

    documentRef.getElementById("system-template-apply-reset")?.addEventListener("click", () => {
      state.applyDraft = createEmptyApplyDraft();
      state.applyMessage = null;
      renderCurrentContent();
      scrollToApply();
    });

    documentRef.getElementById("system-template-apply-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();

      const payload = {
        title: state.applyDraft.title.trim() || null,
        template_id: state.applyDraft.template_id,
        node_group_ids: state.applyDraft.node_group_ids,
        node_ids: state.applyDraft.node_ids,
        note: state.applyDraft.note.trim() || null,
      };

      if (!payload.template_id) {
        windowRef.alert("请先选择一个系统模板。");
        return;
      }

      try {
        const result = await applySystemTemplate(payload);
        state.applyMessage = {
          type: "success",
          text: result?.operation?.id
            ? `系统模板已开始下发，执行回显 ID：${result.operation.id}`
            : "系统模板下发任务已创建。",
        };
        state.applyDraft = {
          ...createEmptyApplyDraft(),
          template_id: payload.template_id,
        };
        await refreshRuntimeData();
        renderCurrentContent();
        scrollToApply();
      } catch (error) {
        state.applyMessage = {
          type: "error",
          text: error instanceof Error ? error.message : "系统模板下发失败",
        };
        renderCurrentContent();
        scrollToApply();
      }
    });
  }

  return {
    renderSystemTemplatesPage,
    setupSystemTemplatesPage,
  };
}
