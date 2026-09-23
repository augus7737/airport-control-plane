import test from "node:test";
import assert from "node:assert/strict";

import { buildCostViews } from "../src/domain/costs/summary.js";

const EMPTY_SUMMARY = {
  node_count: 0,
  provider_count: 0,
  active_node_count: 0,
  idle_node_count: 0,
  cost_missing_node_count: 0,
  unlinked_provider_node_count: 0,
  invalid_cycle_node_count: 0,
  invalid_once_amortization_node_count: 0,
  totals_by_currency: [],
  total_monthly_cost: null,
  currency: null,
  idle_totals_by_currency: [],
  idle_monthly_cost: null,
  idle_currency: null,
  expiring_7d_totals_by_currency: [],
  expiring_7d_monthly_cost: null,
  expiring_7d_currency: null,
};

// buildCostViews 不注入 nowValue，到期口径按真实当前时间派生。
const SOON = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function node(id, providerId, commercial = {}) {
  return { id, provider_id: providerId, commercial };
}

function release(id, overrides = {}) {
  return {
    id,
    status: "success",
    created_at: `${id === "rel_1" ? "2026-03" : "2026-04"}-01T00:00:00Z`,
    ...overrides,
  };
}

function findNode(views, id) {
  return views.nodes.find((item) => item.node_id === id);
}

function findProvider(views, id) {
  return views.providers.find((item) => item.provider_id === id);
}

function findAccessUser(views, id) {
  return views.access_users.find((item) => item.access_user_id === id);
}

test("cost views tolerate empty and malformed inputs", () => {
  assert.deepEqual(buildCostViews(), {
    summary: EMPTY_SUMMARY,
    nodes: [],
    providers: [],
    releases: [],
    access_users: [],
  });

  const garbage = buildCostViews({ nodes: null, providers: "x", releases: 42, accessUsers: undefined });
  assert.deepEqual(garbage.summary, EMPTY_SUMMARY);
  assert.deepEqual(garbage.nodes, []);
  assert.deepEqual(garbage.providers, []);
  assert.deepEqual(garbage.releases, []);
  assert.deepEqual(garbage.access_users, []);

  const idless = buildCostViews({
    nodes: [{ commercial: { billing_cycle: "月付", billing_amount: 10 } }],
    providers: [{ name: "无 id 厂商" }, { id: "" }],
    releases: [{ status: "success" }, { id: "" }],
    accessUsers: [{ name: "无 id 用户" }],
  });
  // 厂商行按入参数组生成，缺 id 的厂商不会被 providerMap 认领节点，却仍然出行。
  assert.equal(idless.summary.provider_count, 2);
  assert.equal(idless.summary.node_count, 1);
  assert.equal(idless.releases.length, 2);
  assert.equal(idless.access_users.length, 1);
  // 名称缺失的行排在最前，provider_id 原样带出 undefined / 空串。
  assert.deepEqual(
    idless.providers.map((item) => item.provider_id),
    ["", undefined],
  );
});

test("summary aggregates fleet totals, idle money and expiring money", () => {
  const views = buildCostViews({
    providers: [{ id: "p1", name: "厂商甲", default_currency: "CNY" }],
    nodes: [
      node("n1", "p1", { billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY" }),
      node("n2", "p1", {
        billing_cycle: "月付",
        billing_amount: 50,
        billing_currency: "CNY",
        expires_at: SOON,
      }),
      node("n3", "p1", { billing_cycle: "月付", billing_amount: 0, billing_currency: "CNY" }),
      node("n4", "p1", { billing_cycle: "双周付", billing_amount: 30 }),
      node("n5", "p1", { billing_cycle: "一次性", billing_amount: 900 }),
      node("n6", "p_missing", { billing_cycle: "月付", billing_amount: 20, billing_currency: "CNY" }),
    ],
    releases: [release("rel_1", { node_ids: ["n1"], access_user_ids: ["u1"] })],
    accessUsers: [{ id: "u1", name: "用户一" }],
  });

  assert.equal(views.summary.node_count, 6);
  assert.equal(views.summary.active_node_count, 1);
  assert.equal(views.summary.idle_node_count, 3);
  // n4（周期非法）、n5（缺折旧月数）算不出成本；n6 未绑定厂商但金额可算。
  assert.equal(views.summary.cost_missing_node_count, 2);
  assert.equal(views.summary.invalid_cycle_node_count, 1);
  assert.equal(views.summary.invalid_once_amortization_node_count, 1);
  assert.equal(views.summary.unlinked_provider_node_count, 1);

  // 0 元账单计入合计；算不出成本的三条不进入任何金额桶。
  // 全站合计（170）包含未绑定厂商的 n6（20），厂商侧合计只有 150。
  assert.deepEqual(views.summary.totals_by_currency, [{ currency: "CNY", amount: 170 }]);
  assert.equal(views.summary.total_monthly_cost, 170);
  assert.equal(views.summary.currency, "CNY");

  // 闲置 = 有成本且未被任何成功发布使用：n2（50）、n3（0）、n6（20）。
  assert.deepEqual(views.summary.idle_totals_by_currency, [{ currency: "CNY", amount: 70 }]);
  assert.equal(views.summary.idle_monthly_cost, 70);

  assert.equal(views.summary.expiring_7d_monthly_cost, 50);
  assert.deepEqual(views.summary.expiring_7d_totals_by_currency, [{ currency: "CNY", amount: 50 }]);
});

test("unlinked provider nodes are counted separately from invalid bills", () => {
  const views = buildCostViews({
    providers: [{ id: "p1", name: "厂商甲", default_currency: "CNY" }],
    nodes: [
      node("n1", "p_missing", { billing_cycle: "月付", billing_amount: 20, billing_currency: "CNY" }),
      node("n2", "p1", { billing_cycle: "双周付", billing_amount: 30 }),
    ],
  });

  assert.equal(views.summary.node_count, 2);
  // 未绑定厂商的 n1 金额可算，只被记为 unlinked，而不算成本缺失。
  assert.equal(views.summary.cost_missing_node_count, 1);
  assert.equal(views.summary.unlinked_provider_node_count, 1);
  assert.equal(findNode(views, "n1").cost_status, "unlinked_provider");
  assert.equal(findNode(views, "n2").cost_status, "invalid_cycle");
  assert.equal(views.summary.invalid_cycle_node_count, 1);
});

test("nodes sharing an id collapse into one cost row and providers group by id", () => {
  const views = buildCostViews({
    providers: [{ id: "p1", name: "厂商甲" }],
    nodes: [
      node("n1", "p1", { billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY" }),
      node("n1", "p1", { billing_cycle: "月付", billing_amount: 30, billing_currency: "CNY" }),
      node("n2", "p1", { billing_cycle: "月付", billing_amount: 30, billing_currency: "CNY" }),
    ],
  });

  assert.equal(views.summary.node_count, 3);
  assert.deepEqual(views.summary.totals_by_currency, [{ currency: "CNY", amount: 160 }]);
  assert.equal(findProvider(views, "p1").linked_node_count, 3);
});

test("provider rows group node money, count problems and stay per currency", () => {
  const views = buildCostViews({
    providers: [
      { id: "p1", name: "厂商甲", default_currency: "CNY", monthly_budget: 200, budget_alert_threshold: 50 },
      { id: "p2", name: "厂商乙" },
      { id: "p3", name: "厂商丙" },
      { id: "p4", name: "厂商丁" },
    ],
    nodes: [
      node("n1", "p1", { billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY" }),
      node("n2", "p1", { billing_cycle: "年付", billing_amount: 1200, billing_currency: "CNY" }),
      node("n3", "p1", { billing_cycle: "月付", billing_currency: "CNY" }),
      node("n4", "p2", { billing_cycle: "月付", billing_amount: 10, billing_currency: "USD" }),
      node("n5", "p2", { billing_cycle: "月付", billing_amount: 10, billing_currency: "CNY" }),
      node("n6", "p3", { billing_cycle: "月付", billing_amount: 10 }),
      node("n7", "p4", {}),
    ],
    releases: [release("rel_1", { node_ids: ["n1"], access_user_ids: ["u1"] })],
  });

  // 厂商行按名称的 zh-CN 拼音序（丙 bing < 丁 ding < 甲 jia < 乙 yi）。
  assert.deepEqual(
    views.providers.map((item) => item.provider_id),
    ["p3", "p4", "p1", "p2"],
  );

  const p1 = findProvider(views, "p1");
  assert.equal(p1.name, "厂商甲");
  assert.equal(p1.status, null);
  assert.equal(p1.account_name, null);
  assert.deepEqual(p1.regions, []);
  assert.equal(p1.linked_node_count, 3);
  assert.equal(p1.incomplete_node_count, 1);
  assert.equal(p1.active_node_count, 1);
  assert.equal(p1.idle_node_count, 1);
  assert.deepEqual(p1.totals_by_currency, [{ currency: "CNY", amount: 200 }]);
  assert.equal(p1.total_monthly_cost, 200);
  assert.equal(p1.currency, "CNY");
  assert.deepEqual(p1.active_totals_by_currency, [{ currency: "CNY", amount: 100 }]);
  assert.deepEqual(p1.idle_totals_by_currency, [{ currency: "CNY", amount: 100 }]);
  assert.equal(p1.monthly_budget, 200);
  assert.equal(p1.default_currency, "CNY");
  assert.equal(p1.budget_alert_threshold, 50);
  assert.equal(p1.budget_usage_percent, 100);
  assert.equal(p1.budget_alert, true);

  // 多币种厂商：只给分项，不给单一合计。
  const p2 = findProvider(views, "p2");
  assert.deepEqual(p2.totals_by_currency, [
    { currency: "CNY", amount: 10 },
    { currency: "USD", amount: 10 },
  ]);
  assert.equal(p2.total_monthly_cost, null);
  assert.equal(p2.currency, null);
  assert.equal(p2.budget_usage_percent, null);
  assert.equal(p2.budget_alert, false);

  // 无币种成本不进入任何聚合，但节点行仍带数字。
  const p3 = findProvider(views, "p3");
  assert.deepEqual(p3.totals_by_currency, []);
  assert.equal(p3.total_monthly_cost, null);
  assert.equal(p3.incomplete_node_count, 0);
  assert.equal(findNode(views, "n6").total_monthly_cost, 10);
  assert.equal(findNode(views, "n6").cost_status, "incomplete");

  assert.deepEqual(findProvider(views, "p4").totals_by_currency, []);
});

test("provider totals ignore nodes that no longer match a provider row", () => {
  const views = buildCostViews({
    providers: [{ id: "p1", name: "厂商甲" }],
    nodes: [node("n1", "p1", { billing_cycle: "月付", billing_amount: 100 })],
    releases: [],
  });

  // 账单 100 元、无币种：节点行有数字，厂商与全站合计都必须忽略它。
  assert.equal(findNode(views, "n1").total_monthly_cost, 100);
  assert.equal(findNode(views, "n1").effective_currency, null);
  assert.deepEqual(findProvider(views, "p1").totals_by_currency, []);
  assert.deepEqual(views.summary.totals_by_currency, []);
  assert.equal(views.summary.total_monthly_cost, null);
});

test("budget usage caps nothing but rounds and alerts at the threshold boundary", () => {
  const build = (monthlyBudget, threshold, amount) =>
    findProvider(
      buildCostViews({
        providers: [
          { id: "p1", name: "厂商甲", default_currency: "CNY", monthly_budget: monthlyBudget, budget_alert_threshold: threshold },
        ],
        nodes: [node("n1", "p1", { billing_cycle: "月付", billing_amount: amount, billing_currency: "CNY" })],
      }),
      "p1",
    );

  const boundary = build(200, 50, 100);
  assert.equal(boundary.budget_usage_percent, 50);
  assert.equal(boundary.budget_alert, true);

  const justBelow = build(200, 50.01, 100);
  assert.equal(justBelow.budget_usage_percent, 50);
  assert.equal(justBelow.budget_alert, false);

  const overspent = build(300, 80, 100);
  assert.equal(overspent.budget_usage_percent, 33.33);
  assert.equal(overspent.budget_alert, false);

  const overBudget = build(30, 50, 100);
  assert.equal(overBudget.budget_usage_percent, 333.33);
  assert.equal(overBudget.budget_alert, true);

  // 预算为 0 不视为预算缺失：百分比为 null，告警随之关闭。
  const noBudget = build(0, 50, 100);
  assert.equal(noBudget.monthly_budget, 0);
  assert.equal(noBudget.budget_usage_percent, null);
  assert.equal(noBudget.budget_alert, false);

  // 0 花费 + 0 阈值 → 告警为真（阈值为 0 时的既有口径）。
  const zeroThreshold = build(100, 0, 0);
  assert.equal(zeroThreshold.budget_usage_percent, 0);
  assert.equal(zeroThreshold.budget_alert, true);

  // 非法阈值（负数）回落为 null，不告警。
  const badThreshold = build(100, -1, 50);
  assert.equal(badThreshold.budget_alert_threshold, null);
  assert.equal(badThreshold.budget_usage_percent, 50);
  assert.equal(badThreshold.budget_alert, false);
});

test("budget currency mismatch falls back to the single-total shortcut", () => {
  const mismatch = findProvider(
    buildCostViews({
      providers: [{ id: "p1", name: "厂商甲", default_currency: "USD", monthly_budget: 100 }],
      nodes: [node("n1", "p1", { billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY" })],
    }),
    "p1",
  );
  assert.deepEqual(mismatch.totals_by_currency, [{ currency: "CNY", amount: 100 }]);
  assert.equal(mismatch.budget_usage_percent, null);
  assert.equal(mismatch.budget_alert, false);

  const implicitCurrency = findProvider(
    buildCostViews({
      providers: [{ id: "p1", name: "厂商甲", monthly_budget: 100, budget_alert_threshold: 80 }],
      nodes: [node("n1", "p1", { billing_cycle: "月付", billing_amount: 90, billing_currency: "CNY" })],
    }),
    "p1",
  );
  // 单一币种时即便厂商没写 default_currency，也按该币种核算预算。
  assert.equal(implicitCurrency.default_currency, null);
  assert.equal(implicitCurrency.budget_usage_percent, 90);
  assert.equal(implicitCurrency.budget_alert, true);

  const multiCurrency = findProvider(
    buildCostViews({
      providers: [{ id: "p1", name: "厂商甲", monthly_budget: 100, budget_alert_threshold: 20 }],
      nodes: [
        node("n1", "p1", { billing_cycle: "月付", billing_amount: 90, billing_currency: "CNY" }),
        node("n2", "p1", { billing_cycle: "月付", billing_amount: 90, billing_currency: "USD" }),
      ],
    }),
    "p1",
  );
  assert.equal(multiCurrency.budget_usage_percent, null);
  assert.equal(multiCurrency.budget_alert, false);
});

test("release rows split node cost across the bound access users", () => {
  const views = buildCostViews({
    providers: [{ id: "p1", name: "厂商甲" }],
    nodes: [
      node("n1", "p1", { billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY" }),
      node("n2", "p1", { billing_cycle: "月付", billing_amount: 50, billing_currency: "CNY" }),
      node("n3", "p1", { billing_cycle: "月付", billing_amount: 7.5, billing_currency: "USD" }),
    ],
    releases: [
      release("rel_1", {
        status: "success",
        created_at: "2026-03-01T00:00:00Z",
        title: "三月发布",
        profile_id: "pf1",
        deployment_node_ids: ["n1"],
        entry_node_ids: ["n1", "n2"],
        node_ids: ["n2", "n9"],
        access_user_ids: ["u1", "u1", "u2"],
      }),
    ],
    accessUsers: [{ id: "u1", name: "用户一" }],
  });

  const item = views.releases[0];
  assert.equal(item.release_id, "rel_1");
  assert.equal(item.title, "三月发布");
  assert.equal(item.profile_id, "pf1");
  assert.deepEqual(item.deployment_node_ids, ["n1"]);
  assert.deepEqual(item.entry_node_ids, ["n1", "n2"]);
  assert.deepEqual(item.node_ids, ["n1", "n2", "n9"]);
  assert.equal(item.node_count, 3);
  assert.equal(item.active_access_user_count, 2);
  assert.deepEqual(item.totals_by_currency, [{ currency: "CNY", amount: 150 }]);
  assert.equal(item.total_monthly_cost, 150);
  assert.deepEqual(item.per_user_totals_by_currency, [{ currency: "CNY", amount: 75 }]);
  assert.equal(item.per_user_monthly_cost, 75);
  assert.equal(item.per_user_currency, "CNY");
  assert.equal(item.incomplete_node_count, 1);
  assert.deepEqual(
    item.node_costs.map((row) => [row.node_id, row.total_monthly_cost, row.cost_status]),
    [
      ["n1", 100, "ok"],
      ["n2", 50, "ok"],
      ["n9", null, "incomplete"],
    ],
  );
  assert.equal(item.node_costs[2].node_name, "n9");
  assert.deepEqual(item.node_costs[2].route_roles, []);
});

test("release rows spread multi currency totals without a single per user number", () => {
  const views = buildCostViews({
    providers: [{ id: "p1", name: "厂商甲" }],
    nodes: [
      node("n1", "p1", { billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY" }),
      node("n2", "p1", { billing_cycle: "月付", billing_amount: 25, billing_currency: "USD" }),
    ],
    releases: [
      release("rel_1", {
        node_ids: ["n1", "n2"],
        access_user_ids: ["u1", "u2", "u3"],
      }),
    ],
  });

  const item = views.releases[0];
  assert.deepEqual(item.per_user_totals_by_currency, [
    { currency: "CNY", amount: 33.33 },
    { currency: "USD", amount: 8.33 },
  ]);
  assert.equal(item.per_user_monthly_cost, null);
  assert.equal(item.per_user_currency, null);
});

test("release rows divide by zero users as null and zero cost as zero", () => {
  const views = buildCostViews({
    providers: [{ id: "p1", name: "厂商甲" }],
    nodes: [
      node("n1", "p1", { billing_cycle: "月付", billing_amount: 0, billing_currency: "CNY" }),
      node("n2", "p1", { billing_cycle: "月付", billing_amount: 80, billing_currency: "CNY" }),
    ],
    releases: [
      release("rel_1", { node_ids: ["n1"], access_user_ids: [] }),
      release("rel_2", { node_ids: ["n2"], access_user_ids: ["u1", "u2", "u3", "u4"] }),
    ],
  });

  const [newest, oldest] = views.releases;
  assert.equal(newest.release_id, "rel_2");
  assert.deepEqual(newest.per_user_totals_by_currency, [{ currency: "CNY", amount: 20 }]);
  assert.equal(newest.per_user_monthly_cost, 20);

  assert.equal(oldest.release_id, "rel_1");
  assert.deepEqual(oldest.per_user_totals_by_currency, [{ currency: "CNY", amount: null }]);
  assert.equal(oldest.per_user_monthly_cost, null);
  assert.equal(oldest.total_monthly_cost, 0);
});

test("release rows sort newest first with a stable tie breaker", () => {
  const views = buildCostViews({
    providers: [{ id: "p1", name: "厂商甲" }],
    nodes: [],
    releases: [
      release("rel_tie_1", { created_at: "2026-02-01T00:00:00Z", finished_at: "2026-02-01T06:00:00Z" }),
      release("rel_tie_2", { created_at: "2026-02-01T00:00:00Z", finished_at: "2026-02-01T06:00:00Z" }),
      release("rel_old", { created_at: "2026-01-01T00:00:00Z", finished_at: "2026-05-01T00:00:00Z" }),
    ],
  });

  // rel_old 的 finished_at 最新；同时间戳的两条保持入参顺序。
  assert.deepEqual(
    views.releases.map((item) => item.release_id),
    ["rel_old", "rel_tie_1", "rel_tie_2"],
  );
});

test("node activity follows the newest successful deployment, per node status first", () => {
  const views = buildCostViews({
    providers: [{ id: "p1", name: "厂商甲" }],
    nodes: [
      node("n1", "p1", { billing_cycle: "月付", billing_amount: 10, billing_currency: "CNY" }),
      node("n2", "p1", { billing_cycle: "月付", billing_amount: 10, billing_currency: "CNY" }),
      node("n3", "p1", { billing_cycle: "月付", billing_amount: 10, billing_currency: "CNY" }),
    ],
    releases: [
      release("rel_1", {
        status: "success",
        node_ids: ["n1"],
        deployments: [
          { node_id: "n1", status: "failed" },
          { node_id: "n2", status: "success" },
        ],
      }),
      release("rel_2", {
        status: "success",
        node_ids: ["n3"],
        deployments: [],
      }),
    ],
    accessUsers: [],
  });

  assert.equal(findNode(views, "n1").active, false);
  assert.equal(findNode(views, "n2").active, true);
  assert.equal(findNode(views, "n3").active, true);
  assert.equal(views.summary.active_node_count, 2);
  assert.equal(views.summary.idle_node_count, 1);
});

test("access user rows estimate from the newest matching successful release", () => {
  const views = buildCostViews({
    providers: [{ id: "p1", name: "厂商甲" }],
    nodes: [
      node("n1", "p1", { billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY" }),
      node("n2", "p1", { billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY" }),
    ],
    releases: [
      release("rel_new", {
        status: "success",
        created_at: "2026-04-01T00:00:00Z",
        profile_id: "pf_other",
        node_ids: ["n2"],
        access_user_ids: ["u1"],
      }),
      release("rel_used", {
        status: "success",
        created_at: "2026-03-01T00:00:00Z",
        title: "可用发布",
        profile_id: "pf1",
        node_ids: ["n1"],
        access_user_ids: ["u1", "u2"],
      }),
      release("rel_failed", {
        status: "failed",
        created_at: "2026-05-01T00:00:00Z",
        node_ids: ["n1"],
        access_user_ids: ["u2"],
      }),
    ],
    accessUsers: [
      { id: "u1", name: "用户一", profile_id: "pf1", status: "active", protocol: "vless" },
      { id: "u2", name: "用户二", profile_id: "pf1", status: "disabled" },
      { id: "u3", name: "用户三" },
    ],
  });

  // 名称按 zh-CN 拼音序：二 er < 三 san < 一 yi。
  assert.deepEqual(
    views.access_users.map((item) => item.access_user_id),
    ["u2", "u3", "u1"],
  );

  const u1 = findAccessUser(views, "u1");
  const u2 = findAccessUser(views, "u2");
  const u3 = findAccessUser(views, "u3");
  assert.equal(u1.access_user_id, "u1");
  assert.equal(u1.current_release_id, "rel_used");
  assert.equal(u1.current_release_title, "可用发布");
  assert.equal(u1.release_node_count, 1);
  assert.equal(u1.active_access_user_count, 2);
  assert.equal(u1.estimated_monthly_cost, 50);
  assert.equal(u1.currency, "CNY");
  assert.equal(u1.cost_status, "ok");
  assert.deepEqual(u1.estimated_totals_by_currency, [{ currency: "CNY", amount: 50 }]);
  assert.equal(u1.status, "active");
  assert.equal(u1.protocol, "vless");

  // 只有失败发布可用：给出口径一致的缺省行。
  assert.equal(u2.current_release_id, "rel_used");
  assert.equal(u2.estimated_monthly_cost, 50);

  assert.equal(u3.current_release_id, null);
  assert.equal(u3.estimated_monthly_cost, null);
  assert.equal(u3.currency, null);
  assert.equal(u3.release_node_count, 0);
  assert.equal(u3.active_access_user_count, 0);
  assert.deepEqual(u3.estimated_totals_by_currency, []);
  assert.equal(u3.cost_status, "incomplete");
  assert.deepEqual(u3.problems, ["当前没有可用于估算的最新成功发布"]);
});

test("access user rows fall back to profile-less releases and keep name order", () => {
  const views = buildCostViews({
    providers: [{ id: "p1", name: "厂商甲" }],
    nodes: [node("n1", "p1", { billing_cycle: "月付", billing_amount: 90, billing_currency: "CNY" })],
    releases: [
      release("rel_1", {
        created_at: "2026-03-01T00:00:00Z",
        profile_id: null,
        node_ids: ["n1"],
        access_user_ids: ["u2", "u1"],
      }),
    ],
    accessUsers: [
      { id: "u1", name: "乙用户", profile_id: "pf1" },
      { id: "u2", name: "甲用户" },
    ],
  });

  assert.deepEqual(
    views.access_users.map((item) => [item.name, item.estimated_monthly_cost]),
    [
      ["甲用户", 45],
      ["乙用户", 45],
    ],
  );
  assert.equal(views.access_users[0].currency, "CNY");
});

test("rows sort by display name and ties keep the input order", () => {
  const views = buildCostViews({
    providers: [
      { id: "p2", name: "厂商甲" },
      { id: "p1", name: "A厂商" },
      { id: "p3", name: "厂商甲" },
    ],
    nodes: [
      { id: "n3", provider_id: "p1", name: "alpha", commercial: { billing_cycle: "月付", billing_amount: 10, billing_currency: "CNY" } },
      { id: "n1", provider_id: "p1", name: "中文节点", commercial: { billing_cycle: "月付", billing_amount: 20, billing_currency: "CNY" } },
      { id: "n2", provider_id: "p1", name: "alpha", commercial: { billing_cycle: "月付", billing_amount: 30, billing_currency: "CNY" } },
    ],
    releases: [],
    accessUsers: [],
  });

  // zh-CN 序把中文名排在拉丁名之前；同名 alpha 保持入参顺序（n3 先于 n2）。
  assert.deepEqual(
    views.nodes.map((item) => [item.node_name, item.node_id]),
    [
      ["中文节点", "n1"],
      ["alpha", "n3"],
      ["alpha", "n2"],
    ],
  );
  assert.deepEqual(
    views.providers.map((item) => item.provider_id),
    ["p2", "p3", "p1"],
  );
});
