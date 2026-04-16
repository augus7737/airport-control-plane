import {
  normalizeManagementRelayStrategy,
  relayStrategyCandidates,
} from "./management-strategies.js";

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

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }

  return Boolean(fallback);
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

function inferHostFamily(host) {
  const value = normalizeString(host);
  if (!value) {
    return null;
  }

  return value.includes(":") ? "ipv6" : "ipv4";
}

function buildProxyEndpoint(host, port, sshUser, label = null) {
  const proxyHost = normalizeString(host);
  if (!proxyHost) {
    return null;
  }

  return {
    host: proxyHost,
    port: normalizePort(port) ?? 22,
    family: inferHostFamily(proxyHost),
    source: "proxy_host",
    ssh_user: normalizeString(sshUser) ?? null,
    label: normalizeString(label) ?? proxyHost,
  };
}

function resolveManagementConfig(node, defaultNodeSshUser, options = {}) {
  const { allowLegacyNetworkingFallback = false } = options;
  const management = isPlainObject(node?.management) ? node.management : {};
  const legacyNetworking =
    allowLegacyNetworkingFallback && isPlainObject(node?.networking) ? node.networking : {};
  const requestedAccessMode =
    normalizeString(management.access_mode) ??
    normalizeString(node?.ssh_access_mode) ??
    normalizeString(legacyNetworking.access_mode) ??
    "direct";
  const requestedProxyHost =
    requestedAccessMode === "relay"
      ? normalizeString(management.proxy_host) ?? normalizeString(node?.ssh_proxy_host)
      : null;

  return {
    requested_access_mode: requestedAccessMode === "relay" ? "relay" : "direct",
    relay_strategy:
      requestedAccessMode === "relay"
        ? normalizeManagementRelayStrategy(management.relay_strategy, "auto")
        : null,
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
    proxy_host:
      requestedProxyHost,
    proxy_port:
      requestedProxyHost
        ? normalizePort(management.proxy_port) ??
          normalizePort(node?.ssh_proxy_port) ??
          22
        : null,
    proxy_user:
      requestedProxyHost
        ? normalizeString(management.proxy_user) ??
          normalizeString(node?.ssh_proxy_user) ??
          defaultNodeSshUser
        : null,
    proxy_label:
      requestedProxyHost
        ? normalizeString(management.proxy_label) ??
          normalizeString(node?.ssh_proxy_label)
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
    allow_ipv6: normalizeBoolean(management.allow_ipv6, false),
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
    allowIpv6 = false,
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

  const useReachablePrivateIpv4 = controllerCanReachPrivateIpv4 || relayCanReachPrivateIpv4;
  const host = useReachablePrivateIpv4
    ? privateIpv4
    : publicIpv4 || (allowIpv6 ? publicIpv6 : null) || null;

  if (!host) {
    return null;
  }

  return {
    host,
    port: sshPort,
    family: host.includes(":") ? "ipv6" : "ipv4",
    source:
      useReachablePrivateIpv4
        ? "private_ipv4"
        : host === publicIpv4
          ? "public_ipv4"
          : host === publicIpv6
            ? "public_ipv6"
            : "management_target_unresolved",
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
    const allowLegacyNetworkingFallback = options.allowLegacyNetworkingFallback === true;
    const management = resolveManagementConfig(node, defaultNodeSshUser, {
      allowLegacyNetworkingFallback,
    });
    const preferredLanIpv4 = options.preferredLanIpv4 ?? getPreferredLanIpv4();
    const relayNode =
      management.requested_access_mode === "relay" && management.relay_node_id
        ? getNodeById(management.relay_node_id)
        : null;
    const proxyTarget =
      management.requested_access_mode === "relay"
        ? buildProxyEndpoint(
            management.proxy_host,
            management.proxy_port,
            management.proxy_user,
            management.proxy_label,
          )
        : null;
    const relayConfig = relayNode
      ? resolveManagementConfig(relayNode, defaultNodeSshUser, {
          allowLegacyNetworkingFallback,
        })
      : null;
    const target = buildEndpoint(node, {
      accessMode: management.requested_access_mode,
      preferredLanIpv4,
      relayNode,
      samePrivateIpv4Subnet,
      sshHost: management.ssh_host,
      sshPort: management.ssh_port,
      allowIpv6: management.allow_ipv6,
    });
    const relayTarget = relayNode
      ? buildEndpoint(relayNode, {
          accessMode: "direct",
          preferredLanIpv4,
          relayNode: null,
          samePrivateIpv4Subnet,
          sshHost: relayConfig?.ssh_host,
          sshPort: relayConfig?.ssh_port ?? 19822,
          allowIpv6: relayConfig?.allow_ipv6 ?? false,
        })
      : proxyTarget;
    const relayKind = relayNode ? "managed-node" : proxyTarget ? "ssh-proxy" : null;
    const problems = [];
    const hasRelayNodeConfig = Boolean(management.relay_node_id);
    const hasProxyConfig = Boolean(proxyTarget?.host);

    if (management.requested_access_mode === "relay" && !hasRelayNodeConfig && !hasProxyConfig) {
      problems.push("management_relay_target_missing");
    }

    if (management.requested_access_mode === "relay" && hasRelayNodeConfig && !relayNode && !hasProxyConfig) {
      problems.push("management_relay_node_missing");
    }

    const hasExplicitSshHost = Boolean(management.ssh_host);
    const hasPublicIpv4 = Boolean(normalizeString(node?.facts?.public_ipv4));
    const hasPublicIpv6 = Boolean(normalizeString(node?.facts?.public_ipv6));
    const hasReachablePrivateIpv4 =
      Boolean(target?.source === "private_ipv4");

    if (
      !hasExplicitSshHost &&
      !hasPublicIpv4 &&
      !hasReachablePrivateIpv4 &&
      hasPublicIpv6 &&
      !management.allow_ipv6
    ) {
      problems.push("management_public_ipv4_missing");
    }

    if (!target?.host) {
      problems.push("management_target_missing");
    }

    if (management.requested_access_mode === "relay" && !relayTarget?.host) {
      problems.push(hasProxyConfig ? "management_proxy_target_missing" : "management_relay_target_missing");
    }

    const effectiveAccessMode =
      management.requested_access_mode === "relay" && relayTarget?.host ? "relay" : "direct";
    const routeLabel =
      effectiveAccessMode === "relay"
        ? relayKind === "ssh-proxy"
          ? `控制面 -> SSH 代理 ${proxyTarget?.label || proxyTarget?.host || "未命名代理"} -> ${getNodeDisplayName(node)}`
          : `控制面 -> ${getNodeDisplayName(relayNode)} -> ${getNodeDisplayName(node)}`
        : `控制面 -> ${getNodeDisplayName(node)}`;
    const note =
      effectiveAccessMode === "relay"
        ? relayKind === "ssh-proxy"
          ? `控制面将通过 SSH 代理 ${proxyTarget?.label || proxyTarget?.host || "未命名代理"} 连接 ${getNodeDisplayName(node)}。`
          : `控制面将通过 SSH 跳板 ${getNodeDisplayName(relayNode)} 连接 ${getNodeDisplayName(node)}。`
        : `控制面将直接连接 ${getNodeDisplayName(node)}。`;

    return {
      access_mode: effectiveAccessMode,
      requested_access_mode: management.requested_access_mode,
      relay_kind: relayKind,
      relay_node: relayNode,
      relay_target: relayTarget,
      proxy_target: relayKind === "ssh-proxy" ? proxyTarget : null,
      target,
      ssh_user: management.ssh_user,
      allow_ipv6: management.allow_ipv6,
      route_label: routeLabel,
      route_note: management.route_note,
      problems,
      relay_strategy: management.relay_strategy,
      strategy_candidates:
        management.requested_access_mode === "relay"
          ? relayStrategyCandidates(management.relay_strategy)
          : [],
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
