export function createProvidersPageModule(dependencies) {
  const {
    appState,
    escapeHtml,
    statusClassName,
    statusText,
  } = dependencies;

  const emptyCollection = Object.freeze([]);

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
          health = summary.active > 0 || summary.degraded > 0 || summary.pending > 0 ? "degraded" : "failed";
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
      .sort((left, right) => right.total - left.total || left.name.localeCompare(right.name, "zh-Hans-CN"));
  }

  function renderProvidersPage() {
    const providers = summarizeProviders(appState.nodes);
    const regionCount = new Set(
      providers.flatMap((provider) => provider.regionList),
    ).size;
    const relayCount = appState.nodes.filter((node) => String(node.networking?.access_mode || "direct") === "relay").length;
    const cards = providers.length
      ? providers.map((provider) => `
          <article class="panel">
            <div class="panel-body">
              <div class="panel-title">
                <div><h3>${escapeHtml(provider.name)}</h3><p>${escapeHtml(provider.regionList.join(" / ") || "区域待补充")}</p></div>
                <span class="${statusClassName(provider.health)}">${statusText(provider.health)}</span>
              </div>
              <div class="detail-kv">
                <div class="kv-row"><span>纳管节点数</span><strong>${provider.total}</strong></div>
                <div class="kv-row"><span>可用 / 异常</span><strong>${provider.active} / ${provider.failed + provider.degraded}</strong></div>
                <div class="kv-row"><span>接入来源</span><strong>${escapeHtml(provider.sourceLabel)}</strong></div>
                <div class="kv-row"><span>链路结构</span><strong>直连 ${provider.direct} / 中转 ${provider.relay}</strong></div>
              </div>
            </div>
          </article>
        `).join("")
      : `
        <article class="panel">
          <div class="panel-body">
            <div class="empty">当前还没有可统计的厂商数据。先录入或自动纳管几台节点，这里就会按真实节点自动汇总。</div>
          </div>
        </article>
      `;

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">已记录厂商</div><div class="stat-value">${providers.length}</div><div class="stat-foot">基于当前真实节点清单自动汇总。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">已纳管节点</div><div class="stat-value">${appState.nodes.length}</div><div class="stat-foot">包含手工录入与自动注册节点。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">覆盖区域</div><div class="stat-value">${regionCount}</div><div class="stat-foot">按节点区域与入口区域汇总得出。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">经中转节点</div><div class="stat-value">${relayCount}</div><div class="stat-foot">用于识别需要先入香港等入口节点的链路。</div></div></article>
      </section>
      <section class="grid fade-up" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));margin-top:18px;">${cards}</section>
    `;
  }

  return {
    normalizeNodeProviderName,
    normalizeNodeRegionName,
    renderProvidersPage,
    summarizeProviders,
  };
}
