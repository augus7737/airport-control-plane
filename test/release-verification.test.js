import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateDeploymentVerification,
  evaluateReleaseVerification,
  inferBusinessProbeKind,
  resolveDeploymentOutcome,
} from "../src/domain/releases/verification.js";

const tcpRelease = {
  id: "release_tcp",
  profile: {
    protocol: "vless",
    transport: "tcp",
  },
  routes: [
    {
      node_id: "node_1",
      entry_endpoint: "203.0.113.10",
      entry_port: 443,
    },
  ],
};

const tcpDeployment = {
  node_id: "node_1",
  artifacts: {
    sing_box: {
      rendered_config: {
        inbounds: [{ type: "vless", listen_port: 443 }],
      },
      manifest: {
        profile: {
          protocol: "vless",
          transport: "tcp",
        },
      },
    },
  },
};

test("rendered_only target is partial and never counts as applied success", () => {
  const result = evaluateDeploymentVerification({
    release: tcpRelease,
    deployment: tcpDeployment,
    operationTarget: {
      node_id: "node_1",
      status: "success",
      output: [
        "[publish] stage=rendered",
        "[publish] validation=passed",
        "[publish] activation=service_missing",
        "[publish] result=rendered_only",
      ],
    },
    checks: {
      business_entry_tcp: {
        success: true,
        latency_ms: 31,
        endpoint: { host: "203.0.113.10", port: 443 },
      },
    },
    subscription: {
      endpoint: { host: "203.0.113.10", port: 443 },
    },
  });

  assert.equal(result.status, "partial");
  assert.equal(result.success, false);
  assert.equal(result.applied, false);
  assert.equal(result.failures.some((item) => item.reason_code === "rendered_only_not_applied"), true);
});

test("applied TCP release succeeds only after business probe and subscription entry match", () => {
  const result = evaluateDeploymentVerification({
    release: tcpRelease,
    deployment: tcpDeployment,
    operationTarget: {
      node_id: "node_1",
      status: "success",
      output: [
        "[publish] stage=rendered",
        "[publish] validation=passed",
        "[publish] activation=running",
        "[publish] result=applied",
      ],
    },
    checks: {
      business_entry_tcp: {
        success: true,
        latency_ms: 28,
        endpoint: { host: "203.0.113.10", port: 443 },
      },
    },
    subscription: {
      endpoint: { host: "203.0.113.10", port: 443 },
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.applied, true);
  assert.equal(result.business_entry_ready, true);
  assert.deepEqual(result.failures, []);
});

test("a rendered-only component cannot be hidden by a later applied component", () => {
  const result = evaluateDeploymentVerification({
    release: tcpRelease,
    deployment: tcpDeployment,
    operationTarget: {
      node_id: "node_1",
      status: "success",
      output: [
        "[publish] stage=rendered",
        "[publish] validation=skipped",
        "[publish] result=rendered_only",
        "[publish] stage=rendered",
        "[publish] validation=passed",
        "[publish] activation=running",
        "[publish] result=applied",
      ],
    },
    checks: { business_entry_tcp: { success: true } },
  });

  assert.equal(result.status, "partial");
  assert.equal(result.applied, false);
  assert.equal(result.failures.some((item) => item.reason_code === "rendered_only_not_applied"), true);
});

test("Hysteria2 requires UDP/QUIC business verification instead of TCP-only success", () => {
  const release = {
    id: "release_hy2",
    profile: {
      protocol: "hysteria2",
      transport: "udp",
    },
    routes: [
      {
        node_id: "node_hy2",
        entry_endpoint: "198.51.100.8",
        entry_port: 8443,
      },
    ],
  };
  const deployment = {
    node_id: "node_hy2",
    artifacts: {
      sing_box: {
        rendered_config: {
          inbounds: [{ type: "hysteria2", listen_port: 8443 }],
        },
        manifest: {
          profile: {
            protocol: "hysteria2",
            transport: "udp",
          },
        },
      },
    },
  };

  assert.equal(inferBusinessProbeKind({ release, deployment }), "udp_quic");

  const tcpOnly = evaluateDeploymentVerification({
    release,
    deployment,
    operationTarget: {
      node_id: "node_hy2",
      status: "success",
      output: [
        "[publish] stage=rendered",
        "[publish] validation=passed",
        "[publish] activation=running",
        "[publish] result=applied",
      ],
    },
    checks: {
      business_entry_tcp: {
        success: true,
        latency_ms: 35,
      },
    },
  });

  assert.equal(tcpOnly.status, "failed");
  assert.equal(
    tcpOnly.failures.some((item) => item.reason_code === "business_entry_wrong_protocol_probe"),
    true,
  );

  const udpQuic = evaluateDeploymentVerification({
    release,
    deployment,
    operationTarget: {
      node_id: "node_hy2",
      status: "success",
      output: [
        "[publish] stage=rendered",
        "[publish] validation=passed",
        "[publish] activation=running",
        "[publish] result=applied",
      ],
    },
    checks: {
      business_entry_udp_quic: {
        success: true,
        latency_ms: 37,
      },
    },
  });

  assert.equal(udpQuic.status, "success");
});

test("subscription entry mismatch fails an otherwise applied deployment", () => {
  const result = evaluateDeploymentVerification({
    release: tcpRelease,
    deployment: tcpDeployment,
    operationTarget: {
      node_id: "node_1",
      status: "success",
      output: [
        "[publish] stage=rendered",
        "[publish] validation=passed",
        "[publish] activation=running",
        "[publish] result=applied",
      ],
    },
    checks: {
      business_entry_tcp: {
        success: true,
      },
    },
    subscription: {
      endpoint: { host: "203.0.113.11", port: 443 },
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failures.some((item) => item.reason_code === "subscription_entry_mismatch"), true);
});

test("release verification aggregates success, partial and failed deployments", () => {
  const release = {
    ...tcpRelease,
    routes: [
      ...tcpRelease.routes,
      {
        node_id: "node_2",
        entry_endpoint: "203.0.113.20",
        entry_port: 443,
      },
    ],
    deployments: [
      tcpDeployment,
      {
        ...tcpDeployment,
        node_id: "node_2",
      },
    ],
  };
  const operation = {
    targets: [
      {
        node_id: "node_1",
        status: "success",
        output: [
          "[publish] stage=rendered",
          "[publish] validation=passed",
          "[publish] activation=running",
          "[publish] result=applied",
        ],
      },
      {
        node_id: "node_2",
        status: "success",
        output: [
          "[publish] stage=rendered",
          "[publish] validation=passed",
          "[publish] result=rendered_only",
        ],
      },
    ],
  };

  const result = evaluateReleaseVerification({
    release,
    operation,
    checksByNodeId: {
      node_1: {
        business_entry_tcp: { success: true },
      },
      node_2: {
        business_entry_tcp: { success: true },
      },
    },
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(result.summary, {
    total: 2,
    success: 1,
    partial: 1,
    failed: 0,
  });
  assert.equal(result.failures.some((item) => item.node_id === "node_2"), true);
});

// ---- 生效层 / 可达层分层（判定口径 C，见 verification.js 的 EFFECTIVENESS_CHECK_NAMES 注释） ----

const appliedTarget = {
  node_id: "node_1",
  status: "success",
  output: [
    "[publish] stage=rendered",
    "[publish] validation=passed",
    "[publish] activation=running",
    "[publish] result=applied",
  ],
};

function appliedWithBusinessProbe(probe) {
  return evaluateDeploymentVerification({
    release: tcpRelease,
    deployment: tcpDeployment,
    operationTarget: appliedTarget,
    checks: { business_entry_tcp: probe },
    subscription: { endpoint: { host: "203.0.113.10", port: 443 } },
  });
}

test("配置已生效但业务端口不可达：整体复检失败，生效层仍判成功", () => {
  const result = appliedWithBusinessProbe({ success: false, reason_code: "business_entry_tcp_failed" });

  assert.equal(result.status, "failed", "verification.status 保留含可达层的完整结论");
  assert.equal(result.effectiveness_status, "success");
  assert.equal(result.reachability_status, "failed");

  const outcome = resolveDeploymentOutcome(result);
  assert.equal(outcome.status, "success", "release/deployment/task 一律按生效层收口");
  assert.equal(outcome.reachability, "failed");
  assert.match(outcome.note, /配置已生效/);
  assert.match(outcome.note, /business_entry_tcp_failed/);
});

test("业务入口复检缺失或未跑：可达层 partial，不改生效层成败", () => {
  const result = evaluateDeploymentVerification({
    release: tcpRelease,
    deployment: tcpDeployment,
    operationTarget: appliedTarget,
    checks: {},
    subscription: { endpoint: { host: "203.0.113.10", port: 443 } },
  });

  assert.equal(result.reachability_status, "partial");
  assert.equal(result.effectiveness_status, "success");
  assert.match(resolveDeploymentOutcome(result).note, /未通过或未完成/);
});

test("订阅入口不一致属于生效层，仍然阻断成败", () => {
  const result = evaluateDeploymentVerification({
    release: tcpRelease,
    deployment: tcpDeployment,
    operationTarget: appliedTarget,
    checks: { business_entry_tcp: { success: true } },
    subscription: { endpoint: { host: "203.0.113.99", port: 443 } },
  });

  assert.equal(result.effectiveness_status, "failed");
  const outcome = resolveDeploymentOutcome(result);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.note, /发布后复检失败: subscription_entry_mismatch/);
});

test("rendered_only 属生效层未完成，不会被可达层成功掩盖", () => {
  const result = evaluateDeploymentVerification({
    release: tcpRelease,
    deployment: tcpDeployment,
    operationTarget: { ...appliedTarget, output: ["[publish] result=rendered_only"] },
    checks: { business_entry_tcp: { success: true } },
    subscription: { endpoint: { host: "203.0.113.10", port: 443 } },
  });

  assert.equal(result.effectiveness_status, "partial");
  const outcome = resolveDeploymentOutcome(result);
  assert.equal(outcome.status, "partial");
  assert.match(outcome.note, /发布后复检未完成/);
  assert.match(outcome.note, /rendered_only_not_applied/);
});

test("resolveDeploymentOutcome 复检结果缺失时按失败收口", () => {
  assert.deepEqual(resolveDeploymentOutcome(undefined), {
    status: "failed",
    reachability: "skipped",
    note: "发布后复检缺失: verification_missing",
  });
});

test("逐节点全生效但可达性有失败时，聚合层给出 effectiveness=success + reachability 告警", () => {
  const release = {
    ...tcpRelease,
    deployments: [tcpDeployment],
  };
  const result = evaluateReleaseVerification({
    release,
    operation: { targets: [appliedTarget] },
    checksByNodeId: {
      node_1: { business_entry_tcp: { success: false, reason_code: "connection_refused" } },
    },
    subscriptionsByNodeId: { node_1: { endpoint: { host: "203.0.113.10", port: 443 } } },
    requireSubscriptionConsistency: true,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.effectiveness_status, "success");
  assert.equal(result.reachability_status, "failed");
  assert.deepEqual(
    result.reachability_failures.map((item) => `${item.node_id}:${item.reason_code}`),
    ["node_1:connection_refused"],
  );
});

