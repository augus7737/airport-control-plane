import {
  addCurrencyAmount,
  buildAmountSummaryFromAccumulator,
  createCurrencyAccumulator,
} from "./calculator.js";

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).filter(Boolean).map(String))];
}

function sortByNewest(left, right) {
  const leftTimestamp =
    Date.parse(left?.finished_at || left?.created_at || left?.updated_at || "") || 0;
  const rightTimestamp =
    Date.parse(right?.finished_at || right?.created_at || right?.updated_at || "") || 0;

  return (
    rightTimestamp - leftTimestamp ||
    String(right?.created_at || "").localeCompare(String(left?.created_at || ""))
  );
}

function isSuccessStatus(status) {
  return String(status || "").trim().toLowerCase() === "success";
}

function resolveReleaseNodeIds(release) {
  return uniqueStrings([
    ...(Array.isArray(release?.deployment_node_ids) ? release.deployment_node_ids : []),
    ...(Array.isArray(release?.entry_node_ids) ? release.entry_node_ids : []),
    ...(Array.isArray(release?.node_ids) ? release.node_ids : []),
  ]);
}

function findReleaseDeployment(release, nodeId) {
  const deployments = Array.isArray(release?.deployments) ? release.deployments : [];
  return deployments.find((item) => item?.node_id === nodeId) || null;
}

export function findLatestSuccessfulReleaseForNode(nodeId, releases = []) {
  const candidates = [];

  for (const release of Array.isArray(releases) ? releases : []) {
    if (!release?.id) {
      continue;
    }

    const deployment = findReleaseDeployment(release, nodeId);
    const includesNode = Boolean(deployment) || resolveReleaseNodeIds(release).includes(nodeId);
    if (!includesNode) {
      continue;
    }

    const successful = deployment ? isSuccessStatus(deployment.status) : isSuccessStatus(release.status);
    if (!successful) {
      continue;
    }

    candidates.push({
      release,
      deployment,
      finished_at: deployment?.finished_at ?? release.finished_at ?? release.created_at ?? null,
      created_at: release.created_at ?? null,
    });
  }

  candidates.sort(sortByNewest);
  return candidates[0] || null;
}

export function findActiveNodeIds(nodes = [], releases = []) {
  const activeNodeIds = new Set();

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node?.id) {
      continue;
    }

    if (findLatestSuccessfulReleaseForNode(node.id, releases)) {
      activeNodeIds.add(node.id);
    }
  }

  return activeNodeIds;
}

export function buildReleaseCostItems(releases = [], nodeCostByNodeId = new Map()) {
  return [...(Array.isArray(releases) ? releases : [])]
    .map((release) => {
      const involvedNodeIds = resolveReleaseNodeIds(release);
      const totalsAccumulator = createCurrencyAccumulator();
      const activeAccessUserCount = uniqueStrings(release?.access_user_ids).length;
      const nodeCosts = involvedNodeIds.map((nodeId) => {
        const cost = nodeCostByNodeId.get(nodeId) || null;
        if (cost?.effective_currency && Number.isFinite(cost.total_monthly_cost)) {
          addCurrencyAmount(totalsAccumulator, cost.effective_currency, cost.total_monthly_cost);
        }

        const deployment = findReleaseDeployment(release, nodeId);
        return {
          node_id: nodeId,
          node_name: cost?.node_name ?? nodeId,
          provider_id: cost?.provider_id ?? null,
          provider_name: cost?.provider_name ?? null,
          route_roles: Array.isArray(deployment?.route_roles) ? deployment.route_roles : [],
          cost_status: cost?.cost_status ?? "incomplete",
          total_monthly_cost: cost?.total_monthly_cost ?? null,
          currency: cost?.effective_currency ?? null,
          problems: Array.isArray(cost?.problems) ? cost.problems : [],
        };
      });
      const totalSummary = buildAmountSummaryFromAccumulator(totalsAccumulator);
      const perUserTotals = totalSummary.totals_by_currency.map((item) => ({
        currency: item.currency,
        amount:
          activeAccessUserCount > 0
            ? Math.round(((item.amount / activeAccessUserCount) + Number.EPSILON) * 100) / 100
            : null,
      }));

      return {
        release_id: release?.id ?? null,
        title: release?.title ?? release?.id ?? "未命名发布",
        status: release?.status ?? null,
        profile_id: release?.profile_id ?? null,
        created_at: release?.created_at ?? null,
        finished_at: release?.finished_at ?? null,
        deployment_node_ids: uniqueStrings(release?.deployment_node_ids),
        entry_node_ids: uniqueStrings(release?.entry_node_ids),
        node_ids: involvedNodeIds,
        node_count: involvedNodeIds.length,
        active_access_user_count: activeAccessUserCount,
        totals_by_currency: totalSummary.totals_by_currency,
        total_monthly_cost: totalSummary.total_monthly_cost,
        currency: totalSummary.currency,
        per_user_totals_by_currency: perUserTotals,
        per_user_monthly_cost:
          perUserTotals.length === 1 ? perUserTotals[0].amount : null,
        per_user_currency: perUserTotals.length === 1 ? perUserTotals[0].currency : null,
        incomplete_node_count: nodeCosts.filter((item) => item.total_monthly_cost === null).length,
        node_costs: nodeCosts,
      };
    })
    .sort(sortByNewest);
}

export function findLatestSuccessfulReleaseForAccessUser(accessUser, releases = []) {
  const accessUserId = accessUser?.id;
  if (!accessUserId) {
    return null;
  }

  const profileId = accessUser?.profile_id ?? null;
  return [...(Array.isArray(releases) ? releases : [])]
    .filter((release) => {
      if (!release?.id || !isSuccessStatus(release.status)) {
        return false;
      }

      const accessUserIds = uniqueStrings(release.access_user_ids);
      if (!accessUserIds.includes(accessUserId)) {
        return false;
      }

      if (profileId && release.profile_id && release.profile_id !== profileId) {
        return false;
      }

      return true;
    })
    .sort(sortByNewest)[0] ?? null;
}

export function buildAccessUserCostItems(
  accessUsers = [],
  releases = [],
  releaseCostByReleaseId = new Map(),
) {
  return [...(Array.isArray(accessUsers) ? accessUsers : [])]
    .map((accessUser) => {
      const release = findLatestSuccessfulReleaseForAccessUser(accessUser, releases);
      const releaseCost = release ? releaseCostByReleaseId.get(release.id) || null : null;

      return {
        access_user_id: accessUser?.id ?? null,
        name: accessUser?.name ?? accessUser?.id ?? "未命名用户",
        status: accessUser?.status ?? null,
        profile_id: accessUser?.profile_id ?? null,
        protocol: accessUser?.protocol ?? null,
        current_release_id: release?.id ?? null,
        current_release_title: release?.title ?? null,
        current_release_created_at: release?.created_at ?? null,
        release_node_count: releaseCost?.node_count ?? 0,
        active_access_user_count: releaseCost?.active_access_user_count ?? 0,
        estimated_totals_by_currency: Array.isArray(releaseCost?.per_user_totals_by_currency)
          ? releaseCost.per_user_totals_by_currency
          : [],
        estimated_monthly_cost: releaseCost?.per_user_monthly_cost ?? null,
        currency: releaseCost?.per_user_currency ?? null,
        cost_status: releaseCost ? "ok" : "incomplete",
        problems: releaseCost ? [] : ["当前没有可用于估算的最新成功发布"],
      };
    })
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "zh-CN"));
}
