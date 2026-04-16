function sourceValue(source, key, fallback = null) {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRecordSource(source, key) {
  return isPlainObject(source?.[key]) ? source[key] : source;
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
  const input = readRecordSource(source, "networking");
  const accessMode = sourceValue(input, "access_mode", existingNetworking.access_mode ?? "direct");

  return {
    access_mode: accessMode,
    relay_node_id:
      accessMode === "relay"
        ? sourceValue(input, "relay_node_id", existingNetworking.relay_node_id ?? null)
        : null,
    relay_label:
      accessMode === "relay"
        ? sourceValue(input, "relay_label", existingNetworking.relay_label ?? null)
        : null,
    relay_region:
      accessMode === "relay"
        ? sourceValue(input, "relay_region", existingNetworking.relay_region ?? null)
        : null,
    entry_region: sourceValue(input, "entry_region", existingNetworking.entry_region ?? null),
    entry_port: sourceValue(input, "entry_port", existingNetworking.entry_port ?? null),
    route_note: sourceValue(input, "route_note", existingNetworking.route_note ?? null),
  };
}

function buildManagementRecord(
  source = {},
  existingManagement = {},
) {
  const currentManagement = isPlainObject(existingManagement) ? existingManagement : {};
  const input = readRecordSource(source, "management");
  const accessMode = sourceValue(
    input,
    "access_mode",
    currentManagement.access_mode ?? "direct",
  );

  return {
    access_mode: accessMode,
    relay_node_id:
      accessMode === "relay"
        ? sourceValue(
            input,
            "relay_node_id",
            currentManagement.relay_node_id ?? null,
          )
        : null,
    relay_label:
      accessMode === "relay"
        ? sourceValue(
            input,
            "relay_label",
            currentManagement.relay_label ?? null,
          )
        : null,
    relay_region:
      accessMode === "relay"
        ? sourceValue(
            input,
            "relay_region",
            currentManagement.relay_region ?? null,
          )
        : null,
    ssh_host: sourceValue(input, "ssh_host", currentManagement.ssh_host ?? null),
    ssh_port: sourceValue(input, "ssh_port", currentManagement.ssh_port ?? null),
    ssh_user: sourceValue(input, "ssh_user", currentManagement.ssh_user ?? null),
    route_note: sourceValue(
      input,
      "route_note",
      currentManagement.route_note ?? null,
    ),
  };
}

function buildMigratedManagementRecord(node = {}) {
  const currentManagement = isPlainObject(node?.management) ? node.management : {};
  const legacyNetworking = isPlainObject(node?.networking) ? node.networking : {};
  const requestedAccessMode =
    sourceValue(currentManagement, "access_mode", null) ??
    sourceValue(node, "ssh_access_mode", null) ??
    sourceValue(legacyNetworking, "access_mode", "direct");
  const accessMode = requestedAccessMode === "relay" ? "relay" : "direct";
  const legacyRouteNote =
    accessMode === "relay" ? sourceValue(legacyNetworking, "route_note", null) : null;

  return {
    ...currentManagement,
    access_mode: accessMode,
    relay_node_id:
      accessMode === "relay"
        ? sourceValue(
            currentManagement,
            "relay_node_id",
            sourceValue(node, "ssh_relay_node_id", sourceValue(legacyNetworking, "relay_node_id", null)),
          )
        : null,
    relay_label:
      accessMode === "relay"
        ? sourceValue(
            currentManagement,
            "relay_label",
            sourceValue(node, "ssh_relay_label", sourceValue(legacyNetworking, "relay_label", null)),
          )
        : null,
    relay_region:
      accessMode === "relay"
        ? sourceValue(
            currentManagement,
            "relay_region",
            sourceValue(node, "ssh_relay_region", sourceValue(legacyNetworking, "relay_region", null)),
          )
        : null,
    ssh_host: sourceValue(currentManagement, "ssh_host", sourceValue(node, "ssh_host", null)),
    ssh_port: sourceValue(
      currentManagement,
      "ssh_port",
      sourceValue(node, "ssh_port", sourceValue(node?.facts ?? {}, "ssh_port", 19822)),
    ),
    ssh_user: sourceValue(currentManagement, "ssh_user", sourceValue(node, "ssh_user", null)),
    route_note: sourceValue(
      currentManagement,
      "route_note",
      sourceValue(node, "ssh_route_note", legacyRouteNote),
    ),
  };
}

function migrateLegacyNodeManagementRecord(node = {}) {
  const nextManagement = buildMigratedManagementRecord(node);
  const currentManagement = isPlainObject(node?.management) ? node.management : null;
  const changed = JSON.stringify(currentManagement ?? null) !== JSON.stringify(nextManagement);

  if (!changed) {
    return {
      changed: false,
      node,
    };
  }

  return {
    changed: true,
    node: {
      ...node,
      management: nextManagement,
    },
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
    const networking = buildNetworkingRecord(payload.networking ?? payload, existingNode?.networking);
    const management = buildManagementRecord(payload.management, existingNode?.management);

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
      networking,
      management: {
        ...management,
        ssh_port: management.ssh_port ?? facts.ssh_port ?? existingNode?.facts?.ssh_port ?? 19822,
      },
    };
  }

  function updateNodeAssetRecord(existingNode, payload) {
    const currentFacts =
      existingNode.facts && typeof existingNode.facts === "object" ? existingNode.facts : {};

    const nextNetworking = buildNetworkingRecord(payload.networking ?? payload, existingNode.networking);
    const nextManagement = buildManagementRecord(payload.management, existingNode.management);

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
      networking: nextNetworking,
      management: {
        ...nextManagement,
        ssh_port:
          nextManagement.ssh_port ??
          sourceValue(payload, "ssh_port", currentFacts.ssh_port ?? 19822) ??
          19822,
      },
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

    const networking = buildNetworkingRecord(payload.networking ?? payload);
    const management = buildManagementRecord(payload.management, null);

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
      networking,
      management: {
        ...management,
        ssh_port: management.ssh_port ?? facts.ssh_port ?? 19822,
      },
    };
  }

  return {
    sourceValue,
    buildCommercialRecord,
    buildManagementRecord,
    migrateLegacyNodeManagementRecord,
    buildNetworkingRecord,
    buildNodeRecord,
    updateNodeAssetRecord,
    buildManualNodeRecord,
  };
}
