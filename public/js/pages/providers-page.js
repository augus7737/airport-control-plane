import {
  getLocationPresetOptions,
  formatLocationDisplay,
  normalizeLocationValue,
} from "../shared/location-suggestions.js";
import {
  findCostItemByProviderId,
  formatCurrencyTotals,
} from "../shared/cost-formatters.js";

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

function normalizeProviderRegions(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => normalizeLocationValue(value, { scope: "region" }) || String(value || "").trim())
      .filter(Boolean),
  )];
}

function formatProviderRegions(regions = []) {
  return normalizeProviderRegions(regions)
    .map((region) =>
      formatLocationDisplay(region, {
        scope: "region",
        style: "name",
      }),
    )
    .join(" / ");
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
    return normalizeLocationValue(node?.labels?.region, { scope: "region" })
      || normalizeLocationValue(node?.networking?.entry_region, { scope: "entry" })
      || null;
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
          providerIds: new Set(),
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
      if (node?.provider_id) {
        summary.providerIds.add(node.provider_id);
      }
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
          provider_id: summary.providerIds.size === 1 ? [...summary.providerIds][0] : null,
          health,
          sourceLabel,
          regionList: [...summary.regions]
            .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
            .map((region) =>
              formatLocationDisplay(region, {
                scope: region === "中国大陆" ? "entry" : "region",
                style: "name",
              }),
            ),
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
        default_currency: "",
        monthly_budget: "",
        budget_alert_threshold: "",
        default_overage_price_per_gb: "",
        billing_contact: "",
        cost_note: "",
        note: "",
      };
    }

    return {
      name: String(provider.name || ""),
      account_name: String(provider.account_name || ""),
      website: String(provider.website || ""),
      api_endpoint: String(provider.api_endpoint || ""),
      regions: joinCommaList(normalizeProviderRegions(provider.regions)),
      status: String(provider.status || "active"),
      auto_provision_enabled: Boolean(provider.auto_provision_enabled),
      default_currency: String(provider.default_currency || ""),
      monthly_budget:
        provider.monthly_budget === undefined || provider.monthly_budget === null
          ? ""
          : String(provider.monthly_budget),
      budget_alert_threshold:
        provider.budget_alert_threshold === undefined || provider.budget_alert_threshold === null
          ? ""
          : String(provider.budget_alert_threshold),
      default_overage_price_per_gb:
        provider.default_overage_price_per_gb === undefined ||
        provider.default_overage_price_per_gb === null
          ? ""
          : String(provider.default_overage_price_per_gb),
      billing_contact: String(provider.billing_contact || ""),
      cost_note: String(provider.cost_note || ""),
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

  function renderProviderNodeStats(summary, costSummary = null) {
    if (!summary) {
      return '<span class="tiny">当前还没有节点绑定到这个厂商。</span>';
    }
    const costLine = costSummary
      ? `总月成本 ${formatCurrencyTotals(costSummary, "待补")} · 闲置 ${formatCurrencyTotals(
          costSummary.idle_totals_by_currency,
          "0",
        )}`
      : "成本台账待补";

    return `
      <div class="ops-inline-meta">
        <strong>${summary.total} 台节点</strong>
        <span class="tiny">直连 ${summary.direct} / 中转 ${summary.relay} · 可用 ${summary.active} / 异常 ${
          summary.failed + summary.degraded
        }</span>
        <span class="tiny">${escapeHtml(costLine)}</span>
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
    const costSummary = appState.costs.summary || {};
    const budgetAlertCount = appState.costs.providers.filter((item) => item.budget_alert).length;
    const selectedProviderNodeSummary = selectedProvider
      ? nodeSummaryByName.get(String(selectedProvider.name || "").trim().toLowerCase()) || null
      : null;
    const selectedProviderCost = selectedProvider
      ? findCostItemByProviderId(appState.costs.providers, selectedProvider.id)
      : null;
    const regionQuickOptions = getLocationPresetOptions("region").slice(0, 12);
    const providerRows = filteredProviders.length
      ? filteredProviders
          .map((provider) => {
            const nodeSummary =
              nodeSummaryByName.get(String(provider.name || "").trim().toLowerCase()) || null;
            const providerCost = findCostItemByProviderId(appState.costs.providers, provider.id);
            const budgetUsage =
              providerCost && Number.isFinite(providerCost.budget_usage_percent)
                ? `${providerCost.budget_usage_percent}%`
                : "未设预算";

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
                    <span class="tiny">${escapeHtml(formatProviderRegions(provider.regions) || "区域待补充")}</span>
                  </div>
                </td>
                <td>${renderProviderNodeStats(nodeSummary, providerCost)}</td>
                <td>
                  <div class="ops-inline-meta">
                    <strong>${provider.auto_provision_enabled ? "已预留自动建机" : "先手工纳管"}</strong>
                    <span class="tiny">${escapeHtml(provider.api_endpoint || provider.website || "尚未填写 API / 控制台地址")}</span>
                    <span class="tiny">预算 ${escapeHtml(budgetUsage)}${providerCost?.budget_alert ? " · 已触线" : ""}</span>
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
              ${
                matchedProvider
                  ? `<div class="kv-row"><span>总月成本</span><strong>${escapeHtml(
                      formatCurrencyTotals(
                        findCostItemByProviderId(appState.costs.providers, matchedProvider.id),
                        "待补",
                      ),
                    )}</strong></div>`
                  : ""
              }
            </div>
          </article>
        `;
      })
      .join("");
    const nodeOnlyProviderTags = nodeOnlySummaries.length
      ? `
        <div class="provider-ledger-callout">
          <div>
            <strong>还有 ${nodeOnlySummaries.length} 个节点厂商标签未建档</strong>
            <p>先把这些厂商补成正式台账，节点资产、成本和后续自动化入口才会稳定对齐。</p>
          </div>
          <div class="provider-inline-tag-row">
            ${nodeOnlySummaries
              .slice(0, 8)
              .map((summary) => `<span class="provider-inline-tag">${escapeHtml(summary.name)}</span>`)
              .join("")}
          </div>
        </div>
      `
      : "";
    const providerFormOverviewRows = selectedProvider
      ? [
          ["节点概况", selectedProviderNodeSummary ? `${selectedProviderNodeSummary.total} 台` : "尚未绑定节点"],
          [
            "覆盖国家",
            selectedProviderNodeSummary?.regionList?.join(" / ") || formatProviderRegions(selectedProvider?.regions) || "待补充",
          ],
          [
            "月成本",
            formatCurrencyTotals(selectedProviderCost, "待补"),
          ],
          [
            "预算使用",
            selectedProviderCost && Number.isFinite(selectedProviderCost.budget_usage_percent)
              ? `${selectedProviderCost.budget_usage_percent}%`
              : "未设置预算",
          ],
        ]
      : [
          ["录入目标", "先建厂商主档"],
          ["建议口径", "国家优先，不先录城市"],
          ["自动化", "没有 API 也能先建档"],
          ["成本台账", "后续节点会稳定对齐到 provider_id"],
        ];

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">已建档厂商</div><div class="stat-value">${appState.providers.length}</div><div class="stat-foot">现在可以手工录入、编辑和维护厂商账号信息。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">月成本总额</div><div class="stat-value">${escapeHtml(formatCurrencyTotals(costSummary, "待补"))}</div><div class="stat-foot">按节点实时折算，不做汇率换算。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">闲置成本</div><div class="stat-value">${escapeHtml(formatCurrencyTotals(costSummary.idle_totals_by_currency, "0"))}</div><div class="stat-foot">当前不在任何活跃发布里的节点成本。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">预算预警</div><div class="stat-value">${budgetAlertCount}</div><div class="stat-foot">${autoProvisionCount} 个厂商已预留自动化；${nodeOnlySummaries.length > 0 ? `另有 ${nodeOnlySummaries.length} 个只存在于节点标签。` : "节点标签与厂商台账已基本对齐。"}</div></div></article>
      </section>

      <section class="ops-page-grid fade-up">
        <article class="panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>厂商台账</h3>
                <p>这里是正式的云厂商主数据，不只是标签汇总。先把账号和覆盖国家建好，后面再逐个接 API 与自动建机。</p>
              </div>
              <div class="provider-pill">共 ${filteredProviders.length} 条</div>
            </div>
            <div class="ops-toolbar">
              <label class="field ops-inline-field">
                <span>搜索厂商</span>
                <input id="provider-filter-input" type="search" value="${escapeHtml(state.filter)}" placeholder="按名称、账号、国家或备注筛选" />
              </label>
            </div>
            ${nodeOnlyProviderTags}
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
                <p>${selectedProvider ? "更新这个厂商的身份、覆盖国家、自动化能力和预算默认值。" : "先录入厂商身份和覆盖国家，后续节点资产、成本台账和自动化入口就能逐步对齐。"}</p>
              </div>
              ${selectedProvider ? `<span class="provider-pill">编辑中</span>` : '<span class="provider-pill">新建</span>'}
            </div>
            ${state.message ? `<div class="message ${escapeHtml(state.message.type)}">${escapeHtml(state.message.text)}</div>` : ""}
            <form id="provider-form" class="stack provider-form-shell">
              <div class="provider-form-overview">
                ${providerFormOverviewRows
                  .map(
                    ([label, value]) => `
                      <div class="provider-form-overview-card">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(String(value || "-"))}</strong>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
              <section class="provider-form-section">
                <div class="provider-form-section-head">
                  <div>
                    <h4>厂商身份</h4>
                    <p>先建立厂商主档，后续节点、成本与自动化都围绕这组主数据对齐。</p>
                  </div>
                </div>
                <div class="ops-form-grid">
                  <label class="field">
                    <span>厂商名称</span>
                    <input name="name" value="${escapeHtml(draft.name)}" placeholder="例如 DMIT / Vultr / Oracle" required />
                  </label>
                  <label class="field">
                    <span>账号标识</span>
                    <input name="account_name" value="${escapeHtml(draft.account_name)}" placeholder="例如 主账号 / 验收账号 / 国际资源池" />
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
                    <span>覆盖国家 / 市场</span>
                    <input name="regions" value="${escapeHtml(draft.regions)}" placeholder="例如 香港, 越南, 马来西亚" />
                    <span class="field-note">优先填写国家或市场名称；支持中文、英文或代码，保存时会统一成规范国家名。</span>
                  </label>
                  <label class="field">
                    <span>状态</span>
                    <select name="status">
                      <option value="active"${draft.status === "active" ? " selected" : ""}>可用</option>
                      <option value="disabled"${draft.status === "disabled" ? " selected" : ""}>停用</option>
                    </select>
                  </label>
                </div>
                <div class="provider-region-chip-row" aria-label="常用覆盖国家">
                  ${regionQuickOptions
                    .map(
                      (item) => `
                        <button
                          class="provider-region-chip"
                          type="button"
                          data-provider-region-suggestion="${escapeHtml(item.value)}"
                        >
                          ${escapeHtml(item.value)}
                        </button>
                      `,
                    )
                    .join("")}
                </div>
              </section>
              <section class="provider-form-section">
                <div class="provider-form-section-head">
                  <div>
                    <h4>预算与自动化</h4>
                    <p>这部分先填默认口径，不做复杂财务系统，但要保证后续成本汇总和自动补货有依据。</p>
                  </div>
                </div>
                <div class="ops-form-grid">
                  <label class="field">
                    <span>默认币种</span>
                    <input name="default_currency" value="${escapeHtml(draft.default_currency)}" placeholder="例如 USD" />
                  </label>
                  <label class="field">
                    <span>月预算</span>
                    <input name="monthly_budget" type="number" min="0" step="0.01" value="${escapeHtml(draft.monthly_budget)}" placeholder="例如 500" />
                  </label>
                  <label class="field">
                    <span>预算告警阈值</span>
                    <input name="budget_alert_threshold" type="number" min="0" step="0.01" value="${escapeHtml(draft.budget_alert_threshold)}" placeholder="例如 80 或 0.8" />
                  </label>
                  <label class="field">
                    <span>默认超额单价 / GB</span>
                    <input name="default_overage_price_per_gb" type="number" min="0" step="0.01" value="${escapeHtml(draft.default_overage_price_per_gb)}" placeholder="例如 0.8" />
                  </label>
                  <label class="checkbox" style="grid-column: 1 / -1;">
                    <input type="checkbox" name="auto_provision_enabled"${draft.auto_provision_enabled ? " checked" : ""} />
                    <span>后续要接自动建机 / 自动补货</span>
                  </label>
                </div>
              </section>
              <section class="provider-form-section">
                <div class="provider-form-section-head">
                  <div>
                    <h4>账单与备注</h4>
                    <p>补齐联系人和说明，避免成本规则只存在于口头约定里。</p>
                  </div>
                </div>
                <div class="ops-form-grid">
                  <label class="field">
                    <span>账单联系人</span>
                    <input name="billing_contact" value="${escapeHtml(draft.billing_contact)}" placeholder="例如 ops@example.com" />
                  </label>
                  <label class="field">
                    <span>成本备注</span>
                    <textarea name="cost_note" rows="3" placeholder="记录预算口径、折旧规则、超额流量结算方式。">${escapeHtml(draft.cost_note)}</textarea>
                  </label>
                  <label class="field" style="grid-column: 1 / -1;">
                    <span>备注</span>
                    <textarea name="note" rows="4" placeholder="记录账单方式、注意事项、后续是否接自动建机等。">${escapeHtml(draft.note)}</textarea>
                  </label>
                </div>
              </section>
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

    documentRef.querySelectorAll("[data-provider-region-suggestion]").forEach((button) => {
      button.addEventListener("click", () => {
        const regionInput = documentRef.querySelector('#provider-form [name="regions"]');
        if (!(regionInput instanceof HTMLInputElement)) {
          return;
        }

        const nextRegion = normalizeLocationValue(
          button.getAttribute("data-provider-region-suggestion"),
          { scope: "region" },
        );
        if (!nextRegion) {
          return;
        }

        const mergedRegions = normalizeProviderRegions([
          ...splitCommaList(regionInput.value),
          nextRegion,
        ]);
        regionInput.value = joinCommaList(mergedRegions);
        regionInput.focus();
      });
    });

    documentRef.getElementById("provider-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const payload = {
        name: String(formData.get("name") || "").trim(),
        account_name: String(formData.get("account_name") || "").trim() || null,
        website: String(formData.get("website") || "").trim() || null,
        api_endpoint: String(formData.get("api_endpoint") || "").trim() || null,
        regions: normalizeProviderRegions(splitCommaList(formData.get("regions"))),
        status: String(formData.get("status") || "active").trim() || "active",
        auto_provision_enabled: formData.get("auto_provision_enabled") === "on",
        default_currency: String(formData.get("default_currency") || "").trim() || null,
        monthly_budget:
          formData.get("monthly_budget") === ""
            ? null
            : Number(formData.get("monthly_budget")),
        budget_alert_threshold:
          formData.get("budget_alert_threshold") === ""
            ? null
            : Number(formData.get("budget_alert_threshold")),
        default_overage_price_per_gb:
          formData.get("default_overage_price_per_gb") === ""
            ? null
            : Number(formData.get("default_overage_price_per_gb")),
        billing_contact: String(formData.get("billing_contact") || "").trim() || null,
        cost_note: String(formData.get("cost_note") || "").trim() || null,
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
