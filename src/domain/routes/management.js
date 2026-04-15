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

function resolveManagementConfig(node, defaultNodeSshUser) {
  const management = isPlainObject(node?.management) ? node.management : {};
  const legacyNetworking = isPlainObject(node?.networking) ? node.networking : {};
  const requestedAccessMode =
    normalizeString(management.access_mode) ??
    normalizeString(node?.ssh_access_mode) ??
    normalizeString(legacyNetworking.access_mode) ??
    "direct";

  return {
    requested_access_mode: requestedAccessMode === "relay" ? "relay" : "direct",
    relay_node_id:
      requestedAccessMode === "relay"
        ? normalizeString(management.relay_node_id) ??
          normalizeString(node?.ssh_relay_node_id) ??
          normalizeString(legacyNetworking.relay_node_id)
        : null,
    relay_label:
      requestedAccessMode === "relay"
        ? normalizeString(management.relay_label) ??
          normalizeString(node?.ssh_relay_label) ??
          normalizeString(legacyNetworking.relay_label)
        : null,
    relay_region:
      requestedAccessMode === "relay"
        ? normalizeString(management.relay_region) ??
          normalizeString(node?.ssh_relay_region) ??
          normalizeString(legacyNetworking.relay_region)
        : null,
    route_note:
      normalizeString(management.route_note) ??
      normalizeString(node?.ssh_route_note) ??
      normalizeString(legacyNetworking.route_note),
    ssh_host:
      normalizeString(management.ssh_host) ??
      normalizeString(node?.ssh_host),
    ssh_port:
      normalizePort(management.ssh_port) ??
      normalizePort(node?.ssh_port) ??
      normalizePort(node?.facts?.ssh_port) ??
      19822,
    ssh_user:
      normalizeString(management.ssh_user) ??
      normalizeString(node?.ssh_user) ??
      defaultNodeSshUser,
  };
}

function buildEndpoint(node, options = {}) {
  const {
    accessMode = "direct",
    preferredLanIpv4 = null,
    relayNode = null,
    samePrivateIpv4Subnet,
    sshHost = null,
    sshPort = 19822,
  } = options;

  const explicitHost = normalizeString(sshHost);
  if (explicitHost) {
    return {
      host: explicitHost,
      port: sshPort,
      family: explicitHost.includes(":") ? "ipv6" : "ipv4",
      source: "ssh_host",
    };
  }

  const privateIpv4 = normalizeString(node?.facts?.private_ipv4);
  const publicIpv4 = normalizeString(node?.facts?.public_ipv4);
  const publicIpv6 = normalizeString(node?.facts?.public_ipv6);
  const relayPrivateIpv4 = normalizeString(relayNode?.facts?.private_ipv4);

  const relayCanReachPrivateIpv4 =
    accessMode === "relay" &&
    privateIpv4 &&
    relayPrivateIpv4 &&
    typeof samePrivateIpv4Subnet === "function" &&
    samePrivateIpv4Subnet(privateIpv4, relayPrivateIpv4);

  const controllerCanReachPrivateIpv4 =
    accessMode !== "relay" &&
    privateIpv4 &&
    preferredLanIpv4 &&
    typeof samePrivateIpv4Subnet === "function" &&
    samePrivateIpv4Subnet(privateIpv4, preferredLanIpv4);

  const host = controllerCanReachPrivateIpv4 || relayCanReachPrivateIpv4
    ? privateIpv4
    : publicIpv4 || publicIpv6 || privateIpv4 || null;

  if (!host) {
    return null;
  }

  return {
    host,
    port: sshPort,
    family: host.includes(":") ? "ipv6" : "ipv4",
    source:
      controllerCanReachPrivateIpv4 || relayCanReachPrivateIpv4
        ? "private_ipv4"
        : host === publicIpv4
          ? "public_ipv4"
          : host === publicIpv6
            ? "public_ipv6"
            : "private_ipv4_fallback",
  };
}

export function createManagementRouteDomain(dependencies = {}) {
  const {
    defaultNodeSshUser = "root",
    getNodeById = () => null,
    getPreferredLanIpv4 = () => null,
    samePrivateIpv4Subnet,
  } = dependencies;

  function resolveManagementRoute(node, options = {}) {
    const management = resolveManagementConfig(node, defaultNodeSshUser);
    const preferredLanIpv4 = options.preferredLanIpv4 ?? getPreferredLanIpv4();
    const relayNode =
      management.requested_access_mode === "relay" && management.relay_node_id
        ? getNodeById(management.relay_node_id)
        : null;
    const relayConfig = relayNode
      ? resolveManagementConfig(relayNode, defaultNodeSshUser)
      : null;
    const target = buildEndpoint(node, {
      accessMode: management.requested_access_mode,
      preferredLanIpv4,
      relayNode,
      samePrivateIpv4Subnet,
      sshHost: management.ssh_host,
      sshPort: management.ssh_port,
    });
    const relayTarget = relayNode
      ? buildEndpoint(relayNode, {
          accessMode: "direct",
          preferredLanIpv4,
          relayNode: null,
          samePrivateIpv4Subnet,
          sshHost: relayConfig?.ssh_host,
          sshPort: relayConfig?.ssh_port ?? 19822,
        })
      : null;
    const problems = [];

    if (management.requested_access_mode === "relay" && !management.relay_node_id) {
      problems.push("management_relay_node_id_missing");
    }

    if (management.requested_access_mode === "relay" && !relayNode) {
      problems.push("management_relay_node_missing");
    }

    if (!target?.host) {
      problems.push("management_target_missing");
    }

    if (management.requested_access_mode === "relay" && !relayTarget?.host) {
      problems.push("management_relay_target_missing");
    }

    const effectiveAccessMode =
      management.requested_access_mode === "relay" && relayTarget?.host ? "relay" : "direct";
    const routeLabel =
      effectiveAccessMode === "relay"
        ? `控制面 -> ${getNodeDisplayName(relayNode)} -> ${getNodeDisplayName(node)}`
        : `控制面 -> ${getNodeDisplayName(node)}`;
    const note =
      effectiveAccessMode === "relay"
        ? `控制面将通过 SSH 跳板 ${getNodeDisplayName(relayNode)} 连接 ${getNodeDisplayName(node)}。`
        : `控制面将直接连接 ${getNodeDisplayName(node)}。`;

    return {
      access_mode: effectiveAccessMode,
      requested_access_mode: management.requested_access_mode,
      relay_node: relayNode,
      relay_target: relayTarget,
      target,
      ssh_user: management.ssh_user,
      route_label: routeLabel,
      route_note: management.route_note,
      problems,
      config: management,
      reachable: Boolean(target?.host),
    };
  }

  return {
    getNodeDisplayName,
    resolveManagementConfig,
    resolveManagementRoute,
  };
}
