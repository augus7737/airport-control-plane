import test from "node:test";
import assert from "node:assert/strict";

import {
  formatPrimaryLatency,
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
