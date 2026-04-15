export function createNodeAssetModalPayloadsModule(dependencies = {}) {
  const { toNumberOrNull } = dependencies;

  function collectRoutePayload(formData) {
    const accessMode = String(formData.get("access_mode") || "").trim() || "direct";
    return {
      access_mode: accessMode,
      entry_region: String(formData.get("entry_region") || "").trim() || null,
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
          ? String(formData.get("relay_region") || "").trim() || null
          : null,
      route_note: String(formData.get("route_note") || "").trim() || null,
    };
  }

  function buildManualNodePayload(formData) {
    return {
      hostname: String(formData.get("hostname") || "").trim(),
      provider: String(formData.get("provider") || "").trim() || null,
      region: String(formData.get("region") || "").trim() || null,
      role: String(formData.get("role") || "").trim() || null,
      public_ipv4: String(formData.get("public_ipv4") || "").trim() || null,
      public_ipv6: String(formData.get("public_ipv6") || "").trim() || null,
      private_ipv4: String(formData.get("private_ipv4") || "").trim() || null,
      ssh_port: toNumberOrNull(formData.get("ssh_port")),
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
      ...collectRoutePayload(formData),
    };
  }

  function buildAssetPayload(formData) {
    return {
      provider: String(formData.get("provider") || "").trim() || null,
      region: String(formData.get("region") || "").trim() || null,
      role: String(formData.get("role") || "").trim() || null,
      billing_cycle: String(formData.get("billing_cycle") || "").trim() || null,
      expires_at: String(formData.get("expires_at") || "").trim() || null,
      auto_renew: formData.get("auto_renew") === "on",
      ssh_port: toNumberOrNull(formData.get("ssh_port")),
      bandwidth_mbps: toNumberOrNull(formData.get("bandwidth_mbps")),
      traffic_quota_gb: toNumberOrNull(formData.get("traffic_quota_gb")),
      traffic_used_gb: toNumberOrNull(formData.get("traffic_used_gb")),
      note: String(formData.get("note") || "").trim() || null,
      ...collectRoutePayload(formData),
    };
  }

  return {
    buildAssetPayload,
    buildManualNodePayload,
    collectRoutePayload,
  };
}
