import { formatLocationDisplay } from "../shared/location-suggestions.js";
import {
  formatCostStatus,
  formatCurrencyTotals,
} from "../shared/cost-formatters.js";

export function createNodeTableCellsModule(dependencies = {}) {
  const {
    daysUntil,
    escapeHtml,
    formatAccessMode,
    formatDate,
    formatExpiryCountdown,
    formatProbeCapability,
    formatProbeLongSummary,
    formatProbeStageCompact,
    formatProbeSummary,
    formatProbeType,
    formatRelativeTime,
    formatRenewal,
    formatRouteSummary,
    formatTraffic,
    getAccessMode,
    getExpiryTone,
    getLatestProbeForNode,
    getNodeCountry,
    getNodeCostSnapshot,
    getNodeDisplayName,
    getProbeSchedulerState,
    getRouteNodes,
    nodeDetailHref,
    nodeShellHref,
    renderNodeConfigurationCell,
    renderPublicIpCell,
    statusClassName,
    statusText,
  } = dependencies;

  function renderNodeStatusCell(node) {
    const latestProbe = getLatestProbeForNode(node);
    const scheduler = typeof getProbeSchedulerState === "function" ? getProbeSchedulerState() : null;
    const subline = latestProbe ? formatProbeSummary(latestProbe) : "待首检";
    const timeLabel = latestProbe?.observed_at
      ? formatRelativeTime(latestProbe.observed_at)
      : node.last_probe_at
        ? formatRelativeTime(node.last_probe_at)
        : "尚未探测";
    const nodeStatus = String(node?.status || "new").toLowerCase();
    const schedulerEnabled = Boolean(scheduler?.enabled);
    const nextProbeAt =
      schedulerEnabled &&
      ["active", "degraded", "failed"].includes(nodeStatus) &&
      node.last_probe_at &&
      Number.isFinite(Number(scheduler?.interval_ms))
        ? new Date(Date.parse(node.last_probe_at) + Number(scheduler.interval_ms)).toISOString()
        : null;

    return `
      <div class="cell-hover-card status-cell-card">
        <div class="status-cell-compact">
          <span class="${statusClassName(node.status)}">${statusText(node.status)}</span>
          <span class="status-subline">${escapeHtml(subline)}</span>
        </div>
        <div class="cell-hover-panel">
          <div class="cell-hover-title-row">
            <div class="cell-hover-title">最近探测</div>
            <span class="${statusClassName(node.status)}">${statusText(node.status)}</span>
          </div>
          <div class="cell-hover-grid">
            <div class="cell-hover-row">
              <span>探测类型</span>
              <strong>${escapeHtml(latestProbe ? formatProbeType(latestProbe) : "暂无记录")}</strong>
            </div>
            <div class="cell-hover-row">
              <span>巡检状态</span>
              <strong>${escapeHtml(formatProbeCapability(latestProbe))}</strong>
            </div>
            <div class="cell-hover-row">
              <span>阶段摘要</span>
              <strong>${escapeHtml(formatProbeStageCompact(latestProbe))}</strong>
            </div>
            <div class="cell-hover-row">
              <span>详细说明</span>
              <strong>${escapeHtml(formatProbeLongSummary(latestProbe))}</strong>
            </div>
            <div class="cell-hover-row">
              <span>最近时间</span>
              <strong>${escapeHtml(timeLabel)}</strong>
            </div>
            ${
              schedulerEnabled
                ? `
                  <div class="cell-hover-row">
                    <span>巡检调度</span>
                    <strong>${escapeHtml(scheduler.running ? "本轮执行中" : "已开启")}</strong>
                  </div>
                  <div class="cell-hover-row">
                    <span>下一轮预计</span>
                    <strong>${escapeHtml(nextProbeAt ? formatRelativeTime(nextProbeAt) : scheduler.next_run_at ? formatRelativeTime(scheduler.next_run_at) : "等待调度")}</strong>
                  </div>
                `
                : ""
            }
          </div>
        </div>
      </div>
    `;
  }

  function renderNodeIdentityCell(node, options = {}) {
    const variant = options.variant || "ledger";
    const provider = node.labels?.provider || "未标记";
    const region = formatLocationDisplay(node.labels?.region, { scope: "region", style: "compact" });
    const accessMode = formatAccessMode(getAccessMode(node));
    const subline = variant === "preview" ? `${provider} / ${region} · ${accessMode}` : node.id;

    return `
      <div class="node-meta">
        <a class="node-name" href="/node.html?id=${node.id}">${getNodeDisplayName(node)}</a>
        <span class="node-id ${variant === "preview" ? "" : "mono"}">${escapeHtml(subline)}</span>
      </div>
    `;
  }

  function renderNodePlacementCell(node) {
    const provider = node.labels?.provider || "未标记厂商";
    const region = formatLocationDisplay(node.labels?.region, {
      scope: "region",
      style: "compact",
      fallback: "未标记区域",
    });
    const accessMode = formatAccessMode(getAccessMode(node));
    const country = getNodeCountry(node);
    const routeSummary = formatRouteSummary(node, getRouteNodes());

    return `
      <div class="cell-hover-card placement-cell-card">
        <div class="node-meta node-meta-placement">
          <span class="node-name">${escapeHtml(provider)}</span>
          <span class="node-id">${escapeHtml(`${region} · ${accessMode}`)}</span>
        </div>
        <div class="cell-hover-panel">
          <div class="cell-hover-title">接入归属</div>
          <div class="cell-hover-grid">
            <div class="cell-hover-row">
              <span>云厂商</span>
              <strong>${escapeHtml(provider)}</strong>
            </div>
            <div class="cell-hover-row">
              <span>标签区域</span>
              <strong>${escapeHtml(region)}</strong>
            </div>
            <div class="cell-hover-row">
              <span>落地国家</span>
              <strong>${escapeHtml(country)}</strong>
            </div>
            <div class="cell-hover-row">
              <span>接入方式</span>
              <strong>${escapeHtml(accessMode)}</strong>
            </div>
            <div class="cell-hover-row">
              <span>链路摘要</span>
              <strong>${escapeHtml(routeSummary)}</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderNodeAssetCell(node, options = {}) {
    const compact = options.compact ?? false;
    const expiryDays = daysUntil(node.commercial?.expires_at);
    const expiryTone = getExpiryTone(expiryDays);
    const expiryLabel = formatExpiryCountdown(expiryDays);
    const renewal = formatRenewal(node.commercial?.auto_renew);
    const bandwidth = node.commercial?.bandwidth_mbps ? `${node.commercial.bandwidth_mbps} Mbps` : "未记录";
    const traffic = formatTraffic(node.commercial?.traffic_used_gb, node.commercial?.traffic_quota_gb);
    const costSnapshot =
      typeof getNodeCostSnapshot === "function" ? getNodeCostSnapshot(node.id) : null;
    const costLabel = costSnapshot
      ? formatCurrencyTotals(
          costSnapshot,
          costSnapshot.problems?.[0] || "待补",
        )
      : "待补";
    const costStatus = formatCostStatus(costSnapshot?.cost_status);
    const inlineMeta = compact ? renewal : [renewal, bandwidth].filter(Boolean).join(" · ");

    return `
      <div class="cell-hover-card asset-cell-card">
        <div class="asset-cell-inline">
          <span class="asset-expiry-pill tone-${expiryTone}">${escapeHtml(expiryLabel)}</span>
          <span class="asset-inline-note">${escapeHtml([inlineMeta, `月成本 ${costLabel}`].filter(Boolean).join(" · "))}</span>
        </div>
        <div class="cell-hover-panel">
          <div class="cell-hover-title">资产信息</div>
          <div class="cell-hover-grid">
            <div class="cell-hover-row">
              <span>到期日期</span>
              <strong>${escapeHtml(formatDate(node.commercial?.expires_at))}</strong>
            </div>
            <div class="cell-hover-row">
              <span>剩余时间</span>
              <strong>${escapeHtml(expiryLabel)}</strong>
            </div>
            <div class="cell-hover-row">
              <span>续费方式</span>
              <strong>${escapeHtml(renewal)}</strong>
            </div>
            <div class="cell-hover-row">
              <span>带宽</span>
              <strong>${escapeHtml(bandwidth)}</strong>
            </div>
            <div class="cell-hover-row">
              <span>流量</span>
              <strong>${escapeHtml(traffic)}</strong>
            </div>
            <div class="cell-hover-row">
              <span>月成本</span>
              <strong>${escapeHtml(costLabel)}</strong>
            </div>
            <div class="cell-hover-row">
              <span>成本状态</span>
              <strong>${escapeHtml(costStatus)}</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderNodeTableActions(node, options = {}) {
    return `
      <div class="table-actions node-table-actions">
        <a class="table-action-primary table-action-shell" href="${nodeShellHref(node.id)}">终端</a>
        <a class="table-action-pill" href="${nodeDetailHref(node.id)}">详情</a>
      </div>
    `;
  }

  function nodeTable(nodes, options = {}) {
    const variant = options.variant || "ledger";
    const showPlacement = options.showPlacement ?? variant !== "preview";
    const colgroup =
      variant === "preview"
        ? `
            <colgroup>
              <col style="width:22%">
              <col style="width:18%">
              <col style="width:18%">
              <col style="width:14%">
              <col style="width:16%">
              <col style="width:12%">
            </colgroup>
          `
        : `
            <colgroup>
              <col style="width:17%">
              <col style="width:15%">
              <col style="width:15%">
              <col style="width:16%">
              <col style="width:12%">
              <col style="width:13%">
              <col style="width:12%">
            </colgroup>
          `;
    const rows = nodes
      .map(
        (node) => `
          <tr>
            <td>${renderNodeIdentityCell(node, { variant })}</td>
            <td>${renderNodeStatusCell(node)}</td>
            ${showPlacement ? `<td>${renderNodePlacementCell(node)}</td>` : ""}
            <td>${renderPublicIpCell(node)}</td>
            <td>${renderNodeConfigurationCell(node)}</td>
            <td>${renderNodeAssetCell(node, { compact: variant === "preview" })}</td>
            <td>${renderNodeTableActions(node, { variant })}</td>
          </tr>
        `,
      )
      .join("");

    return `
      <div class="table-shell">
        <table class="list-table ${variant === "preview" ? "list-table-preview" : "list-table-ledger"}">
          ${colgroup}
          <thead>
            <tr>
              <th>节点</th>
              <th>状态</th>
              ${showPlacement ? "<th>归属</th>" : ""}
              <th>公网地址</th>
              <th>配置</th>
              <th>资产</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  return {
    nodeTable,
    renderNodeAssetCell,
    renderNodeIdentityCell,
    renderNodePlacementCell,
    renderNodeStatusCell,
    renderNodeTableActions,
  };
}
