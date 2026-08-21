function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

const ROUTE_DIRECTIONS = Object.freeze([
  "international_egress",
  "return_to_china",
  "regional_transit",
]);

const ROUTE_DIRECTION_ALIASES = Object.freeze({
  egress: "international_egress",
  global: "international_egress",
  international: "international_egress",
  international_egress: "international_egress",
  outbound: "international_egress",
  overseas: "international_egress",
  return: "return_to_china",
  return_to_china: "return_to_china",
  china_return: "return_to_china",
  back_to_china: "return_to_china",
  inbound_china: "return_to_china",
  regional: "regional_transit",
  regional_transit: "regional_transit",
  relay: "regional_transit",
  transit: "regional_transit",
});

const CHINA_MAINLAND_REGION_ALIASES = new Set([
  "cn",
  "chn",
  "china",
  "mainland",
  "mainland_china",
  "中国",
  "中国大陆",
  "大陆",
  "华北",
  "华东",
  "华南",
  "华中",
  "西南",
  "西北",
  "东北",
  "北京",
  "上海",
  "广州",
  "深圳",
  "杭州",
  "南京",
  "成都",
  "武汉",
  "重庆",
  "天津",
]);

function getNodeDisplayName(node) {
  return (
    normalizeString(node?.name) ??
    normalizeString(node?.hostname) ??
    normalizeString(node?.facts?.hostname) ??
    normalizeString(node?.id) ??
    "未知节点"
  );
}

function resolveNetworkingConfig(node) {
  const networking = isPlainObject(node?.networking) ? node.networking : {};
  const accessMode = normalizeString(networking.access_mode) ?? "direct";

  return {
    access_mode: accessMode === "relay" ? "relay" : "direct",
    entry_region: normalizeString(networking.entry_region) ?? "中国大陆",
    route_direction: normalizeString(networking.route_direction),
    relay_node_id: accessMode === "relay" ? normalizeString(networking.relay_node_id) : null,
    relay_label: accessMode === "relay" ? normalizeString(networking.relay_label) : null,
    relay_region: accessMode === "relay" ? normalizeString(networking.relay_region) : null,
    entry_port: normalizePort(networking.entry_port),
    nat_mode: normalizeString(networking.nat_mode),
    route_note: normalizeString(networking.route_note),
  };
}

function normalizeRouteDirection(value) {
  const text = normalizeString(value);
  if (!text) {
    return null;
  }

  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  if (ROUTE_DIRECTIONS.includes(key)) {
    return key;
  }

  return ROUTE_DIRECTION_ALIASES[key] ?? null;
}

function normalizeRegionKey(value) {
  return normalizeString(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? null;
}

function isChinaMainlandRegion(value) {
  const key = normalizeRegionKey(value);
  if (!key) {
    return false;
  }

  if (CHINA_MAINLAND_REGION_ALIASES.has(key)) {
    return true;
  }

  if (key.startsWith("cn_") || key.startsWith("cn-")) {
    return true;
  }

  return key.includes("china_mainland") || key.includes("中国大陆");
}

function resolveLandingRegion(node) {
  return (
    normalizeString(node?.networking?.landing_region) ??
    normalizeString(node?.labels?.region) ??
    normalizeString(node?.region) ??
    normalizeString(node?.facts?.region) ??
    normalizeString(node?.facts?.public_ipv4_location?.country) ??
    normalizeString(node?.facts?.public_ipv6_location?.country)
  );
}

function inferRouteDirection({ landingNode, networking }) {
  const entryIsChina = isChinaMainlandRegion(networking.entry_region);
  const landingRegion = resolveLandingRegion(landingNode);
  const landingIsChina = isChinaMainlandRegion(landingRegion);

  if (entryIsChina && landingRegion && !landingIsChina) {
    return "international_egress";
  }

  if (!entryIsChina && landingIsChina) {
    return "return_to_china";
  }

  if (networking.access_mode === "relay") {
    return "regional_transit";
  }

  return entryIsChina ? "international_egress" : "regional_transit";
}

function resolveRouteDirection({ landingNode, networking, profile }) {
  const requested =
    networking.route_direction ??
    normalizeString(landingNode?.route_direction) ??
    normalizeString(profile?.route_direction);
  const normalized = normalizeRouteDirection(requested);
  const inferred = inferRouteDirection({ landingNode, networking });

  return {
    route_direction: normalized ?? inferred,
    requested_route_direction: requested,
    route_direction_source: normalized ? "explicit" : "inferred",
    route_direction_valid: !requested || Boolean(normalized),
  };
}

function buildEntryEndpoint(node) {
  const endpoint = isPlainObject(node?.endpoints?.business_ingress)
    ? node.endpoints.business_ingress
    : {};
  const host =
    normalizeString(endpoint.external_host) ??
    normalizeString(endpoint.host) ??
    normalizeString(node?.networking?.entry_host) ??
    normalizeString(node?.facts?.public_ipv4) ??
    normalizeString(node?.facts?.public_ipv6);
  if (!host) {
    return null;
  }

  return {
    host,
    family: normalizeString(endpoint.family) ?? (host.includes(":") ? "ipv6" : "ipv4"),
    source:
      normalizeString(endpoint.source) ??
      (endpoint.external_host || endpoint.host
        ? "endpoints.business_ingress.external"
        : node?.networking?.entry_host
          ? "networking.entry_host"
          : node?.facts?.public_ipv4
            ? "public_ipv4"
            : "public_ipv6"),
    topology: normalizeString(endpoint.topology) ?? normalizeString(node?.networking?.topology),
  };
}

function buildRelayUpstreamEndpoint(entryNode, landingNode, samePrivateIpv4Subnet) {
  const entryPublicIpv6 = normalizeString(entryNode?.facts?.public_ipv6);
  const landingPublicIpv6 = normalizeString(landingNode?.facts?.public_ipv6);
  if (entryPublicIpv6 && landingPublicIpv6) {
    return {
      host: landingPublicIpv6,
      family: "ipv6",
      source: "public_ipv6",
    };
  }

  const entryPrivateIpv4 = normalizeString(entryNode?.facts?.private_ipv4);
  const landingPrivateIpv4 = normalizeString(landingNode?.facts?.private_ipv4);
  if (
    entryPrivateIpv4 &&
    landingPrivateIpv4 &&
    typeof samePrivateIpv4Subnet === "function" &&
    samePrivateIpv4Subnet(entryPrivateIpv4, landingPrivateIpv4)
  ) {
    return {
      host: landingPrivateIpv4,
      family: "ipv4",
      source: "private_ipv4_same_subnet",
    };
  }

  const landingPublicIpv4 = normalizeString(landingNode?.facts?.public_ipv4);
  if (landingPublicIpv4) {
    return {
      host: landingPublicIpv4,
      family: "ipv4",
      source: "public_ipv4",
    };
  }

  return null;
}

function inferNetworkProtocol(profile = {}) {
  const protocol = normalizeString(profile?.protocol)?.toLowerCase() ?? null;
  const transport = normalizeString(profile?.transport)?.toLowerCase() ?? null;

  if (protocol === "hysteria2" || transport === "udp" || transport === "quic") {
    return "udp";
  }

  return "tcp";
}

function routeIdentityPart(value) {
  if (value === null || value === undefined) {
    return "none";
  }

  return encodeURIComponent(String(value).trim() || "none");
}

function buildRouteIdentity({
  routeDirection,
  networking,
  entryNode,
  landingNode,
  entryEndpoint,
  entryPort,
  relayUpstreamEndpoint,
  profile,
}) {
  const profileId = normalizeString(profile?.id) ?? normalizeString(profile?.name);
  const protocol = normalizeString(profile?.protocol)?.toLowerCase() ?? null;
  const transport = normalizeString(profile?.transport)?.toLowerCase() ?? null;
  const networkProtocol = inferNetworkProtocol(profile);
  const entryNodeId = normalizeString(entryNode?.id);
  const landingNodeId = normalizeString(landingNode?.id);
  const relayNodeId = networking.access_mode === "relay" ? networking.relay_node_id : null;
  const keyParts = [
    routeDirection,
    networking.access_mode,
    entryNodeId,
    landingNodeId,
    relayNodeId,
    entryEndpoint?.host,
    entryPort,
    relayUpstreamEndpoint?.host,
    profileId,
    protocol,
    transport,
  ];
  const routeKey = keyParts.map(routeIdentityPart).join(":");

  return {
    route_id: `traffic:${routeKey}`,
    route_key: routeKey,
    route_direction: routeDirection,
    access_mode: networking.access_mode,
    entry_node_id: entryNodeId ?? null,
    landing_node_id: landingNodeId ?? null,
    relay_node_id: relayNodeId,
    entry_host: entryEndpoint?.host ?? null,
    entry_port: entryPort ?? null,
    relay_upstream_host: relayUpstreamEndpoint?.host ?? null,
    profile_id: profileId ?? null,
    protocol,
    transport,
    network_protocol: networkProtocol,
  };
}

function buildHealthInput({ routeIdentity, entryEndpoint, relayUpstreamEndpoint }) {
  return {
    route_id: routeIdentity.route_id,
    route_key: routeIdentity.route_key,
    route_direction: routeIdentity.route_direction,
    access_mode: routeIdentity.access_mode,
    entry_node_id: routeIdentity.entry_node_id,
    landing_node_id: routeIdentity.landing_node_id,
    relay_node_id: routeIdentity.relay_node_id,
    entry_target: entryEndpoint?.host
      ? {
          host: entryEndpoint.host,
          port: routeIdentity.entry_port,
          family: entryEndpoint.family,
          source: entryEndpoint.source,
          network_protocol: routeIdentity.network_protocol,
        }
      : null,
    relay_upstream_target: relayUpstreamEndpoint?.host
      ? {
          host: relayUpstreamEndpoint.host,
          family: relayUpstreamEndpoint.family,
          source: relayUpstreamEndpoint.source,
          network_protocol: routeIdentity.network_protocol,
        }
      : null,
    profile_id: routeIdentity.profile_id,
    protocol: routeIdentity.protocol,
    transport: routeIdentity.transport,
    network_protocol: routeIdentity.network_protocol,
  };
}

export function createTrafficRouteDomain(dependencies = {}) {
  const { samePrivateIpv4Subnet } = dependencies;

  function resolveTrafficRoute(node, allNodes = [], profile = {}) {
    const landingNode = node ?? null;
    const networking = resolveNetworkingConfig(node);
    const problems = [];
    const allNodeItems = Array.isArray(allNodes) ? allNodes : [];
    const entryNode =
      networking.access_mode === "relay"
        ? allNodeItems.find((item) => item?.id === networking.relay_node_id) ?? null
        : landingNode;
    const routeDirection = resolveRouteDirection({ landingNode, networking, profile });
    const entryPort =
      normalizePort(entryNode?.endpoints?.business_ingress?.external_port) ??
      networking.entry_port ??
      normalizePort(profile?.listen_port);
    const entryEndpoint = buildEntryEndpoint(entryNode);

    if (networking.access_mode === "relay" && !networking.relay_node_id) {
      problems.push("relay_node_id_missing");
    }

    if (networking.access_mode === "relay" && !entryNode) {
      problems.push("entry_node_missing");
    }

    if (!entryEndpoint?.host) {
      problems.push("entry_public_ipv4_missing");
    }

    if (!entryPort) {
      problems.push("entry_port_invalid");
    }

    if (!routeDirection.route_direction_valid) {
      problems.push("route_direction_invalid");
    }

    let relayUpstreamEndpoint = null;
    if (networking.access_mode === "relay") {
      relayUpstreamEndpoint = entryNode
        ? buildRelayUpstreamEndpoint(entryNode, landingNode, samePrivateIpv4Subnet)
        : null;
      if (!relayUpstreamEndpoint?.host) {
        problems.push("relay_upstream_missing");
      }
    }

    const landingName = getNodeDisplayName(landingNode);
    const entryName =
      entryNode && entryNode.id === landingNode?.id
        ? landingName
        : getNodeDisplayName(entryNode);
    const routeLabel =
      networking.access_mode === "relay"
        ? `${networking.entry_region} -> ${entryName} -> ${landingName}`
        : `${networking.entry_region} -> ${landingName}`;

    const routeIdentity = buildRouteIdentity({
      routeDirection: routeDirection.route_direction,
      networking,
      entryNode,
      landingNode,
      entryEndpoint,
      entryPort,
      relayUpstreamEndpoint,
      profile,
    });
    const healthInput = buildHealthInput({
      routeIdentity,
      entryEndpoint,
      relayUpstreamEndpoint,
    });

    return {
      access_mode: networking.access_mode,
      entry_node: entryNode,
      landing_node: landingNode,
      entry_endpoint: entryEndpoint,
      relay_upstream_endpoint: relayUpstreamEndpoint,
      entry_port: entryPort,
      route_direction: routeDirection.route_direction,
      requested_route_direction: routeDirection.requested_route_direction,
      route_direction_source: routeDirection.route_direction_source,
      route_identity: routeIdentity,
      route_id: routeIdentity.route_id,
      route_key: routeIdentity.route_key,
      health_input: healthInput,
      nat_mode: networking.nat_mode,
      publishable: problems.length === 0,
      problems,
      route_label: routeLabel,
      route_note: networking.route_note,
      entry_region: networking.entry_region,
      relay_region:
        networking.access_mode === "relay"
          ? networking.relay_region ?? normalizeString(entryNode?.labels?.region)
          : null,
      relay_node_id: networking.relay_node_id,
      relay_label: networking.relay_label,
      upstream_family: relayUpstreamEndpoint?.family ?? null,
      // A single traffic route record is always described from the landing node's perspective.
      route_role: "landing",
    };
  }

  function findTrafficRouteConflicts(routes = []) {
    const publishableRoutes = (Array.isArray(routes) ? routes : []).filter(
      (route) => route?.publishable && route?.entry_endpoint?.host && route?.entry_port,
    );
    const buckets = new Map();

    for (const route of publishableRoutes) {
      const entryNodeId = route.entry_node?.id ?? route.landing_node?.id ?? "unknown-entry-node";
      const key = `${route.entry_endpoint.host}:${route.entry_port}`;
      const bucket = buckets.get(key) ?? {
        key,
        entry_host: route.entry_endpoint.host,
        entry_port: route.entry_port,
        entry_node_ids: [],
        routes: [],
      };
      if (!bucket.entry_node_ids.includes(entryNodeId)) {
        bucket.entry_node_ids.push(entryNodeId);
      }
      bucket.routes.push(route);
      buckets.set(key, bucket);
    }

    return [...buckets.values()]
      .filter((bucket) => bucket.routes.length > 1)
      .map((bucket) => ({
        ...bucket,
        entry_node_id: bucket.entry_node_ids[0] ?? null,
      }));
  }

  function buildTrafficConflictMessage(conflict) {
    const labels = (Array.isArray(conflict?.routes) ? conflict.routes : [])
      .map((route) => route?.route_label)
      .filter(Boolean)
      .join("；");

    return `入口 ${conflict?.entry_host || "-"}:${conflict?.entry_port || "-"} 存在端口冲突：${
      labels || "多条线路占用了同一入口端口"
    }`;
  }

  return {
    buildTrafficConflictMessage,
    findTrafficRouteConflicts,
    getNodeDisplayName,
    normalizeRouteDirection,
    resolveNetworkingConfig,
    resolveTrafficRoute,
  };
}
