import { createHash } from "node:crypto";

const ROLLBACK_COMPONENTS = [
  { planKey: "sing_box", artifactKey: "sing_box", label: "sing-box" },
  { planKey: "traffic_forwarder", artifactKey: "traffic_forwarder", label: "haproxy" },
];

export function buildDeploymentPlanDigest(deploymentPlans) {
  const digestPayload = deploymentPlans.map((plan) => ({
    node_id: plan.node_id,
    route_roles: [...plan.route_roles].sort(),
    sing_box_digest: plan.components.sing_box?.renderPlan?.digest ?? null,
    traffic_forwarder_digest: plan.components.traffic_forwarder?.renderPlan?.digest ?? null,
    entry_ports:
      plan.components.traffic_forwarder?.renderPlan?.bindings?.map((binding) => binding.entry_port) ?? [],
  }));
  return createHash("sha256").update(JSON.stringify(digestPayload)).digest("hex").slice(0, 12);
}

function buildRollbackRenderPlan({ liveRenderPlan, stored, label, nodeLabel }) {
  if (!stored || typeof stored !== "object" || stored.rendered_config === undefined) {
    throw new Error(`目标发布缺少 ${label} 组件产物，无法回滚：节点 ${nodeLabel}`);
  }
  const digest = typeof stored.config_digest === "string" ? stored.config_digest : null;
  if (!digest) {
    throw new Error(`目标发布的 ${label} 产物缺少配置摘要，无法回滚：节点 ${nodeLabel}`);
  }

  const metadata = { ...(liveRenderPlan?.metadata ?? {}) };
  if (stored.config_path) {
    metadata.config_path = stored.config_path;
  }
  if (!metadata.config_path) {
    throw new Error(`目标发布的 ${label} 产物缺少配置文件路径，无法回滚：节点 ${nodeLabel}`);
  }

  const usesRealityKey =
    label === "sing-box" &&
    JSON.stringify(stored.rendered_config).includes("__AIRPORT_REALITY_PRIVATE_KEY__");
  // 私钥注入只由产物里是否还有占位符决定：模板后来改成 Reality 也不该给旧配置注入私钥。
  metadata.security = usesRealityKey
    ? "reality"
    : metadata.security === "reality"
      ? "none"
      : metadata.security ?? null;
  if (usesRealityKey && !metadata.reality_private_key_path) {
    throw new Error(`当前协议模板未提供 Reality 私钥路径，无法回滚：节点 ${nodeLabel}`);
  }

  return {
    engine: stored.engine ?? metadata.engine ?? null,
    config: stored.rendered_config,
    digest,
    metadata,
    ...(label === "haproxy"
      ? { bindings: Array.isArray(stored.bindings) ? stored.bindings : liveRenderPlan?.bindings ?? [] }
      : {}),
  };
}

function uniqueIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && id))];
}

function userLabel(findUser, id) {
  const user = findUser?.(id);
  return { id, name: user?.name ?? id };
}

export function buildRollbackUserDiff({ currentRelease, targetRelease, findUser }) {
  const currentIds = uniqueIds(currentRelease?.access_user_ids);
  const targetIds = uniqueIds(targetRelease?.access_user_ids);

  return {
    target_release_id: targetRelease?.id ?? null,
    target_version: targetRelease?.version ?? null,
    current_release_id: currentRelease?.id ?? null,
    current_version: currentRelease?.version ?? null,
    target_node_count: uniqueIds(targetRelease?.deployment_node_ids).length,
    current_node_count: uniqueIds(currentRelease?.deployment_node_ids).length,
    // 回滚逐字节回放目标发布的产物，所以这些用户会从节点配置里消失。
    lost_users: currentIds.filter((id) => !targetIds.includes(id)).map((id) => userLabel(findUser, id)),
    restored_users: targetIds.filter((id) => !currentIds.includes(id)).map((id) => userLabel(findUser, id)),
  };
}

export function applyRollbackRenderPlans(deploymentPlan, sourceRelease) {
  const plans = deploymentPlan?.deploymentPlans ?? [];
  const deployments = Array.isArray(sourceRelease?.deployments) ? sourceRelease.deployments : [];
  const deploymentsByNodeId = new Map(deployments.map((item) => [item.node_id, item]));
  const planNodeIds = new Set(plans.map((plan) => plan.node_id));

  const missingSourceNodes = plans
    .map((plan) => plan.node_id)
    .filter((nodeId) => !deploymentsByNodeId.has(nodeId));
  if (missingSourceNodes.length > 0) {
    throw new Error(
      `目标发布没有覆盖这些节点，无法回滚：${missingSourceNodes.map((nodeId) => plans.find((plan) => plan.node_id === nodeId)?.node_name ?? nodeId).join("、")}`,
    );
  }

  const droppedNodes = deployments
    .map((deployment) => deployment.node_id)
    .filter((nodeId) => !planNodeIds.has(nodeId));
  if (droppedNodes.length > 0) {
    throw new Error(
      `当前线路拓扑与目标发布不一致，无法回滚：${droppedNodes.map((nodeId) => deploymentsByNodeId.get(nodeId)?.node_name ?? nodeId).join("、")}`,
    );
  }

  for (const plan of plans) {
    const sourceDeployment = deploymentsByNodeId.get(plan.node_id);
    const sourceArtifacts = sourceDeployment?.artifacts ?? {};
    const nodeLabel = plan.node_name ?? plan.node_id;

    for (const component of ROLLBACK_COMPONENTS) {
      const liveComponent = plan.components?.[component.planKey];
      if (!liveComponent?.renderPlan) {
        continue;
      }
      liveComponent.renderPlan = buildRollbackRenderPlan({
        liveRenderPlan: liveComponent.renderPlan,
        stored: sourceArtifacts[component.artifactKey],
        label: component.label,
        nodeLabel,
      });
    }
  }

  const digest = buildDeploymentPlanDigest(plans);
  deploymentPlan.digest = digest;
  deploymentPlan.change_summary = `回滚到 ${sourceRelease?.version ?? sourceRelease?.id}（重新下发该发布的产物配置）`;
  deploymentPlan.rollbackSource = {
    release_id: sourceRelease?.id ?? null,
    version: sourceRelease?.version ?? null,
    config_digest: sourceRelease?.summary?.config_digest_after ?? sourceRelease?.summary?.config_digest ?? null,
  };

  return deploymentPlan.rollbackSource;
}
