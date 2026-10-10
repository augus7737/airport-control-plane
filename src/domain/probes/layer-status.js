// 节点分层状态：node.status 只表达管理链路，业务入口与 relay 上游各存自己的读数。
export const PROBE_LAYERS = ["management", "business", "relay_upstream"];

const LAYER_STATES = new Set(["ready", "unreachable", "not_applicable", "unknown"]);

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatTarget(target) {
  if (!target?.host || !target?.port) {
    return "-";
  }

  return target.family === "ipv6" ? `[${target.host}]:${target.port}` : `${target.host}:${target.port}`;
}

function buildLayer({ state, observedAt, target, reasonCode }) {
  return {
    state: LAYER_STATES.has(state) ? state : "unknown",
    observed_at: state === "unknown" ? null : observedAt ?? null,
    target: target ?? "-",
    reason_code: normalizeString(reasonCode),
  };
}

export function buildUnknownLayer(observedAt = null) {
  return buildLayer({
    state: "unknown",
    observedAt,
    target: "-",
    reasonCode: null,
  });
}

export function buildManagementLayerReading(management, observedAt) {
  const ready = Boolean(management?.control_ready);
  return buildLayer({
    state: ready ? "ready" : "unreachable",
    observedAt,
    target: formatTarget(management?.target ?? null),
    reasonCode: ready ? null : management?.reason_code ?? management?.ssh?.error_message ?? null,
  });
}

// 业务入口与 relay 上游同构：先问"这层适不适用"，再问"通不通"。
export function buildApplicabilityLayerReading(result, observedAt) {
  let state = "unknown";
  if (typeof result?.applicable === "boolean") {
    state = !result.applicable ? "not_applicable" : result.success ? "ready" : "unreachable";
  }

  return buildLayer({
    state,
    observedAt,
    target: formatTarget(result?.target ?? null),
    reasonCode:
      state === "ready"
        ? null
        : result?.reason_code ?? result?.stage?.error_message ?? result?.tcp?.error_message ?? null,
  });
}

// 每次探测只覆盖本次取证到的层；没取证的层沿用上一次读数，避免单项探测把另一层抹成坏。
export function assembleLayerStatus({ observedAt, probeType, previous, readings }) {
  const base = previous && typeof previous === "object" ? previous : {};
  const status = {
    observed_at: observedAt ?? null,
    probe_type: normalizeString(probeType),
  };

  for (const layer of PROBE_LAYERS) {
    const reading = normalizeLayerValue(readings?.[layer]);
    const carried = reading ?? normalizeLayerValue(base[layer]);
    status[layer] = carried ?? buildUnknownLayer(base.observed_at ?? null);
  }

  const failedLayer = PROBE_LAYERS.find((layer) => readings?.[layer]?.state === "unreachable") ?? null;
  status.failed_layer = failedLayer;
  status.reason_code = failedLayer ? normalizeString(readings[failedLayer]?.reason_code) : null;
  return status;
}

export function normalizeLayerValue(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const state = normalizeString(value.state);
  if (!LAYER_STATES.has(state)) {
    return null;
  }

  return buildLayer({
    state,
    observedAt: normalizeString(value.observed_at),
    target: normalizeString(value.target) ?? "-",
    reasonCode: value.reason_code,
  });
}

export function normalizeNodeLayerStatus(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const status = {
    observed_at: normalizeString(value.observed_at),
    probe_type: normalizeString(value.probe_type),
    failed_layer: null,
    reason_code: normalizeString(value.reason_code),
  };

  const failedLayer = normalizeString(value.failed_layer);
  if (PROBE_LAYERS.includes(failedLayer)) {
    status.failed_layer = failedLayer;
  }

  for (const layer of PROBE_LAYERS) {
    status[layer] = normalizeLayerValue(value[layer]) ?? buildUnknownLayer(status.observed_at);
  }

  return status;
}

const LAYER_STATE_TEXT = {
  ready: "通",
  unreachable: "不通",
  not_applicable: "不适用",
  unknown: "未取证",
};

const FAILED_LAYER_TEXT = {
  management: "管理链路",
  business: "业务入口",
  relay_upstream: "relay 上游",
};

export function formatLayerState(state) {
  const normalized = normalizeString(state);
  return normalized ? LAYER_STATE_TEXT[normalized] ?? normalized : LAYER_STATE_TEXT.unknown;
}

export function formatFailedLayer(layer) {
  const normalized = normalizeString(layer);
  return normalized ? FAILED_LAYER_TEXT[normalized] ?? normalized : null;
}
