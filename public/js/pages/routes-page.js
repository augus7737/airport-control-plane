import {
  formatLocationDisplay,
  getLocationCode,
  getLocationCoordinates,
  normalizeLocationValue,
} from "../shared/location-suggestions.js";

const defaultDocumentRef = typeof document !== "undefined" ? document : null;
const defaultWindowRef = typeof window !== "undefined" ? window : null;

function defaultEscapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEntryLabel(node) {
  return normalizeLocationValue(node?.networking?.entry_region, { scope: "entry" }) || "中国大陆";
}

function hashString(value) {
  return [...String(value || "")].reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) >>> 0;
  }, 7);
}

function fanOutCoordinate(coord, seed, intensity = 1) {
  if (!Array.isArray(coord) || coord.length !== 2) {
    return null;
  }

  const numericSeed = hashString(seed);
  const angle = ((numericSeed % 360) * Math.PI) / 180;
  const radialX = 1.1 + ((numericSeed % 5) * 0.24 + 0.2) * intensity;
  const radialY = 0.56 + ((Math.floor(numericSeed / 13) % 5) * 0.12 + 0.08) * intensity;
  return [
    Number((coord[0] + Math.cos(angle) * radialX).toFixed(4)),
    Number((coord[1] + Math.sin(angle) * radialY).toFixed(4)),
  ];
}

function scaleMetric(value, maxValue, minSize, maxSize) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maxValue) || maxValue <= 0) {
    return minSize;
  }

  const ratio = Math.min(1, value / maxValue);
  return minSize + (maxSize - minSize) * ratio;
}

export function createRoutesPageModule(dependencies) {
  const {
    buildRelayGroups,
    escapeHtml = defaultEscapeHtml,
    formatRouteSummary,
    getAccessMode,
    getCountryStats,
    getNodeCountry,
    getNodeDisplayName,
    nodeTable,
    statusClassName,
    statusText,
    documentRef = defaultDocumentRef,
    fetchImpl = fetch,
    windowRef = defaultWindowRef,
  } = dependencies;

  let routeChart = null;
  let routeChartResizeHandlerBound = false;
  let worldMapPromise = null;

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
                  <strong>${escapeHtml(item.country)}</strong>
                  <span>${escapeHtml(item.code)}</span>
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
              <span class="country-code">${escapeHtml(item.code)}</span>
              <span class="country-rank">TOP ${index + 1}</span>
            </div>
            <div class="country-name">${escapeHtml(item.country)}</div>
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

  function formatRegionChip(value, scope = "region", fallback = "-") {
    return formatLocationDisplay(value, {
      scope,
      style: "compact",
      fallback,
    });
  }

  function buildRouteMapModel(nodes = []) {
    const relayGroups = buildRelayGroups(nodes);
    const directNodes = nodes.filter((node) => getAccessMode(node) !== "relay");
    const entryIndex = new Map();
    const relayIndex = new Map();
    const countryIndex = new Map();
    const unresolvedLabels = new Set();
    const lineItems = [];
    const directLineBuckets = new Map();

    function markMissing(value) {
      const label = String(value || "").trim();
      if (label) {
        unresolvedLabels.add(label);
      }
    }

    function ensureEntryPoint(label) {
      const normalized = normalizeLocationValue(label, { scope: "entry" }) || "中国大陆";
      const key = `entry:${normalized}`;
      const existing = entryIndex.get(key);
      if (existing) {
        return existing;
      }

      const coord = getLocationCoordinates(normalized, { scope: "entry" });
      if (!coord) {
        markMissing(normalized);
      }

      const next = {
        key,
        kind: "entry",
        label: normalized,
        code: getLocationCode(normalized, { scope: "entry" }),
        coord,
        total: 0,
        direct: 0,
        relay: 0,
      };
      entryIndex.set(key, next);
      return next;
    }

    function ensureRelayPoint(group) {
      const regionSource =
        group.relayNode?.labels?.region ||
        group.relayNode?.labels?.country ||
        group.relayRegionValue ||
        group.members[0]?.networking?.relay_region ||
        null;
      const normalizedRegion = normalizeLocationValue(regionSource, { scope: "region" }) || regionSource;
      const key = `relay:${group.key}`;
      const existing = relayIndex.get(key);
      if (existing) {
        return existing;
      }

      const baseCoord = normalizedRegion
        ? getLocationCoordinates(normalizedRegion, { scope: "region" })
        : null;
      if (!baseCoord) {
        markMissing(normalizedRegion || group.relayLabel);
      }

      const next = {
        key,
        kind: "relay",
        label: group.relayLabel,
        code: normalizedRegion ? getLocationCode(normalizedRegion, { scope: "region" }) : "RL",
        region: normalizedRegion || "未标记区域",
        coord: baseCoord ? fanOutCoordinate(baseCoord, group.key, 1.18) : null,
        total: 0,
        direct: 0,
        relay: 0,
        nodeId: group.relayNode?.id || null,
      };
      relayIndex.set(key, next);
      return next;
    }

    function ensureCountryPoint(country) {
      const normalized = normalizeLocationValue(country, { scope: "region" }) || country || "未识别";
      const key = `country:${normalized}`;
      const existing = countryIndex.get(key);
      if (existing) {
        return existing;
      }

      const coord = getLocationCoordinates(normalized, { scope: "region" });
      if (!coord) {
        markMissing(normalized);
      }

      const next = {
        key,
        kind: "country",
        label: normalized,
        code: getLocationCode(normalized, { scope: "region" }),
        coord,
        total: 0,
        direct: 0,
        relay: 0,
      };
      countryIndex.set(key, next);
      return next;
    }

    for (const group of relayGroups) {
      const entryPoint = ensureEntryPoint(group.entryRegion);
      const relayPoint = ensureRelayPoint(group);
      entryPoint.total += group.members.length;
      entryPoint.relay += group.members.length;
      relayPoint.total += group.members.length;
      relayPoint.relay += group.members.length;

      if (entryPoint.coord && relayPoint.coord) {
        lineItems.push({
          type: "relay-entry",
          weight: group.members.length,
          fromLabel: entryPoint.label,
          toLabel: relayPoint.label,
          fromCoord: entryPoint.coord,
          toCoord: relayPoint.coord,
          count: group.members.length,
        });
      }

      const destinationMap = new Map();
      for (const member of group.members) {
        const country = getNodeCountry(member);
        destinationMap.set(country, (destinationMap.get(country) || 0) + 1);
      }

      for (const [country, weight] of destinationMap) {
        const countryPoint = ensureCountryPoint(country);
        countryPoint.total += weight;
        countryPoint.relay += weight;

        if (relayPoint.coord && countryPoint.coord) {
          lineItems.push({
            type: "relay-country",
            weight,
            fromLabel: relayPoint.label,
            toLabel: countryPoint.label,
            fromCoord: relayPoint.coord,
            toCoord: countryPoint.coord,
            count: weight,
            nodeId: relayPoint.nodeId,
          });
        }
      }
    }

    for (const node of directNodes) {
      const entryLabel = buildEntryLabel(node);
      const countryLabel = getNodeCountry(node);
      const entryPoint = ensureEntryPoint(entryLabel);
      const countryPoint = ensureCountryPoint(countryLabel);
      entryPoint.total += 1;
      entryPoint.direct += 1;
      countryPoint.total += 1;
      countryPoint.direct += 1;

      const bucketKey = `${entryPoint.key}:${countryPoint.key}`;
      const bucket = directLineBuckets.get(bucketKey) || {
        type: "direct",
        weight: 0,
        fromLabel: entryPoint.label,
        toLabel: countryPoint.label,
        fromCoord: entryPoint.coord,
        toCoord: countryPoint.coord,
        count: 0,
      };
      bucket.weight += 1;
      bucket.count += 1;
      directLineBuckets.set(bucketKey, bucket);
    }

    for (const bucket of directLineBuckets.values()) {
      if (bucket.fromCoord && bucket.toCoord) {
        lineItems.push(bucket);
      }
    }

    return {
      relayGroups,
      entryPoints: [...entryIndex.values()],
      relayPoints: [...relayIndex.values()],
      countryPoints: [...countryIndex.values()],
      lines: lineItems,
      unresolvedLabels: [...unresolvedLabels],
    };
  }

  function buildLineSeriesData(lines, options = {}) {
    const maxWeight = Math.max(...lines.map((line) => line.weight), 1);
    const baseColor = options.color || "rgba(125, 211, 252, 0.66)";
    const lineType = options.lineType || "solid";

    return lines.map((line) => ({
      coords: [line.fromCoord, line.toCoord],
      value: line.weight,
      meta: line,
      lineStyle: {
        color: baseColor,
        width: Number(scaleMetric(line.weight, maxWeight, 1.2, 4.4).toFixed(2)),
        type: lineType,
        opacity: options.opacity ?? 0.74,
        curveness: options.curveness ?? 0.22,
      },
    }));
  }

  function buildScatterSeriesData(points) {
    return points
      .filter((point) => Array.isArray(point.coord))
      .map((point) => ({
        name: point.label,
        value: [...point.coord, point.total],
        meta: point,
      }));
  }

  function buildRouteTooltip(params) {
    const meta = params?.data?.meta;
    if (!meta) {
      return "";
    }

    if (meta.type) {
      const typeLabel =
        meta.type === "direct"
          ? "直连链路"
          : meta.type === "relay-entry"
            ? "入口到中转"
            : "中转到落地";
      return `
        <div class="route-tooltip">
          <div class="route-tooltip-title">${escapeHtml(typeLabel)}</div>
          <div class="route-tooltip-row"><span>路径</span><strong>${escapeHtml(`${meta.fromLabel} -> ${meta.toLabel}`)}</strong></div>
          <div class="route-tooltip-row"><span>承载</span><strong>${meta.count} 条链路</strong></div>
        </div>
      `;
    }

    const kindLabel =
      meta.kind === "entry" ? "入口区域" : meta.kind === "relay" ? "中转节点" : "落地国家";
    const detailLabel =
      meta.kind === "entry"
        ? `直连 ${meta.direct} · 中转 ${meta.relay}`
        : meta.kind === "relay"
          ? `${meta.region} · 承载 ${meta.relay}`
          : `直连 ${meta.direct} · 中转 ${meta.relay}`;

    return `
      <div class="route-tooltip">
        <div class="route-tooltip-title">${escapeHtml(meta.label)}</div>
        <div class="route-tooltip-row"><span>类型</span><strong>${escapeHtml(kindLabel)}</strong></div>
        <div class="route-tooltip-row"><span>代码</span><strong>${escapeHtml(meta.code || "--")}</strong></div>
        <div class="route-tooltip-row"><span>节点</span><strong>${meta.total} 台</strong></div>
        <div class="route-tooltip-row"><span>摘要</span><strong>${escapeHtml(detailLabel)}</strong></div>
      </div>
    `;
  }

  function buildRouteChartOption(model) {
    const relayEntryLines = model.lines.filter((line) => line.type === "relay-entry");
    const relayCountryLines = model.lines.filter((line) => line.type === "relay-country");
    const directLines = model.lines.filter((line) => line.type === "direct");
    const maxEntryCount = Math.max(...model.entryPoints.map((item) => item.total), 1);
    const maxRelayCount = Math.max(...model.relayPoints.map((item) => item.total), 1);
    const maxCountryCount = Math.max(...model.countryPoints.map((item) => item.total), 1);

    return {
      backgroundColor: "transparent",
      animationDuration: 700,
      animationDurationUpdate: 400,
      tooltip: {
        trigger: "item",
        confine: true,
        borderWidth: 1,
        borderColor: "rgba(125, 211, 252, 0.16)",
        backgroundColor: "rgba(6, 12, 24, 0.92)",
        textStyle: {
          color: "#e2e8f0",
          fontSize: 12,
        },
        formatter: buildRouteTooltip,
      },
      geo: {
        map: "airport-world",
        roam: true,
        center: [96, 28],
        zoom: 1.12,
        scaleLimit: {
          min: 1,
          max: 5,
        },
        silent: true,
        itemStyle: {
          areaColor: "#071321",
          borderColor: "rgba(123, 151, 182, 0.36)",
          borderWidth: 0.8,
        },
        emphasis: {
          disabled: true,
        },
      },
      series: [
        {
          name: "直连链路",
          type: "lines",
          coordinateSystem: "geo",
          zlevel: 1,
          effect: {
            show: false,
          },
          data: buildLineSeriesData(directLines, {
            color: "rgba(125, 211, 252, 0.42)",
            lineType: "dashed",
            opacity: 0.48,
            curveness: 0.16,
          }),
        },
        {
          name: "入口到中转",
          type: "lines",
          coordinateSystem: "geo",
          zlevel: 2,
          effect: {
            show: relayEntryLines.length > 0,
            constantSpeed: 30,
            trailLength: 0.2,
            symbol: "circle",
            symbolSize: 5,
            color: "#fb923c",
          },
          data: buildLineSeriesData(relayEntryLines, {
            color: "rgba(251, 146, 60, 0.76)",
            curveness: 0.24,
          }),
        },
        {
          name: "中转到落地",
          type: "lines",
          coordinateSystem: "geo",
          zlevel: 2,
          effect: {
            show: relayCountryLines.length > 0,
            constantSpeed: 34,
            trailLength: 0.22,
            symbol: "circle",
            symbolSize: 5,
            color: "#34d399",
          },
          data: buildLineSeriesData(relayCountryLines, {
            color: "rgba(52, 211, 153, 0.68)",
            curveness: 0.24,
          }),
        },
        {
          name: "入口区域",
          type: "effectScatter",
          coordinateSystem: "geo",
          zlevel: 4,
          rippleEffect: {
            scale: 3.2,
            brushType: "stroke",
          },
          itemStyle: {
            color: "#7dd3fc",
            shadowBlur: 18,
            shadowColor: "rgba(125, 211, 252, 0.38)",
          },
          symbolSize(value) {
            return scaleMetric(Number(value?.[2] || 0), maxEntryCount, 8, 18);
          },
          data: buildScatterSeriesData(model.entryPoints),
        },
        {
          name: "中转节点",
          type: "effectScatter",
          coordinateSystem: "geo",
          zlevel: 5,
          rippleEffect: {
            scale: 2.6,
            brushType: "stroke",
          },
          itemStyle: {
            color: "#fb923c",
            shadowBlur: 18,
            shadowColor: "rgba(251, 146, 60, 0.4)",
          },
          symbolSize(value) {
            return scaleMetric(Number(value?.[2] || 0), maxRelayCount, 10, 20);
          },
          data: buildScatterSeriesData(model.relayPoints),
        },
        {
          name: "落地国家",
          type: "scatter",
          coordinateSystem: "geo",
          zlevel: 3,
          itemStyle: {
            color: "#34d399",
            borderColor: "rgba(255, 255, 255, 0.8)",
            borderWidth: 1.2,
            shadowBlur: 12,
            shadowColor: "rgba(52, 211, 153, 0.28)",
          },
          symbolSize(value) {
            return scaleMetric(Number(value?.[2] || 0), maxCountryCount, 7, 16);
          },
          data: buildScatterSeriesData(model.countryPoints),
        },
      ],
    };
  }

  async function ensureWorldMapRegistered() {
    const echartsLib = windowRef.echarts;
    if (!echartsLib) {
      return null;
    }

    if (typeof echartsLib.getMap === "function" && echartsLib.getMap("airport-world")) {
      return echartsLib;
    }

    if (!worldMapPromise) {
      worldMapPromise = fetchImpl("/vendor/echarts/world.json")
        .then((response) => {
          if (!response.ok) {
            throw new Error(`world-map-http-${response.status}`);
          }
          return response.json();
        })
        .then((worldJson) => {
          echartsLib.registerMap("airport-world", worldJson);
          return echartsLib;
        });
    }

    return worldMapPromise;
  }

  function renderMapDiagnostics(model) {
    if (model.unresolvedLabels.length === 0) {
      return `
        <div class="route-map-callout is-success">
          <strong>坐标已就绪</strong>
          <span>当前入口区域、中转区域和落地国家都能落到世界地图上。</span>
        </div>
      `;
    }

    return `
      <div class="route-map-callout is-warning">
        <strong>部分标签暂未落图</strong>
        <span>${escapeHtml(model.unresolvedLabels.slice(0, 4).join(" / "))}${model.unresolvedLabels.length > 4 ? " ..." : ""}</span>
      </div>
    `;
  }

  function renderRouteGraph(nodes) {
    const model = buildRouteMapModel(nodes);
    const relayEntryLines = model.lines.filter((line) => line.type === "relay-entry").length;
    const relayCountryLines = model.lines.filter((line) => line.type === "relay-country").length;
    const directLines = model.lines.filter((line) => line.type === "direct").length;

    return `
      <div class="route-map-shell">
        <div class="route-map-head">
          <div class="route-map-copy">
            <div class="route-map-kicker">World Routing View</div>
            <h3>全球链路图</h3>
            <p>把入口区域、管理好的中转节点和落地国家投到真实世界底图上。橙色代表入口到中转，绿色代表中转到落地，蓝色虚线代表直连。</p>
          </div>
          <div class="route-map-badges">
            <span class="route-map-badge is-entry">入口 ${model.entryPoints.length}</span>
            <span class="route-map-badge is-relay">中转 ${model.relayPoints.length}</span>
            <span class="route-map-badge is-country">落地 ${model.countryPoints.length}</span>
          </div>
        </div>
        <div class="route-map-stage">
          <div class="route-map-canvas-wrap">
            <div class="route-world-map" id="routes-world-map" aria-label="全球链路图"></div>
            <div class="route-map-overlay">
              <div class="route-map-overlay-card">
                <span>中转链路</span>
                <strong>${relayEntryLines + relayCountryLines}</strong>
                <small>入口段 ${relayEntryLines} · 上游段 ${relayCountryLines}</small>
              </div>
              <div class="route-map-overlay-card">
                <span>直连链路</span>
                <strong>${directLines}</strong>
                <small>不经过中转节点的入口到落地链路</small>
              </div>
              ${renderMapDiagnostics(model)}
            </div>
          </div>
          <aside class="route-map-insights">
            <section class="route-map-sidecard">
              <header>
                <span>入口观察</span>
                <strong>当前入口区域</strong>
              </header>
              <div class="event-list compact">
                ${
                  model.entryPoints.length > 0
                    ? model.entryPoints
                        .sort((left, right) => right.total - left.total)
                        .slice(0, 5)
                        .map((entryPoint) => `
                          <div class="event">
                            <strong>${escapeHtml(formatRegionChip(entryPoint.label, "entry"))}</strong>
                            <p>总链路 ${entryPoint.total} · 直连 ${entryPoint.direct} · 中转 ${entryPoint.relay}</p>
                          </div>
                        `)
                        .join("")
                    : '<div class="event"><strong>暂无入口区域数据</strong><p>录入经中转节点后，这里会自动统计不同入口区域的分布。</p></div>'
                }
              </div>
            </section>
            <section class="route-map-sidecard">
              <header>
                <span>落地分布</span>
                <strong>国家密度</strong>
              </header>
              ${renderCountryDistribution(nodes, { limit: 5, compact: true })}
            </section>
          </aside>
        </div>
        <div class="route-map-legend">
          <span><i class="swatch entry"></i>入口区域</span>
          <span><i class="swatch relay"></i>中转节点</span>
          <span><i class="swatch country"></i>落地国家</span>
          <span><i class="swatch line-solid relay-entry"></i>入口到中转</span>
          <span><i class="swatch line-solid relay-country"></i>中转到落地</span>
          <span><i class="swatch line-dashed"></i>直连</span>
        </div>
      </div>
    `;
  }

  async function setupRoutesPage(nodes = []) {
    if (!documentRef || !windowRef) {
      return;
    }

    const chartElement = documentRef.getElementById("routes-world-map");
    if (!chartElement) {
      return;
    }

    if (!windowRef.echarts) {
      chartElement.innerHTML = '<div class="route-map-inline-error">ECharts 资源未加载，全球链路图暂时不可用。</div>';
      return;
    }

    try {
      const echartsLib = await ensureWorldMapRegistered();
      if (!echartsLib) {
        chartElement.innerHTML = '<div class="route-map-inline-error">ECharts 初始化失败，无法创建全球链路图。</div>';
        return;
      }

      const model = buildRouteMapModel(nodes);
      if (routeChart) {
        routeChart.dispose();
      }
      routeChart = echartsLib.init(chartElement, null, { renderer: "canvas" });
      routeChart.setOption(buildRouteChartOption(model), true);
      routeChart.off("click");
      routeChart.on("click", (params) => {
        const meta = params?.data?.meta;
        if (meta?.nodeId) {
          windowRef.location.href = `/node.html?id=${encodeURIComponent(meta.nodeId)}`;
        }
      });

      if (!routeChartResizeHandlerBound) {
        windowRef.addEventListener("resize", () => {
          routeChart?.resize();
        });
        routeChartResizeHandlerBound = true;
      }
    } catch (error) {
      console.error("[routes] failed to initialize world map", error);
      chartElement.innerHTML = '<div class="route-map-inline-error">世界地图资源加载失败，请稍后刷新重试。</div>';
    }
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
                  <div class="route-caption">入口 ${formatRegionChip(group.entryRegion, "entry")}</div>
                  <h3>${escapeHtml(group.relayLabel)}</h3>
                  <p>${escapeHtml(group.relayRegion || "-")} · 承载 ${group.members.length} 台落地节点</p>
                </div>
                <div class="provider-pill">${group.relayNode ? "已绑定节点" : "仅记录标签"}</div>
              </div>
              <div class="route-flow">
                <span class="route-node route-entry">${escapeHtml(formatRegionChip(group.entryRegion, "entry"))}</span>
                <span class="route-arrow">→</span>
                <span class="route-node route-relay">${escapeHtml(group.relayLabel)}</span>
                <span class="route-arrow">→</span>
                <span class="route-node route-exit">落地节点集群</span>
              </div>
              <div class="route-members">
                ${group.members
                  .map((node) => `
                    <a class="route-member" href="/node.html?id=${node.id}">
                      <div class="route-member-meta">
                        <strong>${escapeHtml(getNodeDisplayName(node))}</strong>
                        <span>${escapeHtml(node.labels?.provider || "未标记")} / ${escapeHtml(formatRegionChip(node.labels?.region, "region"))}</span>
                      </div>
                      <div class="route-member-extra">
                        <span class="${statusClassName(node.status)}">${statusText(node.status)}</span>
                        <span class="tiny">${escapeHtml(node.networking?.route_note || formatRouteSummary(node, nodes))}</span>
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

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">经中转节点</div><div class="stat-value">${relayNodes.length}</div><div class="stat-foot">需要先走入口机或香港中转机，再进入落地节点的机器。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">直连节点</div><div class="stat-value">${directNodes.length}</div><div class="stat-foot">可直接从入口区域到达，不依赖中转跳板。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">中转分组</div><div class="stat-value">${relayGroups.length}</div><div class="stat-foot">按中转机归并后的链路组，便于观察单点依赖。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">待补关系</div><div class="stat-value">${unresolvedRelayCount}</div><div class="stat-foot">已标成经中转，但还没有填写明确中转机的节点。</div></div></article>
      </section>
      <section class="panel fade-up routes-map-panel">
        <div class="panel-body">
          ${renderRouteGraph(nodes)}
        </div>
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
    setupRoutesPage,
  };
}
