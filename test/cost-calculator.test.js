import test from "node:test";
import assert from "node:assert/strict";

import {
  addCurrencyAmount,
  buildAmountSummaryFromAccumulator,
  buildNodeCostSnapshot,
  createCurrencyAccumulator,
  finalizeCurrencyAccumulator,
  mergeCurrencyAccumulators,
  normalizeBudgetSummary,
} from "../src/domain/costs/calculator.js";

const NOW = Date.parse("2026-03-15T12:00:00Z");

function snapshot(commercial = {}, options = {}) {
  return buildNodeCostSnapshot(
    {
      id: "node_1",
      provider_id: "provider_1",
      ...options.node,
      commercial,
    },
    {
      provider: "provider" in options ? options.provider : { id: "provider_1", name: "厂商甲" },
      activeNodeIds: options.activeNodeIds ?? new Set(),
      nowValue: NOW,
      ...(options.snapshot ?? {}),
    },
  );
}

function monthlyKeys(item) {
  return {
    base: item.base_monthly_cost,
    overage: item.overage_cost,
    total: item.total_monthly_cost,
    status: item.cost_status,
    currency: item.effective_currency,
  };
}

test("currency accumulators ignore unusable inputs and keep only real amounts", () => {
  const accumulator = createCurrencyAccumulator();

  addCurrencyAmount(accumulator, "cny", 10);
  addCurrencyAmount(accumulator, "CNY", 0.1);
  addCurrencyAmount(accumulator, " CNY ", 0.2);
  addCurrencyAmount(accumulator, "CNY", "0");
  addCurrencyAmount(accumulator, "CNY", "8");

  assert.deepEqual([...accumulator.entries()], [["CNY", 18.3]]);

  const dropped = createCurrencyAccumulator();
  for (const [currency, amount] of [
    [null, 10],
    ["", 10],
    ["元", 10],
    ["1CNY", 10],
    ["CNY", null],
    ["CNY", ""],
    ["CNY", "abc"],
    ["CNY", Number.NaN],
    ["CNY", undefined],
  ]) {
    addCurrencyAmount(dropped, currency, amount);
  }

  assert.equal(dropped.size, 0);
  assert.equal(addCurrencyAmount(null, "CNY", 10), null);
  assert.deepEqual(finalizeCurrencyAccumulator(undefined), []);
  assert.deepEqual(buildAmountSummaryFromAccumulator(undefined), {
    totals_by_currency: [],
    total_monthly_cost: null,
    currency: null,
  });
});

test("zero amounts stay zero instead of collapsing into the missing-cost shape", () => {
  const accumulator = createCurrencyAccumulator();
  addCurrencyAmount(accumulator, "CNY", 0);

  assert.deepEqual(finalizeCurrencyAccumulator(accumulator), [{ currency: "CNY", amount: 0 }]);
  assert.deepEqual(buildAmountSummaryFromAccumulator(accumulator), {
    totals_by_currency: [{ currency: "CNY", amount: 0 }],
    total_monthly_cost: 0,
    currency: "CNY",
  });
});

test("currency accumulators merge and finalize sorted by currency code", () => {
  const target = createCurrencyAccumulator();
  addCurrencyAmount(target, "USD", 5);
  addCurrencyAmount(target, "CNY", 10);

  const source = createCurrencyAccumulator();
  addCurrencyAmount(source, "cny", 2.5);
  addCurrencyAmount(source, "EUR", 1);

  assert.equal(mergeCurrencyAccumulators(target, source), target);
  assert.deepEqual(finalizeCurrencyAccumulator(target), [
    { currency: "CNY", amount: 12.5 },
    { currency: "EUR", amount: 1 },
    { currency: "USD", amount: 5 },
  ]);

  assert.equal(mergeCurrencyAccumulators(target, null), target);
  assert.equal(mergeCurrencyAccumulators(null, source), null);
});

test("multi currency accumulators expose the breakdown but no single total", () => {
  const accumulator = createCurrencyAccumulator();
  addCurrencyAmount(accumulator, "CNY", 100);
  addCurrencyAmount(accumulator, "USD", 20);

  assert.deepEqual(buildAmountSummaryFromAccumulator(accumulator), {
    totals_by_currency: [
      { currency: "CNY", amount: 100 },
      { currency: "USD", amount: 20 },
    ],
    total_monthly_cost: null,
    currency: null,
  });
});

test("accumulated money is rounded per currency step so binary drift never leaks", () => {
  const accumulator = createCurrencyAccumulator();
  addCurrencyAmount(accumulator, "CNY", 0.1);
  addCurrencyAmount(accumulator, "CNY", 0.2);

  assert.deepEqual(finalizeCurrencyAccumulator(accumulator), [{ currency: "CNY", amount: 0.3 }]);
});

test("empty node input degrades to the unlinked and incomplete shape", () => {
  const item = buildNodeCostSnapshot();

  assert.equal(item.node_id, null);
  assert.equal(item.node_name, "未知节点");
  assert.equal(item.provider_id, null);
  assert.equal(item.provider_name, null);
  assert.equal(item.billing_cycle, null);
  assert.equal(item.billing_amount, null);
  assert.equal(item.billing_currency, null);
  assert.equal(item.effective_currency, null);
  assert.equal(item.overage_price_per_gb, null);
  assert.equal(item.extra_fixed_monthly_cost, 0);
  assert.equal(item.overage_gb, 0);
  assert.equal(item.base_monthly_cost, null);
  // 没有超量时超额成本是 0，只有「有超量但缺单价」才是 null。
  assert.equal(item.overage_cost, 0);
  assert.equal(item.total_monthly_cost, null);
  assert.equal(item.cost_status, "unlinked_provider");
  assert.deepEqual(item.problems, [
    "未绑定稳定厂商 provider_id",
    "缺少账单金额、计费周期或超额单价",
  ]);
  assert.equal(item.active, false);
  assert.equal(item.idle, false);
  assert.equal(item.expiring_soon, false);
  assert.equal(item.expiry_days, null);
  assert.equal(item.auto_renew, false);
});

test("billing cycles normalize to a monthly amount", () => {
  const cases = [
    [{ billing_cycle: "月付", billing_amount: 100 }, 100],
    [{ billing_cycle: "季付", billing_amount: 300 }, 100],
    [{ billing_cycle: "年付", billing_amount: 1200 }, 100],
    [{ billing_cycle: "周付", billing_amount: 70 }, 300],
    [{ billing_cycle: "日付", billing_amount: 10 }, 300],
    [{ billing_cycle: "小时付", billing_amount: 1 }, 720],
    [{ billing_cycle: "一次性", billing_amount: 1200, amortization_months: 12 }, 100],
    [{ billing_cycle: "monthly", billing_amount: 100 }, 100],
    [{ billing_cycle: "one_time", billing_amount: 900, amortization_months: 9 }, 100],
  ];

  for (const [commercial, expected] of cases) {
    const item = snapshot({ billing_currency: "CNY", ...commercial });
    assert.equal(item.base_monthly_cost, expected, JSON.stringify(commercial));
    assert.equal(item.total_monthly_cost, expected, JSON.stringify(commercial));
    assert.equal(item.cost_status, "ok", JSON.stringify(commercial));
    assert.deepEqual(item.problems, [], JSON.stringify(commercial));
  }
});

test("cycle divisions round to cents", () => {
  assert.equal(snapshot({ billing_cycle: "季付", billing_amount: 100, billing_currency: "CNY" }).base_monthly_cost, 33.33);
  assert.equal(snapshot({ billing_cycle: "年付", billing_amount: 100, billing_currency: "CNY" }).base_monthly_cost, 8.33);
  assert.equal(snapshot({ billing_cycle: "周付", billing_amount: 10, billing_currency: "CNY" }).base_monthly_cost, 42.86);
  assert.equal(
    monthlyKeys(
      snapshot(
        { billing_cycle: "季付", billing_amount: 100, billing_currency: "CNY", traffic_quota_gb: 0, traffic_used_gb: 0.01, overage_price_per_gb: 3 },
      ),
    ).total,
    33.36,
  );
});

test("one-time billing amortization guards division by zero and negative months", () => {
  for (const amortization of [undefined, null, 0, -3, ""]) {
    const item = snapshot({
      billing_cycle: "一次性",
      billing_amount: 1200,
      billing_currency: "CNY",
      amortization_months: amortization,
    });

    assert.equal(item.base_monthly_cost, null, String(amortization));
    assert.equal(item.total_monthly_cost, null, String(amortization));
    assert.equal(item.cost_status, "invalid_once_amortization", String(amortization));
    assert.deepEqual(
      item.problems,
      ["一次性账单缺少有效折旧月数", "缺少账单金额、计费周期或超额单价"],
      String(amortization),
    );
  }

  assert.equal(
    snapshot({ billing_cycle: "一次性", billing_amount: 1200, billing_currency: "CNY", amortization_months: 1 }).base_monthly_cost,
    1200,
  );
});

test("missing or invalid billing fields surface as problems, never as silent numbers", () => {
  const invalidCycle = snapshot({ billing_cycle: "双周付", billing_amount: 100, billing_currency: "CNY" });
  assert.equal(invalidCycle.billing_cycle, "双周付");
  assert.equal(invalidCycle.base_monthly_cost, null);
  assert.equal(invalidCycle.cost_status, "invalid_cycle");
  assert.deepEqual(invalidCycle.problems, ["计费周期不合法", "缺少账单金额、计费周期或超额单价"]);

  const missingAmount = snapshot({ billing_cycle: "月付", billing_currency: "CNY" });
  assert.equal(missingAmount.cost_status, "incomplete");
  assert.equal(missingAmount.base_monthly_cost, null);
  assert.equal(missingAmount.total_monthly_cost, null);

  const missingCycle = snapshot({ billing_amount: 100, billing_currency: "CNY" });
  assert.equal(missingCycle.billing_cycle, null);
  assert.equal(missingCycle.cost_status, "incomplete");

  // 有金额无币种：仍算出月成本，但标记为不完整，聚合侧会整体忽略。
  const missingCurrency = snapshot({ billing_cycle: "月付", billing_amount: 100 });
  assert.equal(missingCurrency.effective_currency, null);
  assert.equal(missingCurrency.total_monthly_cost, 100);
  assert.equal(missingCurrency.cost_status, "incomplete");
  assert.deepEqual(missingCurrency.problems, ["缺少账单金额、计费周期或超额单价"]);
});

test("currency resolution prefers the bill and falls back to the provider default", () => {
  const fromNode = snapshot({ billing_cycle: "月付", billing_amount: 100, billing_currency: "usd" });
  assert.equal(fromNode.billing_currency, "USD");
  assert.equal(fromNode.effective_currency, "USD");

  const fromProvider = snapshot(
    { billing_cycle: "月付", billing_amount: 100, billing_currency: "元" },
    { provider: { id: "provider_1", name: "厂商甲", default_currency: "CNY" } },
  );
  assert.equal(fromProvider.billing_currency, null);
  assert.equal(fromProvider.effective_currency, "CNY");

  const providerOnly = snapshot({ billing_cycle: "月付", billing_amount: 100 }, {
    provider: { id: "provider_1", name: "厂商甲", default_currency: "EUR" },
  });
  assert.equal(providerOnly.effective_currency, "EUR");
});

test("traffic overage is metered against the quota and priced per gb", () => {
  const overQuota = snapshot({
    billing_cycle: "月付",
    billing_amount: 100,
    billing_currency: "CNY",
    traffic_quota_gb: 60,
    traffic_used_gb: 100,
    extra_fixed_monthly_cost: 5.5,
  }, {
    provider: { id: "provider_1", name: "厂商甲", default_overage_price_per_gb: 0.5 },
  });

  assert.deepEqual(monthlyKeys(overQuota), {
    base: 100,
    overage: 20,
    total: 125.5,
    status: "ok",
    currency: "CNY",
  });

  const withinQuota = snapshot({
    billing_cycle: "月付",
    billing_amount: 100,
    billing_currency: "CNY",
    traffic_quota_gb: 60,
    traffic_used_gb: 10,
  });
  assert.deepEqual(monthlyKeys(withinQuota), {
    base: 100,
    overage: 0,
    total: 100,
    status: "ok",
    currency: "CNY",
  });

  const freeOverage = snapshot({
    billing_cycle: "月付",
    billing_amount: 100,
    billing_currency: "CNY",
    traffic_quota_gb: 60,
    traffic_used_gb: 70,
    overage_price_per_gb: 0,
  });
  assert.deepEqual(monthlyKeys(freeOverage), {
    base: 100,
    overage: 0,
    total: 100,
    status: "ok",
    currency: "CNY",
  });

  const noPrice = snapshot({
    billing_cycle: "月付",
    billing_amount: 100,
    billing_currency: "CNY",
    traffic_quota_gb: 60,
    traffic_used_gb: 100,
  });
  assert.equal(noPrice.overage_gb, 40);
  assert.equal(noPrice.overage_cost, null);
  assert.equal(noPrice.total_monthly_cost, null);
  assert.equal(noPrice.cost_status, "incomplete");
  // 同一个 incomplete 编码被推了两次，出口按首次出现去重。
  assert.deepEqual(noPrice.problems, ["缺少账单金额、计费周期或超额单价"]);

  const quotaOnly = snapshot({
    billing_cycle: "月付",
    billing_amount: 100,
    billing_currency: "CNY",
    traffic_used_gb: 100,
  });
  assert.equal(quotaOnly.overage_gb, 0);
  assert.equal(quotaOnly.total_monthly_cost, 100);

  const usageOnly = snapshot({
    billing_cycle: "月付",
    billing_amount: 100,
    billing_currency: "CNY",
    traffic_quota_gb: 100,
  });
  assert.equal(usageOnly.overage_gb, 0);
  assert.equal(usageOnly.total_monthly_cost, 100);
});

test("extra fixed cost alone is still reported as incomplete and never totals", () => {
  const item = snapshot({ billing_currency: "CNY", extra_fixed_monthly_cost: 50 }, {
    provider: { id: "provider_1", name: "厂商甲", default_currency: "CNY" },
  });

  assert.equal(item.extra_fixed_monthly_cost, 50);
  assert.equal(item.total_monthly_cost, null);
  assert.equal(item.cost_status, "incomplete");
});

test("problem codes resolve to a single status by priority", () => {
  // 优先级：一次性折旧 > 计费周期 > 未绑定厂商 > 数据不完整。
  const cycleBeatsUnlinked = snapshot({ billing_cycle: "双周付", billing_amount: 100 }, {
    provider: null,
    node: { provider_id: null },
  });
  assert.equal(cycleBeatsUnlinked.cost_status, "invalid_cycle");
  assert.deepEqual(cycleBeatsUnlinked.problems, [
    "未绑定稳定厂商 provider_id",
    "计费周期不合法",
    "缺少账单金额、计费周期或超额单价",
  ]);

  const onceBeatsEverything = snapshot({ billing_cycle: "一次性", billing_amount: 100, amortization_months: 0 }, {
    provider: null,
    node: { provider_id: null },
  });
  assert.equal(onceBeatsEverything.cost_status, "invalid_once_amortization");

  const unlinkedBeatsIncomplete = snapshot({ billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY" }, {
    provider: null,
    node: { provider_id: null },
  });
  assert.equal(unlinkedBeatsIncomplete.cost_status, "unlinked_provider");

  const unknownProviderId = snapshot({ billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY" }, {
    node: { provider_id: "provider_missing" },
    provider: null,
  });
  assert.equal(unknownProviderId.cost_status, "unlinked_provider");
  assert.deepEqual(unknownProviderId.problems, ["未绑定稳定厂商 provider_id"]);
});

test("identity fields fall back through hostname, name and id before the placeholder", () => {
  const providerless = buildNodeCostSnapshot({
    id: "node_9",
    provider_id: "provider_missing",
    name: "备用名",
    labels: { provider: "外部厂商", region: "华东" },
  });
  assert.equal(providerless.node_name, "备用名");
  assert.equal(providerless.provider_name, "外部厂商");
  assert.equal(providerless.provider_label, "外部厂商");
  assert.equal(providerless.region, "华东");
  assert.equal(providerless.source, null);

  assert.equal(buildNodeCostSnapshot({ id: "node_9" }).node_name, "node_9");
  assert.equal(
    buildNodeCostSnapshot({ id: "node_9", facts: { hostname: "hk-01" }, hostname: "ignored" }).node_name,
    "hk-01",
  );
  assert.equal(
    buildNodeCostSnapshot({ id: "node_9", hostname: "hk-02", name: "ignored" }).node_name,
    "hk-02",
  );
});

test("bill metadata is passed through untouched", () => {
  const item = snapshot(
    {
      billing_cycle: "月付",
      billing_amount: 100,
      billing_currency: "CNY",
      cost_note: "含带宽赠送",
      note: "内部备注",
      auto_renew: true,
      billing_started_at: "2026-01-01",
      expires_at: "2026-12-31",
    },
    { node: { source: "manual" } },
  );

  assert.equal(item.cost_note, "含带宽赠送");
  assert.equal(item.note, "内部备注");
  assert.equal(item.auto_renew, true);
  assert.equal(item.billing_started_at, "2026-01-01");
  assert.equal(item.expires_at, "2026-12-31");
  assert.equal(item.source, "manual");
  assert.equal(item.amortization_months, null);
});

test("active and idle flags follow the deployed node set", () => {
  const commercial = { billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY" };
  const activeNodeIds = new Set(["node_1"]);

  const active = snapshot(commercial, { activeNodeIds });
  assert.equal(active.active, true);
  assert.equal(active.idle, false);

  const idle = snapshot(commercial, { activeNodeIds: new Set(["other"]) });
  assert.equal(idle.active, false);
  assert.equal(idle.idle, true);

  // 无成本可算的节点既不算活跃也不算闲置。
  const unknown = snapshot({}, { activeNodeIds: new Set(["node_1"]) });
  assert.equal(unknown.active, true);
  assert.equal(unknown.idle, false);

  // activeNodeIds 不是 Set 时按空集处理，而不是误判。
  const wrongType = snapshot(commercial, { activeNodeIds: ["node_1"] });
  assert.equal(wrongType.active, false);
  assert.equal(wrongType.idle, true);
});

test("expiry days count whole days for date-only values and round up for timestamps", () => {
  const cases = [
    ["2026-03-20", 5],
    ["2026-03-15", 0],
    ["2026-03-16", 1],
    ["2026-03-14", -1],
    ["2026-04-30", 46],
    ["2026-03-16T00:00:00Z", 1],
    ["2026-03-16T12:00:00Z", 1],
    ["2026-03-20T23:00:00Z", 6],
  ];

  for (const [expiresAt, expected] of cases) {
    const item = snapshot({ billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY", expires_at: expiresAt });
    assert.equal(item.expiry_days, expected, expiresAt);
  }

  for (const expiresAt of ["", null, undefined, "昨天", "2026-13-45"]) {
    const item = snapshot({ billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY", expires_at: expiresAt });
    assert.equal(item.expiry_days, null, String(expiresAt));
    assert.equal(item.expiring_soon, false, String(expiresAt));
  }
});

test("expiring soon respects the threshold and ignores past dates", () => {
  const within = snapshot({ billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY", expires_at: "2026-03-20" });
  assert.equal(within.expiry_days, 5);
  assert.equal(within.expiring_soon, true);

  const boundary = snapshot({ billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY", expires_at: "2026-03-22" });
  assert.equal(boundary.expiring_soon, true);

  const outside = snapshot({ billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY", expires_at: "2026-03-23" });
  assert.equal(outside.expiring_soon, false);

  const customThreshold = snapshot(
    { billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY", expires_at: "2026-03-20" },
    { snapshot: { expiringThresholdDays: 3 } },
  );
  assert.equal(customThreshold.expiry_days, 5);
  assert.equal(customThreshold.expiring_soon, false);

  // 已过期不算到期提醒。
  const expired = snapshot({ billing_cycle: "月付", billing_amount: 100, billing_currency: "CNY", expires_at: "2026-03-01" });
  assert.equal(expired.expiry_days, -14);
  assert.equal(expired.expiring_soon, false);
});

test("budget summary normalizes currency, amount and alert threshold", () => {
  assert.deepEqual(normalizeBudgetSummary(), {
    default_currency: null,
    monthly_budget: null,
    budget_alert_threshold: null,
  });

  assert.deepEqual(normalizeBudgetSummary({}), {
    default_currency: null,
    monthly_budget: null,
    budget_alert_threshold: null,
  });

  assert.deepEqual(
    normalizeBudgetSummary({
      default_currency: "cny",
      monthly_budget: "1200.5",
      budget_alert_threshold: 0.8,
    }),
    { default_currency: "CNY", monthly_budget: 1200.5, budget_alert_threshold: 80 },
  );

  assert.deepEqual(
    normalizeBudgetSummary({ default_currency: "人民币", monthly_budget: "", budget_alert_threshold: 1 }),
    { default_currency: null, monthly_budget: null, budget_alert_threshold: 100 },
  );

  // 长度合规但语义仍是币种的字符串会被原样大写收下（校验口径在上游）。
  assert.equal(normalizeBudgetSummary({ default_currency: "cnytwo" }).default_currency, "CNYTWO");

  // 阈值非法时回落为 null，金额负值则由上游校验拦截。
  assert.deepEqual(
    normalizeBudgetSummary({ default_currency: "CNY", monthly_budget: -5, budget_alert_threshold: -1 }),
    { default_currency: "CNY", monthly_budget: -5, budget_alert_threshold: null },
  );
});
