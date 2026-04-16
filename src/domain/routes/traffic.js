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
    relay_node_id: accessMode === "relay" ? normalizeString(networking.relay_node_id) : null,
    relay_label: accessMode === "relay" ? normalizeString(networking.relay_label) : null,
    relay_region: accessMode === "relay" ? normalizeString(networking.relay_region) : null,
    entry_port: normalizePort(networking.entry_port),
    route_note: normalizeString(networking.route_note),
  };
}

function buildEntryEndpoint(node) {
  const host = normalizeString(node?.facts?.public_ipv4);
  if (!host) {
    return null;
  }

  return {
    host,
    family: "ipv4",
    source: "public_ipv4",
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
    const entryPort =
      networking.access_mode === "relay"
        ? networking.entry_port ?? normalizePort(profile?.listen_port)
        : normalizePort(profile?.listen_port);
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

    return {
      access_mode: networking.access_mode,
      entry_node: entryNode,
      landing_node: landingNode,
      entry_endpoint: entryEndpoint,
      relay_upstream_endpoint: relayUpstreamEndpoint,
      entry_port: entryPort,
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
    resolveNetworkingConfig,
    resolveTrafficRoute,
  };
}
