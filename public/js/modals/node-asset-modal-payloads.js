import { normalizeLocationValue } from "../shared/location-suggestions.js";

export function createNodeAssetModalPayloadsModule(dependencies = {}) {
  const { toNumberOrNull } = dependencies;

  function collectBusinessRoutePayload(formData) {
    const accessMode = String(formData.get("access_mode") || "").trim() || "direct";
    return {
      access_mode: accessMode,
      entry_region: normalizeLocationValue(formData.get("entry_region"), { scope: "entry" }),
      entry_port: toNumberOrNull(formData.get("entry_port")),
      relay_node_id:
        accessMode === "relay"
          ? String(formData.get("relay_node_id") || "").trim() || null
          : null,
      relay_label:
        accessMode === "relay"
          ? String(formData.get("relay_label") || "").trim() || null
          : null,
      relay_region:
        accessMode === "relay"
          ? normalizeLocationValue(formData.get("relay_region"), { scope: "region" })
          : null,
      route_note: String(formData.get("route_note") || "").trim() || null,
    };
  }

  function collectManagementPayload(formData) {
    const accessMode = String(formData.get("management_access_mode") || "").trim() || "direct";
    return {
      access_mode: accessMode,
      relay_node_id:
        accessMode === "relay"
          ? String(formData.get("management_relay_node_id") || "").trim() || null
          : null,
      relay_label:
        accessMode === "relay"
          ? String(formData.get("management_relay_label") || "").trim() || null
          : null,
      relay_region:
        accessMode === "relay"
          ? normalizeLocationValue(formData.get("management_relay_region"), { scope: "region" })
          : null,
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
    return {
      hostname: String(formData.get("hostname") || "").trim(),
      provider: String(formData.get("provider") || "").trim() || null,
      region: normalizeLocationValue(formData.get("region"), { scope: "region" }),
      role: String(formData.get("role") || "").trim() || null,
      public_ipv4: String(formData.get("public_ipv4") || "").trim() || null,
      public_ipv6: String(formData.get("public_ipv6") || "").trim() || null,
      private_ipv4: String(formData.get("private_ipv4") || "").trim() || null,
      ssh_port: toNumberOrNull(formData.get("ssh_port")) ?? 19822,
      memory_mb: toNumberOrNull(formData.get("memory_mb")),
      bandwidth_mbps: toNumberOrNull(formData.get("bandwidth_mbps")),
      traffic_quota_gb: toNumberOrNull(formData.get("traffic_quota_gb")),
      traffic_used_gb: toNumberOrNull(formData.get("traffic_used_gb")),
      expires_at: String(formData.get("expires_at") || "").trim() || null,
      billing_cycle: String(formData.get("billing_cycle") || "").trim() || null,
      auto_renew: formData.get("auto_renew") === "on",
      note: String(formData.get("note") || "").trim() || null,
      os_name: "待补充",
      status: "active",
      networking: collectBusinessRoutePayload(formData),
      management: collectManagementPayload(formData),
    };
  }

  function buildAssetPayload(formData) {
    return {
      provider: String(formData.get("provider") || "").trim() || null,
      region: normalizeLocationValue(formData.get("region"), { scope: "region" }),
      role: String(formData.get("role") || "").trim() || null,
      public_ipv4: String(formData.get("public_ipv4") || "").trim() || null,
      public_ipv6: String(formData.get("public_ipv6") || "").trim() || null,
      private_ipv4: String(formData.get("private_ipv4") || "").trim() || null,
      billing_cycle: String(formData.get("billing_cycle") || "").trim() || null,
      expires_at: String(formData.get("expires_at") || "").trim() || null,
      auto_renew: formData.get("auto_renew") === "on",
      ssh_port: toNumberOrNull(formData.get("ssh_port")),
      bandwidth_mbps: toNumberOrNull(formData.get("bandwidth_mbps")),
      traffic_quota_gb: toNumberOrNull(formData.get("traffic_quota_gb")),
      traffic_used_gb: toNumberOrNull(formData.get("traffic_used_gb")),
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
