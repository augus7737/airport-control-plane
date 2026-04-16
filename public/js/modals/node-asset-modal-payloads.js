import { normalizeLocationValue } from "../shared/location-suggestions.js";

export function createNodeAssetModalPayloadsModule(dependencies = {}) {
  const {
    toNumberOrNull,
    findNodeById = () => null,
  } = dependencies;

  function resolveNodeLabel(node) {
    return node?.name || node?.hostname || node?.facts?.hostname || node?.id || null;
  }

  function resolveRelayReference({
    nodeId,
    fallbackLabel,
    fallbackRegion,
  }) {
    const normalizedNodeId = String(nodeId || "").trim() || null;
    const matchedNode = normalizedNodeId ? findNodeById(normalizedNodeId) : null;

    return {
      relay_node_id: normalizedNodeId,
      relay_label:
        resolveNodeLabel(matchedNode) ||
        String(fallbackLabel || "").trim() ||
        null,
      relay_region: matchedNode
        ? normalizeLocationValue(matchedNode.labels?.region, { scope: "region" })
        : normalizeLocationValue(fallbackRegion, { scope: "region" }),
    };
  }

  function collectBusinessRoutePayload(formData) {
    const accessMode = String(formData.get("access_mode") || "").trim() || "direct";
    const relayReference =
      accessMode === "relay"
        ? resolveRelayReference({
            nodeId: formData.get("relay_node_id"),
            fallbackLabel: formData.get("relay_label"),
            fallbackRegion: formData.get("relay_region"),
          })
        : null;
    return {
      access_mode: accessMode,
      entry_region: normalizeLocationValue(formData.get("entry_region"), { scope: "entry" }),
      entry_port: toNumberOrNull(formData.get("entry_port")),
      relay_node_id: relayReference?.relay_node_id ?? null,
      relay_label: relayReference?.relay_label ?? null,
      relay_region: relayReference?.relay_region ?? null,
      route_note: String(formData.get("route_note") || "").trim() || null,
    };
  }

  function collectManagementPayload(formData) {
    const accessMode = String(formData.get("management_access_mode") || "").trim() || "direct";
    const relayReference =
      accessMode === "relay"
        ? resolveRelayReference({
            nodeId: formData.get("management_relay_node_id"),
            fallbackLabel: formData.get("management_relay_label"),
            fallbackRegion: formData.get("management_relay_region"),
          })
        : null;
    return {
      access_mode: accessMode,
      ssh_host: String(formData.get("management_ssh_host") || "").trim() || null,
      ssh_port: toNumberOrNull(formData.get("management_ssh_port")),
      relay_strategy:
        accessMode === "relay"
          ? String(formData.get("management_relay_strategy") || "").trim() || "auto"
          : null,
      relay_node_id: relayReference?.relay_node_id ?? null,
      relay_label: relayReference?.relay_label ?? null,
      relay_region: relayReference?.relay_region ?? null,
      proxy_host:
        accessMode === "relay"
          ? String(formData.get("management_proxy_host") || "").trim() || null
          : null,
      proxy_port:
        accessMode === "relay"
          ? toNumberOrNull(formData.get("management_proxy_port"))
          : null,
      proxy_user:
        accessMode === "relay"
          ? String(formData.get("management_proxy_user") || "").trim() || null
          : null,
      proxy_label:
        accessMode === "relay"
          ? String(formData.get("management_proxy_label") || "").trim() || null
          : null,
      ssh_user: String(formData.get("management_ssh_user") || "").trim() || null,
      route_note: String(formData.get("management_route_note") || "").trim() || null,
    };
  }

  function buildManualNodePayload(formData) {
    const providerId = String(formData.get("provider_id") || "").trim() || null;
    const providerName = String(formData.get("provider") || "").trim() || null;
    return {
      hostname: String(formData.get("hostname") || "").trim(),
      provider_id: providerId,
      provider: providerName || null,
      region: normalizeLocationValue(formData.get("region"), { scope: "region" }),
      role: String(formData.get("role") || "").trim() || null,
      public_ipv4: String(formData.get("public_ipv4") || "").trim() || null,
      public_ipv6: String(formData.get("public_ipv6") || "").trim() || null,
      private_ipv4: String(formData.get("private_ipv4") || "").trim() || null,
      ssh_port: toNumberOrNull(formData.get("management_ssh_port")) ?? 19822,
      memory_mb: toNumberOrNull(formData.get("memory_mb")),
      bandwidth_mbps: toNumberOrNull(formData.get("bandwidth_mbps")),
      traffic_quota_gb: toNumberOrNull(formData.get("traffic_quota_gb")),
      traffic_used_gb: toNumberOrNull(formData.get("traffic_used_gb")),
      expires_at: String(formData.get("expires_at") || "").trim() || null,
      billing_cycle: String(formData.get("billing_cycle") || "").trim() || null,
      billing_amount: toNumberOrNull(formData.get("billing_amount")),
      billing_currency: String(formData.get("billing_currency") || "").trim() || null,
      amortization_months: toNumberOrNull(formData.get("amortization_months")),
      overage_price_per_gb: toNumberOrNull(formData.get("overage_price_per_gb")),
      extra_fixed_monthly_cost: toNumberOrNull(formData.get("extra_fixed_monthly_cost")),
      billing_started_at: String(formData.get("billing_started_at") || "").trim() || null,
      auto_renew: formData.get("auto_renew") === "on",
      cost_note: String(formData.get("cost_note") || "").trim() || null,
      note: String(formData.get("note") || "").trim() || null,
      os_name: "待补充",
      status: "active",
      networking: collectBusinessRoutePayload(formData),
      management: collectManagementPayload(formData),
    };
  }

  function buildAssetPayload(formData) {
    const providerId = String(formData.get("provider_id") || "").trim() || null;
    const managementSshPort = toNumberOrNull(formData.get("management_ssh_port"));
    return {
      ...(managementSshPort !== null ? { ssh_port: managementSshPort } : {}),
      provider_id: providerId,
      provider: String(formData.get("provider") || "").trim() || null,
      region: normalizeLocationValue(formData.get("region"), { scope: "region" }),
      role: String(formData.get("role") || "").trim() || null,
      public_ipv4: String(formData.get("public_ipv4") || "").trim() || null,
      public_ipv6: String(formData.get("public_ipv6") || "").trim() || null,
      private_ipv4: String(formData.get("private_ipv4") || "").trim() || null,
      billing_cycle: String(formData.get("billing_cycle") || "").trim() || null,
      billing_amount: toNumberOrNull(formData.get("billing_amount")),
      billing_currency: String(formData.get("billing_currency") || "").trim() || null,
      amortization_months: toNumberOrNull(formData.get("amortization_months")),
      overage_price_per_gb: toNumberOrNull(formData.get("overage_price_per_gb")),
      extra_fixed_monthly_cost: toNumberOrNull(formData.get("extra_fixed_monthly_cost")),
      billing_started_at: String(formData.get("billing_started_at") || "").trim() || null,
      expires_at: String(formData.get("expires_at") || "").trim() || null,
      auto_renew: formData.get("auto_renew") === "on",
      bandwidth_mbps: toNumberOrNull(formData.get("bandwidth_mbps")),
      traffic_quota_gb: toNumberOrNull(formData.get("traffic_quota_gb")),
      traffic_used_gb: toNumberOrNull(formData.get("traffic_used_gb")),
      cost_note: String(formData.get("cost_note") || "").trim() || null,
      note: String(formData.get("note") || "").trim() || null,
      networking: collectBusinessRoutePayload(formData),
      management: collectManagementPayload(formData),
    };
  }

  return {
    buildAssetPayload,
    buildManualNodePayload,
    collectBusinessRoutePayload,
    collectManagementPayload,
  };
}
