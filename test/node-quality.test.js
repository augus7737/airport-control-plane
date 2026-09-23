// src/domain/diagnostics/node-quality.js 的只读口径固化用例。
// 覆盖：资源/依赖分级阈值边界（静态预检 + 运行时预检）、缺失事实与部分失败的降级、
// 报告解析与摘要拼接、时间戳排序与并列稳定性、?node_id= 过滤语义、store 取新与截断。
//
// 全部走注入依赖：spawn 是假进程（不落真实 SSH、不执行任何真脚本），
// resolveNodeSshTransport 是假通道，nowIso / randomUUID 受控，所以阈值能逐档断言。
// 断言一律以现状为准，意外口径在注释里标「现状」——本轮不改任何行为。
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createNodeDiagnosticsDomain } from "../src/domain/diagnostics/node-quality.js";

const BASE_TIME = 1_700_000_000_000;

function makeNowIso(start = BASE_TIME) {
  let cursor = start;
  return () => {
    cursor += 1;
    return new Date(cursor).toISOString();
  };
}

const metaLine = (key, value) => `__AIRPORT_DIAG__meta ${key}=${value}\n`;
const sectionLine = (section, key, value) => `__AIRPORT_DIAG__section ${section} ${key}=${value}\n`;
const b64 = (value) => Buffer.from(String(value), "utf8").toString("base64");

function preflightOutput(meta = {}) {
  return Object.entries(meta)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => metaLine(key, value))
    .join("");
}

function sectionOutput(section, fields = {}) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => sectionLine(section, key, String(value)))
    .join("");
}

const READY_META = {
  mem_total_mb: "4096",
  mem_available_mb: "2048",
  cpu_count: "4",
  load1: "0.20",
  tmp_free_mb: "512",
  root_free_mb: "8192",
  virtualization: "none",
  has_bash: "1",
  has_curl: "1",
  has_jq: "1",
  has_nexttrace: "1",
};

const LIGHT_OK =
  sectionOutput("hardware", { status: "success", report_url_b64: b64("https://hw.report/ok.svg") }) +
  sectionOutput("ip", { status: "success", report_url_b64: b64("https://ip.report/ok.svg") });
const DEEP_OK = sectionOutput("net", { status: "success", report_url_b64: b64("https://net.report/ok.svg") });

function buildNode(overrides = {}) {
  return {
    id: "node_1",
    name: "HK-1",
    facts: {},
    ...overrides,
  };
}

// 按脚本内容分派响应：预检脚本认 has_nexttrace，档位脚本认 run_check。
function respondWith({
  preflightMeta,
  preflightExit = 0,
  preflightError = null,
  sections = "",
  profileExit = 0,
} = {}) {
  return (script) => {
    if (script.includes("has_nexttrace")) {
      if (preflightError) {
        return { error: preflightError };
      }
      return { stdout: [preflightOutput(preflightMeta ?? READY_META)], exitCode: preflightExit };
    }
    return { stdout: [sections], exitCode: profileExit };
  };
}

function createHarness(overrides = {}) {
  const state = {
    diagnosticStore: overrides.diagnosticStore ?? [],
    taskUpserts: [],
    persisted: [],
    spawnRequests: [],
    transportRequests: [],
  };

  let uuidCounter = 0;
  const node = overrides.node ?? buildNode();

  const domain = createNodeDiagnosticsDomain({
    cwdProvider: () => "/tmp",
    defaultNodeSshUser: "ops",
    diagnosticStore: state.diagnosticStore,
    getNodeById: (nodeId) => (overrides.missingNodeId === nodeId ? null : node),
    nowIso: makeNowIso(overrides.nowStart ?? BASE_TIME),
    persistDiagnosticStore: async () => {
      state.persisted.push("diagnostics");
    },
    persistTaskStore: async () => {
      state.persisted.push("tasks");
    },
    randomUUID: () => `uuid-${(uuidCounter += 1)}`,
    resolveNodeSshTransport: async (requestNode, options) => {
      state.transportRequests.push({ nodeId: requestNode?.id ?? null, options });
      return (
        overrides.sshContext ?? {
          status: "ready",
          transport: {
            command: "ssh",
            args: ["-T", "ops@10.0.0.1"],
            env: { PATH: "/usr/bin" },
            kind: "ssh",
            label: "SSH 直连",
            note: null,
          },
        }
      );
    },
    buildTaskRecord: (taskNode, payload) => ({
      id: `task_${payload.type}_${taskNode.id}`,
      node_id: taskNode.id,
      ...payload,
    }),
    spawn: (command, args, options) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        write(chunk) {
          const response = overrides.respond
            ? overrides.respond(String(chunk), state.spawnRequests.length)
            : { stdout: [""], exitCode: 0 };
          state.spawnRequests.push({ command, args, options });
          process.nextTick(() => {
            for (const chunkText of response.stdout ?? []) {
              child.stdout.emit("data", Buffer.from(chunkText));
            }
            for (const chunkText of response.stderr ?? []) {
              child.stderr.emit("data", Buffer.from(chunkText));
            }
            if (response.error) {
              child.emit("error", response.error);
              return;
            }
            child.emit("close", response.exitCode ?? 0, response.signal ?? null);
          });
        },
        end() {},
        on() {},
      };
      return child;
    },
    terminateChildProcess: () => {},
    upsertTaskRecord: (task) => {
      state.taskUpserts.push(task);
    },
  });

  return { domain, state, node };
}

async function flushAsync(rounds = 40) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// 走真实的 triggerDiagnostic 入口：领域执行是后台补写的，所以要等一轮再读终态。
async function triggerAndWait(overrides, options = {}) {
  const harness = createHarness(overrides);
  const run = await harness.domain.triggerDiagnostic(overrides.node ?? buildNode(), options);
  await flushAsync();
  return {
    ...harness,
    run,
    record: harness.state.diagnosticStore[0],
    task: harness.state.taskUpserts.at(-1),
  };
}

// ---------- 读侧：?node_id= 过滤 / 排序 / 取新 ----------

test("listDiagnostics：未知 node_id 返回空数组（现状：不是 404，也不是 null）", () => {
  const { domain } = createHarness({
    diagnosticStore: [{ id: "diag_a", node_id: "node_1", started_at: "2026-09-23T00:00:00.000Z" }],
  });

  assert.deepEqual(domain.listDiagnostics("missing-node"), []);
  assert.deepEqual(domain.listDiagnostics(""), domain.listDiagnostics(null), "空串等价于不过滤");
  assert.deepEqual(domain.listDiagnostics("node_1").map((item) => item.id), ["diag_a"]);
});

test("listDiagnostics：不过滤时返回整表副本并按时间倒序，不就地重排 store", () => {
  const store = [
    { id: "diag_old", node_id: "node_1", started_at: "2026-09-20T00:00:00.000Z" },
    { id: "diag_new", node_id: "node_2", started_at: "2026-09-23T00:00:00.000Z" },
    { id: "diag_mid", node_id: "node_1", started_at: "2026-09-21T00:00:00.000Z" },
  ];
  const { domain } = createHarness({ diagnosticStore: store });

  assert.deepEqual(domain.listDiagnostics(null).map((item) => item.id), ["diag_new", "diag_mid", "diag_old"]);
  assert.notEqual(domain.listDiagnostics(null), store, "必须返回排序后的副本");
  assert.deepEqual(store.map((item) => item.id), ["diag_old", "diag_new", "diag_mid"], "原 store 不能被就地重排");
  assert.deepEqual(domain.listDiagnostics("node_1").map((item) => item.id), ["diag_mid", "diag_old"]);
});

test("sortDiagnostics：started_at 缺失（含 0 / 空串）才回退 created_at，两者都缺沉到最后", () => {
  const { domain } = createHarness();

  const sorted = domain.sortDiagnostics([
    { id: "both_missing" },
    { id: "created_only", created_at: "2026-09-22T00:00:00.000Z" },
    { id: "blank_started", started_at: "", created_at: "2026-09-25T00:00:00.000Z" },
    { id: "started_wins", started_at: "2026-09-24T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z" },
    { id: "zero_started", started_at: 0, created_at: "2026-09-23T00:00:00.000Z" },
  ]);

  assert.deepEqual(sorted.map((item) => item.id), [
    "blank_started",
    "started_wins",
    "zero_started",
    "created_only",
    "both_missing",
  ]);
  assert.deepEqual(domain.sortDiagnostics(), [], "现状：默认参数是空数组，不抛错");
});

test("sortDiagnostics：时间戳完全相同的记录保持入参相对顺序（并列稳定）", () => {
  const { domain } = createHarness();
  const stamp = "2026-09-23T08:00:00.000Z";

  const sorted = domain.sortDiagnostics([
    { id: "first", started_at: stamp },
    { id: "second", started_at: stamp },
    { id: "third", started_at: stamp },
  ]);

  assert.deepEqual(sorted.map((item) => item.id), ["first", "second", "third"]);
});

test("sortDiagnostics：非法时间戳不做校验，按字典序参与排序（现状）", () => {
  const { domain } = createHarness();

  const sorted = domain.sortDiagnostics([
    { id: "iso", started_at: "2026-09-23T10:00:00.000Z" },
    { id: "junk", started_at: "not-a-date" },
    { id: "empty", started_at: null },
  ]);

  // 倒序按字符串比较："not-a-date" > "2026-..."，所以非法值反而排在最前。
  assert.deepEqual(sorted.map((item) => item.id), ["junk", "iso", "empty"]);
  assert.deepEqual(
    domain
      .sortDiagnostics([
        { id: "sep", started_at: "2026-9-23" },
        { id: "oct", started_at: "2026-10-01" },
      ])
      .map((item) => item.id),
    ["sep", "oct"],
    "现状：未补零的时间戳按字符序比较，2026-9-23 被当成大于 2026-10-01，倒序结果不保证时间单调",
  );
});

test("upsertDiagnosticRecord：命中 id 原位替换、新 id 插到最前、updated_at 总是刷新", () => {
  const { domain, state } = createHarness({
    diagnosticStore: [
      { id: "diag_new", node_id: "node_1", status: "running", updated_at: "2026-01-01T00:00:00.000Z" },
      { id: "diag_old", node_id: "node_1", status: "success", updated_at: "2026-01-01T00:00:00.000Z" },
    ],
  });

  const updated = domain.upsertDiagnosticRecord({ id: "diag_old", node_id: "node_1", status: "failed" });
  assert.equal(updated.status, "failed");
  assert.notEqual(updated.updated_at, "2026-01-01T00:00:00.000Z", "updated_at 由注入的 nowIso 刷新");
  assert.deepEqual(
    state.diagnosticStore.map((item) => item.id),
    ["diag_new", "diag_old"],
    "更新不移动位置：数组顺序 ≠ 时间顺序，读侧必须重新排序",
  );

  domain.upsertDiagnosticRecord({ id: "diag_fresh", node_id: "node_2" });
  assert.equal(state.diagnosticStore[0].id, "diag_fresh");
});

test("upsertDiagnosticRecord：store 超过 200 条按数组尾部截断（现状：按插入位置不按时间）", () => {
  const store = Array.from({ length: 200 }, (unused, index) => ({
    id: `diag_${index}`,
    node_id: "node_1",
    started_at: new Date(BASE_TIME + index * 1000).toISOString(),
    updated_at: "2026-01-01T00:00:00.000Z",
  }));
  const { domain } = createHarness({ diagnosticStore: store });

  domain.upsertDiagnosticRecord({ id: "diag_overflow", node_id: "node_1" });

  assert.equal(store.length, 200);
  assert.equal(store[0].id, "diag_overflow");
  assert.equal(store.some((item) => item.id === "diag_199"), false, "现状：被挤掉的是数组末尾那条");
});

// ---------- 记录 / 任务构造口径 ----------

test("buildDiagnosticRecord：profile 归一化（除 deep 外全归 light），默认字段为「执行中」", () => {
  const { domain } = createHarness();
  const task = { id: "task_1" };

  const deep = domain.buildDiagnosticRecord(buildNode({ facts: { public_ipv4: "203.0.113.5" } }), task, {
    profile: " DEEP ",
  });
  assert.equal(deep.profile, "deep", "现状：trim + 小写后等于 deep 才算 deep");
  assert.equal(deep.provider, "nodequality");
  assert.equal(deep.status, "running");
  assert.equal(deep.result_quality, null);
  assert.equal(deep.host_group_key, "203.0.113.5");
  assert.deepEqual(deep.reports, { hardware: null, ip: null, net: null });
  assert.deepEqual(deep.guard, { static_blockers: [], runtime_blockers: [], warnings: [] });
  assert.equal(deep.preflight, null);
  assert.equal(deep.transport, null);
  assert.equal(deep.finished_at, null);
  assert.equal(deep.created_at, deep.started_at, "现状：created_at 与 started_at 同值");
  assert.equal(deep.id, "diag_uuid-1");
  assert.equal(deep.summary, "深度诊断已开始，正在做资源与依赖预检。");

  for (const profile of ["light", "Light", "standard", "", null, undefined, "deepish"]) {
    assert.equal(domain.buildDiagnosticRecord(buildNode(), task, { profile }).profile, "light", `profile=${String(profile)}`);
  }

  const fromTask = domain.buildDiagnosticRecord(buildNode({ id: "node_9" }), { id: "task_9", payload: { profile: "deep" } }, {});
  assert.equal(fromTask.profile, "deep", "options 缺 profile 时回读 task.payload.profile");
  assert.equal(fromTask.node_id, "node_9");
  assert.equal(fromTask.task_id, "task_9");
  assert.equal(fromTask.summary, "深度诊断已开始，正在做资源与依赖预检。", "现状：摘要看的是归一化后的档位");
  assert.equal(
    domain.buildDiagnosticRecord(buildNode(), { id: "task_9", payload: { profile: "deep" } }, { profile: "light" }).summary,
    "轻量诊断已开始，正在做资源与依赖预检。",
    "options 里的 profile 优先于 task.payload.profile",
  );
});

test("host_group_key 取新口径：public_ipv4 > private_ipv4 > public_ipv6 > management.ssh_host > node id", () => {
  const { domain } = createHarness();

  const cases = [
    [{ facts: { public_ipv4: "1.1.1.1", private_ipv4: "10.0.0.1" } }, "1.1.1.1"],
    [{ facts: { private_ipv4: "10.0.0.1", public_ipv6: "2001:db8::1" } }, "10.0.0.1"],
    [{ facts: { public_ipv6: "2001:db8::1" }, management: { ssh_host: "198.51.100.2" } }, "2001:db8::1"],
    [{ management: { ssh_host: "198.51.100.2" } }, "198.51.100.2"],
    [{ id: "node_fallback" }, "node_fallback"],
  ];

  for (const [node, expected] of cases) {
    assert.equal(
      domain.buildDiagnosticRecord({ id: "node_1", facts: {}, ...node }, { id: "task" }, {}).host_group_key,
      expected,
    );
  }

  assert.equal(
    domain.buildDiagnosticRecord({ id: "node_1", facts: { public_ipv4: "   " } }, { id: "task" }, {}).host_group_key,
    "node_1",
    "现状：空白 facts 被忽略；非字符串（例如数字型 IP）同样被丢弃后回退到 node id",
  );
});

test("buildDiagnosticTask：标题/说明按档位区分，trigger 与 reason 有默认值", () => {
  const { domain } = createHarness();

  const light = domain.buildDiagnosticTask(buildNode(), {});
  assert.equal(light.type, "node_diagnostic");
  assert.equal(light.title, "轻量诊断");
  assert.equal(light.status, "running");
  assert.equal(light.trigger, "manual_diagnostic");
  assert.equal(light.payload.profile, "light");
  assert.equal(light.payload.provider, "nodequality");
  assert.equal(light.payload.reason, "manual_diagnostic");
  assert.equal(light.note.includes("资源校验"), true);

  const deep = domain.buildDiagnosticTask(buildNode(), { profile: "deep", trigger: "auto", reason: "degraded" });
  assert.equal(deep.title, "深度诊断");
  assert.equal(deep.trigger, "auto");
  assert.equal(deep.payload.reason, "degraded");
  assert.equal(deep.note.includes("资源保护校验"), true);
});

// ---------- triggerDiagnostic：并发保护 + 后台补写 ----------

test("triggerDiagnostic：同节点已有 queued/running 记录时抛中文标签", async () => {
  for (const status of ["queued", "running"]) {
    const { domain, state } = createHarness({
      diagnosticStore: [{ id: "diag_busy", node_id: "node_1", status, profile: "light", host_group_key: "node_1" }],
      missingNodeId: "node_1",
    });

    await assert.rejects(() => domain.triggerDiagnostic(buildNode(), {}), (error) => {
      assert.equal(error.message, "当前节点已有诊断任务在执行");
      return true;
    }, `现状：${status} 也算占用`);
    assert.equal(state.diagnosticStore.length, 1, "被拒绝时不应写入新记录");
  }
});

test("triggerDiagnostic：deep 受同宿主互斥、light 不受；完成态不互斥", async () => {
  const doneStore = [
    { id: "diag_done", node_id: "node_2", status: "success", profile: "deep", host_group_key: "203.0.113.5" },
  ];
  const doneHarness = createHarness({ diagnosticStore: doneStore, missingNodeId: "node_1" });
  const allowed = await doneHarness.domain.triggerDiagnostic(
    buildNode({ facts: { public_ipv4: "203.0.113.5" } }),
    { profile: "deep" },
  );
  assert.equal(allowed.diagnostic.profile, "deep");
  assert.equal(allowed.diagnostic.status, "running");
  await flushAsync();

  const busyStore = [
    { id: "diag_other", node_id: "node_2", status: "running", profile: "deep", host_group_key: "203.0.113.5" },
  ];
  const blockedHarness = createHarness({ diagnosticStore: busyStore, missingNodeId: "node_1" });
  await assert.rejects(
    () => blockedHarness.domain.triggerDiagnostic(buildNode({ facts: { public_ipv4: "203.0.113.5" } }), { profile: "DEEP" }),
    (error) => {
      assert.equal(error.message, "同一公网入口宿主已有深度诊断在执行");
      return true;
    },
  );

  const lightHarness = createHarness({ diagnosticStore: busyStore, missingNodeId: "node_1" });
  const lightRun = await lightHarness.domain.triggerDiagnostic(
    buildNode({ facts: { public_ipv4: "203.0.113.5" } }),
    { profile: "light" },
  );
  assert.equal(lightRun.diagnostic.profile, "light");
  assert.equal(lightHarness.state.diagnosticStore.length, 2);
  assert.equal(lightHarness.state.diagnosticStore[0].id, "diag_uuid-1");
  await flushAsync();
});

test("triggerDiagnostic 现状：响应快照恒为 running，真实失败由后台补写", async () => {
  const harness = createHarness({ missingNodeId: "node_1" });

  const { task, diagnostic } = await harness.domain.triggerDiagnostic(buildNode(), {});
  assert.equal(diagnostic.status, "running", "接口拿到的快照对象恒为 running");
  assert.equal(task.status, "running");
  // 现状：同步失败路径在 triggerDiagnostic 返回前就已经把 store 里的记录改成 failed，
  // 但响应体用的是快照对象引用 —— 二者不是同一个对象，前端会先看到 running。
  assert.notEqual(diagnostic, harness.state.diagnosticStore[0], "现状：响应快照与 store 记录不是同一引用");
  assert.equal(harness.state.diagnosticStore[0].status, "failed");

  await flushAsync();

  const finalRecord = harness.state.diagnosticStore[0];
  assert.equal(finalRecord.status, "failed");
  assert.equal(finalRecord.result_quality, "failed");
  assert.equal(finalRecord.summary, "节点不存在，无法继续执行诊断。", "现状：节点被删后异步降级为 failed");
  // 现状：upsert 会再刷一次 updated_at，所以 finished_at 严格早于 updated_at
  assert.ok(finalRecord.finished_at < finalRecord.updated_at);
  assert.deepEqual(harness.state.taskUpserts.at(-1).log_excerpt, ["诊断档位 light", "节点不存在，无法继续执行诊断。"]);
  assert.equal(harness.state.taskUpserts.at(-1).status, "failed");
});

test("缺失事实降级：预检通道 error 事件也只归到 diagnostic_preflight_failed，原始信息留在日志", async () => {
  const { record, task } = await triggerAndWait({
    respond: respondWith({ preflightError: new Error("通道被重置") }),
  }, { profile: "light" });

  assert.equal(record.status, "failed");
  assert.equal(record.summary, "节点预检失败，未能完成资源与依赖校验");
  assert.equal(record.preflight, null);
  // 现状：preflight 失败只进 summary / task.log_excerpt，guard.runtime_blockers 保持空数组
  assert.deepEqual(record.guard.runtime_blockers, []);
  assert.equal(task.log_excerpt.at(-1).includes("通道被重置"), true, "现状：spawn error 原文进 log_excerpt 末行");
});

// ---------- 静态预检阈值（资源分级边界） ----------

test("静态预检：轻量档内存 255 阻断 / 256 放行（严格小于，边界值放行）", async () => {
  const cases = [
    [255, true],
    [256, false],
    ["128", true],
    ["1024MB", false],
    [null, false],
    ["abc", false],
  ];

  for (const [memoryMb, expectBlocked] of cases) {
    const { record } = await triggerAndWait(
      { node: buildNode({ facts: { memory_mb: memoryMb } }), respond: respondWith({ sections: LIGHT_OK }) },
      { profile: "light" },
    );

    if (expectBlocked) {
      assert.equal(record.status, "failed", `${String(memoryMb)}MB 应被阻断`);
      assert.deepEqual(record.guard.static_blockers, ["diagnostic_light_memory_too_low"]);
      assert.equal(record.summary, "轻量诊断要求节点至少 256MB 内存");
    } else {
      assert.deepEqual(record.guard.static_blockers, [], `${String(memoryMb)} 不应被阻断`);
      assert.equal(record.status, "success");
    }
  }
});

test("静态预检现状：内存/磁盘事实缺失或非法不阻断（宁放行的降级）", async () => {
  const { record } = await triggerAndWait(
    { node: buildNode({ facts: { memory_mb: "", disk_gb: undefined } }), respond: respondWith({ sections: DEEP_OK }) },
    { profile: "deep" },
  );

  assert.deepEqual(record.guard.static_blockers, []);
  assert.equal(record.status, "success", "缺失事实不会挡住深度诊断");
});

test("静态预检：深度档内存 1023/1024、磁盘 4/5、warning 阈值 1536 的边界表", async () => {
  const cases = [
    {
      facts: { memory_mb: 1023, disk_gb: 20 },
      blockers: ["diagnostic_deep_memory_too_low"],
      warnings: ["深度诊断会持续数分钟，建议避开业务高峰。"],
    },
    { facts: { memory_mb: 1024, disk_gb: 4 }, blockers: ["diagnostic_deep_disk_too_low"], warnings: ["深度诊断会持续数分钟，建议避开业务高峰。"] },
    { facts: { memory_mb: 2048, disk_gb: 4 }, blockers: ["diagnostic_deep_disk_too_low"], warnings: [] },
    { facts: { memory_mb: 2048, disk_gb: 5 }, blockers: [], warnings: [] },
    { facts: { memory_mb: 1535, disk_gb: 5 }, blockers: [], warnings: ["深度诊断会持续数分钟，建议避开业务高峰。"] },
    { facts: { memory_mb: 1536, disk_gb: 5 }, blockers: [], warnings: [] },
    {
      facts: { memory_mb: 512, disk_gb: 1 },
      blockers: ["diagnostic_deep_memory_too_low", "diagnostic_deep_disk_too_low"],
      warnings: ["深度诊断会持续数分钟，建议避开业务高峰。"],
    },
  ];

  for (const testCase of cases) {
    const { record } = await triggerAndWait(
      { node: buildNode({ facts: testCase.facts }), respond: respondWith({ sections: DEEP_OK }) },
      { profile: "deep" },
    );

    assert.deepEqual(record.guard.static_blockers, testCase.blockers, JSON.stringify(testCase.facts));
    assert.deepEqual(record.guard.warnings, testCase.warnings, JSON.stringify(testCase.facts));
    assert.equal(record.status, testCase.blockers.length > 0 ? "failed" : "success");
  }
});

test("静态阻断时 summary 用中文标签拼接，且连 SSH 通道都不建立", async () => {
  const { record, task, state } = await triggerAndWait(
    { node: buildNode({ facts: { memory_mb: 512, disk_gb: 1 } }), respond: respondWith({ sections: DEEP_OK }) },
    { profile: "deep" },
  );

  assert.equal(record.summary, "深度诊断要求节点至少 1GB 内存；深度诊断要求节点至少 5GB 磁盘");
  assert.deepEqual(state.spawnRequests, [], "现状：静态阻断不执行任何远程脚本");
  assert.deepEqual(state.transportRequests, []);
  assert.equal(task.status, "failed");
  assert.equal(task.log_excerpt[0], "诊断档位 deep");
  assert.equal(task.log_excerpt[1], record.summary);
  assert.equal(task.log_excerpt[2], "阻断原因 深度诊断要求节点至少 1GB 内存；深度诊断要求节点至少 5GB 磁盘");
  assert.equal(record.result_quality, "failed");
});

test("静态阈值只作用于对应档位：light 档不看磁盘、不做 1536 warning", async () => {
  const { record } = await triggerAndWait(
    { node: buildNode({ facts: { memory_mb: 512, disk_gb: 1 } }), respond: respondWith({ sections: LIGHT_OK }) },
    { profile: "light" },
  );

  assert.deepEqual(record.guard.static_blockers, []);
  assert.deepEqual(record.guard.warnings, []);
  assert.equal(record.status, "success");
});

// ---------- 运行时预检阈值（依赖与负载分级） ----------

test("运行时预检：has_bash/has_curl 只认文本 \"1\"，其它写法一律阻断", async () => {
  for (const value of ["0", "01", "true", "yes", "", "null"]) {
    const { record } = await triggerAndWait({
      respond: respondWith({
        preflightMeta: { ...READY_META, has_bash: value, has_curl: undefined },
        sections: LIGHT_OK,
      }),
    }, { profile: "light" });

    assert.equal(record.status, "failed", `has_bash=${String(value)} 应阻断`);
    assert.deepEqual(record.guard.runtime_blockers, ["diagnostic_bash_missing", "diagnostic_curl_missing"]);
    assert.equal(
      record.summary,
      "节点缺少 bash，暂时无法运行 NodeQuality 脚本；节点缺少 curl，暂时无法拉取诊断脚本",
    );
  }

  // 现状：解析器会 trim 整行，所以 "1 " 与 "1" 等价；判定发生在文本层面，
  // 数字 1 序列化后同样是 "1"，只有真正不等于 "1" 的写法才算缺依赖。
  const trailingSpace = await triggerAndWait({
    respond: respondWith({
      preflightMeta: { ...READY_META, has_bash: "1 ", has_curl: undefined },
      sections: LIGHT_OK,
    }),
  }, { profile: "light" });
  assert.deepEqual(trailingSpace.record.guard.runtime_blockers, ["diagnostic_curl_missing"]);

  // 现状：判定发生在「预检脚本文本」层面，数字 1 序列化后就是 "1"，与字符串等价
  const numericOne = await triggerAndWait({
    respond: respondWith({
      preflightMeta: { ...READY_META, has_bash: 1, has_curl: undefined },
      sections: LIGHT_OK,
    }),
  }, { profile: "light" });
  assert.deepEqual(numericOne.record.guard.runtime_blockers, ["diagnostic_curl_missing"]);
});

test("运行时预检：轻量档可用内存 95/96 与 /tmp 127/128 的边界", async () => {
  const cases = [
    { meta: { mem_available_mb: "95" }, blocked: true },
    { meta: { mem_available_mb: "96" }, blocked: false },
    { meta: { tmp_free_mb: "127" }, blocked: true },
    { meta: { tmp_free_mb: "128" }, blocked: false },
    { meta: { mem_available_mb: "" }, blocked: false },
    { meta: { tmp_free_mb: null }, blocked: false },
  ];

  for (const testCase of cases) {
    const { record } = await triggerAndWait({
      respond: respondWith({ preflightMeta: { ...READY_META, ...testCase.meta }, sections: LIGHT_OK }),
    }, { profile: "light" });

    const blockers = record.guard.runtime_blockers;
    assert.equal(
      blockers.includes("diagnostic_memory_available_too_low") ||
        blockers.includes("diagnostic_tmp_free_too_low"),
      testCase.blocked,
      JSON.stringify(testCase.meta),
    );
  }
});

test("运行时预检：深度档 256/256 + jq/nexttrace 依赖 + 负载 1.2/1.75 分档", async () => {
  const blocked = await triggerAndWait({
    respond: respondWith({
      preflightMeta: {
        ...READY_META,
        mem_available_mb: "255",
        tmp_free_mb: "255",
        has_jq: "0",
        has_nexttrace: "0",
        load1: "7.1",
      },
      sections: DEEP_OK,
    }),
  }, { profile: "deep" });

  assert.deepEqual(blocked.record.guard.runtime_blockers, [
    "diagnostic_memory_available_too_low",
    "diagnostic_tmp_free_too_low",
    "diagnostic_jq_missing",
    "diagnostic_nexttrace_missing",
    "diagnostic_load_too_high",
  ]);
  assert.deepEqual(blocked.record.guard.warnings, [], "现状：负载判定是 if/else，阻断时不再给 warning");
  assert.equal(blocked.record.status, "failed");
  assert.equal(
    blocked.record.summary,
    "当前可用内存过低，已停止诊断以避免卡死；当前 /tmp 可用空间不足，已停止诊断；深度诊断依赖 jq；深度诊断依赖 nexttrace；当前节点负载过高，建议低峰期再运行深度诊断",
  );

  const warned = await triggerAndWait({
    respond: respondWith({ preflightMeta: { ...READY_META, load1: "5" }, sections: DEEP_OK }),
  }, { profile: "deep" });
  assert.deepEqual(warned.record.guard.runtime_blockers, []);
  assert.deepEqual(warned.record.guard.warnings, ["当前节点负载偏高，深度诊断结果可能受影响。"]);
  assert.equal(warned.record.status, "success", "现状：负载偏高只 warning，不阻断执行");

  const atWarnThreshold = await triggerAndWait({
    respond: respondWith({ preflightMeta: { ...READY_META, load1: "4.8" }, sections: DEEP_OK }),
  }, { profile: "deep" });
  assert.deepEqual(atWarnThreshold.record.guard.warnings, [], "现状：load 恰好 = cpu*1.2 不告警（严格大于）");

  const atBlockThreshold = await triggerAndWait({
    respond: respondWith({ preflightMeta: { ...READY_META, load1: "7" }, sections: DEEP_OK }),
  }, { profile: "deep" });
  assert.deepEqual(atBlockThreshold.record.guard.runtime_blockers, [], "现状：load 恰好 = cpu*1.75 不阻断（严格大于）");

  const cpuMissing = await triggerAndWait({
    respond: respondWith({ preflightMeta: { ...READY_META, cpu_count: "0", load1: "2" }, sections: DEEP_OK }),
  }, { profile: "deep" });
  assert.equal(cpuMissing.record.preflight.cpu_count, 1, "现状：cpu_count 缺失或 0 时按 1 核折算");
  assert.deepEqual(cpuMissing.record.guard.runtime_blockers, ["diagnostic_load_too_high"]);

  const loadMissing = await triggerAndWait({
    respond: respondWith({ preflightMeta: { ...READY_META, load1: undefined }, sections: DEEP_OK }),
  }, { profile: "deep" });
  assert.deepEqual(loadMissing.record.guard.runtime_blockers, [], "现状：load 读不出来时不阻断");
  assert.equal(loadMissing.record.preflight.load1, null);
});

test("运行时预检：light 档不检查 jq/nexttrace/负载", async () => {
  const { record } = await triggerAndWait({
    respond: respondWith({
      preflightMeta: { ...READY_META, has_jq: "0", has_nexttrace: "0", load1: "99" },
      sections: LIGHT_OK,
    }),
  }, { profile: "light" });

  assert.deepEqual(record.guard.runtime_blockers, []);
  assert.equal(record.status, "success");
});

test("运行时快照落库口径：数字归一化、非法值落 null、空白 virtualization 转 null", async () => {
  const { record } = await triggerAndWait({
    respond: respondWith({
      preflightMeta: {
        mem_total_mb: "4096.7",
        mem_available_mb: "N/A",
        cpu_count: "2",
        load1: "abc",
        tmp_free_mb: "300",
        root_free_mb: "",
        virtualization: "  ",
        has_bash: "1",
        has_curl: "1",
      },
      sections: LIGHT_OK,
    }),
  }, { profile: "light" });

  assert.deepEqual(record.preflight, {
    mem_total_mb: 4096,
    mem_available_mb: null,
    tmp_free_mb: 300,
    root_free_mb: null,
    cpu_count: 2,
    load1: null,
    virtualization: null,
    has_bash: true,
    has_curl: true,
    has_jq: false,
    has_nexttrace: false,
  });
});

test("预检脚本非 0 退出 → diagnostic_preflight_failed，且不再跑档位脚本", async () => {
  const { record, task, state } = await triggerAndWait({
    respond: respondWith({ preflightExit: 2, sections: LIGHT_OK }),
  }, { profile: "light" });

  assert.equal(record.status, "failed");
  assert.equal(record.preflight, null);
  assert.equal(record.summary, "节点预检失败，未能完成资源与依赖校验");
  assert.equal(state.spawnRequests.length, 1, "预检失败要短路，不进档位脚本");
  assert.equal(task.log_excerpt.includes("阻断原因 节点预检失败，未能完成资源与依赖校验"), true);
});

test("SSH 通道不可用时记录 transport 三元组并直接失败", async () => {
  const { record, state } = await triggerAndWait({
    sshContext: {
      status: "unavailable",
      reason_code: "platform_ssh_key_invalid",
      transport: { kind: "ssh-relay", label: "SSH 中转", note: "跳板不可用" },
      note: "平台 SSH 私钥不可用",
    },
    respond: respondWith({ sections: LIGHT_OK }),
  }, { profile: "light" });

  assert.equal(record.status, "failed");
  assert.deepEqual(
    record.transport,
    { kind: "ssh-relay", label: "SSH 中转", note: "平台 SSH 私钥不可用" },
    "现状：通道不可用分支的 transport.note 取 sshContext.note，而不是 transport.note",
  );
  assert.equal(record.summary, "平台 SSH 私钥不可用");
  assert.deepEqual(state.spawnRequests, []);
  assert.equal(state.transportRequests[0].options.allowDemoFallback, false, "诊断不允许回落到 demo 通道");
});

test("SSH transport 整体缺失时落 null 三元组（缺失事实不炸）", async () => {
  const { record } = await triggerAndWait({
    sshContext: { status: "unavailable", reason_code: null, transport: null, note: null },
    respond: respondWith({ sections: LIGHT_OK }),
  }, { profile: "light" });

  assert.deepEqual(record.transport, { kind: null, label: null, note: null });
  assert.equal(record.summary, "当前节点无法建立 SSH 执行通道", "现状：reason_code 缺失时回落固定标签");
});

// ---------- 报告解析：部分失败的降级 ----------

test("轻量档双报告齐全：success/full，摘要按段拼接，日志逐段列状态", async () => {
  const { record, task, state } = await triggerAndWait({
    respond: respondWith({ sections: LIGHT_OK }),
  });

  assert.equal(record.status, "success");
  assert.equal(record.result_quality, "full");
  assert.equal(record.summary, "轻量诊断完成：硬件报告；IP 质量报告");
  assert.deepEqual(Object.keys(record.reports), ["hardware", "ip", "net"]);
  assert.equal(record.reports.hardware.report_url, "https://hw.report/ok.svg");
  assert.equal(record.reports.ip.report_url, "https://ip.report/ok.svg");
  assert.equal(record.reports.net, null, "轻量档没跑 net，段落补 null 占位");
  assert.equal(record.reports.hardware.exit_code, null, "现状：脚本没写 exit_code 就落 null，不做推断");
  assert.equal(record.reports.hardware.raw_json, null);
  assert.equal(record.reports.hardware.output_excerpt, null);
  assert.equal(task.status, "success");
  assert.equal(task.note, record.summary);
  assert.deepEqual(task.log_excerpt, [
    "诊断档位 light",
    "轻量诊断完成：硬件报告；IP 质量报告",
    "hardware 状态 success / https://hw.report/ok.svg",
    "ip 状态 success / https://ip.report/ok.svg",
  ]);
  assert.equal(state.spawnRequests.length, 2, "预检 + 档位脚本各一次");
});

test("轻量档一段有报告一段没有：partial，摘要只收有报告的段", async () => {
  const sections =
    sectionOutput("hardware", { status: "success", report_url_b64: b64("https://hw.report/ok.svg") }) +
    sectionOutput("ip", { status: "failed", exit_code: "1", report_url_b64: "" });

  const { record, task } = await triggerAndWait({ respond: respondWith({ sections }) });

  assert.equal(record.status, "partial");
  assert.equal(record.result_quality, "partial");
  assert.equal(record.summary, "轻量诊断完成：硬件报告", "现状：摘要只拼 report_url 存在的段");
  assert.equal(record.reports.ip.report_url, null);
  assert.equal(record.reports.ip.status, "failed");
  assert.equal(record.reports.ip.exit_code, 1);
  assert.equal(task.status, "partial");
  assert.equal(task.log_excerpt.at(-1), "ip 状态 failed", "无报告链接时行尾不拼 URL");
});

test("轻量档零报告：failed 且文案是「未生成公开报告链接」，原始输出兜底进日志", async () => {
  const { record, task, state } = await triggerAndWait({
    respond: respondWith({ sections: "curl: (7) 连不上远端\n" }),
  });

  assert.equal(record.status, "failed");
  assert.equal(record.result_quality, "failed");
  assert.equal(record.summary, "诊断执行完成，但未生成公开报告链接");
  assert.deepEqual(record.reports, { hardware: null, ip: null, net: null });
  assert.equal(task.status, "failed");
  assert.deepEqual(task.log_excerpt, [
    "诊断档位 light",
    "诊断执行完成，但未生成公开报告链接",
    "阻断原因 诊断执行完成，但未生成公开报告链接",
    "curl: (7) 连不上远端",
  ]);
  assert.equal(record.guard.runtime_blockers.length, 0, "零报告不算预检阻断");
  assert.equal(state.spawnRequests.length, 2);
});

test("现状：档位脚本非 0 退出但仍有报告链接时判 success，退出码不进终态", async () => {
  const { record, task } = await triggerAndWait({
    respond: respondWith({ sections: LIGHT_OK, profileExit: 7 }),
  });

  assert.equal(record.status, "success");
  assert.equal(record.result_quality, "full");
  assert.equal(task.status, "success");
  assert.ok(!("exit_code" in record), "现状：记录里只有段落级 exit_code，档位脚本退出码被丢弃");
});

test("深度档只认 net 段：硬件/IP 报告入库存档但不参与判级", async () => {
  const { record } = await triggerAndWait(
    { respond: respondWith({ sections: LIGHT_OK }) },
    { profile: "deep" },
  );

  assert.equal(record.status, "failed", "没有 net 报告就是失败，哪怕硬件/IP 段都成功");
  assert.equal(record.result_quality, "failed");
  assert.equal(record.summary, "诊断执行完成，但未生成公开报告链接");
  assert.equal(record.reports.net, null);
  assert.equal(record.reports.hardware.report_url, "https://hw.report/ok.svg");
  assert.equal(record.reports.ip.report_url, "https://ip.report/ok.svg");
});

test("深度档 net 段 status=partial：整体 partial，摘要提示完整度有限", async () => {
  const sections = sectionOutput("net", {
    status: "partial",
    exit_code: "1",
    report_url_b64: b64("https://net.report/partial.svg"),
  });

  const { record, task } = await triggerAndWait(
    { respond: respondWith({ sections }) },
    { profile: "deep" },
  );

  assert.equal(record.status, "partial");
  assert.equal(record.result_quality, "partial");
  assert.equal(record.summary, "深度诊断完成：网络质量报告 · 已生成报告，但完整度有限");
  assert.equal(task.status, "partial");
});

test("net 摘要口径：NoData 提示优先于 partial 提示，两者都不看 exit_code", async () => {
  const sections = sectionOutput("net", {
    status: "partial",
    exit_code: "2",
    report_url_b64: b64("https://net.report/nodata.svg"),
    output_excerpt_b64: b64("延迟 12ms\n丢包率 NoData\n路由 跳数不足"),
  });

  const { record } = await triggerAndWait(
    { respond: respondWith({ sections }) },
    { profile: "deep" },
  );

  assert.equal(record.reports.net.summary, "网络质量报告 · 部分测项未返回有效数据");
  assert.equal(record.summary, "深度诊断完成：网络质量报告 · 部分测项未返回有效数据");
  assert.equal(record.reports.net.output_excerpt, "延迟 12ms\n丢包率 NoData\n路由 跳数不足");
});

test("报告解析：畸形 __AIRPORT_DIAG__ 行忽略、同键后写覆盖、缺段不强制凑齐（现状）", async () => {
  const sections =
    [
      "__AIRPORT_DIAG__meta 没有等号",
      "__AIRPORT_DIAG__meta =孤儿键",
      "__AIRPORT_DIAG__section hardware",
      "__AIRPORT_DIAG__section hardware 没有等号",
      "__AIRPORT_DIAG__section  hardware 双空格段落名为空",
      "__AIRPORT_DIAG__section hardware status=failed",
      "__AIRPORT_DIAG__section hardware status=success",
      `__AIRPORT_DIAG__section hardware report_url_b64=${b64("https://hw.report/ok.svg")}`,
    ].join("\n") + "\n";

  const { record } = await triggerAndWait({ respond: respondWith({ sections }) });

  assert.equal(record.reports.hardware.status, "success", "现状：同段同键后写覆盖前写");
  assert.equal(record.reports.ip, null, "畸形行没被误认成段落");
  assert.equal(record.status, "success", "现状：轻量档只出一段成功也算 success，不要求硬件/IP 凑齐");
  assert.equal(record.result_quality, "full");
  assert.equal(record.summary, "轻量诊断完成：硬件报告");
  assert.equal(record.preflight.mem_total_mb, 4096, "现状：档位输出里的 meta 行不会污染预检快照（两份输出各自解析）");
});

test("段落字段映射：exit_code 落数字、raw_json 保持字符串、未知段落整段丢弃", async () => {
  const sections =
    sectionOutput("hardware", {
      status: "success",
      exit_code: "0",
      report_url_b64: b64("https://hw.report/1.svg"),
      json_b64: b64('{"cpu":"EPYC"}'),
      output_excerpt_b64: b64("容器/虚拟化：KVM\nCPU 型号：EPYC 7B12\n内存：8GB"),
    }) +
    sectionOutput("ip", {
      status: "success",
      exit_code: "0",
      report_url_b64: b64("https://ip.report/1.svg"),
      output_excerpt_b64: b64("IP类型：家宽\n综合评分：低风险\n本地25端口出站：不通"),
    }) +
    sectionOutput("browser", { status: "success", report_url_b64: b64("https://x.report/1.svg") });

  const { record } = await triggerAndWait({ respond: respondWith({ sections }) });

  assert.deepEqual(Object.keys(record.reports), ["hardware", "ip", "net"]);
  assert.equal(record.reports.browser, undefined, "现状：段落白名单只有 hardware/ip/net，其它段解析了但落库前丢弃");
  assert.equal(record.reports.hardware.exit_code, 0);
  assert.equal(record.reports.hardware.raw_json, '{"cpu":"EPYC"}', "现状：raw_json 是 base64 解码后的字符串，不做 JSON.parse");
  assert.equal(record.reports.hardware.summary, "硬件报告 · KVM · EPYC 7B12", "现状：抽到 CPU 型号就不再拼内存");
  assert.equal(record.reports.ip.summary, "IP 质量报告 · 家宽 · 低风险 · 25 端口 不通");
  assert.equal(
    record.summary,
    "轻量诊断完成：硬件报告 · KVM · EPYC 7B12；IP 质量报告 · 家宽 · 低风险 · 25 端口 不通",
  );
});

test("摘要标签回退：英文 Virtualization 也认，抽不到才用 node.facts.virtualization，都没有就只剩标题", async () => {
  const cases = [
    { excerpt: "Virtualization: docker", facts: {}, expected: "硬件报告 · docker" },
    { excerpt: "内存：8GB", facts: { virtualization: "OpenVZ" }, expected: "硬件报告 · OpenVZ · 8GB" },
    { excerpt: "一句无关文本", facts: {}, expected: "硬件报告" },
    { excerpt: "", facts: { virtualization: "  kvm  " }, expected: "硬件报告 ·   kvm  " },
  ];

  for (const item of cases) {
    const sections =
      sectionOutput("hardware", {
        status: "success",
        report_url_b64: b64("https://hw.report/3.svg"),
        output_excerpt_b64: b64(item.excerpt),
      }) +
      sectionOutput("ip", { status: "success", report_url_b64: b64("https://ip.report/3.svg") });

    const { record } = await triggerAndWait({
      node: buildNode({ facts: item.facts }),
      respond: respondWith({ sections }),
    });

    assert.equal(
      record.reports.hardware.summary,
      item.expected,
      "现状：node.facts.virtualization 不参与 trim/归一，脏值原样拼进摘要",
    );
    assert.equal(record.reports.ip.summary, "IP 质量报告", "现状：抽不到任何标签时只剩固定标题");
  }
});

test("输出清洗：ANSI 先剥再解析，段落摘录做 CRLF 归一与 1600 字符截断", async () => {
  const sections =
    "\u001b[32m" +
    sectionLine("hardware", "status", "success") +
    "\u001b[0m" +
    sectionLine("hardware", "report_url_b64", b64("https://hw.report/2.svg")) +
    sectionLine("hardware", "output_excerpt_b64", b64("\u001b[1m✓ 通过\u001b[0m\r\n第二行\r第三行")) +
    sectionLine("ip", "status", "success") +
    sectionLine("ip", "report_url_b64", b64("https://ip.report/2.svg")) +
    sectionLine("ip", "output_excerpt_b64", b64("长".repeat(2000)));

  const { record } = await triggerAndWait({ respond: respondWith({ sections }) });

  assert.equal(record.status, "success", "带颜色的协议行剥掉 ANSI 后仍能解析");
  assert.equal(record.reports.hardware.output_excerpt, "✓ 通过\n第二行\n第三行");
  assert.equal(record.reports.ip.output_excerpt.length, 1600);
  assert.ok(record.reports.ip.output_excerpt.endsWith("…"), "现状：超长保留前 1599 字符 + 省略号");
});

// ---------- 僵尸记录与异常兜底 ----------

test("现状：running 没有超时回收，三天前的僵尸记录仍永久互斥", async () => {
  const stale = new Date(BASE_TIME - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { domain, state } = createHarness({
    diagnosticStore: [
      {
        id: "diag_zombie",
        node_id: "node_1",
        status: "running",
        profile: "light",
        host_group_key: "node_1",
        started_at: stale,
      },
    ],
  });

  await assert.rejects(
    () => domain.triggerDiagnostic(buildNode(), { profile: "deep" }),
    (error) => {
      assert.equal(error.message, "当前节点已有诊断任务在执行");
      return true;
    },
  );
  assert.equal(state.diagnosticStore.length, 1);
  assert.equal(state.diagnosticStore[0].status, "running", "现状：过期时间戳不会被自动收尾，只能人工改库");
});

test("执行链路抛异常：兜底写 failed，error.message 原样透传，task/record 各取一次时间戳", async () => {
  const { record, task } = await triggerAndWait({
    respond: (script) => {
      if (script.includes("has_nexttrace")) {
        return { stdout: [preflightOutput(READY_META)], exitCode: 0 };
      }
      throw new Error("档位脚本进程启动失败");
    },
  });

  assert.equal(record.status, "failed");
  assert.equal(record.result_quality, "failed");
  assert.equal(record.summary, "档位脚本进程启动失败", "现状：异常文本不经 reasonLabel 映射直接入库");
  assert.equal(task.status, "failed");
  assert.equal(task.note, "档位脚本进程启动失败");
  assert.deepEqual(task.log_excerpt, ["诊断档位 light", "档位脚本进程启动失败"]);
  assert.notEqual(task.finished_at, record.finished_at, "现状：兜底路径的 finished_at 与正常路径不同源");
});

test("现状（可疑）：异常兜底用 trigger 时的初始快照覆写 store，执行中已落库的 transport/preflight 被抹掉", async () => {
  const { record } = await triggerAndWait({
    respond: (script) => {
      if (script.includes("has_nexttrace")) {
        return { stdout: [preflightOutput(READY_META)], exitCode: 0 };
      }
      throw new Error("档位脚本进程启动失败");
    },
  });

  // 走到这里时 store 里一度存在带 transport + preflight 的记录（预检已成功），
  // 但 catch 里 upsert 的是 triggerDiagnostic 闭包中的初始快照。
  assert.equal(record.transport, null, "现状：预检后写入的 transport 被兜底覆写成 null");
  assert.equal(record.preflight, null, "现状：预检快照同样被抹掉");
  assert.deepEqual(record.guard, { static_blockers: [], runtime_blockers: [], warnings: [] }, "现状：runtime_blockers 只剩初始空值");
  assert.equal(record.reports.net, null);
});

test("reasonLabel：命中表用中文，未知 code 原样透传，只有空值才给「未知异常」", () => {
  const { domain } = createHarness();

  assert.equal(domain.reasonLabel("diagnostic_curl_missing"), "节点缺少 curl，暂时无法拉取诊断脚本");
  assert.equal(domain.reasonLabel("  node_diagnostic_running  "), "当前节点已有诊断任务在执行", "现状：查表前 trim");
  assert.equal(domain.reasonLabel("totally_unknown_code"), "totally_unknown_code", "现状：未知 code 直接裸透传");
  assert.equal(domain.reasonLabel(42), "42", "现状：非字符串 code 走 String()");
  assert.equal(domain.reasonLabel(""), "未知异常");
  assert.equal(domain.reasonLabel(null), "未知异常");
  assert.equal(domain.reasonLabel(undefined), "未知异常");
  assert.equal(domain.reasonLabel(0), "未知异常", "现状：0 被当成空值");
});
