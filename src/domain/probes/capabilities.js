const UDP_PROTOCOLS = new Set(["hysteria2", "hy2"]);
const UDP_NETWORK_PROTOCOLS = new Set(["udp", "quic", "h3", "http3"]);

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function firstString(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function readTransportKind(route = {}) {
  const transport = route?.transport;
  return firstString(
    transport?.kind,
    transport?.transport_kind,
    route?.transport_kind,
    route?.relay_transport_kind,
    route?.management_transport_kind,
    route?.management?.transport_kind,
    route?.management?.route_transport,
    route?.route_transport,
    route?.transport,
  );
}

function readRelayCapabilities(route = {}) {
  return (
    route?.relay_capabilities ??
    route?.transport?.relay_capabilities ??
    route?.management?.relay_capabilities ??
    null
  );
}

function hasExplicitUdpSupport(capabilities) {
  if (!capabilities || typeof capabilities !== "object") {
    return null;
  }

  for (const key of ["supports_udp", "udp_supported", "allow_udp_forwarding", "udp_forwarding"]) {
    if (capabilities[key] === true) {
      return true;
    }
    if (capabilities[key] === false) {
      return false;
    }
  }

  return null;
}

function inferRelayUsed(route = {}) {
  const accessMode = normalizeString(route?.access_mode ?? route?.requested_access_mode);
  const transportKind = readTransportKind(route);
  if (accessMode === "relay" || accessMode === "proxy") {
    return true;
  }

  return Boolean(
    transportKind &&
      (transportKind === "ssh-proxy" ||
        transportKind === "ssh-relay" ||
        transportKind.startsWith("ssh-relay-") ||
        transportKind.includes("relay") ||
        transportKind.includes("proxy")),
  );
}

export function resolveProfileProbeRequirement(profile = {}) {
  const protocol = firstString(profile?.protocol, profile?.type) ?? "vless";
  const networkProtocol =
    firstString(
      profile?.network_protocol,
      profile?.networkProtocol,
      profile?.network?.protocol,
      profile?.transport,
      profile?.metadata?.transport,
    ) ?? (UDP_PROTOCOLS.has(protocol) ? "udp" : "tcp");
  const requiresUdp = UDP_PROTOCOLS.has(protocol) || UDP_NETWORK_PROTOCOLS.has(networkProtocol);
  const requiresQuic =
    UDP_PROTOCOLS.has(protocol) || ["quic", "h3", "http3"].includes(networkProtocol);
  const requiredProbeTypes = requiresUdp ? [requiresQuic ? "udp_quic" : "udp"] : ["tcp_connect"];

  return {
    protocol,
    network_protocol: networkProtocol,
    requires_udp: requiresUdp,
    requires_quic: requiresQuic,
    required_probe_types: requiredProbeTypes,
  };
}

export function resolveRelayUdpSupport(route = {}) {
  const relayUsed = inferRelayUsed(route);
  const transportKind = readTransportKind(route);
  const capabilities = readRelayCapabilities(route);
  const explicitSupport = hasExplicitUdpSupport(capabilities);

  if (!relayUsed) {
    return {
      relay_used: false,
      supports_udp: true,
      reason_code: null,
      transport_kind: transportKind ?? "direct",
      relay_capabilities: capabilities,
    };
  }

  if (explicitSupport !== null) {
    return {
      relay_used: true,
      supports_udp: explicitSupport,
      reason_code: explicitSupport ? null : "relay_udp_not_supported",
      transport_kind: transportKind,
      relay_capabilities: capabilities,
    };
  }

  const tcpOnly =
    !transportKind ||
    transportKind === "tcp" ||
    transportKind === "tcp_forward" ||
    transportKind === "exec_nc" ||
    transportKind === "ssh-proxy" ||
    transportKind === "ssh-relay" ||
    transportKind === "ssh-relay-tcp-forward" ||
    transportKind === "ssh-relay-exec-nc" ||
    transportKind.includes("haproxy");

  if (tcpOnly) {
    return {
      relay_used: true,
      supports_udp: false,
      reason_code: "relay_udp_not_supported",
      transport_kind: transportKind,
      relay_capabilities: capabilities,
    };
  }

  const udpTunnel =
    transportKind.includes("udp") ||
    transportKind.includes("quic") ||
    transportKind.includes("wireguard") ||
    transportKind.includes("tailscale") ||
    transportKind.includes("zerotier") ||
    transportKind.includes("tun");

  return {
    relay_used: true,
    supports_udp: udpTunnel,
    reason_code: udpTunnel ? null : "relay_udp_support_unknown",
    transport_kind: transportKind,
    relay_capabilities: capabilities,
  };
}

export function evaluateProfilePublishCapabilities({ profile = {}, route = {}, managementRoute = null } = {}) {
  const requirement = resolveProfileProbeRequirement(profile);
  const relay = resolveRelayUdpSupport(managementRoute ?? route);
  const publishIssues = [];

  if (requirement.requires_udp && relay.relay_used && relay.supports_udp !== true) {
    publishIssues.push({
      code: relay.reason_code || "relay_udp_support_unknown",
      severity: "blocking",
      publishable: false,
      message:
        relay.reason_code === "relay_udp_support_unknown"
          ? "当前 relay 传输未声明 UDP 能力，不能发布需要 UDP/QUIC 的线路。"
          : "当前 relay 只具备 TCP 转发/桥接能力，不能发布需要 UDP/QUIC 的线路。",
      protocol: requirement.protocol,
      network_protocol: requirement.network_protocol,
      transport_kind: relay.transport_kind,
      required_probe_types: requirement.required_probe_types,
    });
  }

  return {
    publishable: publishIssues.length === 0,
    protocol: requirement.protocol,
    network_protocol: requirement.network_protocol,
    requires_udp: requirement.requires_udp,
    requires_quic: requirement.requires_quic,
    required_probe_types: requirement.required_probe_types,
    relay,
    publish_issues: publishIssues,
  };
}
