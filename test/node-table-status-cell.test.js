import test from "node:test";
import assert from "node:assert/strict";

import { escapeHtml } from "../public/js/shared/core-formatters.js";
import { formatNodeLayerAlert } from "../public/js/shared/probe-formatters.js";
import { createNodeTableCellsModule } from "../public/js/components/node-table-cells.js";

const layerStatus = (failedLayer) => ({
  observed_at: "2026-10-10T08:15:21.785Z",
  probe_type: "full_stack",
  management: { state: "ready", observed_at: "2026-10-10T08:15:21.785Z", target: "1.1.1.1:22", reason_code: null },
  business: {
    state: "unreachable",
    observed_at: "2026-10-10T08:15:21.785Z",
    target: "1.1.1.1:8443",
    reason_code: "tcp_connection_refused",
  },
  relay_upstream: {
    state: "not_applicable",
    observed_at: "2026-10-10T08:15:21.785Z",
    target: "-",
    reason_code: "relay_not_applicable",
  },
  failed_layer: failedLayer,
  reason_code: failedLayer === "business" ? "tcp_connection_refused" : "ssh_control_unreachable",
});

function renderNode(node, probe) {
  const { renderNodeStatusCell } = createNodeTableCellsModule({
    escapeHtml,
    formatProbeCapability: () => "巡检能力",
    formatProbeLatencyBreakdown: () => "",
    formatProbeLongSummary: () => "详细说明",
    formatProbeStageCompact: () => "阶段摘要",
    formatProbeSummary: () => "摘要",
    formatNodeStatusProbeSummary: () => "管理已通 / 入口异常 · 管理 TCP 374ms",
    formatProbeType: () => "综合巡检",
    formatRelativeTime: () => "43 分钟前",
    getLatestProbeForNode: () => probe,
    getProbeSchedulerState: () => ({ enabled: false }),
    statusClassName: (status) => `badge-${status}`,
    statusText: (status) => status,
  });

  return renderNodeStatusCell(node);
}

test("节点状态格把分层告警单独成行，不再和探测摘要拼进同一个截断容器", () => {
  const html = renderNode({ status: "active", layer_status: layerStatus("business") }, { observed_at: "x" });
  const alert = formatNodeLayerAlert({ status: "active", layer_status: layerStatus("business") });

  assert.equal(alert, "业务入口不通 · 端口拒绝");
  assert.match(html, new RegExp(`<span class="status-layer-alert">${alert}</span>`));

  const subline = html.match(/<span class="status-subline">([\s\S]*?)<\/span>/)[1];
  assert.doesNotMatch(subline, /业务入口不通/, "探测摘要不再携带告警，否则开头会被 ellipsis 吃掉");
  assert.equal(subline, "管理已通 / 入口异常 · 管理 TCP 374ms");
});

test("管理层故障不叠告警：徽章已经表达了", () => {
  const html = renderNode({ status: "degraded", layer_status: layerStatus("management") }, { observed_at: "x" });

  assert.doesNotMatch(html, /status-layer-alert/);
});

test("没有分层读数时状态格保持原样（未复验过的节点不编造告警）", () => {
  const html = renderNode({ status: "new" }, null);

  assert.doesNotMatch(html, /status-layer-alert/);
  assert.match(html, /<span class="status-subline">待首检<\/span>/);
});
