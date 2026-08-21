const SUCCESS_STATUSES = new Set(["success", "passed", "ok", "ready", "healthy", "running", "applied"]);
const FAILED_STATUSES = new Set(["failed", "failure", "error", "errored", "timeout", "rolled_back"]);
const UDP_QUIC_PROTOCOLS = new Set(["hysteria2", "hy2", "quic"]);
const UDP_QUIC_TRANSPORTS = new Set(["udp", "quic", "udp_quic", "udp/quic"]);

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

function normalizeStatus(value) {
  return normalizeString(value)?.toLowerCase() ?? null;
}

function normalizeProtocol(value) {
  const normalized = normalizeStatus(value);
  return normalized === "hysteria" ? "hysteria2" : normalized;
}

function normalizeTransport(value) {
  const normalized = normalizeStatus(value);
  if (normalized === "udp/quic") {
    return "udp_quic";
  }
  return normalized;
}

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function normalizeHost(value) {
  const raw = normalizeString(value);
  if (!raw) {
    return null;
  }

  return raw.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function normalizeCheckName(value) {
  return normalizeString(value)?.toLowerCase().replace(/[-\s]+/g, "_") ?? null;
}

function normalizeCheckStatus(value, fallback = "missing") {
  const status = normalizeStatus(value);
  if (!status) {
    return fallback;
  }
  if (SUCCESS_STATUSES.has(status)) {
    return "passed";
  }
  if (FAILED_STATUSES.has(status)) {
    return "failed";
  }
  if (status === "skipped" || status === "skip" || status === "not_applicable") {
    return "skipped";
  }
  if (status === "missing" || status === "unknown" || status === "pending") {
    return "missing";
  }
  return status;
}

function outputLinesFromTarget(target) {
  if (Array.isArray(target?.output)) {
    return target.output.map((line) => String(line || ""));
  }
  if (typeof target?.output_text === "string") {
    return target.output_text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  }
  return [];
}

function extractLastPublishMarker(outputLines, prefix) {
  const marker = `[publish] ${prefix}=`;
  for (let index = outputLines.length - 1; index >= 0; index -= 1) {
    const line = String(outputLines[index] || "");
    if (line.includes(marker)) {
      return normalizeString(line.slice(line.indexOf(marker) + marker.length));
    }
  }
  return null;
}

function extractPublishMarkers(outputLines, prefix) {
  const marker = `[publish] ${prefix}=`;
  return outputLines
    .map((line) => String(line || ""))
    .filter((line) => line.includes(marker))
    .map((line) => normalizeString(line.slice(line.indexOf(marker) + marker.length)))
    .filter(Boolean);
}

function collectPublishMarkers(outputLines) {
  return {
    stage: extractLastPublishMarker(outputLines, "stage"),
    validation: extractLastPublishMarker(outputLines, "validation"),
    activation: extractLastPublishMarker(outputLines, "activation"),
    result: extractLastPublishMarker(outputLines, "result"),
    error: extractLastPublishMarker(outputLines, "error"),
    results: extractPublishMarkers(outputLines, "result"),
    validations: extractPublishMarkers(outputLines, "validation"),
    errors: extractPublishMarkers(outputLines, "error"),
  };
}

function getCheckCandidate(checks, names) {
  if (!checks) {
    return null;
  }

  if (Array.isArray(checks)) {
    const normalizedNames = names.map(normalizeCheckName).filter(Boolean);
    return (
      checks.find((item) => normalizedNames.includes(normalizeCheckName(item?.name ?? item?.type))) ??
      null
    );
  }

  if (isPlainObject(checks)) {
    for (const name of names) {
      const direct = checks[name];
      if (direct != null) {
        return direct;
      }
      const normalizedName = normalizeCheckName(name);
      const matchedKey = Object.keys(checks).find((key) => normalizeCheckName(key) === normalizedName);
      if (matchedKey) {
        return checks[matchedKey];
      }
    }
  }

  return null;
}

function normalizeProvidedCheck(candidate, name) {
  if (candidate == null) {
    return null;
  }

  if (typeof candidate === "boolean") {
    return {
      name,
      status: candidate ? "passed" : "failed",
      reason_code: candidate ? `${name}_passed` : `${name}_failed`,
      message: null,
      details: null,
    };
  }

  if (!isPlainObject(candidate)) {
    return null;
  }

  const success =
    typeof candidate.success === "boolean"
      ? candidate.success
      : typeof candidate.passed === "boolean"
        ? candidate.passed
        : null;
  const status =
    success == null
      ? normalizeCheckStatus(candidate.status ?? candidate.state)
      : success
        ? "passed"
        : "failed";

  return {
    name,
    status,
    reason_code:
      normalizeString(candidate.reason_code ?? candidate.reason ?? candidate.error_code) ??
      (status === "passed" ? `${name}_passed` : `${name}_${status}`),
    message: normalizeString(candidate.message ?? candidate.error_message ?? candidate.note),
    latency_ms: Number.isFinite(Number(candidate.latency_ms)) ? Number(candidate.latency_ms) : null,
    protocol: normalizeProtocol(candidate.protocol),
    transport: normalizeTransport(candidate.transport),
    endpoint: normalizeEndpoint(candidate.endpoint ?? candidate.target ?? candidate.entry),
    details: candidate.details ?? null,
  };
}

function buildCheck(name, status, reasonCode, message = null, details = null) {
  return {
    name,
    status,
    passed: status === "passed",
    reason_code: reasonCode,
    message,
    details,
  };
}

function normalizeEndpoint(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const host = normalizeHost(value.host ?? value.hostname ?? value.address ?? value.entry_endpoint);
  const port = normalizePort(value.port ?? value.entry_port ?? value.listen_port);
  if (!host || !port) {
    return null;
  }

  return {
    host,
    port,
    protocol: normalizeProtocol(value.protocol),
    transport: normalizeTransport(value.transport),
    source: normalizeString(value.source),
  };
}

function endpointsEqual(left, right) {
  return Boolean(left?.host && right?.host && left.host === right.host && left.port === right.port);
}

function findDeploymentForNode(release, nodeId) {
  const deployments = Array.isArray(release?.deployments) ? release.deployments : [];
  return deployments.find((deployment) => deployment?.node_id === nodeId) ?? null;
}

function findRouteForNode(release, nodeId) {
  const routes = Array.isArray(release?.routes) ? release.routes : [];
  return routes.find((route) => route?.node_id === nodeId) ?? null;
}

function inferProfile(release, deployment) {
  return (
    deployment?.artifacts?.sing_box?.manifest?.profile ??
    deployment?.artifacts?.sing_box?.manifest?.release?.profile ??
    release?.profile ??
    null
  );
}

export function inferBusinessProbeKind({ release = null, deployment = null, profile = null } = {}) {
  const inferredProfile = profile ?? inferProfile(release, deployment);
  const protocol = normalizeProtocol(
    inferredProfile?.protocol ??
      release?.protocol ??
      deployment?.protocol ??
      deployment?.artifacts?.sing_box?.rendered_config?.inbounds?.[0]?.type,
  );
  const transport = normalizeTransport(
    inferredProfile?.transport ??
      release?.transport ??
      deployment?.transport ??
      deployment?.artifacts?.sing_box?.rendered_config?.inbounds?.[0]?.transport?.type,
  );

  if (UDP_QUIC_PROTOCOLS.has(protocol) || UDP_QUIC_TRANSPORTS.has(transport)) {
    return "udp_quic";
  }

  return "tcp";
}

function inferExpectedEntryEndpoint(release, deployment, explicitEndpoint = null) {
  const explicit = normalizeEndpoint(explicitEndpoint);
  if (explicit) {
    return explicit;
  }

  const nodeId = deployment?.node_id ?? null;
  const route = deployment?.route ?? findRouteForNode(release, nodeId);
  const routeEndpoint = normalizeEndpoint({
    host: route?.entry_endpoint,
    port: route?.entry_port,
    source: "release_route",
  });
  if (routeEndpoint) {
    return routeEndpoint;
  }

  const manifestRoutes = deployment?.artifacts?.sing_box?.manifest?.routes;
  const manifestRoute = Array.isArray(manifestRoutes)
    ? manifestRoutes.find((item) => item?.node_id === nodeId) ?? manifestRoutes[0]
    : null;
  const manifestEndpoint = normalizeEndpoint({
    host: manifestRoute?.entry_endpoint,
    port: manifestRoute?.entry_port,
    source: "release_manifest",
  });
  if (manifestEndpoint) {
    return manifestEndpoint;
  }

  return normalizeEndpoint(deployment?.expected_entry_endpoint ?? deployment?.business_endpoint);
}

function inferSubscriptionEndpoint(subscription) {
  if (!subscription) {
    return null;
  }

  if (isPlainObject(subscription)) {
    return normalizeEndpoint(
      subscription.endpoint ??
        subscription.entry ??
        subscription.business_endpoint ??
        {
          host: subscription.entry_endpoint ?? subscription.host,
          port: subscription.entry_port ?? subscription.port,
          protocol: subscription.protocol,
          transport: subscription.transport,
          source: subscription.source,
        },
    );
  }

  return null;
}

function buildRenderedCheck(deployment, markers, provided) {
  if (provided) {
    return buildCheck("rendered", provided.status, provided.reason_code, provided.message, provided.details);
  }

  if (
    markers.stage === "rendered" ||
    markers.result === "applied" ||
    markers.result === "rendered_only" ||
    Boolean(deployment?.artifacts?.sing_box?.rendered_config) ||
    Boolean(deployment?.artifacts?.traffic_forwarder?.rendered_config)
  ) {
    return buildCheck("rendered", "passed", "rendered");
  }

  return buildCheck("rendered", "failed", "render_missing", "release artifact was not rendered");
}

function buildConfigValidationCheck(markers, provided) {
  if (provided) {
    return buildCheck(
      "config_validation",
      provided.status,
      provided.reason_code,
      provided.message,
      provided.details,
    );
  }

  if (markers.error === "validation_failed" || markers.errors.includes("validation_failed")) {
    return buildCheck("config_validation", "failed", "validation_failed", "rendered config validation failed");
  }
  if (markers.validation === "passed" || markers.result === "applied") {
    return buildCheck("config_validation", "passed", "validation_passed");
  }
  if (markers.validation === "skipped") {
    return buildCheck("config_validation", "skipped", "validation_skipped", "config validation was skipped");
  }

  return buildCheck("config_validation", "missing", "validation_missing", "config validation was not reported");
}

function buildActivationCheck(markers, target, provided) {
  if (provided) {
    return buildCheck("activation", provided.status, provided.reason_code, provided.message, provided.details);
  }

  if (markers.results.includes("rolled_back")) {
    return buildCheck("activation", "failed", "rolled_back", "at least one publish component rolled back");
  }
  if (markers.results.includes("rendered_only")) {
    return buildCheck(
      "activation",
      "missing",
      "rendered_only_not_applied",
      "at least one publish component was rendered but not applied",
    );
  }
  if (markers.result === "applied" || markers.activation === "running") {
    return buildCheck("activation", "passed", "activation_running");
  }
  if (markers.result === "rolled_back") {
    return buildCheck("activation", "failed", "rolled_back", "publish rolled back after activation failure");
  }
  if (markers.result === "rendered_only") {
    return buildCheck(
      "activation",
      "missing",
      "rendered_only_not_applied",
      "rendered_only is not an applied deployment",
    );
  }
  if (markers.error === "restart_failed" || markers.error === "service_not_running") {
    return buildCheck("activation", "failed", markers.error, "service activation or restart failed");
  }
  if (normalizeStatus(target?.status) === "failed") {
    return buildCheck("activation", "failed", "publish_failed", "operation target failed before activation");
  }

  return buildCheck("activation", "missing", "activation_missing", "service activation was not reported");
}

function buildBusinessEntryCheck({ expectedKind, providedChecks, businessProbe }) {
  const generic =
    normalizeProvidedCheck(getCheckCandidate(providedChecks, ["business_entry", "business_entry_probe"]), "business_entry") ??
    normalizeProvidedCheck(businessProbe, "business_entry");
  const tcp = normalizeProvidedCheck(
    getCheckCandidate(providedChecks, ["business_entry_tcp", "tcp"]),
    "business_entry_tcp",
  );
  const udpQuic = normalizeProvidedCheck(
    getCheckCandidate(providedChecks, ["business_entry_udp_quic", "udp_quic", "quic"]),
    "business_entry_udp_quic",
  );
  const stageTcp =
    businessProbe?.stages?.business_entry_tcp || businessProbe?.tcp
      ? normalizeProvidedCheck(
          {
            ...(businessProbe.stages?.business_entry_tcp ?? businessProbe.tcp),
            protocol: "tcp",
          },
          "business_entry_tcp",
        )
      : null;
  const stageUdpQuic =
    businessProbe?.stages?.business_entry_udp_quic || businessProbe?.udp_quic || businessProbe?.quic
      ? normalizeProvidedCheck(
          {
            ...(businessProbe.stages?.business_entry_udp_quic ?? businessProbe.udp_quic ?? businessProbe.quic),
            protocol: "udp_quic",
          },
          "business_entry_udp_quic",
        )
      : null;

  const selected =
    expectedKind === "udp_quic"
      ? udpQuic ?? stageUdpQuic ?? (generic?.protocol === "udp_quic" ? generic : null)
      : tcp ?? stageTcp ?? generic;

  if (selected) {
    return buildCheck(
      "business_entry",
      selected.status,
      selected.reason_code,
      selected.message,
      {
        protocol: expectedKind,
        latency_ms: selected.latency_ms,
        endpoint: selected.endpoint,
        details: selected.details,
      },
    );
  }

  if (expectedKind === "udp_quic" && (tcp || stageTcp || generic?.protocol === "tcp")) {
    return buildCheck(
      "business_entry",
      "failed",
      "business_entry_wrong_protocol_probe",
      "UDP/QUIC releases require a UDP/QUIC business probe; TCP success is not enough",
      { protocol: expectedKind },
    );
  }

  return buildCheck(
    "business_entry",
    "missing",
    expectedKind === "udp_quic" ? "business_entry_udp_quic_missing" : "business_entry_tcp_missing",
    "business entry probe was not reported",
    { protocol: expectedKind },
  );
}

function buildSubscriptionCheck({ expectedEndpoint, subscription, providedChecks, requireSubscriptionConsistency }) {
  const provided = normalizeProvidedCheck(
    getCheckCandidate(providedChecks, ["subscription_entry", "subscription_consistency"]),
    "subscription_entry",
  );
  if (provided) {
    return buildCheck(
      "subscription_entry",
      provided.status,
      provided.reason_code,
      provided.message,
      provided.details,
    );
  }

  const subscriptionEndpoint = inferSubscriptionEndpoint(subscription);
  if (!expectedEndpoint && !subscriptionEndpoint) {
    return buildCheck(
      "subscription_entry",
      requireSubscriptionConsistency ? "missing" : "skipped",
      "subscription_entry_unavailable",
      "subscription entry was not provided",
    );
  }
  if (!expectedEndpoint || !subscriptionEndpoint) {
    return buildCheck(
      "subscription_entry",
      requireSubscriptionConsistency ? "missing" : "skipped",
      "subscription_entry_incomplete",
      "expected or subscription entry endpoint is missing",
      { expected_endpoint: expectedEndpoint, subscription_endpoint: subscriptionEndpoint },
    );
  }
  if (!endpointsEqual(expectedEndpoint, subscriptionEndpoint)) {
    return buildCheck(
      "subscription_entry",
      "failed",
      "subscription_entry_mismatch",
      "subscription entry endpoint does not match the release entry endpoint",
      { expected_endpoint: expectedEndpoint, subscription_endpoint: subscriptionEndpoint },
    );
  }

  return buildCheck("subscription_entry", "passed", "subscription_entry_matched", null, {
    expected_endpoint: expectedEndpoint,
    subscription_endpoint: subscriptionEndpoint,
  });
}

function statusFromChecks(checks, requiredCheckNames) {
  const required = checks.filter((check) => requiredCheckNames.includes(check.name));
  if (required.some((check) => check.status === "failed")) {
    return "failed";
  }
  if (required.every((check) => check.status === "passed")) {
    return "success";
  }
  return "partial";
}

function failureListFromChecks(checks) {
  return checks
    .filter((check) => check.status !== "passed" && check.status !== "skipped")
    .map((check) => ({
      check: check.name,
      reason_code: check.reason_code,
      message: check.message,
      details: check.details ?? null,
    }));
}

export function evaluateDeploymentVerification({
  release = null,
  deployment = null,
  operationTarget = null,
  checks: providedChecks = null,
  businessProbe = null,
  subscription = null,
  expectedEntryEndpoint = null,
  requireSubscriptionConsistency = false,
} = {}) {
  const outputLines = outputLinesFromTarget(operationTarget);
  const markers = collectPublishMarkers(outputLines);
  const targetStatus = normalizeStatus(operationTarget?.status);
  const expectedKind = inferBusinessProbeKind({ release, deployment });
  const expectedEndpoint = inferExpectedEntryEndpoint(release, deployment, expectedEntryEndpoint);
  const rendered = buildRenderedCheck(
    deployment,
    markers,
    normalizeProvidedCheck(getCheckCandidate(providedChecks, ["rendered", "render"]), "rendered"),
  );
  const configValidation = buildConfigValidationCheck(
    markers,
    normalizeProvidedCheck(
      getCheckCandidate(providedChecks, ["config_validation", "validation"]),
      "config_validation",
    ),
  );
  const activation = buildActivationCheck(
    markers,
    operationTarget,
    normalizeProvidedCheck(
      getCheckCandidate(providedChecks, ["activation", "restart", "process_health"]),
      "activation",
    ),
  );
  const businessEntry = buildBusinessEntryCheck({
    expectedKind,
    providedChecks,
    businessProbe,
  });
  const subscriptionEntry = buildSubscriptionCheck({
    expectedEndpoint,
    subscription,
    providedChecks,
    requireSubscriptionConsistency,
  });
  const allChecks = [rendered, configValidation, activation, businessEntry, subscriptionEntry];
  const requiredCheckNames = [
    "rendered",
    "config_validation",
    "activation",
    "business_entry",
    ...(requireSubscriptionConsistency || subscription || subscriptionEntry.status === "failed"
      ? ["subscription_entry"]
      : []),
  ];
  const status =
    targetStatus === "failed" && markers.result !== "rendered_only"
      ? "failed"
      : statusFromChecks(allChecks, requiredCheckNames);

  return {
    node_id: deployment?.node_id ?? operationTarget?.node_id ?? null,
    status,
    success: status === "success",
    applied: activation.status === "passed",
    rendered: rendered.status === "passed",
    business_entry_ready: businessEntry.status === "passed",
    business_probe_kind: expectedKind,
    checks: allChecks,
    failures: failureListFromChecks(allChecks),
  };
}

export function evaluateReleaseVerification({
  release = null,
  operation = null,
  deployments = null,
  checksByNodeId = null,
  businessProbesByNodeId = null,
  subscriptionsByNodeId = null,
  requireSubscriptionConsistency = false,
} = {}) {
  const deploymentItems = Array.isArray(deployments)
    ? deployments
    : Array.isArray(release?.deployments)
      ? release.deployments
      : [];
  const operationTargets = Array.isArray(operation?.targets) ? operation.targets : [];
  const nodeIds = [
    ...new Set([
      ...deploymentItems.map((item) => item?.node_id).filter(Boolean),
      ...operationTargets.map((item) => item?.node_id).filter(Boolean),
    ]),
  ];

  if (nodeIds.length === 0) {
    return {
      release_id: release?.id ?? null,
      status: "failed",
      success: false,
      deployments: [],
      summary: { total: 0, success: 0, partial: 0, failed: 0 },
      failures: [
        {
          check: "release",
          reason_code: "deployment_targets_missing",
          message: "release has no deployment targets to verify",
          details: null,
        },
      ],
    };
  }

  const deploymentResults = nodeIds.map((nodeId) => {
    const deployment =
      deploymentItems.find((item) => item?.node_id === nodeId) ?? findDeploymentForNode(release, nodeId);
    const operationTarget = operationTargets.find((item) => item?.node_id === nodeId) ?? null;
    return evaluateDeploymentVerification({
      release,
      deployment: deployment ?? { node_id: nodeId },
      operationTarget,
      checks: checksByNodeId?.[nodeId] ?? null,
      businessProbe: businessProbesByNodeId?.[nodeId] ?? null,
      subscription: subscriptionsByNodeId?.[nodeId] ?? null,
      requireSubscriptionConsistency,
    });
  });
  const summary = {
    total: deploymentResults.length,
    success: deploymentResults.filter((item) => item.status === "success").length,
    partial: deploymentResults.filter((item) => item.status === "partial").length,
    failed: deploymentResults.filter((item) => item.status === "failed").length,
  };
  const status =
    summary.success === summary.total
      ? "success"
      : summary.failed === summary.total
        ? "failed"
        : "partial";

  return {
    release_id: release?.id ?? null,
    status,
    success: status === "success",
    deployments: deploymentResults,
    summary,
    failures: deploymentResults.flatMap((item) =>
      item.failures.map((failure) => ({
        ...failure,
        node_id: item.node_id,
      })),
    ),
  };
}
