import { normalizeLocationValue } from "../shared/location-suggestions.js";
import { DEFAULT_NODE_SSH_PORT } from "../shared/management-defaults.js";

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

  function textOrNull(value) {
    return String(value || "").trim() || null;
  }

  function inferEndpointTopology({
    externalHost,
    externalPort,
    internalHost,
    internalPort,
    fallback = null,
  }) {
    if (!externalHost || !externalPort || !internalPort) {
      return fallback;
    }

    if (internalHost && internalHost !== externalHost) {
      return "nat";
    }

    return externalPort === internalPort ? "direct" : "nat";
  }

  function collectBusinessRoutePayload(formData) {
    const accessMode = String(formData.get("access_mode") || "").trim() || "direct";
    const entryHost = textOrNull(formData.get("entry_host"));
    const entryPort = toNumberOrNull(formData.get("entry_port"));
    const internalHost = textOrNull(formData.get("business_internal_host"));
    const internalPort = toNumberOrNull(formData.get("business_internal_port"));
    const topology = inferEndpointTopology({
      externalHost: entryHost,
      externalPort: entryPort,
      internalHost,
      internalPort,
    });
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
      route_direction: textOrNull(formData.get("route_direction")),
      entry_host: entryHost,
      entry_port: entryPort,
      internal_host: internalHost,
      internal_port: internalPort,
      topology,
      nat_mode: topology === "nat" ? "port_mapping" : null,
      relay_node_id: relayReference?.relay_node_id ?? null,
      relay_label: relayReference?.relay_label ?? null,
      relay_region: relayReference?.relay_region ?? null,
      route_note: String(formData.get("route_note") || "").trim() || null,
    };
  }

  function collectManagementPayload(formData) {
    const accessMode = String(formData.get("management_access_mode") || "").trim() || "direct";
    const sshHost = textOrNull(formData.get("management_ssh_host"));
    const sshPort = toNumberOrNull(formData.get("management_ssh_port"));
    const internalHost = textOrNull(formData.get("management_internal_host"));
    const internalPort = toNumberOrNull(formData.get("management_internal_port"));
    const topology = inferEndpointTopology({
      externalHost: sshHost,
      externalPort: sshPort,
      internalHost,
      internalPort,
    });
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
      ssh_host: sshHost,
      ssh_port: sshPort,
      ssh_internal_host: internalHost,
      ssh_internal_port: internalPort,
      topology,
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

  function collectEndpointsPayload(formData, { networking, management }) {
    const serviceListenHost = textOrNull(formData.get("service_listen_host"));
    const serviceListenPort = toNumberOrNull(formData.get("service_listen_port"));

    return {
      management: {
        kind: "management",
        protocol: "ssh",
        host: management.ssh_host,
        port: management.ssh_port,
        external_host: management.ssh_host,
        external_port: management.ssh_port,
        internal_host: management.ssh_internal_host,
        internal_port: management.ssh_internal_port,
        topology: management.topology,
        ssh_user: management.ssh_user,
      },
      business_ingress: {
        kind: "business_ingress",
        protocol: null,
        host: networking.entry_host,
        port: networking.entry_port,
        external_host: networking.entry_host,
        external_port: networking.entry_port,
        internal_host: networking.internal_host,
        internal_port: networking.internal_port,
        topology: networking.topology,
      },
      service_listen: {
        kind: "service_listen",
        protocol: null,
        host: serviceListenPort ? serviceListenHost || "0.0.0.0" : serviceListenHost,
        port: serviceListenPort,
        listen_host: serviceListenPort ? serviceListenHost || "0.0.0.0" : serviceListenHost,
        listen_port: serviceListenPort,
        internal_host: serviceListenPort ? serviceListenHost || "0.0.0.0" : serviceListenHost,
        internal_port: serviceListenPort,
        topology: "internal",
      },
    };
  }

  function buildManualNodePayload(formData) {
    const providerId = String(formData.get("provider_id") || "").trim() || null;
    const providerName = String(formData.get("provider") || "").trim() || null;
    const networking = collectBusinessRoutePayload(formData);
    const management = collectManagementPayload(formData);
    const serviceListenHost = textOrNull(formData.get("service_listen_host"));
    const serviceListenPort = toNumberOrNull(formData.get("service_listen_port"));
    return {
      hostname: String(formData.get("hostname") || "").trim(),
      provider_id: providerId,
      provider: providerName || null,
      region: normalizeLocationValue(formData.get("region"), { scope: "region" }),
      role: String(formData.get("role") || "").trim() || null,
      public_ipv4: String(formData.get("public_ipv4") || "").trim() || null,
      public_ipv6: String(formData.get("public_ipv6") || "").trim() || null,
      private_ipv4: String(formData.get("private_ipv4") || "").trim() || null,
      ssh_port: management.ssh_internal_port ?? management.ssh_port ?? DEFAULT_NODE_SSH_PORT,
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
      service_listen_host: serviceListenHost,
      service_listen_port: serviceListenPort,
      os_name: "待补充",
      status: "active",
      networking,
      management,
      endpoints: collectEndpointsPayload(formData, { networking, management }),
    };
  }

  function buildAssetPayload(formData) {
    const providerId = String(formData.get("provider_id") || "").trim() || null;
    const networking = collectBusinessRoutePayload(formData);
    const management = collectManagementPayload(formData);
    const serviceListenHost = textOrNull(formData.get("service_listen_host"));
    const serviceListenPort = toNumberOrNull(formData.get("service_listen_port"));
    return {
      ...(management.ssh_internal_port !== null ? { ssh_port: management.ssh_internal_port } : {}),
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
      service_listen_host: serviceListenHost,
      service_listen_port: serviceListenPort,
      networking,
      management,
      endpoints: collectEndpointsPayload(formData, { networking, management }),
    };
  }

  return {
    buildAssetPayload,
    buildManualNodePayload,
    collectBusinessRoutePayload,
    collectManagementPayload,
  };
}
