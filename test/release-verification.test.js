import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateDeploymentVerification,
  evaluateReleaseVerification,
  inferBusinessProbeKind,
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
