import { SUPPORTED_BILLING_CYCLES } from "../domain/costs/normalize.js";

function validateNullableIpField(errors, value, fieldName, options = {}) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (typeof value !== "string") {
    errors.push(`${fieldName} must be a string`);
    return;
  }

  const normalized = value.trim();
  if (!normalized) {
    return;
  }

  const ipv4Pattern = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const ipv6Pattern = /^[0-9a-fA-F:]+$/;

  if (options.version === 4) {
    if (!ipv4Pattern.test(normalized)) {
      errors.push(`${fieldName} must be a valid IPv4 address`);
    }
    return;
  }

  if (options.version === 6) {
    if (!normalized.includes(":") || !ipv6Pattern.test(normalized)) {
      errors.push(`${fieldName} must be a valid IPv6 address`);
    }
  }
}

function validateNullablePortField(errors, value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    errors.push(`${fieldName} must be an integer between 1 and 65535`);
  }
}

function validateNullableStringField(errors, value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (typeof value !== "string") {
    errors.push(`${fieldName} must be a string`);
  }
}

function validateNullableNonNegativeNumberField(errors, value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${fieldName} must be a non-negative number`);
  }
}

function validateNullablePositiveIntegerField(errors, value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${fieldName} must be a positive integer`);
  }
}

function validateNullableCurrencyField(errors, value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (typeof value !== "string") {
    errors.push(`${fieldName} must be a string`);
    return;
  }

  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,9}$/.test(normalized)) {
    errors.push(`${fieldName} must be a valid currency code`);
  }
}

function validateNullableBillingCycleField(errors, value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (typeof value !== "string") {
    errors.push(`${fieldName} must be a string`);
    return;
  }

  const normalized = value.trim();
  if (!SUPPORTED_BILLING_CYCLES.includes(normalized)) {
    errors.push(`${fieldName} must be one of ${SUPPORTED_BILLING_CYCLES.join(", ")}`);
  }
}

function validateNullableDateField(errors, value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (typeof value !== "string") {
    errors.push(`${fieldName} must be a string`);
    return;
  }

  if (Number.isNaN(Date.parse(value.trim()))) {
    errors.push(`${fieldName} must be a valid timestamp`);
  }
}

function validateNodeCostFields(errors, payload) {
  validateNullableStringField(errors, payload.provider_id, "provider_id");
  validateNullableBillingCycleField(errors, payload.billing_cycle, "billing_cycle");
  validateNullableNonNegativeNumberField(errors, payload.billing_amount, "billing_amount");
  validateNullableCurrencyField(errors, payload.billing_currency, "billing_currency");
  validateNullablePositiveIntegerField(errors, payload.amortization_months, "amortization_months");
  validateNullableNonNegativeNumberField(
    errors,
    payload.overage_price_per_gb,
    "overage_price_per_gb",
  );
  validateNullableNonNegativeNumberField(
    errors,
    payload.extra_fixed_monthly_cost,
    "extra_fixed_monthly_cost",
  );
  validateNullableDateField(errors, payload.billing_started_at, "billing_started_at");
  validateNullableStringField(errors, payload.cost_note, "cost_note");
}

function validateAccessModeField(errors, value, fieldName) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (!["direct", "relay"].includes(String(value).trim().toLowerCase())) {
    errors.push(`${fieldName} must be direct or relay`);
  }
}

function validateRouteSection(errors, payload, fieldName, options = {}) {
  if (payload === undefined || payload === null) {
    return;
  }

  if (!isPlainObject(payload)) {
    errors.push(`${fieldName} must be an object`);
    return;
  }

  validateAccessModeField(errors, payload.access_mode, `${fieldName}.access_mode`);

  if (options.allowEntryPort) {
    validateNullablePortField(errors, payload.entry_port, `${fieldName}.entry_port`);
  }

  if (options.allowSshPort) {
    validateNullablePortField(errors, payload.ssh_port, `${fieldName}.ssh_port`);
  }

  if (
    options.allowSshUser &&
    payload.ssh_user !== undefined &&
    payload.ssh_user !== null &&
    typeof payload.ssh_user !== "string"
  ) {
    errors.push(`${fieldName}.ssh_user must be a string`);
  }

  if (
    options.allowSshHost &&
    payload.ssh_host !== undefined &&
    payload.ssh_host !== null &&
    typeof payload.ssh_host !== "string"
  ) {
    errors.push(`${fieldName}.ssh_host must be a string`);
  }

  if (
    options.allowProxyHost &&
    payload.proxy_host !== undefined &&
    payload.proxy_host !== null &&
    typeof payload.proxy_host !== "string"
  ) {
    errors.push(`${fieldName}.proxy_host must be a string`);
  }

  if (
    options.allowProxyUser &&
    payload.proxy_user !== undefined &&
    payload.proxy_user !== null &&
    typeof payload.proxy_user !== "string"
  ) {
    errors.push(`${fieldName}.proxy_user must be a string`);
  }

  if (
    options.allowProxyLabel &&
    payload.proxy_label !== undefined &&
    payload.proxy_label !== null &&
    typeof payload.proxy_label !== "string"
  ) {
    errors.push(`${fieldName}.proxy_label must be a string`);
  }

  if (options.allowProxyPort) {
    validateNullablePortField(errors, payload.proxy_port, `${fieldName}.proxy_port`);
  }

  if (
    options.allowIpv6Flag &&
    payload.allow_ipv6 !== undefined &&
    payload.allow_ipv6 !== null &&
    typeof payload.allow_ipv6 !== "boolean"
  ) {
    errors.push(`${fieldName}.allow_ipv6 must be a boolean`);
  }
}

export function validateRegistration(payload) {
  const errors = [];

  if (!payload.bootstrap_token) {
    errors.push("bootstrap_token is required");
  }

  if (!payload.fingerprint) {
    errors.push("fingerprint is required");
  }

  if (!payload.facts || typeof payload.facts !== "object") {
    errors.push("facts object is required");
    return errors;
  }

  if (!payload.facts.hostname) {
    errors.push("facts.hostname is required");
  }

  if (!payload.facts.public_ipv4 && !payload.facts.public_ipv6 && !payload.facts.private_ipv4) {
    errors.push("facts.public_ipv4 or facts.public_ipv6 or facts.private_ipv4 is required");
  }

  for (const field of ["cpu_cores", "memory_mb", "disk_gb", "ssh_port"]) {
    const value = payload.facts[field];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      errors.push(`facts.${field} must be a non-negative number`);
    }
  }

  if (
    payload.facts.ssh_port !== undefined &&
    payload.facts.ssh_port !== null &&
    (!Number.isInteger(payload.facts.ssh_port) ||
      payload.facts.ssh_port < 1 ||
      payload.facts.ssh_port > 65535)
  ) {
    errors.push("facts.ssh_port must be an integer between 1 and 65535");
  }

  return errors;
}

export function validateManualNode(payload) {
  const errors = [];

  if (!payload.hostname) {
    errors.push("hostname is required");
  }

  for (const field of [
    "memory_mb",
    "cpu_cores",
    "disk_gb",
    "ssh_port",
    "bandwidth_mbps",
    "traffic_quota_gb",
    "traffic_used_gb",
  ]) {
    const value = payload[field];
    if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0)) {
      errors.push(`${field} must be a non-negative number`);
    }
  }

  validateNullablePortField(errors, payload.ssh_port, "ssh_port");
  validateNullablePortField(errors, payload.entry_port, "entry_port");
  validateNullableStringField(errors, payload.provider, "provider");
  validateNullableStringField(errors, payload.region, "region");
  validateNullableStringField(errors, payload.role, "role");
  validateNullableStringField(errors, payload.note, "note");
  validateAccessModeField(errors, payload.access_mode, "access_mode");
  validateNodeCostFields(errors, payload);
  validateRouteSection(errors, payload.networking, "networking", {
    allowEntryPort: true,
  });
  validateRouteSection(errors, payload.management, "management", {
    allowSshPort: true,
    allowSshUser: true,
    allowSshHost: true,
    allowProxyHost: true,
    allowProxyPort: true,
    allowProxyUser: true,
    allowProxyLabel: true,
    allowIpv6Flag: true,
  });

  return errors;
}

export function validateAssetUpdate(payload) {
  const errors = [];

  validateNullableIpField(errors, payload.public_ipv4, "public_ipv4", { version: 4 });
  validateNullableIpField(errors, payload.public_ipv6, "public_ipv6", { version: 6 });
  validateNullableIpField(errors, payload.private_ipv4, "private_ipv4", { version: 4 });

  for (const field of ["ssh_port", "entry_port", "bandwidth_mbps", "traffic_quota_gb", "traffic_used_gb"]) {
    const value = payload[field];
    if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0)) {
      errors.push(`${field} must be a non-negative number`);
    }
  }

  validateNullablePortField(errors, payload.ssh_port, "ssh_port");
  validateNullablePortField(errors, payload.entry_port, "entry_port");
  validateNullableStringField(errors, payload.provider, "provider");
  validateNullableStringField(errors, payload.region, "region");
  validateNullableStringField(errors, payload.role, "role");
  validateNullableStringField(errors, payload.note, "note");
  validateAccessModeField(errors, payload.access_mode, "access_mode");
  validateNodeCostFields(errors, payload);
  validateRouteSection(errors, payload.networking, "networking", {
    allowEntryPort: true,
  });
  validateRouteSection(errors, payload.management, "management", {
    allowSshPort: true,
    allowSshUser: true,
    allowSshHost: true,
    allowProxyHost: true,
    allowProxyPort: true,
    allowProxyUser: true,
    allowProxyLabel: true,
    allowIpv6Flag: true,
  });

  return errors;
}

export function validateOperationRequest(payload) {
  const errors = [];
  const mode = payload.mode ?? "command";

  if (!["command", "script"].includes(mode)) {
    errors.push("mode must be command or script");
  }

  if (!Array.isArray(payload.node_ids) || payload.node_ids.length === 0) {
    errors.push("node_ids must contain at least one node");
  }

  if (mode === "command" && !payload.command) {
    errors.push("command is required when mode=command");
  }

  if (mode === "script" && !payload.script_body) {
    errors.push("script_body is required when mode=script");
  }

  return errors;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidTimestamp(value) {
  if (!value) {
    return false;
  }

  return !Number.isNaN(Date.parse(String(value)));
}

function validateStringArray(errors, value, fieldName) {
  if (value === undefined || value === null) {
    return;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${fieldName} must be an array of non-empty strings`);
  }
}

export function validateAccessUserCreate(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push("payload is required");
    return errors;
  }

  if (typeof payload.name !== "string" || !payload.name.trim()) {
    errors.push("name is required");
  }

  if (
    payload.protocol !== undefined &&
    payload.protocol !== null &&
    !["vless", "vmess"].includes(String(payload.protocol).trim().toLowerCase())
  ) {
    errors.push("protocol must be vless or vmess");
  }

  if (
    payload.status !== undefined &&
    payload.status !== null &&
    !["active", "disabled", "expired"].includes(String(payload.status).trim().toLowerCase())
  ) {
    errors.push("status must be active, disabled or expired");
  }

  if (payload.expires_at && !isValidTimestamp(payload.expires_at)) {
    errors.push("expires_at must be a valid timestamp");
  }

  if (
    payload.profile_id !== undefined &&
    payload.profile_id !== null &&
    (typeof payload.profile_id !== "string" || !payload.profile_id.trim())
  ) {
    errors.push("profile_id must be a non-empty string");
  }

  if (
    payload.note !== undefined &&
    payload.note !== null &&
    typeof payload.note !== "string"
  ) {
    errors.push("note must be a string");
  }

  if (
    payload.credential !== undefined &&
    payload.credential !== null &&
    !isPlainObject(payload.credential)
  ) {
    errors.push("credential must be an object");
  }

  if (
    isPlainObject(payload.credential) &&
    payload.credential.uuid !== undefined &&
    (typeof payload.credential.uuid !== "string" || !payload.credential.uuid.trim())
  ) {
    errors.push("credential.uuid must be a non-empty string");
  }

  if (
    isPlainObject(payload.credential) &&
    payload.credential.alter_id !== undefined &&
    payload.credential.alter_id !== null &&
    (!Number.isInteger(payload.credential.alter_id) || payload.credential.alter_id < 0)
  ) {
    errors.push("credential.alter_id must be a non-negative integer");
  }

  validateStringArray(errors, payload.node_group_ids, "node_group_ids");

  return errors;
}

export function validateAccessUserUpdate(payload) {
  const errors = validateAccessUserCreate(payload);

  if (payload?.created_at !== undefined) {
    errors.push("created_at cannot be modified");
  }

  return errors.filter((error) => error !== "name is required");
}

export function validateProxyProfileCreate(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push("payload is required");
    return errors;
  }

  if (typeof payload.name !== "string" || !payload.name.trim()) {
    errors.push("name is required");
  }

  if (
    payload.protocol !== undefined &&
    payload.protocol !== null &&
    !["vless", "vmess"].includes(String(payload.protocol).trim().toLowerCase())
  ) {
    errors.push("protocol must be vless or vmess");
  }

  const protocol =
    payload.protocol !== undefined && payload.protocol !== null
      ? String(payload.protocol).trim().toLowerCase()
      : null;
  const security =
    payload.security !== undefined && payload.security !== null
      ? String(payload.security).trim().toLowerCase()
      : null;

  if (protocol === "vmess" && security === "reality") {
    errors.push("vmess does not support reality");
  }

  if (
    payload.transport !== undefined &&
    payload.transport !== null &&
    !["tcp", "ws", "grpc", "http", "httpupgrade"].includes(
      String(payload.transport).trim().toLowerCase(),
    )
  ) {
    errors.push("transport must be tcp, ws, grpc, http or httpupgrade");
  }

  if (
    payload.security !== undefined &&
    payload.security !== null &&
    !["reality", "tls", "none"].includes(String(payload.security).trim().toLowerCase())
  ) {
    errors.push("security must be reality, tls or none");
  }

  if (
    payload.status !== undefined &&
    payload.status !== null &&
    !["draft", "active", "disabled"].includes(String(payload.status).trim().toLowerCase())
  ) {
    errors.push("status must be draft, active or disabled");
  }

  if (
    payload.listen_port !== undefined &&
    payload.listen_port !== null &&
    (!Number.isInteger(payload.listen_port) ||
      payload.listen_port < 1 ||
      payload.listen_port > 65535)
  ) {
    errors.push("listen_port must be an integer between 1 and 65535");
  }

  for (const field of ["tls_enabled", "reality_enabled", "mux_enabled"]) {
    if (
      payload[field] !== undefined &&
      payload[field] !== null &&
      typeof payload[field] !== "boolean"
    ) {
      errors.push(`${field} must be a boolean`);
    }
  }

  if (payload.template !== undefined && payload.template !== null && !isPlainObject(payload.template)) {
    errors.push("template must be an object");
  }

  for (const field of ["transport", "security", "server_name", "flow", "tag", "note"]) {
    if (
      payload[field] !== undefined &&
      payload[field] !== null &&
      typeof payload[field] !== "string"
    ) {
      errors.push(`${field} must be a string`);
    }
  }

  return errors;
}

export function validateProxyProfileUpdate(payload) {
  const errors = validateProxyProfileCreate(payload);

  if (payload?.created_at !== undefined) {
    errors.push("created_at cannot be modified");
  }

  return errors.filter((error) => error !== "name is required");
}

export function validateNodeGroupCreate(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push("payload is required");
    return errors;
  }

  if (typeof payload.name !== "string" || !payload.name.trim()) {
    errors.push("name is required");
  }

  if (
    payload.type !== undefined &&
    payload.type !== null &&
    !["static"].includes(String(payload.type).trim().toLowerCase())
  ) {
    errors.push("type must be static");
  }

  if (
    payload.status !== undefined &&
    payload.status !== null &&
    !["active", "disabled"].includes(String(payload.status).trim().toLowerCase())
  ) {
    errors.push("status must be active or disabled");
  }

  validateStringArray(errors, payload.node_ids, "node_ids");

  if (payload.filters !== undefined && payload.filters !== null && !isPlainObject(payload.filters)) {
    errors.push("filters must be an object");
  }

  if (
    payload.note !== undefined &&
    payload.note !== null &&
    typeof payload.note !== "string"
  ) {
    errors.push("note must be a string");
  }

  return errors;
}

export function validateNodeGroupUpdate(payload) {
  const errors = validateNodeGroupCreate(payload);

  if (payload?.created_at !== undefined) {
    errors.push("created_at cannot be modified");
  }

  return errors.filter((error) => error !== "name is required");
}

export function validateProviderCreate(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push("payload is required");
    return errors;
  }

  if (typeof payload.name !== "string" || !payload.name.trim()) {
    errors.push("name is required");
  }

  if (
    payload.status !== undefined &&
    payload.status !== null &&
    !["active", "disabled"].includes(String(payload.status).trim().toLowerCase())
  ) {
    errors.push("status must be active or disabled");
  }

  validateStringArray(errors, payload.regions, "regions");

  for (const field of [
    "account_name",
    "website",
    "api_endpoint",
    "note",
    "default_currency",
    "billing_contact",
    "cost_note",
  ]) {
    if (
      payload[field] !== undefined &&
      payload[field] !== null &&
      typeof payload[field] !== "string"
    ) {
      errors.push(`${field} must be a string`);
    }
  }

  if (
    payload.auto_provision_enabled !== undefined &&
    payload.auto_provision_enabled !== null &&
    typeof payload.auto_provision_enabled !== "boolean"
  ) {
    errors.push("auto_provision_enabled must be a boolean");
  }

  validateNullableCurrencyField(errors, payload.default_currency, "default_currency");
  validateNullableNonNegativeNumberField(errors, payload.monthly_budget, "monthly_budget");
  validateNullableNonNegativeNumberField(
    errors,
    payload.budget_alert_threshold,
    "budget_alert_threshold",
  );
  validateNullableNonNegativeNumberField(
    errors,
    payload.default_overage_price_per_gb,
    "default_overage_price_per_gb",
  );

  return errors;
}

export function validateProviderUpdate(payload) {
  const errors = validateProviderCreate(payload);

  if (payload?.created_at !== undefined) {
    errors.push("created_at cannot be modified");
  }

  return errors.filter((error) => error !== "name is required");
}

function isValidSystemUsername(value) {
  return typeof value === "string" && /^[a-z_][a-z0-9_-]*[$]?$/.test(value.trim());
}

export function validateSystemUserCreate(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push("payload is required");
    return errors;
  }

  if (typeof payload.name !== "string" || !payload.name.trim()) {
    errors.push("name is required");
  }

  if (!isValidSystemUsername(payload.username)) {
    errors.push("username must match linux account naming rules");
  } else if (String(payload.username).trim() === "root") {
    errors.push("username root is not allowed");
  }

  if (
    payload.uid !== undefined &&
    payload.uid !== null &&
    (!Number.isInteger(payload.uid) || payload.uid < 1)
  ) {
    errors.push("uid must be a positive integer");
  }

  validateStringArray(errors, payload.groups, "groups");
  validateStringArray(errors, payload.node_group_ids, "node_group_ids");
  validateStringArray(errors, payload.ssh_authorized_keys, "ssh_authorized_keys");

  if (
    payload.status !== undefined &&
    payload.status !== null &&
    !["active", "disabled"].includes(String(payload.status).trim().toLowerCase())
  ) {
    errors.push("status must be active or disabled");
  }

  for (const field of ["shell", "home_dir", "note"]) {
    if (
      payload[field] !== undefined &&
      payload[field] !== null &&
      typeof payload[field] !== "string"
    ) {
      errors.push(`${field} must be a string`);
    }
  }

  if (
    payload.sudo_enabled !== undefined &&
    payload.sudo_enabled !== null &&
    typeof payload.sudo_enabled !== "boolean"
  ) {
    errors.push("sudo_enabled must be a boolean");
  }

  return errors;
}

export function validateSystemUserUpdate(payload) {
  const errors = validateSystemUserCreate(payload);

  if (payload?.created_at !== undefined) {
    errors.push("created_at cannot be modified");
  }

  return errors
    .filter((error) => error !== "name is required")
    .filter((error) =>
      payload?.username === undefined ? error !== "username must match linux account naming rules" : true,
    )
    .filter((error) =>
      payload?.username === undefined ? error !== "username root is not allowed" : true,
    );
}

export function validateSystemUserApply(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push("payload is required");
    return errors;
  }

  if (
    !Array.isArray(payload.system_user_ids) ||
    payload.system_user_ids.length === 0 ||
    payload.system_user_ids.some((item) => typeof item !== "string" || !item.trim())
  ) {
    errors.push("system_user_ids must contain at least one system user");
  }

  validateStringArray(errors, payload.node_group_ids, "node_group_ids");
  validateStringArray(errors, payload.node_ids, "node_ids");

  if (
    payload.title !== undefined &&
    payload.title !== null &&
    (typeof payload.title !== "string" || !payload.title.trim())
  ) {
    errors.push("title must be a non-empty string");
  }

  if (
    payload.operator !== undefined &&
    payload.operator !== null &&
    (typeof payload.operator !== "string" || !payload.operator.trim())
  ) {
    errors.push("operator must be a non-empty string");
  }

  if (
    payload.note !== undefined &&
    payload.note !== null &&
    typeof payload.note !== "string"
  ) {
    errors.push("note must be a string");
  }

  if (
    payload.dry_run !== undefined &&
    payload.dry_run !== null &&
    typeof payload.dry_run !== "boolean"
  ) {
    errors.push("dry_run must be a boolean");
  }

  return errors;
}

export function validateSystemTemplateCreate(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push("payload is required");
    return errors;
  }

  if (typeof payload.name !== "string" || !payload.name.trim()) {
    errors.push("name is required");
  }

  if (
    payload.category !== undefined &&
    payload.category !== null &&
    !["baseline", "bootstrap", "hardening", "custom"].includes(
      String(payload.category).trim().toLowerCase(),
    )
  ) {
    errors.push("category must be baseline, bootstrap, hardening or custom");
  }

  if (
    payload.status !== undefined &&
    payload.status !== null &&
    !["active", "draft", "disabled"].includes(String(payload.status).trim().toLowerCase())
  ) {
    errors.push("status must be active, draft or disabled");
  }

  if (
    payload.script_name !== undefined &&
    payload.script_name !== null &&
    (typeof payload.script_name !== "string" || !payload.script_name.trim())
  ) {
    errors.push("script_name must be a non-empty string");
  }

  if (typeof payload.script_body !== "string" || !payload.script_body.trim()) {
    errors.push("script_body is required");
  }

  validateStringArray(errors, payload.node_group_ids, "node_group_ids");
  validateStringArray(errors, payload.tags, "tags");

  if (
    payload.note !== undefined &&
    payload.note !== null &&
    typeof payload.note !== "string"
  ) {
    errors.push("note must be a string");
  }

  return errors;
}

export function validateSystemTemplateUpdate(payload) {
  const errors = validateSystemTemplateCreate(payload);

  if (payload?.created_at !== undefined) {
    errors.push("created_at cannot be modified");
  }

  return errors
    .filter((error) => error !== "name is required")
    .filter((error) => (payload?.script_body === undefined ? error !== "script_body is required" : true));
}

export function validateSystemTemplateApply(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push("payload is required");
    return errors;
  }

  if (typeof payload.template_id !== "string" || !payload.template_id.trim()) {
    errors.push("template_id is required");
  }

  validateStringArray(errors, payload.node_group_ids, "node_group_ids");
  validateStringArray(errors, payload.node_ids, "node_ids");

  if (
    payload.title !== undefined &&
    payload.title !== null &&
    (typeof payload.title !== "string" || !payload.title.trim())
  ) {
    errors.push("title must be a non-empty string");
  }

  if (
    payload.operator !== undefined &&
    payload.operator !== null &&
    (typeof payload.operator !== "string" || !payload.operator.trim())
  ) {
    errors.push("operator must be a non-empty string");
  }

  if (
    payload.note !== undefined &&
    payload.note !== null &&
    typeof payload.note !== "string"
  ) {
    errors.push("note must be a string");
  }

  if (
    payload.dry_run !== undefined &&
    payload.dry_run !== null &&
    typeof payload.dry_run !== "boolean"
  ) {
    errors.push("dry_run must be a boolean");
  }

  return errors;
}

export function validateConfigReleaseCreate(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push("payload is required");
    return errors;
  }

  if (typeof payload.title !== "string" || !payload.title.trim()) {
    errors.push("title is required");
  }

  if (!Array.isArray(payload.access_user_ids) || payload.access_user_ids.length === 0) {
    errors.push("access_user_ids must contain at least one user");
  } else if (
    payload.access_user_ids.some((item) => typeof item !== "string" || !item.trim())
  ) {
    errors.push("access_user_ids must be an array of non-empty strings");
  }

  if (typeof payload.profile_id !== "string" || !payload.profile_id.trim()) {
    errors.push("profile_id is required");
  }

  validateStringArray(errors, payload.node_group_ids, "node_group_ids");
  validateStringArray(errors, payload.node_ids, "node_ids");

  if (
    payload.operator !== undefined &&
    payload.operator !== null &&
    (typeof payload.operator !== "string" || !payload.operator.trim())
  ) {
    errors.push("operator must be a non-empty string");
  }

  if (
    payload.note !== undefined &&
    payload.note !== null &&
    typeof payload.note !== "string"
  ) {
    errors.push("note must be a string");
  }

  if (
    (!Array.isArray(payload.node_group_ids) || payload.node_group_ids.length === 0) &&
    (!Array.isArray(payload.node_ids) || payload.node_ids.length === 0)
  ) {
    errors.push("node_group_ids or node_ids must contain at least one target");
  }

  return errors;
}

export function validateShellSessionCreate(payload) {
  const errors = [];

  if (!payload.node_id) {
    errors.push("node_id is required");
  }

  return errors;
}

export function validateShellSessionInput(payload) {
  const errors = [];

  if (typeof payload.data !== "string" || payload.data.length === 0) {
    errors.push("data is required");
  }

  if (typeof payload.data === "string" && payload.data.length > 4000) {
    errors.push("data must be shorter than 4000 characters");
  }

  return errors;
}

export function validatePlatformSingBoxDistributionUpdate(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push("payload is required");
    return errors;
  }

  if (payload.enabled !== undefined && typeof payload.enabled !== "boolean") {
    errors.push("enabled must be a boolean");
  }

  if (
    payload.version !== undefined &&
    (typeof payload.version !== "string" || !payload.version.trim())
  ) {
    errors.push("version must be a non-empty string");
  }

  if (
    payload.install_path !== undefined &&
    (typeof payload.install_path !== "string" || !payload.install_path.trim())
  ) {
    errors.push("install_path must be a non-empty string");
  }

  if (payload.variants !== undefined && !isPlainObject(payload.variants)) {
    errors.push("variants must be an object");
  }

  if (isPlainObject(payload.variants)) {
    for (const [target, variant] of Object.entries(payload.variants)) {
      if (!isPlainObject(variant)) {
        errors.push(`variants.${target} must be an object`);
        continue;
      }

      if (variant.enabled !== undefined && typeof variant.enabled !== "boolean") {
        errors.push(`variants.${target}.enabled must be a boolean`);
      }

      if (
        variant.upstream_url !== undefined &&
        (typeof variant.upstream_url !== "string" || !variant.upstream_url.trim())
      ) {
        errors.push(`variants.${target}.upstream_url must be a non-empty string`);
      }

      if (
        variant.upstream_sha256 !== undefined &&
        variant.upstream_sha256 !== null &&
        (typeof variant.upstream_sha256 !== "string" || !variant.upstream_sha256.trim())
      ) {
        errors.push(`variants.${target}.upstream_sha256 must be a non-empty string or null`);
      }
    }
  }

  return errors;
}

export function validatePlatformSingBoxMirrorRequest(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    errors.push("payload is required");
    return errors;
  }

  if (typeof payload.target !== "string" || !payload.target.trim()) {
    errors.push("target is required");
  }

  return errors;
}

export function createBootstrapTokenValidators({
  normalizeBootstrapTimestamp,
  bootstrapTokenIndex,
}) {
  function validateBootstrapTokenCreate(payload) {
    const errors = [];

    if (!payload || typeof payload !== "object") {
      errors.push("payload is required");
      return errors;
    }

    if (payload.token && typeof payload.token === "string" && payload.token.trim().length === 0) {
      errors.push("token cannot be an empty string");
    }

    if (payload.token && bootstrapTokenIndex.has(payload.token.trim())) {
      errors.push("token already exists");
    }

    if (payload.status && !["active", "disabled"].includes(payload.status)) {
      errors.push("status must be active or disabled");
    }

    if (payload.expires_at && !normalizeBootstrapTimestamp(payload.expires_at)) {
      errors.push("expires_at must be a valid timestamp");
    }

    if (payload.max_uses !== undefined && payload.max_uses !== null) {
      if (
        !Number.isFinite(payload.max_uses) ||
        payload.max_uses < 0 ||
        !Number.isInteger(payload.max_uses)
      ) {
        errors.push("max_uses must be a non-negative integer");
      }
    }

    return errors;
  }

  function validateBootstrapTokenUpdate(payload) {
    const errors = [];

    if (!payload || typeof payload !== "object") {
      errors.push("payload is required");
      return errors;
    }

    if (payload.token) {
      errors.push("token cannot be modified");
    }

    if (payload.status && !["active", "disabled"].includes(payload.status)) {
      errors.push("status must be active or disabled");
    }

    if (payload.expires_at && !normalizeBootstrapTimestamp(payload.expires_at)) {
      errors.push("expires_at must be a valid timestamp");
    }

    if (payload.max_uses !== undefined && payload.max_uses !== null) {
      if (
        !Number.isFinite(payload.max_uses) ||
        payload.max_uses < 0 ||
        !Number.isInteger(payload.max_uses)
      ) {
        errors.push("max_uses must be a non-negative integer");
      }
    }

    return errors;
  }

  return {
    validateBootstrapTokenCreate,
    validateBootstrapTokenUpdate,
  };
}
