import { createHash } from "node:crypto";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringArray(value) {
  if (typeof value === "string") {
    return normalizeString(value) ? [normalizeString(value)] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function pickEngineTemplate(template) {
  if (isPlainObject(template?.sing_box)) {
    return template.sing_box;
  }

  return isPlainObject(template) ? template : {};
}

function pickRealityTemplate(profile) {
  const template = pickEngineTemplate(profile.template);
  return isPlainObject(template.reality) ? template.reality : {};
}

function pickTlsTemplate(profile) {
  const template = pickEngineTemplate(profile.template);
  return isPlainObject(template.tls) ? template.tls : {};
}

function pickTransportTemplate(profile) {
  const template = pickEngineTemplate(profile.template);
  return isPlainObject(template.transport) ? template.transport : null;
}

function pickMultiplexTemplate(profile) {
  const template = pickEngineTemplate(profile.template);
  return isPlainObject(template.multiplex) ? template.multiplex : null;
}

function pickLogTemplate(profile) {
  const template = pickEngineTemplate(profile.template);
  return isPlainObject(template.log) ? template.log : null;
}

function pickConfigPath(profile) {
  const template = pickEngineTemplate(profile.template);
  return normalizeString(template.config_path) ?? "/etc/sing-box/config.json";
}

function pickListenAddress(profile) {
  const template = pickEngineTemplate(profile.template);
  return normalizeString(template.listen) ?? "::";
}

function pickListenFields(profile) {
  const template = pickEngineTemplate(profile.template);
  return isPlainObject(template.listen_fields) ? template.listen_fields : null;
}

function buildServiceCommandArgsLine(configPath) {
  return `command_args=${shellQuote(`run -c ${configPath}`)}`;
}

function userIsEligible(user, nowDate = new Date()) {
  if (String(user?.status || "active").toLowerCase() !== "active") {
    return false;
  }

  const expiresAt = parseTimestamp(user?.expires_at);
  if (!expiresAt) {
    return true;
  }

  return expiresAt.getTime() > nowDate.getTime();
}

function buildEligibleUsers(accessUsers, nowDate = new Date()) {
  const eligibleUsers = [];
  const skippedUsers = [];

  for (const user of accessUsers) {
    if (userIsEligible(user, nowDate)) {
      eligibleUsers.push(user);
      continue;
    }

    skippedUsers.push({
      id: user?.id ?? null,
      name: user?.name ?? user?.id ?? "unknown",
      reason:
        String(user?.status || "active").toLowerCase() !== "active"
          ? "status_inactive"
          : "expired",
    });
  }

  return {
    eligibleUsers,
    skippedUsers,
  };
}

export function validateSingBoxProfileTemplate(profile) {
  const errors = [];
  const protocol = String(profile?.protocol || "vless").toLowerCase();
  const transport = String(profile?.transport || "tcp").toLowerCase();
  const security = String(profile?.security || "reality").toLowerCase();
  const realityTemplate = pickRealityTemplate(profile);
  const tlsTemplate = pickTlsTemplate(profile);
  const transportTemplate = pickTransportTemplate(profile);
  const shortIds = normalizeStringArray(realityTemplate.short_ids ?? realityTemplate.short_id);
  const handshake = isPlainObject(realityTemplate.handshake) ? realityTemplate.handshake : {};
  const handshakeServer = normalizeString(handshake.server) ?? normalizeString(profile?.server_name);

  if (!["vless", "vmess"].includes(protocol)) {
    errors.push("当前真实发布仅支持 VLESS / VMess 模板");
  }

  if (!Number.isInteger(Number(profile?.listen_port)) || Number(profile?.listen_port) < 1) {
    errors.push("listen_port 必须是有效端口");
  }

  if (!["tcp", "ws", "grpc", "http", "httpupgrade"].includes(transport)) {
    errors.push(`暂不支持的 transport: ${transport}`);
  }

  if (!["reality", "tls", "none"].includes(security)) {
    errors.push(`暂不支持的 security: ${security}`);
  }

  if (protocol === "vmess" && security === "reality") {
    errors.push("VMess 模板暂不支持 Reality，请改用 TLS 或无加密");
  }

  if (transport !== "tcp" && !isPlainObject(transportTemplate)) {
    errors.push(`${transport} 模式下需要在模板 JSON 中提供 transport 对象`);
  }

  if (security === "tls") {
    if (normalizeString(tlsTemplate.certificate_path) === null) {
      errors.push("TLS 模板需要 template.tls.certificate_path");
    }
    if (normalizeString(tlsTemplate.key_path) === null) {
      errors.push("TLS 模板需要 template.tls.key_path");
    }
    if (normalizeString(tlsTemplate.certificate) || normalizeString(tlsTemplate.key)) {
      errors.push("TLS 证书请使用 certificate_path / key_path，不要直接内嵌内容");
    }
  }

  if (security === "reality" && protocol === "vless") {
    if (!handshakeServer) {
      errors.push("Reality 模板需要 server_name 或 template.reality.handshake.server");
    }
    if (normalizeString(realityTemplate.private_key_path) === null) {
      errors.push("Reality 模板需要 template.reality.private_key_path");
    }
    if (shortIds.length === 0) {
      errors.push("Reality 模板需要 template.reality.short_id");
    }
    if (normalizeString(realityTemplate.private_key)) {
      errors.push("Reality 私钥请只放在节点本地文件，不要直接写入模板 JSON");
    }
  }

  return errors;
}

function buildLogConfig(profile) {
  const template = pickLogTemplate(profile);
  const level = normalizeString(template?.level) ?? "info";
  return {
    level,
    ...template,
  };
}

function buildTransportConfig(profile) {
  const transport = String(profile?.transport || "tcp").toLowerCase();
  if (transport === "tcp") {
    return null;
  }

  const template = pickTransportTemplate(profile) || {};
  return {
    ...template,
    type: transport,
  };
}

function buildMultiplexConfig(profile) {
  const template = pickMultiplexTemplate(profile);
  if (!profile?.mux_enabled && !template) {
    return null;
  }

  return {
    enabled: true,
    ...(template || {}),
  };
}

function buildTlsConfig(profile) {
  const security = String(profile?.security || "reality").toLowerCase();
  if (security === "none") {
    return null;
  }

  const template = isPlainObject(pickTlsTemplate(profile)) ? { ...pickTlsTemplate(profile) } : {};
  delete template.enabled;
  delete template.reality;
  delete template.certificate;
  delete template.key;

  const block = {
    ...template,
    enabled: true,
  };

  if (normalizeString(profile?.server_name)) {
    block.server_name = normalizeString(profile.server_name);
  }

  if (Array.isArray(template.alpn) && template.alpn.length > 0) {
    block.alpn = template.alpn;
  }

  if (normalizeString(template.min_version)) {
    block.min_version = normalizeString(template.min_version);
  }

  if (normalizeString(template.max_version)) {
    block.max_version = normalizeString(template.max_version);
  }

  if (security === "tls") {
    delete block.reality;

    if (normalizeString(template.certificate_path)) {
      block.certificate_path = normalizeString(template.certificate_path);
    }
    if (normalizeString(template.key_path)) {
      block.key_path = normalizeString(template.key_path);
    }
  }

  if (security === "reality") {
    delete block.certificate_path;
    delete block.key_path;

    const sourceRealityTemplate = pickRealityTemplate(profile);
    const realityTemplate = isPlainObject(sourceRealityTemplate) ? { ...sourceRealityTemplate } : {};
    const handshake = isPlainObject(realityTemplate.handshake) ? { ...realityTemplate.handshake } : {};
    const handshakeServer =
      normalizeString(handshake.server) ?? normalizeString(profile?.server_name) ?? "www.cloudflare.com";
    const handshakePort =
      Number.isInteger(Number(handshake.server_port)) && Number(handshake.server_port) > 0
        ? Number(handshake.server_port)
        : 443;
    const shortIds = normalizeStringArray(sourceRealityTemplate.short_ids ?? sourceRealityTemplate.short_id);

    delete realityTemplate.enabled;
    delete realityTemplate.private_key;
    delete realityTemplate.private_key_path;
    delete realityTemplate.short_id;
    delete realityTemplate.short_ids;
    delete realityTemplate.handshake;

    block.reality = {
      ...realityTemplate,
      enabled: true,
      handshake: {
        ...handshake,
        server: handshakeServer,
        server_port: handshakePort,
      },
      private_key: "__AIRPORT_REALITY_PRIVATE_KEY__",
      short_id: shortIds,
    };

    if (normalizeString(sourceRealityTemplate.max_time_difference)) {
      block.reality.max_time_difference = normalizeString(sourceRealityTemplate.max_time_difference);
    }
  }

  return block;
}

function buildInboundConfig(release, profile, eligibleUsers) {
  const protocol = String(profile?.protocol || "vless").toLowerCase();
  const inbound = {
    type: protocol,
    tag: normalizeString(profile?.tag) ?? `airport-${release.id}`,
    listen: pickListenAddress(profile),
    listen_port: Number(profile?.listen_port ?? 443),
    users: eligibleUsers.map((user) =>
      protocol === "vmess"
        ? {
            name: normalizeString(user?.name) ?? user?.id ?? "unknown",
            uuid: normalizeString(user?.credential?.uuid),
            alterId:
              Number.isInteger(Number(user?.credential?.alter_id)) && Number(user?.credential?.alter_id) >= 0
                ? Number(user.credential.alter_id)
                : 0,
          }
        : {
            name: normalizeString(user?.name) ?? user?.id ?? "unknown",
            uuid: normalizeString(user?.credential?.uuid),
            ...(normalizeString(profile?.flow) ? { flow: normalizeString(profile.flow) } : {}),
          },
    ),
  };

  const listenFields = pickListenFields(profile);
  if (listenFields) {
    Object.assign(inbound, listenFields);
  }

  const transport = buildTransportConfig(profile);
  if (transport) {
    inbound.transport = transport;
  }

  const multiplex = buildMultiplexConfig(profile);
  if (multiplex) {
    inbound.multiplex = multiplex;
  }

  const tls = buildTlsConfig(profile);
  if (tls) {
    inbound.tls = tls;
  }

  return inbound;
}

function buildConfigDigest(config) {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 12);
}

export function buildSingBoxConfig(release, resolved) {
  const validationErrors = validateSingBoxProfileTemplate(resolved.profile);
  if (validationErrors.length > 0) {
    const error = new Error(validationErrors[0]);
    error.details = validationErrors;
    throw error;
  }

  const { eligibleUsers, skippedUsers } = buildEligibleUsers(resolved.accessUsers);
  if (eligibleUsers.length === 0) {
    const error = new Error("没有可发布的接入用户，所有用户都处于停用或已过期状态");
    error.details = ["至少需要 1 个 active 且未过期的接入用户"];
    throw error;
  }

  const profile = resolved.profile;
  const config = {
    log: buildLogConfig(profile),
    inbounds: [buildInboundConfig(release, profile, eligibleUsers)],
  };
  const engineTemplate = pickEngineTemplate(profile.template);

  if (Array.isArray(engineTemplate.outbounds) && engineTemplate.outbounds.length > 0) {
    config.outbounds = engineTemplate.outbounds;
  }

  if (isPlainObject(engineTemplate.route)) {
    config.route = engineTemplate.route;
  }

  if (Array.isArray(engineTemplate.endpoints) && engineTemplate.endpoints.length > 0) {
    config.endpoints = engineTemplate.endpoints;
  }

  const security = String(profile?.security || "reality").toLowerCase();
  const protocol = String(profile?.protocol || "vless").toUpperCase();
  const digest = buildConfigDigest(config);
  const changeSummary =
    security === "reality"
      ? `${protocol} Reality / ${eligibleUsers.length} 个有效用户 / ${profile.listen_port} 端口`
      : security === "tls"
        ? `${protocol} TLS / ${eligibleUsers.length} 个有效用户 / ${profile.listen_port} 端口`
        : `${protocol} 明文 / ${eligibleUsers.length} 个有效用户 / ${profile.listen_port} 端口`;

  return {
    config,
    digest,
    eligibleUsers,
    skippedUsers,
    metadata: {
      engine: "sing-box",
      delivery_mode: "validate_and_restart_if_available",
      rollbackable: true,
      config_path: pickConfigPath(profile),
      change_summary: changeSummary,
      security,
      transport: String(profile?.transport || "tcp").toLowerCase(),
      reality_private_key_path:
        security === "reality"
          ? normalizeString(pickRealityTemplate(profile).private_key_path)
          : null,
    },
  };
}

export function buildSingBoxPublishScript({
  release,
  manifest,
  renderedConfig,
  renderPlan,
  binaryDistribution = null,
}) {
  const manifestText = JSON.stringify(manifest, null, 2);
  const renderedConfigText = JSON.stringify(renderedConfig, null, 2);
  const serviceCommandArgsLine = buildServiceCommandArgsLine(renderPlan.metadata.config_path);
  const releaseFile = `/etc/airport/releases/${release.id}.json`;
  const renderedConfigFile = `/etc/airport/releases/${release.id}.sing-box.json`;
  const stagedConfigFile = `/etc/airport/releases/${release.id}.sing-box.staged.json`;
  const backupConfigFile = `/etc/airport/releases/${release.id}.sing-box.backup.json`;
  const validationLogFile = `/etc/airport/releases/${release.id}.sing-box.check.log`;
  const binaryInstallPath =
    normalizeString(binaryDistribution?.install_path) ?? "/usr/local/bin/sing-box";
  const binaryVariants = Array.isArray(binaryDistribution?.variants)
    ? binaryDistribution.variants.filter((variant) => normalizeString(variant?.effective_url))
    : [];
  const binaryLookupSection = binaryVariants.length
    ? `lookup_binary_url() {
  case "$1" in
${binaryVariants
  .map((variant) => `    ${variant.target}) printf '%s' ${shellQuote(variant.effective_url)} ;;`)
  .join("\n")}
    *) printf '' ;;
  esac
}

lookup_binary_sha256() {
  case "$1" in
${binaryVariants
  .map((variant) =>
    `    ${variant.target}) printf '%s' ${shellQuote(normalizeString(variant.effective_sha256) ?? "")} ;;`,
  )
  .join("\n")}
    *) printf '' ;;
  esac
}

lookup_binary_source() {
  case "$1" in
${binaryVariants
  .map((variant) =>
    `    ${variant.target}) printf '%s' ${shellQuote(normalizeString(variant.source_mode) ?? "upstream")} ;;`,
  )
  .join("\n")}
    *) printf '' ;;
  esac
}

install_singbox_binary() {
  if command -v sing-box >/dev/null 2>&1; then
    echo "[publish] binary_install=existing"
    return 0
  fi

  TARGET="$(detect_singbox_target)"
  if [ -z "$TARGET" ]; then
    echo "[publish] binary_install=unsupported_platform"
    return 1
  fi

  DOWNLOAD_URL="$(lookup_binary_url "$TARGET")"
  if [ -z "$DOWNLOAD_URL" ]; then
    echo "[publish] binary_install=no_distribution"
    return 1
  fi

  TMP_DIR="$(mktemp -d /tmp/airport-singbox.XXXXXX 2>/dev/null || mktemp -d)"
  ARCHIVE_FILE="$TMP_DIR/sing-box.tar.gz"

  if ! download_file "$DOWNLOAD_URL" "$ARCHIVE_FILE"; then
    echo "[publish] binary_install=download_failed"
    rm -rf "$TMP_DIR"
    return 1
  fi

  EXPECTED_SHA256="$(lookup_binary_sha256 "$TARGET")"
  if [ -n "$EXPECTED_SHA256" ]; then
    ACTUAL_SHA256="$(compute_sha256 "$ARCHIVE_FILE" || true)"
    if [ -z "$ACTUAL_SHA256" ] || [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
      echo "[publish] binary_install=checksum_failed"
      rm -rf "$TMP_DIR"
      return 1
    fi
  fi

  if ! tar -xzf "$ARCHIVE_FILE" -C "$TMP_DIR" >/dev/null 2>&1; then
    echo "[publish] binary_install=extract_failed"
    rm -rf "$TMP_DIR"
    return 1
  fi

  BINARY_FILE="$(find "$TMP_DIR" -type f -name sing-box | head -n 1)"
  if [ -z "$BINARY_FILE" ] || [ ! -f "$BINARY_FILE" ]; then
    echo "[publish] binary_install=binary_missing"
    rm -rf "$TMP_DIR"
    return 1
  fi

  install -d -m 755 "$(dirname "$SINGBOX_BIN_FILE")"
  cp "$BINARY_FILE" "$SINGBOX_BIN_FILE"
  chmod 755 "$SINGBOX_BIN_FILE"
  hash -r 2>/dev/null || true
  ensure_singbox_service || true

  echo "[publish] binary_source=$(lookup_binary_source "$TARGET")"
  echo "[publish] binary_target=$TARGET"
  echo "[publish] binary_version=$SINGBOX_VERSION"
  echo "[publish] binary_install=ok"
  rm -rf "$TMP_DIR"
  return 0
}
`
    : `install_singbox_binary() {
  echo "[publish] binary_install=disabled"
  return 1
}
`;

  return `#!/bin/sh
set -eu
export PATH="/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:\${PATH}"

AIRPORT_DIR=/etc/airport
RELEASE_DIR=/etc/airport/releases
RELEASE_ID=${shellQuote(release.id)}
MANIFEST_FILE=${shellQuote(releaseFile)}
RENDERED_CONFIG_FILE=${shellQuote(renderedConfigFile)}
STAGED_CONFIG_FILE=${shellQuote(stagedConfigFile)}
BACKUP_CONFIG_FILE=${shellQuote(backupConfigFile)}
VALIDATION_LOG_FILE=${shellQuote(validationLogFile)}
MANAGED_MANIFEST_FILE=/etc/airport/managed-proxy.json
MANAGED_ENGINE_FILE=/etc/airport/managed-proxy.engine
MANAGED_RELEASE_FILE=/etc/airport/managed-proxy.release
MANAGED_SINGBOX_FILE=/etc/airport/managed-sing-box.json
SINGBOX_CONFIG_FILE=${shellQuote(renderPlan.metadata.config_path)}
SINGBOX_BIN_FILE=${shellQuote(binaryInstallPath)}
SINGBOX_VERSION=${shellQuote(normalizeString(binaryDistribution?.version) ?? "")}
RESULT_MARKER=rendered_only
BACKUP_READY=0

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[\\/&]/\\\\&/g'
}

detect_singbox_target() {
  ARCH="$(uname -m 2>/dev/null || true)"
  case "$ARCH" in
    x86_64|amd64) printf '%s' linux-amd64 ;;
    aarch64|arm64) printf '%s' linux-arm64 ;;
    *) printf '' ;;
  esac
}

download_file() {
  URL="$1"
  OUTPUT_FILE="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --connect-timeout 20 -o "$OUTPUT_FILE" "$URL"
    return $?
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO "$OUTPUT_FILE" "$URL"
    return $?
  fi

  return 1
}

compute_sha256() {
  INPUT_FILE="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$INPUT_FILE" | awk '{print $1}'
    return 0
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$INPUT_FILE" | awk '{print $1}'
    return 0
  fi

  if command -v busybox >/dev/null 2>&1; then
    busybox sha256sum "$INPUT_FILE" | awk '{print $1}'
    return 0
  fi

  return 1
}

rollback_previous_config() {
  if [ "$BACKUP_READY" -eq 1 ]; then
    cp "$BACKUP_CONFIG_FILE" "$SINGBOX_CONFIG_FILE"
    if [ -x /etc/init.d/sing-box ]; then
      rc-service sing-box restart >/dev/null 2>&1 || true
    fi
    RESULT_MARKER=rolled_back
    echo "[publish] result=$RESULT_MARKER"
  fi
}

ensure_singbox_service() {
  if ! command -v sing-box >/dev/null 2>&1; then
    return 1
  fi

  SINGBOX_BIN_RESOLVED="$(command -v sing-box)"
  {
    printf '%s\n' '#!/sbin/openrc-run'
    printf '%s\n' '# airport-managed: sing-box'
    printf '%s\n' 'description="sing-box service"'
    printf '%s\n' "command=$SINGBOX_BIN_RESOLVED"
    printf '%s\n' ${shellQuote(serviceCommandArgsLine)}
    printf '%s\n' 'command_background="yes"'
    printf '%s\n' ${shellQuote('pidfile="/run/${RC_SVCNAME}.pid"')}
    printf '\n'
    printf '%s\n' 'depend() {'
    printf '%s\n' '  need net'
    printf '%s\n' '}'
  } >/etc/init.d/sing-box
  chmod 755 /etc/init.d/sing-box

  rc-update add sing-box default >/dev/null 2>&1 || true
  return 0
}

${binaryLookupSection}

install -d -m 755 "$AIRPORT_DIR" "$RELEASE_DIR" "$(dirname "$SINGBOX_CONFIG_FILE")"

cat >"$MANIFEST_FILE" <<'EOF_MANIFEST'
${manifestText}
EOF_MANIFEST

cat >"$RENDERED_CONFIG_FILE" <<'EOF_CONFIG'
${renderedConfigText}
EOF_CONFIG

cp "$MANIFEST_FILE" "$MANAGED_MANIFEST_FILE"
cp "$RENDERED_CONFIG_FILE" "$MANAGED_SINGBOX_FILE"
printf '%s\\n' sing-box >"$MANAGED_ENGINE_FILE"
printf '%s\\n' "$RELEASE_ID" >"$MANAGED_RELEASE_FILE"
echo "[publish] engine=sing-box"
echo "[publish] config_digest=${renderPlan.digest}"
echo "[publish] stage=rendered"
echo "[publish] config_path=$SINGBOX_CONFIG_FILE"

cp "$RENDERED_CONFIG_FILE" "$STAGED_CONFIG_FILE"

${
  renderPlan.metadata.security === "reality"
    ? `REALITY_PRIVATE_KEY_PATH=${shellQuote(renderPlan.metadata.reality_private_key_path ?? "")}
if [ -z "$REALITY_PRIVATE_KEY_PATH" ] || [ ! -f "$REALITY_PRIVATE_KEY_PATH" ]; then
  echo "[publish] error=reality_private_key_missing" >&2
  exit 1
fi
REALITY_PRIVATE_KEY="$(tr -d '\\r\\n' <"$REALITY_PRIVATE_KEY_PATH")"
if [ -z "$REALITY_PRIVATE_KEY" ]; then
  echo "[publish] error=reality_private_key_empty" >&2
  exit 1
fi
sed "s/__AIRPORT_REALITY_PRIVATE_KEY__/$(escape_sed_replacement "$REALITY_PRIVATE_KEY")/g" "$STAGED_CONFIG_FILE" >"$STAGED_CONFIG_FILE.tmp"
mv "$STAGED_CONFIG_FILE.tmp" "$STAGED_CONFIG_FILE"
`
    : ""
}
if [ -f "$SINGBOX_CONFIG_FILE" ]; then
  cp "$SINGBOX_CONFIG_FILE" "$BACKUP_CONFIG_FILE"
  BACKUP_READY=1
  echo "[publish] rollback=backup_ready"
fi

if command -v sing-box >/dev/null 2>&1; then
  ensure_singbox_service || true
else
  if install_singbox_binary; then
    hash -r 2>/dev/null || true
  fi
fi

if command -v sing-box >/dev/null 2>&1; then
  ensure_singbox_service || true
  if ! sing-box check -c "$STAGED_CONFIG_FILE" >"$VALIDATION_LOG_FILE" 2>&1; then
    echo "[publish] error=validation_failed" >&2
    cat "$VALIDATION_LOG_FILE" >&2 || true
    rollback_previous_config
    exit 1
  fi
  echo "[publish] validation=passed"
else
  echo "[publish] validation=skipped"
fi

cp "$STAGED_CONFIG_FILE" "$SINGBOX_CONFIG_FILE"

if [ -x /etc/init.d/sing-box ]; then
  if rc-service sing-box restart >/dev/null 2>&1; then
    sleep 1
    if rc-service sing-box status >/dev/null 2>&1; then
      echo "[publish] activation=running"
      RESULT_MARKER=applied
      echo "[publish] result=$RESULT_MARKER"
      exit 0
    fi

    echo "[publish] error=service_not_running" >&2
    rc-service sing-box status >&2 || true
    rollback_previous_config
    exit 1
  fi

  echo "[publish] error=restart_failed" >&2
  rollback_previous_config
  exit 1
fi

echo "[publish] activation=service_missing"
echo "[publish] result=$RESULT_MARKER"
`;
}

function extractPublishMarker(outputLines, prefix) {
  for (let index = outputLines.length - 1; index >= 0; index -= 1) {
    const line = String(outputLines[index] || "");
    const marker = `[publish] ${prefix}=`;
    if (line.includes(marker)) {
      return line.slice(line.indexOf(marker) + marker.length).trim();
    }
  }

  return null;
}

export function summarizeSingBoxTargets(targets = []) {
  const summary = {
    applied_nodes: 0,
    rendered_only_nodes: 0,
    rolled_back_nodes: 0,
    failed_nodes_sample: [],
  };

  for (const target of targets) {
    const outputLines = Array.isArray(target?.output) ? target.output : [];
    const result = extractPublishMarker(outputLines, "result");
    const error = extractPublishMarker(outputLines, "error");

    if (result === "applied") {
      summary.applied_nodes += 1;
    } else if (result === "rolled_back") {
      summary.rolled_back_nodes += 1;
    } else if (result === "rendered_only" || String(target?.status || "").toLowerCase() === "success") {
      summary.rendered_only_nodes += 1;
    }

    if (
      String(target?.status || "failed").toLowerCase() !== "success" &&
      summary.failed_nodes_sample.length < 3
    ) {
      summary.failed_nodes_sample.push({
        node_id: target?.node_id ?? null,
        hostname: target?.hostname ?? target?.node_id ?? "unknown",
        reason_code: error ?? "publish_failed",
      });
    }
  }

  return summary;
}

export function describeSingBoxTargetOutcome(target) {
  const outputLines = Array.isArray(target?.output) ? target.output : [];
  const result = extractPublishMarker(outputLines, "result");

  if (String(target?.status || "").toLowerCase() === "success") {
    if (result === "applied") {
      return "sing-box 配置已校验并重载。";
    }

    return "sing-box 配置已渲染到节点，等待服务接管或人工启用。";
  }

  if (result === "rolled_back") {
    return "sing-box 配置发布失败，已自动回滚到上一版。";
  }

  return "sing-box 配置发布失败，请查看终端输出。";
}
