import {
  normalizeBillingCycle,
  normalizeBudgetThreshold,
  normalizeCostCurrency,
  normalizeNullableInteger,
  normalizeNullableNumber,
} from "./normalize.js";

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function computeExpiryDays(expiresAt, nowValue = Date.now()) {
  const normalized = String(expiresAt || "").trim();
  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const today = new Date(nowValue).toISOString().slice(0, 10);
    const delta =
      Date.parse(`${normalized}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
    return Number.isFinite(delta) ? Math.round(delta / (24 * 60 * 60 * 1000)) : null;
  }

  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.ceil((parsed - nowValue) / (24 * 60 * 60 * 1000));
}

function createProblemDefinitions() {
  return {
    unlinked_provider: "未绑定稳定厂商 provider_id",
    invalid_cycle: "计费周期不合法",
    invalid_once_amortization: "一次性账单缺少有效折旧月数",
    incomplete: "缺少账单金额、计费周期或超额单价",
  };
}

function resolveCostStatus(problemCodes = []) {
  if (problemCodes.includes("invalid_once_amortization")) {
    return "invalid_once_amortization";
  }
  if (problemCodes.includes("invalid_cycle")) {
    return "invalid_cycle";
  }
  if (problemCodes.includes("unlinked_provider")) {
    return "unlinked_provider";
  }
  if (problemCodes.includes("incomplete")) {
    return "incomplete";
  }
  return "ok";
}

export function createCurrencyAccumulator() {
  return new Map();
}

export function addCurrencyAmount(accumulator, currency, amount) {
  if (!(accumulator instanceof Map)) {
    return accumulator;
  }

  const normalizedCurrency = normalizeCostCurrency(currency);
  const numericAmount = normalizeNullableNumber(amount);
  if (!normalizedCurrency || !Number.isFinite(numericAmount)) {
    return accumulator;
  }

  accumulator.set(
    normalizedCurrency,
    roundMoney((accumulator.get(normalizedCurrency) ?? 0) + numericAmount),
  );
  return accumulator;
}

export function mergeCurrencyAccumulators(target, source) {
  if (!(target instanceof Map) || !(source instanceof Map)) {
    return target;
  }

  for (const [currency, amount] of source.entries()) {
    addCurrencyAmount(target, currency, amount);
  }

  return target;
}

export function finalizeCurrencyAccumulator(accumulator) {
  if (!(accumulator instanceof Map)) {
    return [];
  }

  return [...accumulator.entries()]
    .map(([currency, amount]) => ({
      currency,
      amount: roundMoney(amount),
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

export function buildAmountSummaryFromAccumulator(accumulator) {
  const totalsByCurrency = finalizeCurrencyAccumulator(accumulator);
  if (totalsByCurrency.length === 1) {
    return {
      totals_by_currency: totalsByCurrency,
      total_monthly_cost: totalsByCurrency[0].amount,
      currency: totalsByCurrency[0].currency,
    };
  }

  return {
    totals_by_currency: totalsByCurrency,
    total_monthly_cost: null,
    currency: null,
  };
}

function computeBaseMonthlyCost(billingCycle, billingAmount, amortizationMonths) {
  if (!Number.isFinite(billingAmount) || !billingCycle) {
    return null;
  }

  switch (billingCycle) {
    case "月付":
      return roundMoney(billingAmount);
    case "季付":
      return roundMoney(billingAmount / 3);
    case "年付":
      return roundMoney(billingAmount / 12);
    case "周付":
      return roundMoney((billingAmount * 30) / 7);
    case "日付":
      return roundMoney(billingAmount * 30);
    case "小时付":
      return roundMoney(billingAmount * 24 * 30);
    case "一次性":
      return amortizationMonths > 0 ? roundMoney(billingAmount / amortizationMonths) : null;
    default:
      return null;
  }
}

export function buildNodeCostSnapshot(node, options = {}) {
  const provider = options.provider ?? null;
  const activeNodeIds = options.activeNodeIds instanceof Set ? options.activeNodeIds : new Set();
  const nowValue = Number.isFinite(options.nowValue) ? options.nowValue : Date.now();
  const expiringThresholdDays = Number.isFinite(options.expiringThresholdDays)
    ? options.expiringThresholdDays
    : 7;
  const commercial =
    node?.commercial && typeof node.commercial === "object" ? node.commercial : {};
  const billingCycle = normalizeBillingCycle(commercial.billing_cycle);
  const billingAmount = normalizeNullableNumber(commercial.billing_amount);
  const amortizationMonths = normalizeNullableInteger(commercial.amortization_months);
  const overagePricePerGb = normalizeNullableNumber(
    commercial.overage_price_per_gb ?? provider?.default_overage_price_per_gb,
  );
  const extraFixedMonthlyCost =
    normalizeNullableNumber(commercial.extra_fixed_monthly_cost, 0) ?? 0;
  const trafficQuotaGb = normalizeNullableNumber(commercial.traffic_quota_gb);
  const trafficUsedGb = normalizeNullableNumber(commercial.traffic_used_gb);
  const overageGb =
    Number.isFinite(trafficUsedGb) && Number.isFinite(trafficQuotaGb)
      ? roundMoney(Math.max(trafficUsedGb - trafficQuotaGb, 0))
      : 0;
  const problemCodes = [];

  if (!node?.provider_id || !provider) {
    problemCodes.push("unlinked_provider");
  }

  if (commercial.billing_cycle && !billingCycle) {
    problemCodes.push("invalid_cycle");
  }

  if (billingCycle === "一次性" && !(amortizationMonths > 0)) {
    problemCodes.push("invalid_once_amortization");
  }

  const baseMonthlyCost = computeBaseMonthlyCost(
    billingCycle,
    billingAmount,
    amortizationMonths,
  );
  if (billingAmount === null || !billingCycle || baseMonthlyCost === null) {
    problemCodes.push("incomplete");
  }

  let overageCost = 0;
  if (overageGb > 0) {
    if (!Number.isFinite(overagePricePerGb)) {
      overageCost = null;
      problemCodes.push("incomplete");
    } else {
      overageCost = roundMoney(overageGb * overagePricePerGb);
    }
  }

  const totalMonthlyCost =
    Number.isFinite(baseMonthlyCost) && Number.isFinite(overageCost)
      ? roundMoney(baseMonthlyCost + overageCost + extraFixedMonthlyCost)
      : null;
  const currency =
    normalizeCostCurrency(commercial.billing_currency) ??
    normalizeCostCurrency(provider?.default_currency) ??
    null;
  if ((Number.isFinite(baseMonthlyCost) || Number.isFinite(overageCost) || extraFixedMonthlyCost > 0) && !currency) {
    problemCodes.push("incomplete");
  }
  const expiryDays = computeExpiryDays(commercial.expires_at, nowValue);
  const problemDefinitions = createProblemDefinitions();
  const uniqueProblemCodes = [...new Set(problemCodes)];

  return {
    node_id: node?.id ?? null,
    node_name: node?.facts?.hostname ?? node?.hostname ?? node?.name ?? node?.id ?? "未知节点",
    provider_id: node?.provider_id ?? null,
    provider_name: provider?.name ?? node?.labels?.provider ?? null,
    provider_label: node?.labels?.provider ?? null,
    source: node?.source ?? null,
    region: node?.labels?.region ?? null,
    billing_cycle: billingCycle ?? commercial.billing_cycle ?? null,
    billing_amount: billingAmount,
    billing_currency: normalizeCostCurrency(commercial.billing_currency) ?? null,
    effective_currency: currency,
    amortization_months: amortizationMonths,
    overage_price_per_gb: overagePricePerGb,
    extra_fixed_monthly_cost: roundMoney(extraFixedMonthlyCost),
    traffic_quota_gb: trafficQuotaGb,
    traffic_used_gb: trafficUsedGb,
    overage_gb: overageGb,
    base_monthly_cost: baseMonthlyCost,
    overage_cost: overageCost,
    total_monthly_cost: totalMonthlyCost,
    cost_status: resolveCostStatus(uniqueProblemCodes),
    problems: uniqueProblemCodes.map((code) => problemDefinitions[code] || code),
    expires_at: commercial.expires_at ?? null,
    billing_started_at: commercial.billing_started_at ?? null,
    auto_renew: Boolean(commercial.auto_renew),
    cost_note: commercial.cost_note ?? null,
    note: commercial.note ?? null,
    active: activeNodeIds.has(node?.id),
    idle: totalMonthlyCost !== null && !activeNodeIds.has(node?.id),
    expiring_soon:
      expiryDays !== null && expiryDays >= 0 && expiryDays <= expiringThresholdDays,
    expiry_days: expiryDays,
  };
}

export function normalizeBudgetSummary(provider = {}) {
  return {
    default_currency: normalizeCostCurrency(provider.default_currency) ?? null,
    monthly_budget: normalizeNullableNumber(provider.monthly_budget),
    budget_alert_threshold: normalizeBudgetThreshold(provider.budget_alert_threshold),
  };
}
