function sourceValue(source, key, fallback = null) {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : fallback;
}

function buildCommercialRecord(source = {}, existingCommercial = {}) {
  return {
    expires_at: sourceValue(source, "expires_at", existingCommercial.expires_at ?? null),
    auto_renew: sourceValue(source, "auto_renew", existingCommercial.auto_renew ?? false),
    bandwidth_mbps: sourceValue(
      source,
      "bandwidth_mbps",
      existingCommercial.bandwidth_mbps ?? null,
    ),
    traffic_quota_gb: sourceValue(
      source,
      "traffic_quota_gb",
      existingCommercial.traffic_quota_gb ?? null,
    ),
    traffic_used_gb: sourceValue(
      source,
      "traffic_used_gb",
      existingCommercial.traffic_used_gb ?? null,
    ),
    billing_cycle: sourceValue(
      source,
      "billing_cycle",
      existingCommercial.billing_cycle ?? null,
    ),
    note: sourceValue(source, "note", existingCommercial.note ?? null),
  };
}

function buildNetworkingRecord(source = {}, existingNetworking = {}) {
  const accessMode = sourceValue(source, "access_mode", existingNetworking.access_mode ?? "direct");

  return {
    access_mode: accessMode,
    relay_node_id:
      accessMode === "relay"
        ? sourceValue(source, "relay_node_id", existingNetworking.relay_node_id ?? null)
        : null,
    relay_label:
      accessMode === "relay"
        ? sourceValue(source, "relay_label", existingNetworking.relay_label ?? null)
        : null,
    relay_region:
      accessMode === "relay"
        ? sourceValue(source, "relay_region", existingNetworking.relay_region ?? null)
        : null,
    entry_region: sourceValue(source, "entry_region", existingNetworking.entry_region ?? null),
    route_note: sourceValue(source, "route_note", existingNetworking.route_note ?? null),
  };
}

export function createNodeRecordBuilders({
  normalizeNodeFacts,
  createNodeId,
  nowIso = () => new Date().toISOString(),
}) {
  if (typeof normalizeNodeFacts !== "function") {
    throw new TypeError("normalizeNodeFacts must be a function");
  }

  if (typeof createNodeId !== "function") {
    throw new TypeError("createNodeId must be a function");
  }

  function buildNodeRecord(payload, existingNode) {
    const now = nowIso();
    const labels = {
      ...(existingNode?.labels ?? {}),
      ...(payload.labels && typeof payload.labels === "object" ? payload.labels : {}),
    };
    const facts = normalizeNodeFacts(payload.facts, {
      existingFacts: existingNode?.facts,
    });

    return {
      id: existingNode?.id ?? createNodeId(),
      fingerprint: payload.fingerprint,
      status: existingNode?.status ?? "new",
      registered_at: existingNode?.registered_at ?? now,
      last_seen_at: now,
      last_probe_at: existingNode?.last_probe_at ?? null,
      health_score: existingNode?.health_score ?? null,
      labels,
      source: existingNode?.source ?? "bootstrap",
      bootstrap_token_id: existingNode?.bootstrap_token_id ?? null,
      facts,
      commercial: buildCommercialRecord(payload.commercial, existingNode?.commercial),
      networking: buildNetworkingRecord(payload.networking, existingNode?.networking),
    };
  }

  function updateNodeAssetRecord(existingNode, payload) {
    const currentFacts =
      existingNode.facts && typeof existingNode.facts === "object" ? existingNode.facts : {};

    return {
      ...existingNode,
      labels: {
        ...existingNode.labels,
        provider: sourceValue(payload, "provider", existingNode.labels?.provider ?? null),
        region: sourceValue(payload, "region", existingNode.labels?.region ?? null),
        role: sourceValue(payload, "role", existingNode.labels?.role ?? null),
      },
      facts: normalizeNodeFacts(
        {
          ...currentFacts,
          public_ipv4: sourceValue(payload, "public_ipv4", currentFacts.public_ipv4 ?? null),
          public_ipv6: sourceValue(payload, "public_ipv6", currentFacts.public_ipv6 ?? null),
          private_ipv4: sourceValue(payload, "private_ipv4", currentFacts.private_ipv4 ?? null),
          ssh_port: sourceValue(payload, "ssh_port", currentFacts.ssh_port ?? 19822),
          public_ipv4_source:
            sourceValue(payload, "public_ipv4", currentFacts.public_ipv4 ?? null) !==
            (currentFacts.public_ipv4 ?? null)
              ? "manual_override"
              : currentFacts.public_ipv4_source ?? null,
          public_ipv6_source:
            sourceValue(payload, "public_ipv6", currentFacts.public_ipv6 ?? null) !==
            (currentFacts.public_ipv6 ?? null)
              ? "manual_override"
              : currentFacts.public_ipv6_source ?? null,
        },
        { existingFacts: currentFacts },
      ),
      commercial: buildCommercialRecord(payload, existingNode.commercial),
      networking: buildNetworkingRecord(payload, existingNode.networking),
    };
  }

  function buildManualNodeRecord(payload) {
    const now = nowIso();
    const facts = normalizeNodeFacts(
      {
        hostname: payload.hostname,
        os_name: payload.os_name,
        os_version: payload.os_version,
        arch: payload.arch,
        kernel_version: payload.kernel_version,
        public_ipv4: payload.public_ipv4,
        public_ipv6: payload.public_ipv6,
        private_ipv4: payload.private_ipv4,
        cpu_cores: payload.cpu_cores,
        memory_mb: payload.memory_mb,
        disk_gb: payload.disk_gb,
        ssh_port: payload.ssh_port,
        public_ipv4_source: payload.public_ipv4_source,
        public_ipv6_source: payload.public_ipv6_source,
        public_ipv4_location: payload.public_ipv4_location,
        public_ipv6_location: payload.public_ipv6_location,
        public_ipv4_owner: payload.public_ipv4_owner,
        public_ipv6_owner: payload.public_ipv6_owner,
      },
      { existingFacts: null },
    );

    return {
      id: createNodeId(),
      fingerprint: payload.fingerprint ?? null,
      status: payload.status ?? "active",
      registered_at: now,
      last_seen_at: payload.last_seen_at ?? null,
      last_probe_at: payload.last_probe_at ?? null,
      health_score: payload.health_score ?? null,
      labels: {
        provider: payload.provider ?? null,
        region: payload.region ?? null,
        role: payload.role ?? null,
      },
      source: "manual",
      facts,
      commercial: buildCommercialRecord(payload),
      networking: buildNetworkingRecord(payload),
    };
  }

  return {
    sourceValue,
    buildCommercialRecord,
    buildNetworkingRecord,
    buildNodeRecord,
    updateNodeAssetRecord,
    buildManualNodeRecord,
  };
}
