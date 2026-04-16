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

export function createProvidersPageModule(dependencies) {
  const {
    appState,
    createProvider,
    deleteProvider,
    documentRef,
    escapeHtml,
    formatRelativeTime,
    page,
    refreshRuntimeData,
    renderCurrentContent,
    statusClassName,
    statusText,
    updateProvider,
    windowRef,
  } = dependencies;

  const emptyCollection = Object.freeze([]);
  const state = {
    filter: "",
    selectedId: null,
    message: null,
  };

  function normalizeNodeProviderName(node) {
    return String(node?.labels?.provider || "").trim() || "未标记";
  }

  function normalizeNodeRegionName(node) {
    return (
      String(node?.labels?.region || "").trim() ||
      String(node?.networking?.entry_region || "").trim() ||
      null
    );
  }

  function summarizeProviders(nodes = appState.nodes) {
    const providerMap = new Map();

    for (const node of Array.isArray(nodes) ? nodes : emptyCollection) {
      const name = normalizeNodeProviderName(node);
      const region = normalizeNodeRegionName(node);
      const accessMode = String(node?.networking?.access_mode || "direct").toLowerCase();
      const source = String(node?.source || "manual").toLowerCase();
      const status = String(node?.status || "new").toLowerCase();

      if (!providerMap.has(name)) {
        providerMap.set(name, {
          name,
          total: 0,
          active: 0,
          degraded: 0,
          failed: 0,
          pending: 0,
          direct: 0,
          relay: 0,
          bootstrap: 0,
          manual: 0,
          regions: new Set(),
        });
      }

      const summary = providerMap.get(name);
      summary.total += 1;
      if (region) {
        summary.regions.add(region);
      }

      if (accessMode === "relay") {
        summary.relay += 1;
      } else {
        summary.direct += 1;
      }

      if (source === "bootstrap") {
        summary.bootstrap += 1;
      } else {
        summary.manual += 1;
      }

      if (["active", "success", "stable"].includes(status)) {
        summary.active += 1;
      } else if (status === "degraded") {
        summary.degraded += 1;
      } else if (status === "failed") {
        summary.failed += 1;
      } else {
        summary.pending += 1;
      }
    }

    return [...providerMap.values()]
      .map((summary) => {
        let health = "new";
        if (summary.failed > 0) {
          health =
            summary.active > 0 || summary.degraded > 0 || summary.pending > 0
              ? "degraded"
              : "failed";
        } else if (summary.degraded > 0) {
          health = "degraded";
        } else if (summary.active > 0) {
          health = "active";
        }

        let sourceLabel = "手工录入";
        if (summary.bootstrap > 0 && summary.manual > 0) {
          sourceLabel = "自动 + 手工";
        } else if (summary.bootstrap > 0) {
          sourceLabel = "自动注册";
        }

        return {
          ...summary,
          health,
          sourceLabel,
          regionList: [...summary.regions].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
        };
      })
      .sort(
        (left, right) =>
          right.total - left.total || left.name.localeCompare(right.name, "zh-Hans-CN"),
      );
  }

  function getSelectedProvider() {
    return appState.providers.find((item) => item.id === state.selectedId) || null;
  }

  function getDraft(provider) {
    if (!provider) {
      return {
        name: "",
        account_name: "",
        website: "",
        api_endpoint: "",
        regions: "",
        status: "active",
        auto_provision_enabled: false,
        note: "",
      };
    }

    return {
      name: String(provider.name || ""),
      account_name: String(provider.account_name || ""),
      website: String(provider.website || ""),
      api_endpoint: String(provider.api_endpoint || ""),
      regions: joinCommaList(provider.regions),
      status: String(provider.status || "active"),
      auto_provision_enabled: Boolean(provider.auto_provision_enabled),
      note: String(provider.note || ""),
    };
  }

  function getNodeSummaryByProviderName() {
    return new Map(
      summarizeProviders(appState.nodes).map((summary) => [summary.name.trim().toLowerCase(), summary]),
    );
  }

  function getFilteredProviders() {
    const query = state.filter.trim().toLowerCase();
    if (!query) {
      return appState.providers;
    }

    return appState.providers.filter((provider) =>
      [
        provider.id,
        provider.name,
        provider.account_name,
        provider.website,
        provider.api_endpoint,
        joinCommaList(provider.regions),
        provider.note,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }

  function getNodeOnlySummaries() {
    const providerNames = new Set(
      appState.providers
        .map((provider) => String(provider.name || "").trim().toLowerCase())
        .filter(Boolean),
    );

    return summarizeProviders(appState.nodes).filter(
      (summary) => !providerNames.has(summary.name.trim().toLowerCase()),
    );
  }

  function scrollToForm() {
    documentRef.getElementById("provider-form-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  async function handleDelete(providerId) {
    const provider = appState.providers.find((item) => item.id === providerId);
    if (!provider) {
      return;
    }

    const confirmed = windowRef.confirm(`确认删除云厂商“${provider.name}”吗？`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteProvider(provider.id);
      if (state.selectedId === provider.id) {
        state.selectedId = null;
      }
      state.message = {
        type: "success",
        text: `已删除云厂商：${provider.name}`,
      };
      await refreshRuntimeData();
      renderCurrentContent();
    } catch (error) {
      state.message = {
        type: "error",
        text: error instanceof Error ? error.message : "删除云厂商失败",
      };
      renderCurrentContent();
    }
  }

  function renderProviderNodeStats(summary) {
    if (!summary) {
      return '<span class="tiny">当前还没有节点绑定到这个厂商。</span>';
    }

    return `
      <div class="ops-inline-meta">
        <strong>${summary.total} 台节点</strong>
        <span class="tiny">直连 ${summary.direct} / 中转 ${summary.relay} · 可用 ${summary.active} / 异常 ${
          summary.failed + summary.degraded
        }</span>
      </div>
    `;
  }

  function renderProvidersPage() {
    const selectedProvider = getSelectedProvider();
    const draft = getDraft(selectedProvider);
    const filteredProviders = getFilteredProviders();
    const nodeSummaryByName = getNodeSummaryByProviderName();
    const nodeOnlySummaries = getNodeOnlySummaries();
    const totalNodeProviders = summarizeProviders(appState.nodes).length;
    const autoProvisionCount = appState.providers.filter(
      (provider) => provider.auto_provision_enabled,
    ).length;
    const activeProviderCount = appState.providers.filter(
      (provider) => String(provider.status || "").toLowerCase() === "active",
    ).length;
    const providerRows = filteredProviders.length
      ? filteredProviders
          .map((provider) => {
            const nodeSummary =
              nodeSummaryByName.get(String(provider.name || "").trim().toLowerCase()) || null;

            return `
              <tr>
                <td>
                  <div class="node-meta">
                    <span class="node-name">${escapeHtml(provider.name || provider.id)}</span>
                    <span class="node-id mono">${escapeHtml(provider.id || "-")}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${escapeHtml(provider.account_name || "未设置账号")}</strong>
                    <span class="tiny">${escapeHtml(joinCommaList(provider.regions) || "区域待补充")}</span>
                  </div>
                </td>
                <td>${renderProviderNodeStats(nodeSummary)}</td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${provider.auto_provision_enabled ? "已预留自动建机" : "先手工纳管"}</strong>
                    <span class="tiny">${escapeHtml(provider.api_endpoint || provider.website || "尚未填写 API / 控制台地址")}</span>
                  </div>
                </td>
                <td><span class="${statusClassName(provider.status)}">${statusText(provider.status)}</span></td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${provider.updated_at ? formatRelativeTime(provider.updated_at) : "刚创建"}</strong>
                    <span class="tiny">${provider.created_at ? escapeHtml(provider.created_at.slice(0, 10)) : "未记录时间"}</span>
                  </div>
                </td>
                <td>
                  <div class="ops-table-actions">
                    <button class="button ghost" type="button" data-provider-edit="${escapeHtml(provider.id)}">编辑</button>
                    <button class="button ghost" type="button" data-provider-delete="${escapeHtml(provider.id)}">删除</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td colspan="7">
            <div class="empty">还没有云厂商台账。先在右侧录入一个厂商账号，后面再逐步接自动建机。</div>
          </td>
        </tr>
      `;

    const nodeSummaryCards = summarizeProviders(appState.nodes)
      .map((provider) => {
        const matchedProvider = appState.providers.find(
          (item) => String(item.name || "").trim().toLowerCase() === provider.name.trim().toLowerCase(),
        );

        return `
          <article class="mini-card provider-summary-card">
            <div class="provider-summary-head">
              <div>
                <h3>${escapeHtml(provider.name)}</h3>
                <p>${escapeHtml(provider.regionList.join(" / ") || "区域待补充")}</p>
              </div>
              <span class="${statusClassName(provider.health)}">${statusText(provider.health)}</span>
            </div>
            <div class="detail-kv provider-summary-kv">
              <div class="kv-row"><span>纳管节点</span><strong>${provider.total}</strong></div>
              <div class="kv-row"><span>链路结构</span><strong>直连 ${provider.direct} / 中转 ${provider.relay}</strong></div>
              <div class="kv-row"><span>接入来源</span><strong>${escapeHtml(provider.sourceLabel)}</strong></div>
              <div class="kv-row"><span>台账状态</span><strong>${escapeHtml(matchedProvider ? "已建档" : "仅节点标签")}</strong></div>
            </div>
          </article>
        `;
      })
      .join("");

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">已建档厂商</div><div class="stat-value">${appState.providers.length}</div><div class="stat-foot">现在可以手工录入、编辑和维护厂商账号信息。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">活跃厂商</div><div class="stat-value">${activeProviderCount}</div><div class="stat-foot">状态为可用的厂商账号数量。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">自动建机预留</div><div class="stat-value">${autoProvisionCount}</div><div class="stat-foot">已标记为后续可接自动建机的厂商。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">节点中出现的厂商</div><div class="stat-value">${totalNodeProviders}</div><div class="stat-foot">${nodeOnlySummaries.length > 0 ? `还有 ${nodeOnlySummaries.length} 个厂商只存在于节点标签里。` : "节点标签与厂商台账已基本对齐。"}</div></div></article>
      </section>

      <section class="ops-page-grid fade-up">
        <article class="panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>厂商台账</h3>
                <p>先把厂商与账号信息录进来，后面再逐个接 API、区域和自动建机能力。</p>
              </div>
              <div class="provider-pill">共 ${filteredProviders.length} 条</div>
            </div>
            <div class="ops-toolbar">
              <label class="field ops-inline-field">
                <span>搜索厂商</span>
                <input id="provider-filter-input" type="search" value="${escapeHtml(state.filter)}" placeholder="按名称、账号、区域或备注筛选" />
              </label>
            </div>
            <div class="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>厂商</th>
                    <th>账号 / 区域</th>
                    <th>节点概况</th>
                    <th>自动化入口</th>
                    <th>状态</th>
                    <th>更新时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>${providerRows}</tbody>
              </table>
            </div>
          </div>
        </article>

        <aside class="panel" id="provider-form-panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>${selectedProvider ? "编辑厂商" : "接入新厂商"}</h3>
                <p>${selectedProvider ? "更新这个厂商的账号、区域和自动建机预留信息。" : "先录入厂商名称和账号信息，后续节点资产就能逐步对齐。"}</p>
              </div>
              ${selectedProvider ? `<span class="provider-pill">编辑中</span>` : '<span class="provider-pill">新建</span>'}
            </div>
            ${state.message ? `<div class="message ${escapeHtml(state.message.type)}">${escapeHtml(state.message.text)}</div>` : ""}
            <form id="provider-form" class="stack">
              <div class="ops-form-grid">
                <label class="field">
                  <span>厂商名称</span>
                  <input name="name" value="${escapeHtml(draft.name)}" placeholder="例如 DMIT / Vultr / Oracle" required />
                </label>
                <label class="field">
                  <span>账号标识</span>
                  <input name="account_name" value="${escapeHtml(draft.account_name)}" placeholder="例如 主账号 / 验收账号 / HK 资源池" />
                </label>
                <label class="field">
                  <span>控制台地址</span>
                  <input name="website" value="${escapeHtml(draft.website)}" placeholder="https://..." />
                </label>
                <label class="field">
                  <span>API 入口</span>
                  <input name="api_endpoint" value="${escapeHtml(draft.api_endpoint)}" placeholder="https://api.example.com" />
                </label>
                <label class="field">
                  <span>区域标签</span>
                  <input name="regions" value="${escapeHtml(draft.regions)}" placeholder="HKG, LAX, NRT" />
                </label>
                <label class="field">
                  <span>状态</span>
                  <select name="status">
                    <option value="active"${draft.status === "active" ? " selected" : ""}>可用</option>
                    <option value="disabled"${draft.status === "disabled" ? " selected" : ""}>停用</option>
                  </select>
                </label>
                <label class="field" style="grid-column: 1 / -1;">
                  <span>备注</span>
                  <textarea name="note" rows="4" placeholder="记录账单方式、注意事项、后续是否接自动建机等。">${escapeHtml(draft.note)}</textarea>
                </label>
                <label class="checkbox" style="grid-column: 1 / -1;">
                  <input type="checkbox" name="auto_provision_enabled"${draft.auto_provision_enabled ? " checked" : ""} />
                  <span>后续要接自动建机 / 自动补货</span>
                </label>
              </div>
              <div class="ops-action-row">
                <button class="button primary" type="submit">${selectedProvider ? "保存更新" : "新增厂商"}</button>
                <button class="button" type="button" id="provider-form-reset">${selectedProvider ? "取消编辑" : "清空表单"}</button>
              </div>
            </form>
          </div>
        </aside>
      </section>

      <section class="panel fade-up" style="margin-top:18px;">
        <div class="panel-body">
          <div class="panel-title">
            <div>
              <h3>节点视角汇总</h3>
              <p>这里保留你当前节点真实跑出来的厂商分布，方便核对哪些厂商已经建档，哪些还只是节点标签。</p>
            </div>
            <div class="provider-pill">共 ${summarizeProviders(appState.nodes).length} 个</div>
          </div>
          ${
            nodeSummaryCards
              ? `<div class="provider-catalog-grid">${nodeSummaryCards}</div>`
              : '<div class="ops-empty-block">当前还没有节点上的厂商分布数据。先纳管几台机器，这里会自动汇总。</div>'
          }
        </div>
      </section>
    `;
  }

  function setupProvidersPage() {
    if (page !== "providers") {
      return;
    }

    documentRef.getElementById("focus-provider-form")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      renderCurrentContent();
      scrollToForm();
    });

    documentRef.getElementById("providers-sync-placeholder")?.addEventListener("click", () => {
      state.message = {
        type: "success",
        text: "云厂商同步入口已经预留好。当前这版先支持手工建档，厂商 API 接入我们后续单独做。",
      };
      renderCurrentContent();
      scrollToForm();
    });

    const filterInput = documentRef.getElementById("provider-filter-input");
    filterInput?.addEventListener("input", (event) => {
      state.filter = event.target.value;
      const cursor = event.target.selectionStart ?? state.filter.length;
      renderCurrentContent();
      const nextInput = documentRef.getElementById("provider-filter-input");
      nextInput?.focus();
      if (typeof nextInput?.setSelectionRange === "function") {
        nextInput.setSelectionRange(cursor, cursor);
      }
    });

    documentRef.querySelectorAll("[data-provider-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedId = button.getAttribute("data-provider-edit");
        state.message = null;
        renderCurrentContent();
        scrollToForm();
      });
    });

    documentRef.querySelectorAll("[data-provider-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const providerId = button.getAttribute("data-provider-delete");
        if (providerId) {
          handleDelete(providerId);
        }
      });
    });

    documentRef.getElementById("provider-form-reset")?.addEventListener("click", () => {
      state.selectedId = null;
      state.message = null;
      renderCurrentContent();
      scrollToForm();
    });

    documentRef.getElementById("provider-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const payload = {
        name: String(formData.get("name") || "").trim(),
        account_name: String(formData.get("account_name") || "").trim() || null,
        website: String(formData.get("website") || "").trim() || null,
        api_endpoint: String(formData.get("api_endpoint") || "").trim() || null,
        regions: splitCommaList(formData.get("regions")),
        status: String(formData.get("status") || "active").trim() || "active",
        auto_provision_enabled: formData.get("auto_provision_enabled") === "on",
        note: String(formData.get("note") || "").trim() || null,
      };

      try {
        const currentProvider = getSelectedProvider();
        const savedProvider = currentProvider
          ? await updateProvider(currentProvider.id, payload)
          : await createProvider(payload);
        state.selectedId = savedProvider?.id || currentProvider?.id || null;
        state.message = {
          type: "success",
          text: currentProvider
            ? `已更新云厂商：${payload.name}`
            : `已新增云厂商：${payload.name}`,
        };
        await refreshRuntimeData();
        renderCurrentContent();
        scrollToForm();
      } catch (error) {
        state.message = {
          type: "error",
          text: error instanceof Error ? error.message : "保存云厂商失败",
        };
        renderCurrentContent();
        scrollToForm();
      }
    });
  }

  return {
    normalizeNodeProviderName,
    normalizeNodeRegionName,
    renderProvidersPage,
    setupProvidersPage,
    summarizeProviders,
  };
}
