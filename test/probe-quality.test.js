// src/domain/probes/executor.js 的只读口径固化用例。
// 目标：把「健康分 / 分级阈值边界 / 缺失事实与部分失败降级 / 多探测记录取新口径」写死，
// 本轮**不改任何行为**，所以断言一律以现状为准（含下面标了「现状」的意外口径）。
//
// 注意：这里不触碰任何真实网络与 SSH。
//   - SSH 执行通道由注入的 `spawn` / `resolveNodeSshTransport` 替身提供；
//   - TCP 预检走 `net.Socket`，用桩替掉（executor 是 `new net.Socket()` 延迟取属性，桩可见），
//     所以既不会真连节点，也不会因为 CI 网络策略而抖动；
//   - 延迟来自 `Date.now()`，用「每次调用前进固定步长」的假时钟，得到精确可控的 latency_ms，
//     从而能逐档验证 probeLatencyScore 的阈值边界（每条用例都先断言 latency_ms，
//     假时钟一旦被额外调用就会先在这里红，不会悄悄错判分数）。
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import test from "node:test";

import { createProbeExecutorDomain } from "../src/domain/probes/executor.js";

const OBSERVED_AT = "2026-09-23T08:00:00.000Z";
const SSH_MARKER = "__airport_probe_ok__";

const originalSocket = net.Socket;

function installSteppedClock(stepMs) {
  const realNow = Date.now;
  let current = 1_700_000_000_000;
  Date.now = () => {
    current += stepMs;
    return current;
  };
  return () => {
    Date.now = realNow;
  };
}

class FakeTcpSocket {
  constructor() {
    this.handlers = {};
    this.timeoutMs = null;
  }

  setTimeout(ms) {
    this.timeoutMs = ms;
    return this;
  }

  once(event, callback) {
    this.handlers[event] = callback;
    return this;
  }

  destroy() {
    this.destroyCount = (this.destroyCount ?? 0) + 1;
  }

  connect(options) {
    FakeTcpSocket.attempts.push({ ...options, timeoutMs: this.timeoutMs });
    const behavior = FakeTcpSocket.behaviors.shift() ?? FakeTcpSocket.defaultBehavior;
    process.nextTick(() => {
      if (behavior === "connect") {
        this.handlers.connect();
        return;
      }
      const error = new Error(behavior);
      error.code = behavior;
      this.handlers.error(error);
    });
  }
}

function resetTcpSockets(behaviors = []) {
  FakeTcpSocket.attempts = [];
  FakeTcpSocket.behaviors = behaviors;
  FakeTcpSocket.defaultBehavior = "connect";
}

// 替身进程：spawn 被调用的那一刻才排程事件，保证执行器先挂好监听器。
function fakeChildFactory({ stdoutChunks = [], exitCode = 0, spawnError = null } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      chunks: [],
      write(chunk) {
        this.chunks.push(String(chunk));
      },
      end() {},
      on() {},
    };

    process.nextTick(() => {
      for (const chunk of stdoutChunks) {
        child.stdout.emit("data", Buffer.from(chunk));
      }
      if (spawnError) {
        child.emit("error", spawnError);
        return;
      }
      child.emit("close", exitCode, null);
    });

    return child;
  };
}

function directRoute(overrides = {}) {
  return {
    access_mode: "direct",
    requested_access_mode: "direct",
    target: {
      host: "203.0.113.10",
      port: 22,
      family: "ipv4",
      source: "facts.public_ipv4",
    },
    ssh_user: "root",
    problems: [],
    ...overrides,
  };
}

function relayRoute(overrides = {}) {
  return {
    access_mode: "relay",
    requested_access_mode: "relay",
    target: {
      host: "10.88.0.12",
      port: 22,
      family: "ipv4",
      source: "endpoints.management.internal",
    },
    relay_node: { id: "entry_1" },
    relay_target: { host: "10.88.0.12", port: 22 },
    relay_strategy: "auto",
    problems: [],
    ...overrides,
  };
}

function readySshContext(kind = "ssh") {
  return {
    status: "ready",
    transport: {
      command: "/usr/bin/ssh",
      args: ["-T", "root@203.0.113.10"],
      env: { PATH: "/usr/bin" },
      kind,
      label: kind === "ssh" ? "SSH 直连" : "SSH 中转",
      note: null,
      strategy_requested: "auto",
      strategy_used: "auto",
    },
    relay_target: { host: "10.88.0.12", port: 22 },
    relay_capabilities: null,
  };
}

function skippedSshContext(reasonCode, note = null) {
  return {
    status: "unavailable",
    reason_code: reasonCode,
    note,
    transport: null,
    relay_capabilities: null,
  };
}

function buildBusinessContext(overrides = {}) {
  return {
    published: true,
    access_mode: "direct",
    entry_target: { host: "203.0.113.20", port: 8443, family: "ipv4" },
    route_label: "line-a",
    release_id: "release_1",
    problems: [],
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const state = {
    probeStore: [],
    taskUpserts: [],
    nodeRecords: [],
    persisted: [],
    spawnCalls: [],
    sshTransportRequests: [],
  };

  let uuidCounter = 0;
  const childPlan = overrides.children ?? [fakeChildFactory({ stdoutChunks: [SSH_MARKER], exitCode: 0 })];

  const domain = createProbeExecutorDomain({
    cwdProvider: () => "/tmp",
    defaultNodeSshUser: "root",
    getNodeById: (nodeId) => (nodeId === overrides.missingNodeId ? null : { id: nodeId, name: `node ${nodeId}`, status: "new" }),
    nowIso: () => OBSERVED_AT,
    persistNodeStore: async () => {
      state.persisted.push("nodes");
    },
    persistProbeStore: async () => {
      state.persisted.push("probes");
    },
    persistTaskStore: async () => {
      state.persisted.push("tasks");
    },
    probeStore: state.probeStore,
    probeTcpTimeoutMsValue: overrides.tcpTimeoutMs,
    probeSshTimeoutMsValue: overrides.sshTimeoutMs,
    randomUUID: () => `uuid-${(uuidCounter += 1)}`,
    resolveBusinessProbeContext: overrides.businessContext
      ? () => overrides.businessContext
      : () => null,
    resolveManagementRoute: overrides.managementRoute ?? (() => null),
    resolveNodeSshTransport: async (node, options) => {
      state.sshTransportRequests.push({ nodeId: node?.id ?? null, options });
      if (overrides.entryTransport && node?.id === "entry_1") {
        return overrides.entryTransport;
      }
      return overrides.sshContext ?? skippedSshContext("platform_ssh_key_missing", "缺少平台密钥");
    },
    setNodeRecord: (node) => {
      state.nodeRecords.push(node);
    },
    spawn: (command, args, options) => {
      state.spawnCalls.push({ command, args, options });
      const next = childPlan.shift();
      if (!next) {
        throw new Error("fake spawn called more times than planned");
      }
      return next();
    },
    terminateChildProcess: () => {},
    upsertTaskRecord: (task) => {
      state.taskUpserts.push(task);
    },
  });

  return { domain, state };
}

async function runProbe(harness, probeType, overrides = {}) {
  const task = {
    id: `task_${probeType}`,
    node_id: overrides.nodeId ?? "node_1",
    type: "node_probe",
    payload: { probe_type: probeType },
  };

  const result = await harness.domain.executeProbeTask(task, overrides.options ?? {});
  return { task, ...result };
}

// 每个用例独立安装/卸载桩，避免跨用例污染。
async function withStubs({ latencyMs = 137, behaviors = [] } = {}, run) {
  resetTcpSockets(behaviors);
  net.Socket = FakeTcpSocket;
  const restoreClock = installSteppedClock(latencyMs);
  try {
    return await run();
  } finally {
    restoreClock();
    net.Socket = originalSocket;
  }
}

test("full_stack：管理链路 SSH 接管成功 + 无业务线路时，健康分等于管理分且节点判为 active", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const harness = createHarness({
      managementRoute: relayRoute,
      sshContext: readySshContext("ssh-relay"),
    });

    const { probe, node } = await runProbe(harness, "full_stack");

    // latency 20 → probeLatencyScore 96，control_ready 再 +4 → 封顶 100
    assert.equal(probe.latency_ms, 20);
    assert.equal(probe.latency_source, "management_ssh_e2e");
    assert.equal(probe.health_score, 100);
    assert.equal(node.status, "active");
    assert.equal(probe.success, true);
    assert.equal(probe.control_ready, true);
    // 现状：不适用的探测项写 null（不是 false），与「探过且失败」区分开
    assert.equal(probe.business_ready, null);
    assert.equal(probe.relay_upstream_ready, null);
    assert.equal(probe.reason_code, "management_only_ready");
    assert.equal(probe.error_stage, null);
    assert.equal(probe.error_message, null);
    // relay 模式跳过控制面直连 TCP 预检（不留「未连通」的假失败痕迹）
    assert.equal(probe.stages.management_tcp.attempted, false);
    assert.equal(probe.stages.management_tcp.skipped_reason, "relay_direct_tcp_skipped");
    assert.deepEqual(FakeTcpSocket.attempts, [], "relay 模式不应发起真实 TCP 预检");
    // 权重口径：只有管理链路适用时，combineScores 归一化回单项分
    assert.equal(probe.summary.includes("接管验证成功"), true);
  });
});

test("full_stack：SSH 延迟分档阈值边界（<= 归入较快档，含 +4 封顶与 50 分地板）", async () => {
  const bands = [
    { latencyMs: 60, managementScore: 100 }, // 96 + 4
    { latencyMs: 61, managementScore: 94 }, // 90 + 4
    { latencyMs: 120, managementScore: 94 },
    { latencyMs: 121, managementScore: 86 }, // 82 + 4
    { latencyMs: 250, managementScore: 86 },
    { latencyMs: 251, managementScore: 76 }, // 72 + 4
    { latencyMs: 500, managementScore: 76 },
    { latencyMs: 501, managementScore: 64 }, // 60 + 4
    { latencyMs: 1000, managementScore: 64 },
    { latencyMs: 1001, managementScore: 54 }, // 50 + 4
    { latencyMs: 5000, managementScore: 54 },
  ];

  for (const band of bands) {
    await withStubs({ latencyMs: band.latencyMs }, async () => {
      const harness = createHarness({
        managementRoute: relayRoute,
        sshContext: readySshContext("ssh-relay"),
      });
      const { probe } = await runProbe(harness, "full_stack");

      assert.equal(probe.latency_ms, band.latencyMs, `latency clock drift at ${band.latencyMs}`);
      assert.equal(
        probe.health_score,
        band.managementScore,
        `band boundary mismatch for latency ${band.latencyMs}`,
      );
    });
  }
});

test("full_stack：SSH 接管失败时按 reason_code 分档（62/56/44/36），节点降级为 degraded", async () => {
  const cases = [
    ["platform_ssh_key_missing", 62],
    ["platform_ssh_key_invalid", 56],
    ["ssh_permission_denied", 44],
    ["ssh_probe_failed", 36],
  ];

  for (const [reasonCode, expectedScore] of cases) {
    await withStubs({ latencyMs: 20 }, async () => {
      const harness = createHarness({
        managementRoute: directRoute,
        sshContext: skippedSshContext(reasonCode, `原因 ${reasonCode}`),
      });

      const { probe, node } = await runProbe(harness, "full_stack");

      assert.equal(probe.stages.management_tcp.success, true, "直连 TCP 预检应成功");
      assert.equal(probe.control_ready, false);
      assert.equal(probe.health_score, expectedScore, `score for ${reasonCode}`);
      // 现状：管理链路没接管 = degraded（不是 failed），只有业务/relay 失败才 failed
      assert.equal(node.status, "degraded");
      assert.equal(probe.success, false);
      assert.equal(probe.reason_code, reasonCode);
      assert.equal(probe.error_stage, "ssh_auth", "TCP 通但 SSH 没接管时错误阶段应落到 ssh_auth");
    });
  }
});

test("full_stack：管理 TCP 不通 + 直连模式时健康分 16、error_stage 为 management_tcp", async () => {
  await withStubs({ latencyMs: 20, behaviors: ["ECONNREFUSED"] }, async () => {
    const harness = createHarness({ managementRoute: directRoute });

    const { probe, node } = await runProbe(harness, "full_stack");

    // 直连模式 TCP 预检失败 → SSH 不尝试 → control_ready false → 非 relay → 16
    assert.equal(probe.health_score, 16);
    assert.equal(node.status, "degraded");
    assert.equal(probe.reason_code, "tcp_connection_refused");
    assert.equal(probe.error_stage, "management_tcp");
    assert.equal(probe.error_message, "tcp_connection_refused");
    assert.equal(probe.latency_ms, null);
    assert.equal(probe.latency_source, null);
    assert.equal(probe.stages.ssh.attempted, false);
    assert.equal(probe.stages.ssh.skipped_reason, "tcp_unreachable");
    assert.equal(harness.state.sshTransportRequests.length, 0, "TCP 不通就不该再去建 SSH 通道");
  });
});

test("full_stack：relay 模式管理链路完全没接管时健康分 30、节点 failed", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const harness = createHarness({
      managementRoute: relayRoute,
      sshContext: skippedSshContext("relay_transport_unavailable", "中转不可用"),
    });

    const { probe, node } = await runProbe(harness, "full_stack");

    assert.equal(probe.health_score, 30, "relay 模式未接管固定 30 分");
    assert.equal(node.status, "degraded");
    assert.equal(probe.reason_code, "relay_transport_unavailable");
    assert.equal(probe.stages.ssh.transport_note, null, "现状：跳过的阶段也带完整字段（值为 null）");
  });
});

test("full_stack：业务入口不可达是「部分失败」，整体 failed 且按 35/40/25 权重合分", async () => {
  await withStubs({ latencyMs: 20, behaviors: ["ECONNREFUSED"] }, async () => {
    const harness = createHarness({
      managementRoute: relayRoute,
      sshContext: readySshContext("ssh-relay"),
      businessContext: buildBusinessContext(),
    });

    const { probe, node } = await runProbe(harness, "full_stack");

    // 管理 100*35 + 业务失败 12*40 = 3500+480 → /75 → 53.07 → 53
    assert.equal(probe.health_score, 53);
    assert.equal(node.status, "failed");
    assert.equal(probe.success, false);
    assert.equal(probe.business_ready, false, "业务适用且失败时是 false，不是 null");
    assert.equal(probe.reason_code, "tcp_connection_refused");
    assert.equal(probe.error_stage, "business_entry_tcp");
    assert.equal(probe.stages.business_entry_tcp.attempted, true);
    assert.equal(probe.stages.business_entry_tcp.success, false);
  });
});

test("full_stack：业务入口成功时按 35/40/25 合分，且主延迟优先取业务入口", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const harness = createHarness({
      managementRoute: relayRoute,
      sshContext: readySshContext("ssh-relay"),
      businessContext: buildBusinessContext(),
    });

    const { probe, node } = await runProbe(harness, "full_stack");

    // 管理 100*35 + 业务 (96+0)*40 → (3500+3840)/75 = 97.87 → 98
    assert.equal(probe.health_score, 98);
    assert.equal(node.status, "active");
    assert.equal(probe.success, true);
    assert.equal(probe.business_ready, true);
    assert.equal(probe.latency_ms, 20);
    assert.equal(probe.latency_source, "business_entry_tcp");
    assert.equal(probe.reason_code, "business_route_ready");
    assert.equal(probe.target, "203.0.113.20:8443");
    assert.equal(probe.target_host, "203.0.113.20");
    assert.equal(probe.target_port, 8443);
    assert.equal(probe.access_mode, "direct");
    assert.equal(probe.business_access_mode, "direct");
    assert.equal(probe.management_access_mode, "relay");
    assert.equal(probe.entry_node_id, null);
    assert.equal(probe.route_label, "line-a");
    assert.equal(probe.release_id, "release_1");
  });
});

test("full_stack：relay 上游失败同样把整体压成 failed，并保留上游三元组", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const harness = createHarness({
      managementRoute: relayRoute,
      sshContext: readySshContext("ssh-relay"),
      businessContext: {
        published: true,
        access_mode: "relay",
        entry_target: { host: "203.0.113.20", port: 8443, family: "ipv4" },
        relay_upstream_target: { host: "198.51.100.9", port: 443, family: "ipv4" },
        entry_node: { id: "entry_1", name: "入口机" },
        entry_node_id: "entry_1",
        problems: [],
      },
      // 上游 nc 探测失败（退出码非 0，输出里带 refused）
      children: [
        fakeChildFactory({ stdoutChunks: [SSH_MARKER], exitCode: 0 }),
        fakeChildFactory({ stdoutChunks: ["nc: connect to 198.51.100.9 port 443 (tcp) failed: Connection refused"], exitCode: 1 }),
      ],
      entryTransport: (() => {
        const ctx = readySshContext("ssh-relay");
        ctx.relay_capabilities = { supports_udp: false };
        return ctx;
      })(),
    });

    const { probe, node } = await runProbe(harness, "full_stack");

    assert.equal(node.status, "failed");
    assert.equal(probe.relay_upstream_ready, false);
    assert.equal(probe.error_stage, "relay_upstream_tcp");
    assert.equal(probe.upstream_host, "198.51.100.9");
    assert.equal(probe.upstream_port, 443);
    assert.equal(probe.upstream_family, "ipv4");
    assert.equal(probe.entry_node_id, "entry_1");
    assert.equal(probe.entry_node_name, "入口机");
    // 管理 100*35 + 业务成功 96*40 + relay 失败 10*25 = 3500+3840+250 = 7590/100 → 76
    assert.equal(probe.health_score, 76);
    assert.equal(probe.reason_code, "tcp_connection_refused");
    assert.equal(probe.stages.relay_upstream_tcp.attempted, true);
    assert.equal(probe.stages.relay_upstream_tcp.success, false);
    assert.equal(probe.stages.relay_upstream_tcp.error_message, "tcp_connection_refused");
    assert.equal(probe.error_message, "tcp_connection_refused");
    assert.equal(probe.stderr_excerpt.includes("Connection refused"), true, "原始输出留在 stderr_excerpt");
  });
});

test("full_stack：relay 上游成功按 family 给分（ipv4 84 / ipv6 92）且权重最低", async () => {
  for (const [family, expectedRelayScore] of [
    ["ipv4", 84],
    ["ipv6", 92],
  ]) {
    await withStubs({ latencyMs: 20 }, async () => {
      const harness = createHarness({
        managementRoute: relayRoute,
        sshContext: readySshContext("ssh-relay"),
        businessContext: {
          published: true,
          access_mode: "relay",
          entry_target: { host: "203.0.113.20", port: 8443, family: "ipv4" },
          relay_upstream_target: {
            host: family === "ipv6" ? "2001:db8::9" : "198.51.100.9",
            port: 443,
            family,
          },
          entry_node: { id: "entry_1", facts: { hostname: "entry-host" } },
          entry_node_id: "entry_1",
          problems: [],
        },
        children: [
          fakeChildFactory({ stdoutChunks: [SSH_MARKER], exitCode: 0 }),
          fakeChildFactory({ stdoutChunks: [], exitCode: 0 }),
        ],
        entryTransport: readySshContext("ssh-relay"),
      });

      const { probe, node } = await runProbe(harness, "full_stack");

      assert.equal(probe.relay_upstream_ready, true);
      assert.equal(node.status, "active", "三项全通才是 active");
      assert.equal(probe.success, true);
      // 管理 100*35 + 业务 96*40 + relay expectedRelayScore*25
      const expected = Math.round((3500 + 3840 + expectedRelayScore * 25) / 100);
      assert.equal(probe.health_score, expected);
      assert.equal(probe.upstream_family, family);
      // 现状：入口节点名回退到 facts.hostname（没有 name 字段时）
      assert.equal(probe.entry_node_name, "entry-host");
      // 现状：主延迟优先业务入口，relay 阶段即使有延迟也不当主延迟
      assert.equal(probe.latency_source, "business_entry_tcp");
    });
  }
});

test("full_stack：直连模式只有 TCP 通、SSH 未接管时主延迟回落到 management_tcp", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const harness = createHarness({
      managementRoute: directRoute,
      // reason_code 为 null（宿主没给原因）时才回落到 tcp_only_success
      sshContext: skippedSshContext(null, "未提供原因"),
    });

    const { probe } = await runProbe(harness, "full_stack");

    assert.equal(probe.latency_ms, 20);
    assert.equal(probe.latency_source, "management_tcp");
    // 现状：reason_code 用 tcp_only_success 表达「只确认端口可达」
    assert.equal(probe.reason_code, "tcp_only_success");
  });
});

test("ssh_auth 单项探测：缺少管理地址是最严重的缺失事实（16 分 / failed / target \"-\"）", async () => {
  await withStubs({}, async () => {
    const harness = createHarness({ managementRoute: () => null });

    const { probe, node } = await runProbe(harness, "ssh_auth");

    assert.equal(probe.health_score, 16);
    assert.equal(node.status, "failed");
    assert.equal(probe.success, false);
    assert.equal(probe.reason_code, "probe_target_missing");
    assert.equal(probe.target, "-");
    assert.equal(probe.target_host, null);
    assert.equal(probe.target_port, null);
    assert.equal(probe.stages.tcp.attempted, false);
    assert.equal(probe.stages.tcp.skipped_reason, "probe_target_missing");
    assert.equal(probe.summary, "节点缺少可探测的管理地址。");
    // 现状：管理地址缺失 + problems 时会把问题码拼进 summary
    assert.deepEqual(probe.stages.tcp.relay_capabilities, null);
    assert.equal(probe.auth_method, "publickey");
    assert.equal(probe.ssh_user, "root");
    assert.equal(probe.packet_loss_ratio, null);
    assert.equal(probe.exit_code, null);
  });
});

test("ssh_auth 单项探测：problems 缺失事实要进摘要文案", async () => {
  await withStubs({}, async () => {
    const harness = createHarness({
      managementRoute: () => ({
        access_mode: "direct",
        target: null,
        problems: ["management_host_missing", "management_port_missing"],
      }),
    });

    const { probe } = await runProbe(harness, "ssh_auth");

    assert.equal(
      probe.summary,
      "节点缺少可探测的管理地址（management_host_missing, management_port_missing）。",
    );
    assert.equal(probe.health_score, 16);
  });
});

test("单项探测：不适用项走「默认分」兜底（业务 78 / relay 74），节点仍判 active", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const businessHarness = createHarness({ managementRoute: directRoute });
    const businessRun = await runProbe(businessHarness, "business_entry_tcp");
    assert.equal(businessRun.probe.health_score, 78);
    // 现状（口径不一致，见报告）：单项探测不区分「不适用」与「失败」，
    // allowSkippedSuccess=false → 没配业务线路也记 success false / 节点 failed，分数却给 78 兜底
    assert.equal(businessRun.node.status, "failed");
    assert.equal(businessRun.probe.success, false);
    assert.equal(businessRun.probe.reason_code, "business_entry_target_missing");
    assert.equal(businessRun.probe.business_ready, null);
    assert.equal(
      businessRun.probe.summary,
      "当前业务线路缺少可探测的入口地址或端口。",
    );

    const relayHarness = createHarness({ managementRoute: directRoute });
    const relayRun = await runProbe(relayHarness, "relay_upstream_tcp");
    assert.equal(relayRun.probe.health_score, 74);
    assert.equal(relayRun.node.status, "failed");
    assert.equal(relayRun.probe.success, false);
    assert.equal(relayRun.probe.reason_code, "business_route_unpublished");
    assert.equal(relayRun.probe.summary, "当前节点还没有成功发布的业务线路，已跳过入口上游探测。");
  });
});

test("单项探测：业务线路未发布 vs 缺端口 的 reason_code 口径", async () => {
  const cases = [
    ["business_route_unpublished", "当前节点还没有成功发布的业务线路，已跳过业务入口探测。"],
    ["entry_endpoint_missing", "当前业务线路缺少可探测的入口地址或端口。"],
    ["entry_port_missing", "当前业务线路缺少可探测的入口地址或端口。"],
  ];

  for (const [problem, expectedSummary] of cases) {
    await withStubs({ latencyMs: 20 }, async () => {
      const harness = createHarness({
        managementRoute: directRoute,
        businessContext: {
          published: problem === "business_route_unpublished",
          access_mode: "direct",
          entry_target: null,
          problems: [problem],
        },
      });

      const { probe } = await runProbe(harness, "business_entry_tcp");
      const expectedReason =
        problem === "business_route_unpublished"
          ? "business_route_unpublished"
          : problem === "entry_endpoint_missing"
            ? "business_entry_target_missing"
            : "business_entry_port_missing";

      assert.equal(probe.reason_code, expectedReason);
      assert.equal(probe.summary, expectedSummary);
      assert.equal(probe.health_score, 78, "不适用一律 78 兜底，与 problems 类型无关");
    });
  }
});

test("单项探测：ssh_auth 在 relay 模式未接管时判 failed（与 full_stack 的 degraded 不同）", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const harness = createHarness({
      managementRoute: relayRoute,
      sshContext: skippedSshContext("relay_transport_unavailable"),
    });

    const { probe, node } = await runProbe(harness, "ssh_auth");

    assert.equal(node.status, "failed");
    assert.equal(probe.health_score, 30);
    assert.equal(probe.error_stage, "ssh_auth");
    assert.equal(probe.latency_ms, null, "现状：relay 模式不回退管理 TCP 延迟");
    assert.equal(probe.latency_source, null);
  });
});

test("单项探测：ssh_auth 直连 TCP 通但 SSH 失败时判 degraded", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const harness = createHarness({
      managementRoute: directRoute,
      children: [fakeChildFactory({ stdoutChunks: ["Permission denied (publickey)"], exitCode: 255 })],
      sshContext: readySshContext("ssh"),
    });

    const { probe, node } = await runProbe(harness, "ssh_auth");

    assert.equal(node.status, "degraded");
    assert.equal(probe.control_ready, false);
    assert.equal(probe.health_score, 44, "ssh_permission_denied → 44");
    assert.equal(probe.reason_code, "ssh_permission_denied");
    assert.equal(probe.error_message, "ssh_permission_denied");
    assert.equal(probe.exit_code, 255);
    assert.equal(probe.stderr_excerpt.includes("Permission denied"), true);
  });
});

test("探测记录落库口径：新记录在最前，超过 500 条截断尾部", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const harness = createHarness({ managementRoute: () => null });

    for (let index = 0; index < 502; index += 1) {
      harness.state.probeStore.push({ id: `seed_${index}`, node_id: "node_1", observed_at: OBSERVED_AT });
    }

    await runProbe(harness, "ssh_auth");

    assert.equal(harness.state.probeStore.length, 500);
    assert.equal(harness.state.probeStore[0].probe_type, "ssh_auth");
    assert.equal(harness.state.probeStore[0].id, "probe_uuid-1");
    // 现状：截断只砍数组尾部，seed_0/seed_1 被挤掉，顺序不做重排
    assert.equal(harness.state.probeStore[1].id, "seed_0");
    assert.equal(harness.state.probeStore.at(-1).id, "seed_498");
  });
});

test("任务与节点写回口径：health_score / status / last_probe_at 同步到节点，日志带分数", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const harness = createHarness({
      managementRoute: relayRoute,
      sshContext: readySshContext("ssh-relay"),
    });

    const { task, node } = await runProbe(harness, "full_stack");

    assert.equal(node.health_score, 100);
    assert.equal(node.last_probe_at, OBSERVED_AT);
    assert.equal(node.status, "active");
    assert.equal(task.status, "success");
    assert.equal(task.finished_at, OBSERVED_AT);
    assert.deepEqual(task.log_excerpt, [
      "探测类型 full_stack",
      "目标 10.88.0.12:22",
      task.note,
      "健康分 100，节点状态 active",
    ]);
    assert.equal(harness.state.nodeRecords.length, 1);
    // 现状：写盘顺序 = 任务先写一次，再 Promise.all(probes, tasks, nodes)
    assert.deepEqual(harness.state.persisted, ["tasks", "probes", "tasks", "nodes"]);
  });
});

test("缺失事实降级：节点不存在时不产生探测记录，也不回写节点", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const harness = createHarness({
      managementRoute: relayRoute,
      missingNodeId: "node_1",
    });

    const { task, node, probe } = await runProbe(harness, "full_stack");

    assert.equal(node, null);
    assert.equal(probe, null);
    assert.equal(task.status, "failed");
    assert.equal(task.note, "节点不存在，无法继续执行健康探测。");
    assert.deepEqual(harness.state.probeStore, []);
    assert.deepEqual(harness.state.nodeRecords, []);
    assert.deepEqual(harness.state.persisted, ["tasks"]);
  });
});

test("探测类型未知时静默按 ssh_auth 处理（现状：未知类型不报错）", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const harness = createHarness({ managementRoute: () => null });
    const task = { id: "task_x", node_id: "node_1", payload: { probe_type: "QUIC_BOGUS" } };

    const result = await harness.domain.executeProbeTask(task, {});

    // 现状：未知 probe_type 静默按 ssh_auth 执行，probe_type 字段也被改写成 ssh_auth
    assert.equal(result.probe.probe_type, "ssh_auth");
    assert.equal(result.probe.health_score, 16);
    assert.equal(result.probe.stages.tcp.skipped_reason, "probe_target_missing");
  });
});

test("buildProbeRecord：payload 优先，缺 node/task 时回落为 null，id 缺失才生成", async () => {
  const harness = createHarness();

  const generated = harness.domain.buildProbeRecord(null, null, { reason_code: "x" });
  assert.equal(generated.id, "probe_uuid-1");
  assert.equal(generated.node_id, null);
  assert.equal(generated.task_id, null);
  assert.equal(generated.reason_code, "x");

  const explicit = harness.domain.buildProbeRecord(
    { id: "node_9" },
    { id: "task_9" },
    { id: "probe_keep", node_id: "node_payload" },
  );
  assert.equal(explicit.id, "probe_keep");
  assert.equal(explicit.node_id, "node_payload", "现状：payload 里的 node_id 覆盖入参节点");
  assert.equal(explicit.task_id, "task_9");

  const fromArgs = harness.domain.buildProbeRecord({ id: "node_9" }, { id: "task_9" }, {});
  assert.equal(fromArgs.node_id, "node_9");
  assert.equal(fromArgs.task_id, "task_9");
  assert.equal(fromArgs.id, "probe_uuid-2");
});

test("resolveProbeTarget / resolveBusinessProbeTarget / resolveRelayUpstreamTarget：缺失事实的解析口径", async () => {
  const withContext = createHarness({
    managementRoute: directRoute,
    businessContext: {
      published: true,
      entry_target: { host: "203.0.113.20", port: 8443 },
      relay_upstream_target: { host: "2001:db8::9", port: 443 },
      problems: [],
    },
  });

  const businessTarget = withContext.domain.resolveBusinessProbeTarget({ id: "node_1" });
  assert.equal(businessTarget.family, "ipv4", "现状：缺 family 时按 host 是否含冒号推断");
  assert.equal(businessTarget.access_mode, "direct", "缺 access_mode 时默认 direct");
  assert.equal(businessTarget.source, null);

  const relayTarget = withContext.domain.resolveRelayUpstreamTarget({ id: "node_1" });
  assert.equal(relayTarget.family, "ipv6");
  assert.equal(relayTarget.access_mode, "relay", "relay 上游缺 access_mode 时默认 relay");

  const managementTarget = withContext.domain.resolveProbeTarget({ id: "node_1" });
  assert.equal(managementTarget.host, "203.0.113.10");
  assert.equal(managementTarget.ssh_user, "root");
  assert.deepEqual(managementTarget.strategy_candidates, []);

  const empty = createHarness({
    managementRoute: () => ({ access_mode: "direct", target: {}, problems: ["management_host_missing"] }),
  });
  assert.equal(empty.domain.resolveProbeTarget({ id: "node_1" }), null, "target 无 host 视为没地址");
  assert.equal(empty.domain.resolveBusinessProbeTarget({ id: "node_1" }), null);
  assert.equal(empty.domain.resolveRelayUpstreamTarget({ id: "node_1" }), null);
});

test("超时口径：注入值非法时回落 4000/12000ms", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const fallback = createHarness({
      managementRoute: directRoute,
      tcpTimeoutMs: 0,
      sshTimeoutMs: Number.NaN,
    });
    assert.equal(fallback.domain.sshProbeTimeoutMs(), 12000);

    await runProbe(fallback, "ssh_auth");
    assert.equal(FakeTcpSocket.attempts.length, 1);
    assert.equal(FakeTcpSocket.attempts[0].timeoutMs, 4000);

    const custom = createHarness({ managementRoute: directRoute, tcpTimeoutMs: 1500 });
    await runProbe(custom, "ssh_auth");
    assert.equal(FakeTcpSocket.attempts.at(-1).timeoutMs, 1500);
    assert.equal(custom.domain.sshProbeTimeoutMs(), 12000, "未注入 ssh 超时时回落 12000");
  });
});

test("capability 回读口径：单项 relay 探测的 null 语义", async () => {
  await withStubs({ latencyMs: 20 }, async () => {
    const harness = createHarness({ managementRoute: directRoute });

    const { capability, transport } = await runProbe(harness, "relay_upstream_tcp");

    assert.equal(capability.business_entry_reachable, null);
    assert.equal(capability.relay_upstream_reachable, null, "不适用 → null，不是 false");
    assert.equal(capability.ssh_reachable, false);
    assert.equal(capability.tcp_reachable, false);
    assert.equal(capability.relay_used, false);
    assert.equal(transport, null);
  });
});
