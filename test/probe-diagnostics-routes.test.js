// src/http/routes/probes.js 与 src/http/routes/diagnostics.js 的读接口口径固化。
// 用假 ctx + 假 reply 直接调路由工厂：不起服务、不碰真实数据目录、不触发任何探测。
//
// 钉死：?node_id= 过滤语义（未知 id 是 200 + 空数组，不是 404）、
// 方法/路径匹配边界（不匹配时一个字节都不写）、响应体只有 { items } 没有分页，
// 以及两条路由都没有 :id 路径段 —— 因此不存在绕过 ctx.safeDecodePathSegment 的解码点。
import assert from "node:assert/strict";
import test from "node:test";

import { createDiagnosticsRoutes } from "../src/http/routes/diagnostics.js";
import { createProbesRoutes } from "../src/http/routes/probes.js";
import { createNodeDiagnosticsDomain } from "../src/domain/diagnostics/node-quality.js";

function makeReply() {
  const reply = {
    statusCode: null,
    headers: null,
    body: null,
    writeCount: 0,
    writeHead(statusCode, headers) {
      reply.statusCode = statusCode;
      reply.headers = headers;
      reply.writeCount += 1;
    },
    end(body) {
      reply.body = body;
    },
  };
  return reply;
}

async function call(handler, method, path) {
  const reply = makeReply();
  await handler({
    request: { method },
    reply,
    url: new URL(`http://control-plane${path}`),
  });

  return {
    reply,
    payload: reply.body === null ? null : JSON.parse(reply.body),
  };
}

// 真实 listNodeProbes/sortProbes 住在 src/server.js（本模块禁改区），无法 import，
// 所以这里只钉「路由把哪个函数、带什么参数交给 ctx」这层委托关系；
// 排序比较器本身的口径由 test/node-quality.test.js 里同族的 sortDiagnostics 用例固化。
function makeProbeCtx(store = []) {
  const calls = { listNodeProbes: [], sortProbes: [] };
  const ctx = {
    probeStore: store,
    listNodeProbes(nodeId) {
      calls.listNodeProbes.push(nodeId);
      return store.filter((probe) => probe.node_id === nodeId);
    },
    sortProbes(probes) {
      calls.sortProbes.push(probes);
      return [...probes].reverse();
    },
  };
  return { ctx, calls };
}

function makeDiagnosticDomain(store) {
  return createNodeDiagnosticsDomain({
    diagnosticStore: store,
    nowIso: () => "2026-09-23T00:00:00.000Z",
  });
}

const PROBE_ROWS = [
  { id: "probe_a", node_id: "node_1", observed_at: "2026-09-21T00:00:00.000Z" },
  { id: "probe_b", node_id: "node_2", observed_at: "2026-09-22T00:00:00.000Z" },
  { id: "probe_c", node_id: "node_1", observed_at: "2026-09-23T00:00:00.000Z" },
];

// ---------- GET /api/v1/probes ----------

test("probes：带 node_id 时只走 listNodeProbes，绝不再拉全表排序", async () => {
  const { ctx, calls } = makeProbeCtx(PROBE_ROWS);
  const handler = createProbesRoutes(ctx);

  const { reply, payload } = await call(handler, "GET", "/api/v1/probes?node_id=node_1");

  assert.deepEqual(calls.listNodeProbes, ["node_1"]);
  assert.deepEqual(calls.sortProbes, [], "现状：过滤分支不调 sortProbes，排序责任全在 ctx");
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(payload, { items: [PROBE_ROWS[0], PROBE_ROWS[2]] });
  assert.deepEqual(
    Object.keys(payload),
    ["items"],
    "现状：响应只有 items，没有 total/limit/cursor，前端无法分页",
  );
});

test("probes：node_id 缺失/空串/全空格都算不过滤，且把整个 store 引用交给 sortProbes", async () => {
  for (const path of ["/api/v1/probes", "/api/v1/probes?", "/api/v1/probes?node_id=", "/api/v1/probes?node_id=%20%20"]) {
    const { ctx, calls } = makeProbeCtx(PROBE_ROWS);
    const handler = createProbesRoutes(ctx);

    const { payload } = await call(handler, "GET", path);

    assert.deepEqual(calls.listNodeProbes, [], `${path} 不该进入过滤分支`);
    assert.equal(calls.sortProbes.length, 1);
    assert.equal(calls.sortProbes[0], PROBE_ROWS, "现状：直接透传 live store 数组本身，不先拷贝");
    assert.deepEqual(payload.items.map((item) => item.id), ["probe_c", "probe_b", "probe_a"]);
  }
});

test("probes 现状：未知 node_id 返回 200 + 空数组，不是 404 也不是错误体", async () => {
  const { ctx } = makeProbeCtx(PROBE_ROWS);
  const handler = createProbesRoutes(ctx);

  const { reply, payload } = await call(handler, "GET", "/api/v1/probes?node_id=ghost-node");

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(payload, { items: [] });
  assert.equal(payload.error, undefined);
});

test("probes：node_id 前后空白被 trim 后才过滤，重复参数/错名参数只认 node_id", async () => {
  const cases = [
    ["/api/v1/probes?node_id=%20node_1%20", ["node_1"]],
    ["/api/v1/probes?node_id=node_1&node_id=node_2", ["node_1"]],
    ["/api/v1/probes?node=%20node_1", []],
    ["/api/v1/probes?NODE_ID=node_1", []],
  ];

  for (const [path, expected] of cases) {
    const { ctx, calls } = makeProbeCtx(PROBE_ROWS);
    const handler = createProbesRoutes(ctx);

    const { reply, payload } = await call(handler, "GET", path);

    assert.deepEqual(calls.listNodeProbes, expected, path);
    assert.equal(reply.statusCode, 200);
    assert.equal(Array.isArray(payload.items), true);
  }
});

// ---------- GET /api/v1/diagnostics ----------

test("diagnostics：把归一化后的 node_id（不过滤时是 null）原样交给 listDiagnostics", async () => {
  const calls = [];
  const handler = createDiagnosticsRoutes({
    listDiagnostics(nodeId) {
      calls.push(nodeId);
      return [];
    },
  });

  await call(handler, "GET", "/api/v1/diagnostics?node_id=node_1");
  await call(handler, "GET", "/api/v1/diagnostics?node_id=%20%20");
  await call(handler, "GET", "/api/v1/diagnostics");

  assert.deepEqual(calls, ["node_1", null, null], "现状：空串/全空格统一归一为 null 再传下去");
});

test("diagnostics 端到端：真域函数下未知 node_id 是 200 + 空数组，已知 id 按时间倒序", async () => {
  const store = [
    { id: "diag_old", node_id: "node_1", started_at: "2026-09-20T00:00:00.000Z" },
    { id: "diag_new", node_id: "node_2", started_at: "2026-09-23T00:00:00.000Z" },
    { id: "diag_mid", node_id: "node_1", started_at: "2026-09-21T00:00:00.000Z" },
  ];
  const handler = createDiagnosticsRoutes({ listDiagnostics: makeDiagnosticDomain(store).listDiagnostics });

  const ghost = await call(handler, "GET", "/api/v1/diagnostics?node_id=ghost-node");
  assert.equal(ghost.reply.statusCode, 200);
  assert.deepEqual(ghost.payload, { items: [] });

  const filtered = await call(handler, "GET", "/api/v1/diagnostics?node_id=node_1");
  assert.deepEqual(filtered.payload.items.map((item) => item.id), ["diag_mid", "diag_old"]);
  assert.equal(
    store.map((item) => item.id).join(","),
    "diag_old,diag_new,diag_mid",
    "现状：读接口不就地重排 store",
  );

  const all = await call(handler, "GET", "/api/v1/diagnostics");
  assert.deepEqual(all.payload.items.map((item) => item.id), ["diag_new", "diag_mid", "diag_old"]);
});

// ---------- 匹配边界：不匹配时一个字节都不能写 ----------

test("两条路由对方法/路径不匹配时不写响应，交给后续路由处理", async () => {
  const probes = makeProbeCtx(PROBE_ROWS);
  const probeHandler = createProbesRoutes(probes.ctx);
  const diagnosticHandler = createDiagnosticsRoutes({
    listDiagnostics: makeDiagnosticDomain([]).listDiagnostics,
  });

  for (const [method, path] of [
    ["POST", "/api/v1/probes"],
    ["DELETE", "/api/v1/probes"],
    ["GET", "/api/v1/probes/"],
    ["GET", "/api/v1/probes/probe_a"],
    ["GET", "/api/v1/probes%2Fprobe_a"],
    ["GET", "/api/v1/diagnostics/"],
    ["GET", "/api/v1/diagnostics/diag_1"],
    ["POST", "/api/v1/diagnostics"],
    ["GET", "/api/v1/probes2"],
    ["HEAD", "/api/v1/diagnostics"],
  ]) {
    const probesHit = await call(probeHandler, method, path);
    const diagnosticsHit = await call(diagnosticHandler, method, path);
    assert.equal(probesHit.reply.writeCount, 0, `probes 必须对 ${method} ${path} 落空`);
    assert.equal(probesHit.reply.body, null);
    assert.equal(diagnosticsHit.reply.writeCount, 0, `diagnostics 必须对 ${method} ${path} 落空`);
    assert.equal(diagnosticsHit.reply.body, null);
  }

  assert.deepEqual(probes.calls.listNodeProbes, [], "落空时不能提前查库");
  assert.deepEqual(probes.calls.sortProbes, []);
});

test("两条路由都没有 :id 路径段：带编码路径段的需求直接落空，因而不存在绕过 safeDecodePathSegment 的解码点", async () => {
  const probes = makeProbeCtx(PROBE_ROWS);
  const probeHandler = createProbesRoutes(probes.ctx);
  const diagnosticHandler = createDiagnosticsRoutes({
    listDiagnostics: makeDiagnosticDomain([]).listDiagnostics,
  });

  const probesSingle = await call(probeHandler, "GET", "/api/v1/probes/probe_a");
  const diagnosticsSingle = await call(diagnosticHandler, "GET", "/api/v1/diagnostics/diag_1");
  assert.equal(probesSingle.reply.writeCount, 0);
  assert.equal(diagnosticsSingle.reply.writeCount, 0);

  // 非法百分号编码出现在 query 里也不抛错：URLSearchParams 原样透传，路由不做 decodeURIComponent。
  const { ctx, calls } = makeProbeCtx(PROBE_ROWS);
  const handler = createProbesRoutes(ctx);
  const broken = await call(handler, "GET", "/api/v1/probes?node_id=%ZZ");
  assert.deepEqual(calls.listNodeProbes, ["%ZZ"]);
  assert.equal(broken.reply.statusCode, 200);
  assert.deepEqual(broken.payload, { items: [] });
});

test("两条路由出口一致：content-type 是 JSON，空结果也返回 200 + {items: []}", async () => {
  const probes = makeProbeCtx(PROBE_ROWS);
  const { reply } = await call(createProbesRoutes(probes.ctx), "GET", "/api/v1/probes");
  assert.equal(reply.headers["content-type"], "application/json; charset=utf-8");

  const diagnostics = await call(
    createDiagnosticsRoutes({ listDiagnostics: makeDiagnosticDomain([]).listDiagnostics }),
    "GET",
    "/api/v1/diagnostics",
  );
  assert.deepEqual(diagnostics.payload, { items: [] });
});
