import {
  formatLocationDisplay,
  normalizeLocationValue,
} from "../shared/location-suggestions.js";

export function createNodesPageModule(dependencies) {
  const {
    appState,
    daysUntil,
    documentRef,
    getAccessMode,
    nodeTable,
    page,
    pageMeta,
    renderCurrentContent,
  } = dependencies;

  function renderNodesOverviewHeader(nodes) {
    const counts = nodes.reduce(
      (acc, node) => {
        acc.total += 1;
        const status = String(node.status || "new").toLowerCase();
        if (status === "active") acc.active += 1;
        if (status === "new") acc.new += 1;
        if (status === "degraded" || status === "failed") acc.risk += 1;
        return acc;
      },
      { total: 0, active: 0, new: 0, risk: 0 },
    );
    const expiringSoon = nodes.filter((node) => {
      const days = daysUntil(node.commercial?.expires_at);
      return days != null && days <= 7;
    }).length;
    const meta = pageMeta.nodes;
    const stats = [
      {
        label: "节点总数",
        value: counts.total,
        note: "全部节点",
      },
      {
        label: "可接管",
        value: counts.active,
        note: "状态稳定",
      },
      {
        label: "待处理",
        value: counts.new + counts.risk,
        note: "初始化或异常",
      },
      {
        label: "即将到期",
        value: expiringSoon,
        note: "7 天内",
      },
    ];

    return `
      <section class="panel nodes-overview-head fade-up">
        <div class="panel-body">
          <div class="nodes-overview-header">
            <div class="nodes-overview-main">
              <span class="eyebrow">节点工作台</span>
              <h2>${meta.title}</h2>
              <p>把状态、规格、资产和接入链路集中在一张台账里，首屏直接进入筛选和排障。</p>
            </div>
            <div class="nodes-overview-pills">
              ${stats
                .map(
                  (item) => `
                    <article class="nodes-overview-pill">
                      <span class="nodes-overview-pill-label">${item.label}</span>
                      <strong class="nodes-overview-pill-value">${item.value}</strong>
                      <span class="nodes-overview-pill-note">${item.note}</span>
                    </article>
                  `,
                )
                .join("")}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function applyNodeFilters(nodes) {
    return nodes.filter((node) => {
      const query = appState.filters.query.trim().toLowerCase();
      const provider = node.labels?.provider || "";
      const region = normalizeLocationValue(node.labels?.region, { scope: "region" }) || "";
      const hostname = node.facts?.hostname || "";
      const ip = [
        node.facts?.public_ipv4 || "",
        node.facts?.public_ipv6 || "",
        node.facts?.private_ipv4 || "",
      ]
        .filter(Boolean)
        .join(" ");
      const source = node.source || "bootstrap";
      const renew = node.commercial?.auto_renew === true ? "auto" : "manual";
      const expiryDays = daysUntil(node.commercial?.expires_at);
      const accessMode = getAccessMode(node);

      if (query) {
        const haystack = [
          hostname,
          ip,
          provider,
          region,
          formatLocationDisplay(region, { scope: "region", style: "full" }),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }

      if (appState.filters.provider && provider !== appState.filters.provider) {
        return false;
      }

      if (appState.filters.region && region !== appState.filters.region) {
        return false;
      }

      if (appState.filters.source !== "all" && source !== appState.filters.source) {
        return false;
      }

      if (appState.filters.accessMode !== "all" && accessMode !== appState.filters.accessMode) {
        return false;
      }

      if (appState.filters.renewal !== "all" && renew !== appState.filters.renewal) {
        return false;
      }

      if (appState.filters.expiry === "7") {
        return expiryDays != null && expiryDays <= 7 && expiryDays >= 0;
      }

      if (appState.filters.expiry === "30") {
        return expiryDays != null && expiryDays <= 30 && expiryDays >= 0;
      }

      if (appState.filters.expiry === "expired") {
        return expiryDays != null && expiryDays < 0;
      }

      return true;
    });
  }

  function renderNodesPage(nodes) {
    const providers = [...new Set(nodes.map((node) => node.labels?.provider).filter(Boolean))];
    const regions = [
      ...new Set(
        nodes
          .map((node) => normalizeLocationValue(node.labels?.region, { scope: "region" }))
          .filter(Boolean),
      ),
    ];
    const filteredNodes = applyNodeFilters(nodes);
    const expiringSoon = filteredNodes.filter((node) => {
      const days = daysUntil(node.commercial?.expires_at);
      return days != null && days <= 7;
    }).length;
    const relayCount = filteredNodes.filter((node) => getAccessMode(node) === "relay").length;
    const directCount = filteredNodes.filter((node) => getAccessMode(node) !== "relay").length;

    return `
      ${renderNodesOverviewHeader(nodes)}
      <section class="panel nodes-filter-panel fade-up">
        <div class="panel-body">
          <div class="panel-title">
            <div>
              <h3>节点筛选</h3>
              <p>按来源、厂商、区域、续费和接入方式快速收敛范围。</p>
            </div>
            <div class="provider-pill">共 ${filteredNodes.length} 台</div>
          </div>
          <div class="form-grid nodes-filter-grid">
            <div class="field full-row">
              <label for="filter-query">搜索节点</label>
              <input id="filter-query" value="${appState.filters.query}" placeholder="节点名 / IP / 厂商" />
            </div>
            <div class="field">
              <label for="filter-source">纳管来源</label>
              <select id="filter-source">
                <option value="all"${appState.filters.source === "all" ? " selected" : ""}>全部</option>
                <option value="bootstrap"${appState.filters.source === "bootstrap" ? " selected" : ""}>自动注册</option>
                <option value="manual"${appState.filters.source === "manual" ? " selected" : ""}>手工录入</option>
              </select>
            </div>
            <div class="field">
              <label for="filter-provider">云厂商</label>
              <select id="filter-provider">
                <option value="">全部</option>
                ${providers.map((provider) => `<option value="${provider}"${appState.filters.provider === provider ? " selected" : ""}>${provider}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label for="filter-region">区域</label>
              <select id="filter-region">
                <option value="">全部</option>
                ${regions
                  .map(
                    (region) => `
                      <option value="${region}"${appState.filters.region === region ? " selected" : ""}>
                        ${formatLocationDisplay(region, { scope: "region", style: "compact" })}
                      </option>
                    `,
                  )
                  .join("")}
              </select>
            </div>
            <div class="field">
              <label for="filter-renewal">续费方式</label>
              <select id="filter-renewal">
                <option value="all"${appState.filters.renewal === "all" ? " selected" : ""}>全部</option>
                <option value="auto"${appState.filters.renewal === "auto" ? " selected" : ""}>自动续费</option>
                <option value="manual"${appState.filters.renewal === "manual" ? " selected" : ""}>手动续费</option>
              </select>
            </div>
            <div class="field">
              <label for="filter-expiry">到期筛选</label>
              <select id="filter-expiry">
                <option value="all"${appState.filters.expiry === "all" ? " selected" : ""}>全部</option>
                <option value="7"${appState.filters.expiry === "7" ? " selected" : ""}>7 天内到期</option>
                <option value="30"${appState.filters.expiry === "30" ? " selected" : ""}>30 天内到期</option>
                <option value="expired"${appState.filters.expiry === "expired" ? " selected" : ""}>已过期</option>
              </select>
            </div>
            <div class="field">
              <label for="filter-access-mode">接入方式</label>
              <select id="filter-access-mode">
                <option value="all"${appState.filters.accessMode === "all" ? " selected" : ""}>全部</option>
                <option value="direct"${appState.filters.accessMode === "direct" ? " selected" : ""}>直连</option>
                <option value="relay"${appState.filters.accessMode === "relay" ? " selected" : ""}>经中转</option>
              </select>
            </div>
          </div>
          <div class="chips nodes-filter-summary">
            <div class="pill"><span>7 天内到期</span><strong>${expiringSoon} 台</strong></div>
            <div class="pill"><span>直连</span><strong>${directCount} 台</strong></div>
            <div class="pill"><span>中转</span><strong>${relayCount} 台</strong></div>
            <button class="button ghost" type="button" id="reset-filters">清空筛选</button>
          </div>
        </div>
      </section>
      <section class="panel nodes-table-panel fade-up">
        <div class="panel-body">
          <div class="panel-title">
            <div><h3>全部节点</h3><p>以台账视图集中查看状态、归属、规格和资产信息。</p></div>
            <div class="provider-pill">共 ${filteredNodes.length} 台</div>
          </div>
          ${nodeTable(filteredNodes, { variant: "ledger" })}
        </div>
      </section>
    `;
  }

  function setupNodesFilters() {
    if (page !== "nodes") {
      return;
    }

    const bindings = [
      ["filter-query", "query"],
      ["filter-provider", "provider"],
      ["filter-region", "region"],
      ["filter-renewal", "renewal"],
      ["filter-expiry", "expiry"],
      ["filter-source", "source"],
      ["filter-access-mode", "accessMode"],
    ];

    for (const [id, key] of bindings) {
      const element = documentRef.getElementById(id);
      if (!element) continue;
      const eventName = id === "filter-query" ? "input" : "change";
      element.addEventListener(eventName, (event) => {
        appState.filters[key] = event.currentTarget.value;
        renderCurrentContent();
      });
    }

    documentRef.getElementById("reset-filters")?.addEventListener("click", () => {
      appState.filters = {
        query: "",
        provider: "",
        region: "",
        renewal: "all",
        expiry: "all",
        source: "all",
        accessMode: "all",
      };
      renderCurrentContent();
    });
  }

  return {
    applyNodeFilters,
    renderNodesOverviewHeader,
    renderNodesPage,
    setupNodesFilters,
  };
}
