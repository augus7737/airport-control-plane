export const SUPPORTED_MANAGEMENT_RELAY_STRATEGIES = Object.freeze([
  "auto",
  "tcp_forward",
  "exec_nc",
]);

export function normalizeManagementRelayStrategy(value, fallback = "auto") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (SUPPORTED_MANAGEMENT_RELAY_STRATEGIES.includes(normalized)) {
    return normalized;
  }

  return fallback;
}

export function relayStrategyCandidates(strategy) {
  const normalized = normalizeManagementRelayStrategy(strategy, "auto");
  if (normalized === "auto") {
    return ["tcp_forward", "exec_nc"];
  }

  return [normalized];
}

export function relayTransportStrategyFromKind(kind) {
  const normalized = String(kind || "")
    .trim()
    .toLowerCase();

  if (normalized === "ssh-relay") {
    return "tcp_forward";
  }

  if (normalized === "ssh-relay-tcp-forward") {
    return "tcp_forward";
  }

  if (normalized === "ssh-relay-exec-nc") {
    return "exec_nc";
  }

  return null;
}

export function isRelayTransportKind(kind) {
  const normalized = String(kind || "")
    .trim()
    .toLowerCase();

  return normalized === "ssh-relay" || normalized.startsWith("ssh-relay-") || normalized === "ssh-proxy";
}
