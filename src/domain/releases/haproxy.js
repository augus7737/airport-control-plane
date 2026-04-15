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

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sanitizeName(value, fallback = "route") {
  const normalized = normalizeString(value) ?? fallback;
  return normalized.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || fallback;
}

function routeSortKey(route) {
  return [
    String(route?.entry_port ?? ""),
    String(route?.landing_node?.id ?? ""),
    String(route?.route_label ?? ""),
  ].join(":");
}

function formatUpstreamAddress(endpoint, port) {
  const host = normalizeString(endpoint?.host);
  if (!host || !port) {
    return null;
  }

  if (endpoint?.family === "ipv6") {
    return `ipv6@${host}:${port}`;
  }

  return `${host}:${port}`;
}

export function buildTrafficForwarderConfig(release, options = {}) {
  const entryNode = options.entryNode ?? null;
  const profile = isPlainObject(options.profile) ? options.profile : {};
  const upstreamPort = normalizePort(options.upstreamPort ?? profile.listen_port);
  const routes = (Array.isArray(options.routes) ? options.routes : [])
    .filter((route) => route?.access_mode === "relay")
    .sort((left, right) => routeSortKey(left).localeCompare(routeSortKey(right), "en"));

  if (!entryNode?.id) {
    throw new Error("入口节点不存在，无法生成 TCP 转发配置");
  }

  if (!upstreamPort) {
    throw new Error("代理模板 listen_port 无效，无法生成 TCP 转发配置");
  }

  if (routes.length === 0) {
    throw new Error("当前入口节点没有可聚合的 relay 线路");
  }

  const frontends = [];
  const backends = [];
  const bindings = [];

  routes.forEach((route, index) => {
    const entryPort = normalizePort(route?.entry_port);
    const upstreamAddress = formatUpstreamAddress(route?.relay_upstream_endpoint, upstreamPort);

    if (!entryPort || !upstreamAddress) {
      throw new Error(`线路 ${route?.route_label || route?.landing_node?.id || index + 1} 缺少有效入口端口或上游地址`);
    }

    const routeName = sanitizeName(
      route?.landing_node?.facts?.hostname ?? route?.landing_node?.name ?? route?.landing_node?.id,
      `route_${index + 1}`,
    );
    const frontendName = `airport_entry_${String(index + 1).padStart(2, "0")}_${routeName}`;
    const backendName = `airport_upstream_${String(index + 1).padStart(2, "0")}_${routeName}`;

    frontends.push(
      [
        `frontend ${frontendName}`,
        "  mode tcp",
        `  bind 0.0.0.0:${entryPort}`,
        `  default_backend ${backendName}`,
      ].join("\n"),
    );

    backends.push(
      [
        `backend ${backendName}`,
        "  mode tcp",
        "  option tcp-check",
        `  server ${sanitizeName(`${backendName}_srv`, `srv_${index + 1}`)} ${upstreamAddress} check`,
      ].join("\n"),
    );

    bindings.push({
      landing_node_id: route?.landing_node?.id ?? null,
      landing_node_name:
        normalizeString(route?.landing_node?.name) ??
        normalizeString(route?.landing_node?.facts?.hostname) ??
        route?.landing_node?.id ??
        null,
      entry_port: entryPort,
      upstream_host: route?.relay_upstream_endpoint?.host ?? null,
      upstream_family: route?.relay_upstream_endpoint?.family ?? null,
      upstream_port: upstreamPort,
      route_label: route?.route_label ?? null,
    });
  });

  const config = [
    "global",
    "  daemon",
    "  maxconn 1024",
    "",
    "defaults",
    "  mode tcp",
    "  timeout connect 10s",
    "  timeout client 1m",
    "  timeout server 1m",
    "",
    ...frontends.flatMap((block) => [block, ""]),
    ...backends.flatMap((block) => [block, ""]),
  ].join("\n").trimEnd() + "\n";

  const digest = createHash("sha256").update(config).digest("hex").slice(0, 12);

  return {
    config,
    digest,
    routes,
    bindings,
    metadata: {
      engine: "haproxy",
      delivery_mode: "validate_and_restart_if_available",
      rollbackable: true,
      config_path: "/etc/haproxy/haproxy.cfg",
      change_summary: `为 ${bindings.length} 条 relay 线路生成 TCP 入口转发`,
    },
  };
}

export function buildTrafficForwarderPublishScript({
  release,
  manifest,
  renderedConfig,
  renderPlan,
}) {
  const manifestText = JSON.stringify(manifest, null, 2);
  const renderedConfigText = String(renderedConfig || "");
  const releaseFile = `/etc/airport/releases/${release.id}.haproxy.manifest.json`;
  const renderedConfigFile = `/etc/airport/releases/${release.id}.haproxy.cfg`;
  const stagedConfigFile = `/etc/airport/releases/${release.id}.haproxy.staged.cfg`;
  const backupConfigFile = `/etc/airport/releases/${release.id}.haproxy.backup.cfg`;
  const validationLogFile = `/etc/airport/releases/${release.id}.haproxy.check.log`;

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
MANAGED_FORWARDER_FILE=/etc/airport/managed-haproxy.cfg
MANAGED_FORWARDER_ENGINE_FILE=/etc/airport/managed-forwarder.engine
MANAGED_FORWARDER_RELEASE_FILE=/etc/airport/managed-forwarder.release
HAPROXY_CONFIG_FILE=${shellQuote(renderPlan.metadata.config_path)}
RESULT_MARKER=rendered_only
BACKUP_READY=0

install_haproxy_package() {
  if command -v haproxy >/dev/null 2>&1; then
    echo "[publish] binary_install=existing"
    return 0
  fi

  if command -v apk >/dev/null 2>&1; then
    if apk add --no-cache haproxy >/dev/null 2>&1; then
      echo "[publish] binary_install=apk"
      return 0
    fi
    echo "[publish] binary_install=apk_failed"
    return 1
  fi

  if command -v apt-get >/dev/null 2>&1; then
    if apt-get update >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y haproxy >/dev/null 2>&1; then
      echo "[publish] binary_install=apt"
      return 0
    fi
    echo "[publish] binary_install=apt_failed"
    return 1
  fi

  echo "[publish] binary_install=unsupported_package_manager"
  return 1
}

ensure_haproxy_service() {
  if [ -x /etc/init.d/haproxy ]; then
    rc-update add haproxy default >/dev/null 2>&1 || true
  fi
  return 0
}

restart_haproxy_service() {
  if [ -x /etc/init.d/haproxy ]; then
    if rc-service haproxy restart >/dev/null 2>&1; then
      sleep 1
      rc-service haproxy status >/dev/null 2>&1
      return $?
    fi
    return 1
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart haproxy >/dev/null 2>&1 || return 1
    systemctl is-active --quiet haproxy
    return $?
  fi

  return 2
}

rollback_previous_config() {
  if [ "$BACKUP_READY" -eq 1 ]; then
    cp "$BACKUP_CONFIG_FILE" "$HAPROXY_CONFIG_FILE"
    restart_haproxy_service >/dev/null 2>&1 || true
    RESULT_MARKER=rolled_back
    echo "[publish] result=$RESULT_MARKER"
  fi
}

install -d -m 755 "$AIRPORT_DIR" "$RELEASE_DIR" "$(dirname "$HAPROXY_CONFIG_FILE")"

cat >"$MANIFEST_FILE" <<'EOF_MANIFEST'
${manifestText}
EOF_MANIFEST

cat >"$RENDERED_CONFIG_FILE" <<'EOF_CONFIG'
${renderedConfigText}
EOF_CONFIG

printf '%s\n' "$RELEASE_ID" >"$MANAGED_FORWARDER_RELEASE_FILE"
cp "$RENDERED_CONFIG_FILE" "$MANAGED_FORWARDER_FILE"
printf '%s\\n' haproxy >"$MANAGED_FORWARDER_ENGINE_FILE"
echo "[publish] engine=haproxy"
echo "[publish] component=traffic_forwarder"
echo "[publish] config_digest=${renderPlan.digest}"
echo "[publish] stage=rendered"
echo "[publish] config_path=$HAPROXY_CONFIG_FILE"

cp "$RENDERED_CONFIG_FILE" "$STAGED_CONFIG_FILE"

if [ -f "$HAPROXY_CONFIG_FILE" ]; then
  cp "$HAPROXY_CONFIG_FILE" "$BACKUP_CONFIG_FILE"
  BACKUP_READY=1
  echo "[publish] rollback=backup_ready"
fi

if ! command -v haproxy >/dev/null 2>&1; then
  install_haproxy_package || true
fi

if ! command -v haproxy >/dev/null 2>&1; then
  echo "[publish] error=haproxy_missing" >&2
  exit 1
fi

ensure_haproxy_service || true
if ! haproxy -c -f "$STAGED_CONFIG_FILE" >"$VALIDATION_LOG_FILE" 2>&1; then
  echo "[publish] error=validation_failed" >&2
  cat "$VALIDATION_LOG_FILE" >&2 || true
  rollback_previous_config
  exit 1
fi
echo "[publish] validation=passed"

cp "$STAGED_CONFIG_FILE" "$HAPROXY_CONFIG_FILE"

RESTART_STATUS=0
if restart_haproxy_service; then
  RESULT_MARKER=applied
  echo "[publish] activation=running"
  echo "[publish] result=$RESULT_MARKER"
  exit 0
else
  RESTART_STATUS=$?
fi

if [ "$RESTART_STATUS" -eq 2 ]; then
  echo "[publish] error=service_missing" >&2
  rollback_previous_config
  exit 1
fi

echo "[publish] error=restart_failed" >&2
rollback_previous_config
exit 1
`;
}
