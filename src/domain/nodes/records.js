import {
  normalizeBillingCycle,
  normalizeCostCurrency,
  normalizeNullableInteger,
  normalizeNullableNumber,
} from "../costs/normalize.js";
import { normalizeManagementRelayStrategy } from "../routes/management-strategies.js";

function sourceValue(source, key, fallback = null) {
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeBooleanValue(value, fallback = false) {
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

function normalizeNullableStringValue(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : fallback;
}

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function readRecordSource(source, key) {
  return isPlainObject(source?.[key]) ? source[key] : source;
}

const REGION_LOCATION_PRESETS = [
  { value: "中国大陆", aliases: ["中国", "Mainland China", "CN"] },
  { value: "香港", aliases: ["HKG", "HK", "中国香港", "Hong Kong"] },
  { value: "日本", aliases: ["Japan", "JP", "Tokyo", "TYO", "NRT", "TOK", "Narita", "Osaka", "OSA", "东京", "大阪"] },
  { value: "新加坡", aliases: ["SIN", "Singapore"] },
  { value: "韩国", aliases: ["South Korea", "KR", "Seoul", "SEL", "ICN", "Incheon", "首尔", "首尔仁川"] },
  { value: "中国台湾", aliases: ["Taiwan", "TW", "TPE", "Taipei", "台湾", "台北", "中国台湾"] },
  {
    value: "美国",
    aliases: [
      "United States",
      "US",
      "Los Angeles",
      "LAX",
      "San Jose",
      "SJC",
      "Seattle",
      "SEA",
      "洛杉矶",
      "圣何塞",
      "西雅图",
    ],
  },
  { value: "德国", aliases: ["Germany", "DE", "Frankfurt", "FRA", "Nuremberg", "NBG", "法兰克福", "纽伦堡"] },
  { value: "芬兰", aliases: ["Finland", "FI", "Helsinki", "HEL", "赫尔辛基"] },
  { value: "英国", aliases: ["United Kingdom", "UK", "GB", "London", "LON", "伦敦"] },
  { value: "荷兰", aliases: ["Netherlands", "NL", "Amsterdam", "AMS", "阿姆斯特丹"] },
  { value: "法国", aliases: ["France", "FR", "Paris", "PAR", "巴黎"] },
  { value: "澳大利亚", aliases: ["Australia", "AU", "Sydney", "SYD", "悉尼"] },
];

const ENTRY_LOCATION_PRESETS = [
  { value: "中国大陆", aliases: ["中国", "Mainland China", "CN"] },
  { value: "香港", aliases: ["HKG", "HK", "中国香港", "Hong Kong"] },
  { value: "台湾", aliases: ["中国台湾", "Taiwan", "TPE"] },
  { value: "日本", aliases: ["Japan", "JP"] },
  { value: "韩国", aliases: ["South Korea", "KR"] },
  { value: "新加坡", aliases: ["Singapore", "SG"] },
  { value: "美国西海岸", aliases: ["US West Coast", "西海岸"] },
  { value: "欧洲", aliases: ["Europe", "EU"] },
];

function normalizeLocationSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function findLocationPreset(value, scope = "region") {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const normalized = normalizeLocationSearch(raw);
  const presets = scope === "entry" ? ENTRY_LOCATION_PRESETS : REGION_LOCATION_PRESETS;

  for (const preset of presets) {
    const tokens = [preset.value, ...preset.aliases].map((item) => normalizeLocationSearch(item));
    if (tokens.includes(normalized)) {
      return preset;
    }
  }

  if (normalized.includes("香港") || normalized.includes("hong kong")) {
    return presets.find((preset) => preset.value === "香港") || null;
  }
  if (normalized.includes("中国大陆") || normalized === "中国" || normalized.includes("mainland")) {
    return presets.find((preset) => preset.value === "中国大陆") || null;
  }
  if (normalized.includes("台湾")) {
    return presets.find((preset) => preset.value === (scope === "entry" ? "台湾" : "中国台湾")) || null;
  }
  if (normalized.includes("日本")) {
    return presets.find((preset) => preset.value === "日本") || null;
  }
  if (normalized.includes("新加坡")) {
    return presets.find((preset) => preset.value === "新加坡") || null;
  }
  if (normalized.includes("韩国")) {
    return presets.find((preset) => preset.value === "韩国") || null;
  }

  return null;
}

export function normalizeLocationValue(value, scope = "region") {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const preset = findLocationPreset(raw, scope);
  return preset?.value || raw;
}

export function normalizeLocationList(values = [], scope = "region") {
  const collection = Array.isArray(values) ? values : [values];
  return [...new Set(
    collection
      .map((item) => normalizeLocationValue(item, scope) || String(item || "").trim())
      .filter(Boolean),
  )];
}

function normalizeLabelsRecord(labels = {}) {
  if (!isPlainObject(labels)) {
    return labels ?? {};
  }

  return {
    ...labels,
    region: normalizeLocationValue(labels.region, "region"),
  };
}

function normalizeNetworkingRecord(record = {}) {
  if (!isPlainObject(record)) {
    return record ?? {};
  }

  const accessMode = sourceValue(record, "access_mode", "direct");
  return {
    ...record,
    entry_region: normalizeLocationValue(record.entry_region, "entry"),
    relay_region:
      accessMode === "relay"
        ? normalizeLocationValue(record.relay_region, "region")
        : null,
  };
}

function normalizeManagementRecord(record = {}) {
  if (!isPlainObject(record)) {
    return record ?? {};
  }

  const accessMode = sourceValue(record, "access_mode", "direct");
  return {
    ...record,
    relay_strategy:
      accessMode === "relay"
        ? normalizeManagementRelayStrategy(sourceValue(record, "relay_strategy", "auto"))
        : null,
    proxy_host: accessMode === "relay" ? sourceValue(record, "proxy_host", null) : null,
    proxy_port: accessMode === "relay" ? sourceValue(record, "proxy_port", null) : null,
    proxy_user: accessMode === "relay" ? sourceValue(record, "proxy_user", null) : null,
    proxy_label: accessMode === "relay" ? sourceValue(record, "proxy_label", null) : null,
    relay_region:
      accessMode === "relay"
        ? normalizeLocationValue(record.relay_region, "region")
        : null,
  };
}

function hasExplicitManagementSshPort(source = {}) {
  if (isPlainObject(source?.management)) {
    return Object.prototype.hasOwnProperty.call(source.management, "ssh_port");
  }

  return Object.prototype.hasOwnProperty.call(source ?? {}, "ssh_port");
}

function resolveManagedSshPort(source = {}, existingNode = {}, management = {}, facts = {}) {
  const explicitManagementPort = hasExplicitManagementSshPort(source)
    ? normalizePort(readRecordSource(source, "management")?.ssh_port)
    : null;
  if (explicitManagementPort) {
    return explicitManagementPort;
  }

  const inheritedPort =
    normalizePort(sourceValue(source, "ssh_port", null)) ??
    normalizePort(source?.facts?.ssh_port) ??
    normalizePort(facts?.ssh_port);
  const existingManagementPort = normalizePort(existingNode?.management?.ssh_port);
  const existingFactsPort = normalizePort(existingNode?.facts?.ssh_port);
  const existingManagementIsInherited =
    existingManagementPort === null ||
    existingFactsPort === null ||
    existingManagementPort === existingFactsPort;

  if (inheritedPort && existingManagementIsInherited) {
    return inheritedPort;
  }

  return existingManagementPort ?? inheritedPort ?? existingFactsPort ?? 19822;
}

function buildCommercialRecord(source = {}, existingCommercial = {}) {
  const billingCycle = sourceValue(
    source,
    "billing_cycle",
    normalizeBillingCycle(existingCommercial.billing_cycle) ?? existingCommercial.billing_cycle ?? null,
  );
  const billingAmount = sourceValue(
    source,
    "billing_amount",
    normalizeNullableNumber(existingCommercial.billing_amount),
  );
  const billingCurrency = sourceValue(
    source,
    "billing_currency",
    normalizeCostCurrency(existingCommercial.billing_currency),
  );
  const amortizationMonths = sourceValue(
    source,
    "amortization_months",
    normalizeNullableInteger(existingCommercial.amortization_months),
  );
  const overagePricePerGb = sourceValue(
    source,
    "overage_price_per_gb",
    normalizeNullableNumber(existingCommercial.overage_price_per_gb),
  );
  const extraFixedMonthlyCost =
    sourceValue(
      source,
      "extra_fixed_monthly_cost",
      normalizeNullableNumber(existingCommercial.extra_fixed_monthly_cost, 0) ?? 0,
    ) ?? 0;

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
    billing_cycle: normalizeBillingCycle(billingCycle) ?? billingCycle ?? null,
    billing_amount: normalizeNullableNumber(billingAmount),
    billing_currency: normalizeCostCurrency(billingCurrency),
    amortization_months: normalizeNullableInteger(amortizationMonths),
    overage_price_per_gb: normalizeNullableNumber(overagePricePerGb),
    extra_fixed_monthly_cost: normalizeNullableNumber(extraFixedMonthlyCost, 0) ?? 0,
    billing_started_at: sourceValue(
      source,
      "billing_started_at",
      existingCommercial.billing_started_at ?? null,
    ),
    cost_note: sourceValue(
      source,
      "cost_note",
      existingCommercial.cost_note ?? null,
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
        ? normalizeLocationValue(
            sourceValue(input, "relay_region", existingNetworking.relay_region ?? null),
            "region",
          )
        : null,
    entry_region: normalizeLocationValue(
      sourceValue(input, "entry_region", existingNetworking.entry_region ?? null),
      "entry",
    ),
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
    relay_strategy:
      accessMode === "relay"
        ? normalizeManagementRelayStrategy(
            sourceValue(input, "relay_strategy", currentManagement.relay_strategy ?? "auto"),
          )
        : null,
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
        ? normalizeLocationValue(
            sourceValue(
              input,
              "relay_region",
              currentManagement.relay_region ?? null,
            ),
            "region",
          )
        : null,
    proxy_host:
      accessMode === "relay"
        ? sourceValue(input, "proxy_host", currentManagement.proxy_host ?? null)
        : null,
    proxy_port:
      accessMode === "relay"
        ? sourceValue(input, "proxy_port", currentManagement.proxy_port ?? null)
        : null,
    proxy_user:
      accessMode === "relay"
        ? sourceValue(input, "proxy_user", currentManagement.proxy_user ?? null)
        : null,
    proxy_label:
      accessMode === "relay"
        ? sourceValue(input, "proxy_label", currentManagement.proxy_label ?? null)
        : null,
    ssh_host: sourceValue(input, "ssh_host", currentManagement.ssh_host ?? null),
    ssh_port: sourceValue(input, "ssh_port", currentManagement.ssh_port ?? null),
    allow_ipv6: normalizeBooleanValue(
      sourceValue(input, "allow_ipv6", currentManagement.allow_ipv6 ?? false),
      currentManagement.allow_ipv6 ?? false,
    ),
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
    relay_strategy:
      accessMode === "relay"
        ? normalizeManagementRelayStrategy(
            sourceValue(currentManagement, "relay_strategy", "auto"),
          )
        : null,
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
        ? normalizeLocationValue(
            sourceValue(
              currentManagement,
              "relay_region",
              sourceValue(
                node,
                "ssh_relay_region",
                sourceValue(legacyNetworking, "relay_region", null),
              ),
            ),
            "region",
          )
        : null,
    proxy_host:
      accessMode === "relay"
        ? sourceValue(currentManagement, "proxy_host", sourceValue(node, "ssh_proxy_host", null))
        : null,
    proxy_port:
      accessMode === "relay"
        ? sourceValue(currentManagement, "proxy_port", sourceValue(node, "ssh_proxy_port", null))
        : null,
    proxy_user:
      accessMode === "relay"
        ? sourceValue(currentManagement, "proxy_user", sourceValue(node, "ssh_proxy_user", null))
        : null,
    proxy_label:
      accessMode === "relay"
        ? sourceValue(currentManagement, "proxy_label", sourceValue(node, "ssh_proxy_label", null))
        : null,
    ssh_host: sourceValue(currentManagement, "ssh_host", sourceValue(node, "ssh_host", null)),
    ssh_port: sourceValue(
      currentManagement,
      "ssh_port",
      sourceValue(node, "ssh_port", sourceValue(node?.facts ?? {}, "ssh_port", 19822)),
    ),
    allow_ipv6: normalizeBooleanValue(
      sourceValue(currentManagement, "allow_ipv6", false),
      false,
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
  const nextLabels = normalizeLabelsRecord(node?.labels ?? {});
  const currentLabels = isPlainObject(node?.labels) ? node.labels : {};
  const nextNetworking = normalizeNetworkingRecord(node?.networking ?? {});
  const currentNetworking = isPlainObject(node?.networking) ? node.networking : {};
  const changed =
    JSON.stringify(currentManagement ?? null) !== JSON.stringify(nextManagement) ||
    JSON.stringify(currentLabels) !== JSON.stringify(nextLabels) ||
    JSON.stringify(currentNetworking) !== JSON.stringify(nextNetworking);

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
      labels: nextLabels,
      networking: nextNetworking,
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
    const labels = normalizeLabelsRecord({
      ...(existingNode?.labels ?? {}),
      ...(payload.labels && typeof payload.labels === "object" ? payload.labels : {}),
    });
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
      provider_id: normalizeNullableStringValue(
        sourceValue(payload, "provider_id", existingNode?.provider_id ?? null),
        null,
      ),
      source: existingNode?.source ?? "bootstrap",
      bootstrap_token_id: existingNode?.bootstrap_token_id ?? null,
      facts,
      commercial: buildCommercialRecord(payload.commercial, existingNode?.commercial),
      networking,
      management: {
        ...management,
        ssh_port: resolveManagedSshPort(payload, existingNode, management, facts),
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
        region: normalizeLocationValue(
          sourceValue(payload, "region", existingNode.labels?.region ?? null),
          "region",
        ),
        role: sourceValue(payload, "role", existingNode.labels?.role ?? null),
      },
      provider_id: normalizeNullableStringValue(
        sourceValue(payload, "provider_id", existingNode.provider_id ?? null),
        null,
      ),
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
        ssh_port: resolveManagedSshPort(payload, existingNode, nextManagement, {
          ...currentFacts,
          ssh_port: sourceValue(payload, "ssh_port", currentFacts.ssh_port ?? 19822),
        }),
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
        region: normalizeLocationValue(payload.region, "region"),
        role: payload.role ?? null,
      },
      provider_id: normalizeNullableStringValue(payload.provider_id),
      source: "manual",
      facts,
      commercial: buildCommercialRecord(payload),
      networking,
      management: {
        ...management,
        ssh_port: resolveManagedSshPort(payload, null, management, facts),
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
