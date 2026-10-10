import test from "node:test";
import assert from "node:assert/strict";

import {
  formatPrimaryLatency,
  formatNodeLayerAlert,
  formatNodeLayerStatus,
  formatNodeStatusProbeSummary,
  formatProbeLatencyBreakdown,
  formatProbeSummary,
} from "../public/js/shared/probe-formatters.js";

test("probe latency formatters distinguish SSH end-to-end from TCP latency", () => {
  const probe = {
    probe_type: "ssh_auth",
    latency_ms: 220,
    latency_source: "management_ssh_e2e",
    control_ready: true,
    stages: {
      management_tcp: {
        success: true,
        latency_ms: 32,
      },
      ssh: {
        attempted: true,
        success: true,
        latency_ms: 220,
      },
    },
  };

  assert.equal(formatPrimaryLatency(probe), "SSH 端到端 220ms");
  assert.equal(formatProbeSummary(probe), "可接管 · SSH 端到端 220ms");
  assert.equal(formatNodeStatusProbeSummary(probe), "可接管 · 管理 TCP 32ms");
  assert.equal(formatProbeLatencyBreakdown(probe), "管理 TCP 32ms / SSH 端到端 220ms");
});

test("节点分层文案：管理链路正常但业务口不通时要单独报警，管理层故障交给状态徽章", () => {
  const node = {
    status: "active",
    layer_status: {
      observed_at: "2026-10-10T00:00:00.000Z",
      probe_type: "full_stack",
      management: { state: "ready", observed_at: "2026-10-10T00:00:00.000Z", target: "1.1.1.1:22", reason_code: null },
      business: {
        state: "unreachable",
        observed_at: "2026-10-10T00:00:00.000Z",
        target: "1.1.1.1:8443",
        reason_code: "tcp_connection_refused",
      },
      relay_upstream: { state: "not_applicable", observed_at: "2026-10-10T00:00:00.000Z", target: "-", reason_code: null },
      failed_layer: "business",
      reason_code: "tcp_connection_refused",
    },
  };

  assert.equal(formatNodeLayerAlert(node), "业务入口不通 · 端口拒绝");
  assert.equal(formatNodeLayerStatus(node), "管理链路 通 / 业务入口 不通 / 入口上游 不适用");

  node.layer_status.failed_layer = "management";
  assert.equal(formatNodeLayerAlert(node), "", "管理链路故障已经由状态徽章表达，不再叠一层红");

  node.layer_status.failed_layer = "relay_upstream";
  node.layer_status.relay_upstream = {
    state: "unreachable",
    observed_at: "2026-10-10T00:00:00.000Z",
    target: "198.51.100.9:443",
    reason_code: "relay_upstream_probe_failed",
  };
  assert.equal(formatNodeLayerAlert(node), "入口上游不通 · 入口到上游探测失败");

  assert.equal(formatNodeLayerAlert({ status: "new" }), "");
  assert.equal(formatNodeLayerStatus({ status: "new" }), "");
});
