import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleLayerStatus,
  buildApplicabilityLayerReading,
  buildManagementLayerReading,
  normalizeNodeLayerStatus,
} from "../src/domain/probes/layer-status.js";

const OBSERVED_AT = "2026-10-10T00:00:00.000Z";
const EARLIER_AT = "2026-10-09T00:00:00.000Z";

test("分层读数：management 只看 control_ready，业务/relay 先问适用性", () => {
  assert.equal(buildManagementLayerReading({ control_ready: true }, OBSERVED_AT).state, "ready");
  assert.equal(
    buildManagementLayerReading({ control_ready: false, reason_code: "ssh_timeout" }, OBSERVED_AT).state,
    "unreachable",
  );

  const notApplicable = buildApplicabilityLayerReading({ applicable: false, success: false }, OBSERVED_AT);
  assert.equal(notApplicable.state, "not_applicable");
  assert.equal(notApplicable.reason_code, null, "不适用不是故障，不该带失败原因");
  assert.equal(notApplicable.observed_at, OBSERVED_AT);

  assert.equal(buildApplicabilityLayerReading({}, OBSERVED_AT).state, "unknown");
  assert.equal(buildApplicabilityLayerReading({}, OBSERVED_AT).observed_at, null);

  const unreachable = buildApplicabilityLayerReading(
    {
      applicable: true,
      success: false,
      target: { host: "2001:db8::1", port: 8443, family: "ipv6" },
      tcp: { error_message: "ECONNREFUSED" },
    },
    OBSERVED_AT,
  );
  assert.equal(unreachable.state, "unreachable");
  assert.equal(unreachable.target, "[2001:db8::1]:8443");
  assert.equal(unreachable.reason_code, "ECONNREFUSED");
});

test("分层合并：本次只覆盖取证的层，失败层按管理 > 业务 > 上游取第一个", () => {
  const previous = {
    observed_at: EARLIER_AT,
    probe_type: "full_stack",
    management: { state: "ready", observed_at: EARLIER_AT, target: "10.0.0.1:22", reason_code: null },
    business: { state: "unknown", observed_at: null, target: "-", reason_code: null },
    relay_upstream: { state: "unknown", observed_at: null, target: "-", reason_code: null },
    failed_layer: null,
    reason_code: null,
  };

  const merged = assembleLayerStatus({
    observedAt: OBSERVED_AT,
    probeType: "business_entry_tcp",
    previous,
    readings: {
      business: { state: "unreachable", observed_at: OBSERVED_AT, target: "1.2.3.4:8443", reason_code: "tcp_timeout" },
    },
  });

  assert.equal(merged.observed_at, OBSERVED_AT);
  assert.equal(merged.probe_type, "business_entry_tcp");
  assert.deepEqual(merged.management, previous.management, "没取证的层保持原读数与原时间");
  assert.equal(merged.business.state, "unreachable");
  assert.equal(merged.relay_upstream.state, "unknown");
  assert.equal(merged.failed_layer, "business");
  assert.equal(merged.reason_code, "tcp_timeout");

  const bothFailed = assembleLayerStatus({
    observedAt: OBSERVED_AT,
    probeType: "full_stack",
    previous,
    readings: {
      business: { state: "unreachable", observed_at: OBSERVED_AT, target: "1.2.3.4:8443", reason_code: "tcp_timeout" },
      management: { state: "unreachable", observed_at: OBSERVED_AT, target: "10.0.0.1:22", reason_code: "ssh_timeout" },
    },
  });
  assert.equal(bothFailed.failed_layer, "management", "节点状态跟管理链路，失败层也要跟");
  assert.equal(bothFailed.reason_code, "ssh_timeout");
});

test("分层读数落库前归一：伪造或损坏的层状态一律丢掉", () => {
  assert.equal(normalizeNodeLayerStatus(null), null);
  assert.equal(normalizeNodeLayerStatus("ready"), null);
  assert.equal(normalizeNodeLayerStatus({ business: { state: "ready" } }).business.state, "ready");
  assert.equal(
    normalizeNodeLayerStatus({ business: { state: "everything_is_fine" } }).business.state,
    "unknown",
  );
  assert.equal(normalizeNodeLayerStatus({ failed_layer: "management " }).failed_layer, "management");
  assert.equal(normalizeNodeLayerStatus({ failed_layer: "businesss" }).failed_layer, null);

  const normalized = normalizeNodeLayerStatus({
    observed_at: OBSERVED_AT,
    probe_type: "full_stack",
    management: { state: "ready", observed_at: OBSERVED_AT, target: "10.0.0.1:22", reason_code: "  " },
    business: { state: "unreachable", observed_at: OBSERVED_AT, target: "1.2.3.4:8443", reason_code: "tcp_timeout" },
    relay_upstream: { state: "not_applicable", observed_at: OBSERVED_AT, target: "-", reason_code: null },
    failed_layer: "business",
    reason_code: "tcp_timeout",
  });
  assert.equal(normalized.management.reason_code, null, "空白原因不落库");
  assert.equal(normalized.business.reason_code, "tcp_timeout");
  assert.equal(normalized.relay_upstream.state, "not_applicable");
});
