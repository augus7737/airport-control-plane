import {
  addCurrencyAmount,
  buildAmountSummaryFromAccumulator,
  buildNodeCostSnapshot,
  createCurrencyAccumulator,
  normalizeBudgetSummary,
} from "./calculator.js";
import {
  buildAccessUserCostItems,
  buildReleaseCostItems,
  findActiveNodeIds,
} from "./allocation.js";

function sortByName(left, right) {
  return String(left?.name || "").localeCompare(String(right?.name || ""), "zh-CN");
}

function toProviderMap(providers = []) {
  return new Map(
    (Array.isArray(providers) ? providers : [])
      .filter((item) => item?.id)
      .map((item) => [item.id, item]),
  );
}

function computeBudgetUsage(provider, totalsByCurrency = []) {
  const budget = normalizeBudgetSummary(provider);
  const totalMap = new Map(
    (Array.isArray(totalsByCurrency) ? totalsByCurrency : []).map((item) => [item.currency, item.amount]),
  );
  const spendAmount = budget.default_currency
    ? totalMap.get(budget.default_currency) ?? null
    : totalsByCurrency.length === 1
      ? totalsByCurrency[0].amount
      : null;
  const usagePercent =
    Number.isFinite(spendAmount) && Number.isFinite(budget.monthly_budget) && budget.monthly_budget > 0
      ? Math.round(((spendAmount / budget.monthly_budget) * 100 + Number.EPSILON) * 100) / 100
      : null;

  return {
    ...budget,
    budget_usage_percent: usagePercent,
    budget_alert:
      Number.isFinite(usagePercent) &&
      Number.isFinite(budget.budget_alert_threshold) &&
      usagePercent >= budget.budget_alert_threshold,
  };
}

export function buildCostViews(input = {}) {
  const {
    accessUsers = [],
    nodes = [],
    providers = [],
    releases = [],
  } = input;
  const providerMap = toProviderMap(providers);
  const activeNodeIds = findActiveNodeIds(nodes, releases);
  const nodeItems = [...(Array.isArray(nodes) ? nodes : [])]
    .map((node) =>
      buildNodeCostSnapshot(node, {
        provider: providerMap.get(node?.provider_id) || null,
        activeNodeIds,
      }),
    )
    .sort((left, right) =>
      String(left?.node_name || "").localeCompare(String(right?.node_name || ""), "zh-CN"),
    );
  const nodeCostByNodeId = new Map(nodeItems.map((item) => [item.node_id, item]));
  const releaseItems = buildReleaseCostItems(releases, nodeCostByNodeId);
  const releaseCostByReleaseId = new Map(releaseItems.map((item) => [item.release_id, item]));
  const accessUserItems = buildAccessUserCostItems(accessUsers, releases, releaseCostByReleaseId);

  const providerItems = [...(Array.isArray(providers) ? providers : [])]
    .map((provider) => {
      const linkedNodes = nodeItems.filter((item) => item.provider_id === provider.id);
      const totalAccumulator = createCurrencyAccumulator();
      const activeAccumulator = createCurrencyAccumulator();
      const idleAccumulator = createCurrencyAccumulator();

      for (const nodeItem of linkedNodes) {
        if (nodeItem.effective_currency && Number.isFinite(nodeItem.total_monthly_cost)) {
          addCurrencyAmount(totalAccumulator, nodeItem.effective_currency, nodeItem.total_monthly_cost);
          if (nodeItem.active) {
            addCurrencyAmount(activeAccumulator, nodeItem.effective_currency, nodeItem.total_monthly_cost);
          }
          if (nodeItem.idle) {
            addCurrencyAmount(idleAccumulator, nodeItem.effective_currency, nodeItem.total_monthly_cost);
          }
        }
      }

      const totalSummary = buildAmountSummaryFromAccumulator(totalAccumulator);
      const activeSummary = buildAmountSummaryFromAccumulator(activeAccumulator);
      const idleSummary = buildAmountSummaryFromAccumulator(idleAccumulator);
      const budget = computeBudgetUsage(provider, totalSummary.totals_by_currency);

      return {
        provider_id: provider.id,
        name: provider.name ?? provider.id ?? "未命名厂商",
        status: provider.status ?? null,
        account_name: provider.account_name ?? null,
        regions: Array.isArray(provider.regions) ? provider.regions : [],
        linked_node_count: linkedNodes.length,
        incomplete_node_count: linkedNodes.filter((item) => item.total_monthly_cost === null).length,
        active_node_count: linkedNodes.filter((item) => item.active).length,
        idle_node_count: linkedNodes.filter((item) => item.idle).length,
        totals_by_currency: totalSummary.totals_by_currency,
        total_monthly_cost: totalSummary.total_monthly_cost,
        currency: totalSummary.currency,
        active_totals_by_currency: activeSummary.totals_by_currency,
        idle_totals_by_currency: idleSummary.totals_by_currency,
        budget_usage_percent: budget.budget_usage_percent,
        budget_alert: budget.budget_alert,
        monthly_budget: budget.monthly_budget,
        default_currency: budget.default_currency,
        budget_alert_threshold: budget.budget_alert_threshold,
      };
    })
    .sort(sortByName);

  const totalAccumulator = createCurrencyAccumulator();
  const idleAccumulator = createCurrencyAccumulator();
  const expiringAccumulator = createCurrencyAccumulator();

  for (const nodeItem of nodeItems) {
    if (!nodeItem.effective_currency || !Number.isFinite(nodeItem.total_monthly_cost)) {
      continue;
    }

    addCurrencyAmount(totalAccumulator, nodeItem.effective_currency, nodeItem.total_monthly_cost);
    if (nodeItem.idle) {
      addCurrencyAmount(idleAccumulator, nodeItem.effective_currency, nodeItem.total_monthly_cost);
    }
    if (nodeItem.expiring_soon) {
      addCurrencyAmount(expiringAccumulator, nodeItem.effective_currency, nodeItem.total_monthly_cost);
    }
  }

  const totalSummary = buildAmountSummaryFromAccumulator(totalAccumulator);
  const idleSummary = buildAmountSummaryFromAccumulator(idleAccumulator);
  const expiringSummary = buildAmountSummaryFromAccumulator(expiringAccumulator);

  return {
    summary: {
      node_count: nodeItems.length,
      provider_count: providerItems.length,
      active_node_count: nodeItems.filter((item) => item.active).length,
      idle_node_count: nodeItems.filter((item) => item.idle).length,
      cost_missing_node_count: nodeItems.filter((item) => item.total_monthly_cost === null).length,
      unlinked_provider_node_count: nodeItems.filter((item) => item.cost_status === "unlinked_provider").length,
      invalid_cycle_node_count: nodeItems.filter((item) => item.cost_status === "invalid_cycle").length,
      invalid_once_amortization_node_count: nodeItems.filter(
        (item) => item.cost_status === "invalid_once_amortization",
      ).length,
      totals_by_currency: totalSummary.totals_by_currency,
      total_monthly_cost: totalSummary.total_monthly_cost,
      currency: totalSummary.currency,
      idle_totals_by_currency: idleSummary.totals_by_currency,
      idle_monthly_cost: idleSummary.total_monthly_cost,
      idle_currency: idleSummary.currency,
      expiring_7d_totals_by_currency: expiringSummary.totals_by_currency,
      expiring_7d_monthly_cost: expiringSummary.total_monthly_cost,
      expiring_7d_currency: expiringSummary.currency,
    },
    nodes: nodeItems,
    providers: providerItems,
    releases: releaseItems,
    access_users: accessUserItems,
  };
}
