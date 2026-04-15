export function createRoutesPageModule(dependencies) {
  const {
    buildCurvePath,
    buildRelayGroups,
    buildRouteGraph,
    formatRouteSummary,
    getAccessMode,
    getCountryStats,
    getNodeDisplayName,
    nodeTable,
    statusClassName,
    statusText,
  } = dependencies;

  function renderCountryDistribution(nodes, options = {}) {
    const limit = options.limit ?? 6;
    const compact = options.compact ?? false;
    const stats = getCountryStats(nodes);
    const max = Math.max(...stats.map((item) => item.total), 1);

    if (stats.length === 0) {
      return '<div class="empty">当前还没有节点分布数据。</div>';
    }

    if (compact) {
      return `
        <div class="country-list">
          ${stats.slice(0, limit).map((item, index) => `
            <article class="country-list-row">
              <div class="country-list-rank">TOP ${index + 1}</div>
              <div class="country-list-main">
                <div class="country-list-head">
                  <strong>${item.country}</strong>
                  <span>${item.code}</span>
                </div>
                <div class="country-list-meta">直连 ${item.direct} · 中转 ${item.relay} · ${item.providers} 个厂商</div>
                <div class="country-bar compact"><span style="width:${Math.max(18, (item.total / max) * 100)}%"></span></div>
              </div>
              <div class="country-list-total">${item.total}<span> 台</span></div>
            </article>
          `).join("")}
        </div>
      `;
    }

    return `
      <div class="country-grid">
        ${stats.slice(0, limit).map((item, index) => `
          <article class="country-card ${index === 0 && !compact ? "featured" : ""}">
            <div class="country-card-head">
              <span class="country-code">${item.code}</span>
              <span class="country-rank">TOP ${index + 1}</span>
            </div>
            <div class="country-name">${item.country}</div>
            <div class="country-total">${item.total}<span> 台节点</span></div>
            <div class="country-split">
              <span>直连 ${item.direct}</span>
              <span>中转 ${item.relay}</span>
            </div>
            <div class="country-bar"><span style="width:${Math.max(18, (item.total / max) * 100)}%"></span></div>
            <div class="country-note">${item.providers} 个厂商 / ${item.regions} 个区域标签</div>
          </article>
        `).join("")}
      </div>
    `;
  }

  function renderRouteGraph(nodes) {
    const graph = buildRouteGraph(nodes);
    const maxWeight = Math.max(...graph.lines.map((line) => line.weight), 1);

    const pathHtml = graph.lines
      .map((line) => {
        const start = graph.nodeIndex.get(line.from);
        const end = graph.nodeIndex.get(line.to);
        if (!start || !end) {
          return "";
        }

        const strokeWidth = (1.4 + (line.weight / maxWeight) * 2.6).toFixed(2);
        return `
          <path
            class="route-link ${line.type === "direct" ? "direct" : "relay"}"
            d="${buildCurvePath(start, end)}"
            style="stroke-width:${strokeWidth}"
          />
        `;
      })
      .join("");

    const renderGraphNode = (item, kind) => `
      <div class="route-orb route-orb-${kind}" style="left:${item.x}%;top:${item.y}%;">
        <span class="route-orb-code">${item.code}</span>
        <strong>${item.label}</strong>
        <span class="route-orb-meta">${
          kind === "country"
            ? `共 ${item.count} 台 · 直连 ${item.direct} / 中转 ${item.relay}`
            : kind === "relay"
              ? `${item.meta || "未标记"} · 承载 ${item.count} 台`
              : `${item.count} 条入口链路`
        }</span>
      </div>
    `;

    return `
      <div class="route-visual">
        <div class="route-legend">
          <span><i class="swatch entry"></i>入口区域</span>
          <span><i class="swatch relay"></i>中转机</span>
          <span><i class="swatch country"></i>落地国家</span>
          <span><i class="swatch line-solid"></i>经中转链路</span>
          <span><i class="swatch line-dashed"></i>直连链路</span>
        </div>
        <div class="route-canvas">
          <div class="route-lane-label" style="left:14%;">入口区域</div>
          <div class="route-lane-label" style="left:49%;">中转层</div>
          <div class="route-lane-label" style="left:84%;">落地国家</div>
          <svg class="route-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            ${pathHtml}
          </svg>
          ${graph.entryNodes.map((item) => renderGraphNode(item, "entry")).join("")}
          ${graph.relayNodes.map((item) => renderGraphNode(item, "relay")).join("")}
          ${graph.countryNodes.map((item) => renderGraphNode(item, "country")).join("")}
        </div>
      </div>
    `;
  }

  function renderRoutesPage(nodes) {
    const relayNodes = nodes.filter((node) => getAccessMode(node) === "relay");
    const directNodes = nodes.filter((node) => getAccessMode(node) !== "relay");
    const relayGroups = buildRelayGroups(nodes);
    const countryStats = getCountryStats(nodes);

    const topologyCards = relayGroups.length
      ? relayGroups
          .map((group) => `
            <article class="route-card">
              <div class="panel-title">
                <div>
                  <div class="route-caption">入口 ${group.entryRegion}</div>
                  <h3>${group.relayLabel}</h3>
                  <p>${group.relayRegion} · 承载 ${group.members.length} 台落地节点</p>
                </div>
                <div class="provider-pill">${group.relayNode ? "已绑定节点" : "仅记录标签"}</div>
              </div>
              <div class="route-flow">
                <span class="route-node route-entry">${group.entryRegion}</span>
                <span class="route-arrow">→</span>
                <span class="route-node route-relay">${group.relayLabel}</span>
                <span class="route-arrow">→</span>
                <span class="route-node route-exit">落地节点集群</span>
              </div>
              <div class="route-members">
                ${group.members
                  .map((node) => `
                    <a class="route-member" href="/node.html?id=${node.id}">
                      <div class="route-member-meta">
                        <strong>${getNodeDisplayName(node)}</strong>
                        <span>${node.labels?.provider || "未标记"} / ${node.labels?.region || "-"}</span>
                      </div>
                      <div class="route-member-extra">
                        <span class="${statusClassName(node.status)}">${statusText(node.status)}</span>
                        <span class="tiny">${node.networking?.route_note || formatRouteSummary(node, nodes)}</span>
                      </div>
                    </a>
                  `)
                  .join("")}
              </div>
            </article>
          `)
          .join("")
      : '<div class="empty">当前还没有配置“经中转”的节点。后面你录入香港中转机和落地机后，这里会自动形成拓扑视图。</div>';

    const unresolvedRelayCount = relayNodes.filter(
      (node) => !node.networking?.relay_node_id && !node.networking?.relay_label,
    ).length;
    const entryRegions = [...new Set(relayNodes.map((node) => node.networking?.entry_region).filter(Boolean))];

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">经中转节点</div><div class="stat-value">${relayNodes.length}</div><div class="stat-foot">需要先走入口机或香港中转机，再进入落地节点的机器。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">直连节点</div><div class="stat-value">${directNodes.length}</div><div class="stat-foot">可直接从入口区域到达，不依赖中转跳板。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">中转分组</div><div class="stat-value">${relayGroups.length}</div><div class="stat-foot">按中转机归并后的链路组，便于观察单点依赖。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">待补关系</div><div class="stat-value">${unresolvedRelayCount}</div><div class="stat-foot">已标成经中转，但还没有填写明确中转机的节点。</div></div></article>
      </section>
      <section class="workspace fade-up">
        <article class="panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>全球链路图</h3>
                <p>把入口区域、中转机和落地国家放在同一张图上，线越粗代表承载的节点越多。</p>
              </div>
            </div>
            ${renderRouteGraph(nodes)}
          </div>
        </article>
        <aside class="aside-stack">
          <section class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>国家分布</h3><p>国家视角和链路视角放在一起，更适合做扩容和替换决策。</p></div></div>
              ${renderCountryDistribution(nodes, { limit: 5, compact: true })}
            </div>
          </section>
          <section class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>当前入口区域</h3><p>后续可以配合探测任务，按入口区域看整体可用性。</p></div></div>
              <div class="event-list">
                ${
                  entryRegions.length > 0
                    ? entryRegions
                        .map((region) => {
                          const count = relayNodes.filter(
                            (node) => (node.networking?.entry_region || "中国大陆") === region,
                          ).length;
                          return `<div class="event"><strong>${region}</strong><p>共有 ${count} 台节点通过该入口区域进入。</p></div>`;
                        })
                        .join("")
                    : '<div class="event"><strong>暂无入口区域数据</strong><p>录入经中转节点后，这里会自动统计不同入口区域的分布。</p></div>'
                }
              </div>
            </div>
          </section>
        </aside>
      </section>
      <section class="panel fade-up" style="margin-top:18px;">
        <div class="panel-body">
          <div class="panel-title">
            <div>
              <h3>中转链路分组</h3>
              <p>按中转机聚合，把“入口区域 -> 中转机 -> 落地节点”的关系拆开细看。</p>
            </div>
            <div class="provider-pill">落地国家 ${countryStats.length} 个</div>
          </div>
          <div class="route-topology">${topologyCards}</div>
        </div>
      </section>
      <section class="grid fade-up" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-top:18px;">
        <article class="panel">
          <div class="panel-body">
            <div class="panel-title"><div><h3>经中转节点列表</h3><p>适合看哪些落地机依赖上游中转机。</p></div></div>
            ${
              relayNodes.length > 0
                ? nodeTable(relayNodes, { showCommercial: true, showRoute: true })
                : '<div class="empty">当前没有经中转节点。</div>'
            }
          </div>
        </article>
        <article class="panel">
          <div class="panel-body">
            <div class="panel-title"><div><h3>直连节点列表</h3><p>适合看可以独立提供接入能力的节点。</p></div></div>
            ${
              directNodes.length > 0
                ? nodeTable(directNodes, { showCommercial: true, showRoute: true })
                : '<div class="empty">当前没有直连节点。</div>'
            }
          </div>
        </article>
      </section>
    `;
  }

  return {
    renderCountryDistribution,
    renderRouteGraph,
    renderRoutesPage,
  };
}
