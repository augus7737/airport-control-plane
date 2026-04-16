import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractRemoteAddress,
  jsonResponse,
  readJsonBody,
  textResponse,
} from "./utils/http.js";
import {
  createBootstrapTokenValidators,
  validateAccessUserCreate,
  validateAccessUserUpdate,
  validateAssetUpdate,
  validateConfigReleaseCreate,
  validateManualNode,
  validateNodeGroupCreate,
  validateNodeGroupUpdate,
  validateOperationRequest,
  validatePlatformSingBoxDistributionUpdate,
  validatePlatformSingBoxMirrorRequest,
  validateProviderCreate,
  validateProviderUpdate,
  validateProxyProfileCreate,
  validateProxyProfileUpdate,
  validateRegistration,
  validateShellSessionCreate,
  validateShellSessionInput,
  validateSystemTemplateApply,
  validateSystemTemplateCreate,
  validateSystemTemplateUpdate,
  validateSystemUserApply,
  validateSystemUserCreate,
  validateSystemUserUpdate,
} from "./http/validators.js";
import {
  getPreferredLanIpv4,
  isLoopbackHost,
  isPrivateIpv4,
  isPrivateIpv6,
  isPublicIpv4,
  isPublicIpv6,
  normalizeBaseUrl,
  normalizeIpLiteral,
  normalizeNullableString,
  samePrivateIpv4Subnet,
} from "./utils/network.js";
import {
  isHtmlPagePathname,
  servePublicAsset,
  serveStaticFile,
} from "./utils/static-assets.js";
import { createOperatorSessionAuth } from "./domain/auth/session.js";
import { createNodeRecordBuilders } from "./domain/nodes/records.js";
import { createNodeFactsDomain } from "./domain/nodes/facts.js";
import { createNodeLifecycleDomain } from "./domain/nodes/lifecycle.js";
import { createBootstrapTokenDomain } from "./domain/bootstrap/tokens.js";
import { createPlatformSshDomain } from "./domain/platform/ssh.js";
import { createPlatformSingBoxDistributionDomain } from "./domain/platform/sing-box-distribution.js";
import { createOperationsExecutorDomain } from "./domain/operations/executor.js";
import { createProbeExecutorDomain } from "./domain/probes/executor.js";
import {
  buildSingBoxConfig,
  buildSingBoxPublishScript,
  describeSingBoxTargetOutcome,
  summarizeSingBoxTargets,
} from "./domain/releases/sing-box.js";
import {
  buildTrafficForwarderConfig,
  buildTrafficForwarderPublishScript,
} from "./domain/releases/haproxy.js";
import { buildSystemTemplateApplyScript } from "./domain/system/templates.js";
import { buildSystemUserApplyScript } from "./domain/system/users.js";
import { createShellSessionsDomain } from "./domain/shell/sessions.js";
import { createSharesDomain } from "./domain/shares/links.js";
import { createTaskLifecycleDomain } from "./domain/tasks/lifecycle.js";
import { createTaskStoreDomain } from "./domain/tasks/store.js";
import { createTrafficRouteDomain } from "./domain/routes/traffic.js";
import { createManagementRouteDomain } from "./domain/routes/management.js";
import { createStorePersistenceInfrastructure } from "./infrastructure/store-persistence.js";
import { createProbeSchedulerRuntime } from "./runtime/probe-scheduler.js";
import { createServerStartupRuntime } from "./runtime/startup.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(currentDir, "../public");
const scriptsDir = path.resolve(currentDir, "../scripts");
const dataDir = path.resolve(currentDir, "../data");
const nodesFile = path.join(dataDir, "nodes.json");
const operationsFile = path.join(dataDir, "operations.json");
const tasksFile = path.join(dataDir, "tasks.json");
const probesFile = path.join(dataDir, "probes.json");
const bootstrapTokensFile = path.join(dataDir, "bootstrap-tokens.json");
const accessUsersFile = path.join(dataDir, "access-users.json");
const systemTemplatesFile = path.join(dataDir, "system-templates.json");
const systemUsersFile = path.join(dataDir, "system-users.json");
const proxyProfilesFile = path.join(dataDir, "proxy-profiles.json");
const nodeGroupsFile = path.join(dataDir, "node-groups.json");
const providersFile = path.join(dataDir, "providers.json");
const configReleasesFile = path.join(dataDir, "config-releases.json");
const systemTemplateReleasesFile = path.join(dataDir, "system-template-releases.json");
const systemUserReleasesFile = path.join(dataDir, "system-user-releases.json");
const platformSingBoxFile = path.join(dataDir, "platform-sing-box.json");
const platformArtifactsDir = path.join(dataDir, "artifacts", "sing-box");
const envPlatformPublicKey = normalizeNullableString(process.env.PLATFORM_PUBLIC_KEY) ?? null;
const envPlatformSshPrivateKeyPath =
  normalizeNullableString(process.env.PLATFORM_SSH_PRIVATE_KEY_PATH) ?? null;
const managedPlatformSshDir = path.join(dataDir, "platform-ssh");
const managedPlatformSshPrivateKeyPath = path.join(managedPlatformSshDir, "id_ed25519");
const managedPlatformSshPublicKeyPath = path.join(managedPlatformSshDir, "id_ed25519.pub");
const platformPublicBaseUrl = normalizeBaseUrl(process.env.PLATFORM_PUBLIC_BASE_URL ?? "");
const clientPublicBaseUrl = normalizeBaseUrl(process.env.CLIENT_PUBLIC_BASE_URL ?? "");
const defaultNodeSshUser = process.env.NODE_SSH_USER ?? "root";
const demoShellBinary = process.env.DEMO_SHELL_BINARY ?? "/bin/sh";
const shellSessionIdleMs = 15 * 60 * 1000;
const operationHistoryLimit = Math.max(
  Number.parseInt(process.env.OPERATION_HISTORY_LIMIT ?? "1000", 10) || 1000,
  30,
);
const shellSessionClosedRetentionMs = 5 * 60 * 1000;
const shellSessionOutputLimit = 120000;
const operationExecutionTimeoutMs = Number.parseInt(
  process.env.OPERATION_EXECUTION_TIMEOUT_MS ?? "300000",
  10,
);
const sshConnectTimeoutSeconds = Number.parseInt(
  process.env.SSH_CONNECT_TIMEOUT_SECONDS ?? "15",
  10,
);
const probeTcpTimeoutMs = Number.parseInt(
  process.env.PROBE_TCP_TIMEOUT_MS ?? "4000",
  10,
);
const probeSshTimeoutMs = Number.parseInt(
  process.env.PROBE_SSH_TIMEOUT_MS ?? "12000",
  10,
);
const autoProbeEnabled = String(process.env.AUTO_PROBE_ENABLED ?? "true").toLowerCase() !== "false";
const autoProbeIntervalMs = Number.parseInt(
  process.env.AUTO_PROBE_INTERVAL_MS ?? `${15 * 60 * 1000}`,
  10,
);
const autoProbeBatchSize = Number.parseInt(process.env.AUTO_PROBE_BATCH_SIZE ?? "4", 10);
const autoProbeMinGapMs = Number.parseInt(
  process.env.AUTO_PROBE_MIN_GAP_MS ?? `${10 * 60 * 1000}`,
  10,
);
const autoProbeJitterMs = Number.parseInt(process.env.AUTO_PROBE_JITTER_MS ?? "10000", 10);
const operatorAuth = createOperatorSessionAuth({
  env: process.env,
  logger: console,
});
const nodeStore = new Map();
const fingerprintIndex = new Map();
const operationStore = [];
const taskStore = [];
const probeStore = [];
const shellSessionStore = new Map();
const bootstrapTokenStore = new Map();
const bootstrapTokenIndex = new Map();
const accessUserStore = [];
const systemTemplateStore = [];
const systemUserStore = [];
const proxyProfileStore = [];
const nodeGroupStore = [];
const providerStore = [];
const configReleaseStore = [];
const systemTemplateReleaseStore = [];
const systemUserReleaseStore = [];

const initTemplates = {
  "alpine-base": {
    task_type: "init_alpine",
    title: "初始化 Alpine",
    script_name: "Alpine 节点基础初始化（含 sing-box 准备）",
    script_body: `#!/bin/sh
set -eu

# Alpine 轻量节点初始化（可重复执行，含 sing-box best-effort 预装）
export PATH="/usr/sbin:/usr/bin:/sbin:/bin:\${PATH}"

retry_command() {
  ATTEMPTS="$1"
  DELAY_SECONDS="$2"
  shift 2
  COUNT=1

  while [ "$COUNT" -le "$ATTEMPTS" ]; do
    if "$@"; then
      return 0
    fi

    if [ "$COUNT" -lt "$ATTEMPTS" ]; then
      sleep "$DELAY_SECONDS"
    fi

    COUNT=$((COUNT + 1))
  done

  return 1
}

run_with_timeout() {
  TIMEOUT_SECONDS="$1"
  shift

  if command -v timeout >/dev/null 2>&1; then
    timeout "$TIMEOUT_SECONDS" "$@"
    return $?
  fi

  if command -v busybox >/dev/null 2>&1; then
    busybox timeout "$TIMEOUT_SECONDS" "$@"
    return $?
  fi

  "$@"
}

ensure_sshd_setting() {
  KEY="$1"
  VALUE="$2"
  FILE=/etc/ssh/sshd_config

  if [ ! -f "$FILE" ]; then
    return 0
  fi

  if grep -Eq "^[#[:space:]]*$KEY[[:space:]]+" "$FILE"; then
    sed -i "s|^[#[:space:]]*$KEY[[:space:]].*|$KEY $VALUE|" "$FILE" || true
  else
    printf '%s %s\\n' "$KEY" "$VALUE" >>"$FILE"
  fi
}

install_sing_box() {
  if command -v sing-box >/dev/null 2>&1; then
    echo "[init] sing-box 已存在，跳过安装"
    return 0
  fi

  if pgrep -x apk >/dev/null 2>&1; then
    echo "[init] 检测到 apk 正在运行，暂时跳过 sing-box 自动安装" >&2
    return 1
  fi

  rm -f /lib/apk/db/lock >/dev/null 2>&1 || true

  if run_with_timeout 60 apk add --no-cache sing-box sing-box-openrc >/dev/null 2>&1; then
    echo "[init] sing-box 已通过当前镜像安装"
    return 0
  fi

  if run_with_timeout 60 apk add --no-cache sing-box >/dev/null 2>&1; then
    echo "[init] sing-box 已通过当前镜像安装"
    return 0
  fi

  REPO_FILE=/tmp/airport-apk-repositories
  cat >"$REPO_FILE" <<'EOF_REPOS'
https://dl-cdn.alpinelinux.org/alpine/v3.22/main
https://dl-cdn.alpinelinux.org/alpine/v3.22/community
https://dl-cdn.alpinelinux.org/alpine/edge/main
https://dl-cdn.alpinelinux.org/alpine/edge/community
EOF_REPOS

  if ! run_with_timeout 20 apk --repositories-file "$REPO_FILE" update >/dev/null 2>&1; then
    echo "[init] sing-box 仓库索引刷新失败，继续尝试直接安装" >&2
  fi

  if run_with_timeout 60 apk --repositories-file "$REPO_FILE" add --no-cache sing-box sing-box-openrc >/dev/null 2>&1; then
    echo "[init] sing-box 已通过官方仓库安装"
    return 0
  fi

  if run_with_timeout 60 apk --repositories-file "$REPO_FILE" add --no-cache sing-box >/dev/null 2>&1; then
    echo "[init] sing-box 已通过官方仓库安装"
    return 0
  fi

  echo "[init] sing-box 安装失败，已跳过，不阻断整体初始化" >&2
  return 1
}

ensure_sing_box_service() {
  if ! command -v sing-box >/dev/null 2>&1; then
    return 1
  fi

  install -d -m 755 /etc/sing-box /var/lib/sing-box /var/log/sing-box

  if [ ! -f /etc/sing-box/config.json ]; then
    cat >/etc/sing-box/config.json <<'EOF_SINGBOX_CONFIG'
{
  "log": {
    "level": "warn"
  },
  "outbounds": [
    {
      "type": "direct",
      "tag": "direct"
    }
  ]
}
EOF_SINGBOX_CONFIG
  fi

  SINGBOX_BIN="$(command -v sing-box)"
  {
    printf '%s\n' '#!/sbin/openrc-run'
    printf '%s\n' '# airport-managed: sing-box'
    printf '%s\n' 'description="sing-box service"'
    printf '%s\n' "command=$SINGBOX_BIN"
    printf '%s\n' "command_args='run -c /etc/sing-box/config.json'"
    printf '%s\n' 'command_background="yes"'
    printf '%s\n' 'pidfile="/run/$''{RC_SVCNAME}.pid"'
    printf '\n'
    printf '%s\n' 'depend() {'
    printf '%s\n' '  need net'
    printf '%s\n' '}'
  } >/etc/init.d/sing-box
  chmod 755 /etc/init.d/sing-box

  rc-update add sing-box default >/dev/null 2>&1 || true
  return 0
}

echo "[init] 开始初始化"
if ! retry_command 3 2 apk update; then
  echo "[init] apk update 失败，继续尝试使用现有索引安装依赖" >&2
fi
retry_command 3 2 apk add --no-cache bash curl ca-certificates tzdata openssh iproute2 iputils bind-tools

# 基础时区与计划任务
cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime || true
echo "Asia/Shanghai" >/etc/timezone || true
rc-update add crond default >/dev/null 2>&1 || true
rc-service crond start >/dev/null 2>&1 || true
mkdir -p /run/sshd /var/run/sshd
ssh-keygen -A >/dev/null 2>&1 || true
ensure_sshd_setting "AllowTcpForwarding" "yes"
ensure_sshd_setting "PermitOpen" "any"
rc-update add sshd default >/dev/null 2>&1 || true
if pgrep -x sshd >/dev/null 2>&1; then
  rc-service sshd restart >/dev/null 2>&1 || true
else
  rc-service sshd start >/dev/null 2>&1 || sshd >/dev/null 2>&1 || /usr/sbin/sshd >/dev/null 2>&1 || true
fi

# 平台目录与环境文件（按需替换）
install -d -m 755 /opt/airport/bin /opt/airport/log /etc/airport /etc/sing-box /var/lib/sing-box /var/log/sing-box
cat >/etc/airport/node.env <<'EOF'
NODE_ROLE=edge
PANEL_ENDPOINT=https://example.com
PANEL_TOKEN=replace_me
SING_BOX_CONFIG=/etc/sing-box/config.json
EOF
chmod 600 /etc/airport/node.env

# sing-box 预装（best effort，不阻断整体初始化）
install_sing_box || true

if ensure_sing_box_service; then
  sing-box version >/dev/null 2>&1 || true
  echo "[init] sing-box 已完成预装准备"
else
  echo "[init] sing-box 当前不可用，可后续手动补装" >&2
fi

echo "[init] 初始化完成"
`,
  },
};

const alpineBbrTuningScript = `#!/bin/sh
set -eu

export PATH="/usr/sbin:/usr/bin:/sbin:/bin:\${PATH}"

SYSCTL_FILE=/etc/sysctl.d/99-airport-bbr.conf

log() {
  printf '%s\\n' "$1"
}

available_cc() {
  sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || true
}

current_cc() {
  sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || true
}

ensure_sysctl_file() {
  mkdir -p /etc/sysctl.d
  cat >"$SYSCTL_FILE" <<'EOF_SYSCTL'
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF_SYSCTL
}

if command -v modprobe >/dev/null 2>&1; then
  modprobe tcp_bbr >/dev/null 2>&1 || true
fi

ensure_sysctl_file

AVAILABLE="$(available_cc)"
if [ -n "$AVAILABLE" ] && printf '%s' "$AVAILABLE" | grep -qw bbr; then
  sysctl -w net.core.default_qdisc=fq >/dev/null 2>&1 || true
  sysctl -w net.ipv4.tcp_congestion_control=bbr >/dev/null 2>&1 || true
else
  log "[bbr] 当前环境未暴露 bbr，已写入持久化配置并跳过即时切换"
fi

CURRENT="$(current_cc)"
if [ "$CURRENT" = "bbr" ]; then
  log "[bbr] BBR 已启用"
else
  log "[bbr] BBR 未生效，常见于 LXC 或宿主机内核未开启"
fi

log "[bbr] 完成"
`;

const alpineAcmeLegoScript = `#!/bin/sh
set -eu

export PATH="/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:\${PATH}"

if [ -f /etc/airport/acme.env ]; then
  # shellcheck disable=SC1091
  . /etc/airport/acme.env
fi

ACME_EMAIL="\${ACME_EMAIL:-}"
ACME_DOMAINS="\${ACME_DOMAINS:-}"
ACME_CERT_NAME="\${ACME_CERT_NAME:-default}"
ACME_CA_URL="\${ACME_CA_URL:-https://acme-v02.api.letsencrypt.org/directory}"
ACME_WEBROOT="\${ACME_WEBROOT:-/var/www/acme}"
ACME_STATE_DIR="\${ACME_STATE_DIR:-/etc/airport/lego}"
ACME_CERT_ROOT="\${ACME_CERT_ROOT:-/etc/ssl/airport}"

require_value() {
  KEY="$1"
  VALUE="$2"
  if [ -z "$VALUE" ]; then
    echo "[acme] 缺少 $KEY，请先在 /etc/airport/acme.env 或模板脚本里设置。" >&2
    exit 1
  fi
}

install_lego() {
  if command -v lego >/dev/null 2>&1; then
    return 0
  fi

  if command -v apk >/dev/null 2>&1; then
    apk update >/dev/null 2>&1 || true
    apk add --no-cache lego ca-certificates >/dev/null 2>&1 || true
  fi

  command -v lego >/dev/null 2>&1
}

require_value "ACME_EMAIL" "$ACME_EMAIL"
require_value "ACME_DOMAINS" "$ACME_DOMAINS"

if ! install_lego; then
  echo "[acme] lego 未安装成功，请检查 Alpine 仓库或手动安装。" >&2
  exit 1
fi

install -d -m 755 "$ACME_WEBROOT" "$ACME_STATE_DIR" "$ACME_CERT_ROOT/$ACME_CERT_NAME"

set -- --accept-tos --email "$ACME_EMAIL" --server "$ACME_CA_URL" --path "$ACME_STATE_DIR" --http --http.webroot "$ACME_WEBROOT"
for DOMAIN in $(printf '%s' "$ACME_DOMAINS" | tr ',' ' '); do
  set -- "$@" --domains "$DOMAIN"
done

if ! lego "$@" run >/dev/null 2>&1; then
  lego "$@" renew --days 30
fi

PRIMARY_DOMAIN=$(printf '%s' "$ACME_DOMAINS" | cut -d',' -f1 | awk '{print $1}')
if [ -z "$PRIMARY_DOMAIN" ]; then
  echo "[acme] 无法确定主域名" >&2
  exit 1
fi

LEGO_CERT_DIR="$ACME_STATE_DIR/certificates"
install -m 644 "$LEGO_CERT_DIR/$PRIMARY_DOMAIN.crt" "$ACME_CERT_ROOT/$ACME_CERT_NAME/fullchain.pem"
install -m 600 "$LEGO_CERT_DIR/$PRIMARY_DOMAIN.key" "$ACME_CERT_ROOT/$ACME_CERT_NAME/privkey.pem"

echo "[acme] cert_name=$ACME_CERT_NAME"
echo "[acme] fullchain=$ACME_CERT_ROOT/$ACME_CERT_NAME/fullchain.pem"
echo "[acme] privkey=$ACME_CERT_ROOT/$ACME_CERT_NAME/privkey.pem"
echo "[acme] webroot=$ACME_WEBROOT"
`;

function defaultSystemTemplateRecords() {
  const alpineBase = initTemplates["alpine-base"];
  const timestamp = nowIso();

  return [
    {
      id: "system_template_alpine_base",
      name: "Alpine 基线初始化",
      category: "baseline",
      script_name: alpineBase.script_name,
      script_body: alpineBase.script_body,
      status: "active",
      node_group_ids: [],
      tags: ["alpine", "baseline", "bootstrap"],
      note: "内置基线模板，可直接批量应用到低内存 Alpine 节点。",
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      id: "system_template_alpine_bbr",
      name: "Alpine BBR 网络优化",
      category: "hardening",
      script_name: "启用 BBR / FQ（best effort）",
      script_body: alpineBbrTuningScript,
      status: "active",
      node_group_ids: [],
      tags: ["alpine", "network", "bbr", "sysctl"],
      note: "内置网络优化模板，会尽力启用 fq + bbr；在 LXC 场景下若宿主未开放内核能力，脚本会保留提示而不强制失败。",
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      id: "system_template_alpine_acme_lego",
      name: "Alpine ACME 证书申请",
      category: "hardening",
      script_name: "申请 / 续签 TLS 证书（lego / HTTP-01）",
      script_body: alpineAcmeLegoScript,
      status: "active",
      node_group_ids: [],
      tags: ["alpine", "acme", "lego", "tls", "certificate"],
      note: "内置证书模板。执行前请在 /etc/airport/acme.env 中设置 ACME_EMAIL、ACME_DOMAINS、ACME_CERT_NAME，产物默认落在 /etc/ssl/airport/<cert_name>/。",
      created_at: timestamp,
      updated_at: timestamp,
    },
  ];
}

const {
  ensureDataDir,
  loadAccessUserStore,
  loadConfigReleaseStore,
  loadNodeStore,
  loadNodeGroupStore,
  loadOperationStore,
  loadProviderStore,
  loadProbeStore,
  loadProxyProfileStore,
  loadSystemTemplateReleaseStore,
  loadSystemTemplateStore,
  loadSystemUserReleaseStore,
  loadSystemUserStore,
  loadTaskStore,
  persistAccessUserStore,
  persistConfigReleaseStore,
  persistNodeStore,
  persistNodeGroupStore,
  persistOperationStore,
  persistProviderStore,
  persistProbeStore,
  persistProxyProfileStore,
  persistSystemTemplateReleaseStore,
  persistSystemTemplateStore,
  persistSystemUserReleaseStore,
  persistSystemUserStore,
  persistTaskStore,
} = createStorePersistenceInfrastructure({
  accessUserStore,
  accessUsersFile,
  configReleaseStore,
  configReleasesFile,
  dataDir,
  fingerprintIndex,
  mkdir,
  nodeStore,
  nodeGroupStore,
  nodeGroupsFile,
  nodesFile,
  normalizeNodeFacts: (facts, options) => normalizeNodeFacts(facts, options),
  nowIso,
  operationStore,
  operationsFile,
  providerStore,
  providersFile,
  probeStore,
  proxyProfileStore,
  proxyProfilesFile,
  probesFile,
  readFile,
  systemTemplateReleaseStore,
  systemTemplateReleasesFile,
  systemTemplateStore,
  systemTemplatesFile,
  systemUserReleaseStore,
  systemUserReleasesFile,
  systemUserStore,
  systemUsersFile,
  taskStore,
  tasksFile,
  writeFile,
});

const {
  normalizeBootstrapTimestamp,
  registerBootstrapToken,
  persistBootstrapTokens,
  loadBootstrapTokens,
  findBootstrapTokenByValue,
  bootstrapTokenError,
  recordBootstrapTokenUsage,
  buildBootstrapTokenRecord,
  serializeBootstrapToken,
} = createBootstrapTokenDomain({
  store: bootstrapTokenStore,
  index: bootstrapTokenIndex,
  bootstrapTokensFile,
  ensureDataDir,
  readFile,
  writeFile,
  randomUUID,
  nowIso,
});

const {
  validateBootstrapTokenCreate,
  validateBootstrapTokenUpdate,
} = createBootstrapTokenValidators({
  normalizeBootstrapTimestamp,
  bootstrapTokenIndex,
});

const {
  normalizeNodeFacts,
  findExistingBootstrapNode,
} = createNodeFactsDomain({
  normalizeNullableString,
  normalizeIpLiteral,
  isIP,
  isPublicIpv4,
  isPublicIpv6,
  store: nodeStore,
  index: fingerprintIndex,
});

const {
  buildNodeRecord,
  migrateLegacyNodeManagementRecord,
  updateNodeAssetRecord,
  buildManualNodeRecord,
} = createNodeRecordBuilders({
  normalizeNodeFacts,
  createNodeId: () => `node_${randomUUID()}`,
});

const {
  buildTrafficConflictMessage,
  findTrafficRouteConflicts,
  resolveTrafficRoute,
} = createTrafficRouteDomain({
  samePrivateIpv4Subnet,
});

const { resolveManagementRoute } = createManagementRouteDomain({
  defaultNodeSshUser,
  getNodeById: (nodeId) => nodeStore.get(nodeId),
  getPreferredLanIpv4,
  samePrivateIpv4Subnet,
});

const {
  detachRelayNodeReferences,
  pruneOperationsForNode,
  pruneProbesForNode,
  pruneTasksForNode,
} = createNodeLifecycleDomain({
  nodeStore,
  operationStore,
  probeStore,
  taskStore,
});

const {
  bootstrapProbeTaskForInitTask,
  buildTaskRecord,
  ensureNodeInitTask,
  latestNodeTask,
  latestNodeTaskByTrigger,
  resolveInitTemplate,
  sortTasks,
  upsertTaskRecord,
} = createTaskStoreDomain({
  findSystemTemplateById,
  initTemplates,
  nowIso,
  randomUUID,
  taskStore,
});

const {
  cleanupShellSessions,
  closeShellSession,
  closeShellSessionsForNode,
  createShellSession,
  serializeShellSession,
  shellSessionLabel,
} = createShellSessionsDomain({
  cwdProvider: () => process.cwd(),
  nowIso,
  randomUUID,
  resolveShellTransport: async (node) => resolveShellTransport(node),
  shellSessionClosedRetentionMs,
  shellSessionIdleMs,
  shellSessionOutputLimit,
  shellSessionStore,
  spawn,
});

const {
  generateManagedPlatformSshKey,
  hasUsablePlatformSshKey,
  platformSshKeyState,
  resolveExecutionTransport,
  resolveNodeSshTransport,
  resolveShellTransport,
} = createPlatformSshDomain({
  cwdProvider: () => process.cwd(),
  defaultNodeSshUser,
  demoShellBinary,
  envPlatformPublicKey,
  envPlatformSshPrivateKeyPath,
  baseEnv: process.env,
  managedPlatformSshDir,
  managedPlatformSshPrivateKeyPath,
  managedPlatformSshPublicKeyPath,
  mkdir,
  normalizeNullableString,
  readFile,
  resolveManagementRoute: (node, options) => resolveManagementRoute(node, options),
  shellSessionLabel,
  spawn,
  sshConnectTimeoutSeconds,
  stat,
});

const {
  artifactFilePath: singBoxArtifactFilePath,
  buildPublishDistribution,
  loadDistribution: loadPlatformSingBoxDistribution,
  mirrorArtifact: mirrorPlatformSingBoxArtifact,
  serializeDistribution: serializePlatformSingBoxDistribution,
  supportedTargets: supportedSingBoxTargets,
  updateDistribution: updatePlatformSingBoxDistribution,
} = createPlatformSingBoxDistributionDomain({
  artifactsDir: platformArtifactsDir,
  distributionFile: platformSingBoxFile,
  mkdir,
  nowIso,
  readFile,
  spawn,
  stat,
  writeFile,
});

const {
  buildOperationRecord,
  terminateChildProcess,
} = createOperationsExecutorDomain({
  cwdProvider: () => process.cwd(),
  formatTimeLabel,
  getNodeById: (nodeId) => nodeStore.get(nodeId),
  nowIso,
  operationExecutionTimeoutMs,
  randomUUID,
  resolveExecutionTransport,
  spawn,
});

const {
  executeProbeTask,
  resolveProbeTarget,
  sshProbeTimeoutMs,
} = createProbeExecutorDomain({
  cwdProvider: () => process.cwd(),
  defaultNodeSshUser,
  getNodeById: (nodeId) => nodeStore.get(nodeId),
  getPreferredLanIpv4,
  nowIso,
  persistNodeStore,
  persistProbeStore,
  persistTaskStore,
  probeSshTimeoutMsValue: probeSshTimeoutMs,
  probeStore,
  probeTcpTimeoutMsValue: probeTcpTimeoutMs,
  randomUUID,
  resolveBusinessProbeContext: (node, options) => resolveBusinessProbeContext(node, options),
  resolveManagementRoute: (node, options) => resolveManagementRoute(node, options),
  resolveNodeSshTransport: async (node, options) => resolveNodeSshTransport(node, options),
  samePrivateIpv4Subnet,
  setNodeRecord: (node) => nodeStore.set(node.id, node),
  spawn,
  terminateChildProcess,
  upsertTaskRecord,
});

const {
  bootstrapAutoProbeState,
  buildProbeTask,
  ensureBootstrapAutoProbe,
  ensureBootstrapInitTasks,
  executeBootstrapInitTask,
  executeInitTask,
  reconcileTaskStoreFromOperations,
} = createTaskLifecycleDomain({
  bootstrapProbeTaskForInitTask,
  buildOperationRecord,
  buildTaskRecord,
  defaultNodeSshUser,
  ensureNodeInitTask,
  executeProbeTask: async (task, options) => executeProbeTask(task, options),
  getNodeById: (nodeId) => nodeStore.get(nodeId),
  getSshProbeTimeoutMs: () => sshProbeTimeoutMs(),
  hasUsablePlatformSshKey,
  latestNodeTask,
  latestNodeTaskByTrigger,
  listNodes: () => [...nodeStore.values()],
  nowIso,
  operationStore,
  persistNodeStore,
  persistOperationStore,
  persistTaskStore,
  probeStore,
  pushOperationRecord,
  resolveInitTemplate,
  resolveBusinessProbeContext: (node, options) => resolveBusinessProbeContext(node, options),
  resolveManagementRoute: (node, options) => resolveManagementRoute(node, options),
  resolveProbeTarget,
  setNodeRecord: (node) => nodeStore.set(node.id, node),
  shellSessionLabel,
  taskStore,
  upsertTaskRecord,
});

const {
  buildAccessUserShareResponse,
  buildSubscriptionContent,
  resolveRequestOrigin,
} = createSharesDomain({
  clientPublicBaseUrl,
  normalizeBaseUrl,
  platformPublicBaseUrl,
  resolveTrafficRoute: (node, nodes, profile) => resolveTrafficRoute(node, nodes, profile),
});

const {
  getProbeSchedulerState,
  startProbeScheduler,
} = createProbeSchedulerRuntime({
  buildProbeTask,
  executeProbeTask: async (task, options) => executeProbeTask(task, options),
  enabled: autoProbeEnabled,
  intervalMs: autoProbeIntervalMs,
  batchSize: autoProbeBatchSize,
  jitterMs: autoProbeJitterMs,
  listNodes: () => [...nodeStore.values()],
  nowIso,
  minProbeGapMs: autoProbeMinGapMs,
  persistTaskStore,
  taskStore,
  upsertTaskRecord,
});

async function buildPlatformContext(url) {
  const requestOrigin = normalizeBaseUrl(`${url.protocol}//${url.host}`);
  const requestedPort = url.port || String(port);
  const lanIpv4 = getPreferredLanIpv4();
  const lanBaseUrl = lanIpv4
    ? normalizeBaseUrl(`${url.protocol}//${lanIpv4}${requestedPort ? `:${requestedPort}` : ""}`)
    : null;

  let bootstrapBaseUrl = requestOrigin;
  let source = "request";

  if (platformPublicBaseUrl) {
    bootstrapBaseUrl = platformPublicBaseUrl;
    source = "env";
  } else if (isLoopbackHost(url.hostname) && lanBaseUrl) {
    bootstrapBaseUrl = lanBaseUrl;
    source = "detected_lan";
  }

  const keyState = await platformSshKeyState();
  const distribution = serializePlatformSingBoxDistribution(bootstrapBaseUrl);
  const mirroredVariants = distribution.variants.filter((variant) => variant.mirror_available);
  const lastSyncedVariant = [...mirroredVariants].sort((left, right) =>
    String(right.mirror_downloaded_at || "").localeCompare(String(left.mirror_downloaded_at || "")),
  )[0] || null;
  const syncStatus = mirroredVariants.length > 0 ? "success" : "never";

  return {
    request_origin: requestOrigin,
    bootstrap_base_url: bootstrapBaseUrl,
    detected_lan_ipv4: lanIpv4,
    detected_lan_base_url: lanBaseUrl,
    source,
    ssh_key: {
      status: keyState.ok
        ? keyState.bootstrap_ready
          ? "ready"
          : "partial"
        : keyState.reason_code === "platform_ssh_key_invalid"
          ? "invalid"
          : "missing",
      available: keyState.ok,
      bootstrap_ready: Boolean(keyState.bootstrap_ready),
      source: keyState.source,
      private_key_path: keyState.private_key_path,
      public_key: keyState.public_key,
      note: keyState.note,
      can_generate: keyState.source !== "env",
    },
    probe_scheduler: getProbeSchedulerState(),
    sing_box_distribution: {
      ...distribution,
      auto_sync: false,
      mode: distribution.enabled ? (mirroredVariants.length > 0 ? "prefer-mirror" : "hybrid") : "disabled",
      default_version: distribution.version,
      mirror_base_url: bootstrapBaseUrl,
      sync_status: syncStatus,
      last_sync_at: lastSyncedVariant?.mirror_downloaded_at ?? null,
      last_sync_message: lastSyncedVariant?.note ?? null,
      artifact_count: mirroredVariants.length,
      supported_platforms: supportedSingBoxTargets,
    },
  };
}

async function sendBinaryFile(reply, filePath, contentType, fileName = null) {
  const buffer = await readFile(filePath);
  reply.writeHead(200, {
    "content-type": contentType,
    "content-length": String(buffer.byteLength),
    ...(fileName ? { "content-disposition": `inline; filename="${fileName}"` } : {}),
    "cache-control": "public, max-age=300",
  });
  reply.end(buffer);
}

function nowIso() {
  return new Date().toISOString();
}

setInterval(cleanupShellSessions, 60 * 1000).unref?.();

function sortProbes(probes) {
  return [...probes].sort((a, b) =>
    String(b.observed_at ?? "").localeCompare(String(a.observed_at ?? ""))
  );
}

function listNodeProbes(nodeId) {
  return sortProbes(probeStore.filter((probe) => probe.node_id === nodeId));
}

function formatTimeLabel(value) {
  return new Date(value).toISOString().slice(11, 19);
}

function pushOperationRecord(operation) {
  operationStore.unshift(operation);
  if (operationStore.length > operationHistoryLimit) {
    operationStore.length = operationHistoryLimit;
  }
  return operation;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function compactTimestamp(value = nowIso()) {
  return String(value).replace(/[-:.TZ]/g, "").slice(0, 14);
}

function uniqueStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeTimestampValue(value, fallback = null) {
  if (value === undefined) {
    return fallback;
  }

  if (value === null) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function sortByUpdatedAt(items) {
  return [...items].sort((a, b) =>
    String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")),
  );
}

function taskExcerptFromLines(lines) {
  const entries = Array.isArray(lines) ? lines.filter(Boolean) : [];
  return entries.slice(-8);
}

function operationTargetForNode(operation, nodeId) {
  if (!operation || !Array.isArray(operation.targets)) {
    return null;
  }

  return operation.targets.find((target) => target.node_id === nodeId) || null;
}

function findAccessUserById(accessUserId) {
  return accessUserStore.find((item) => item.id === accessUserId) || null;
}

function findProviderById(providerId) {
  return providerStore.find((item) => item.id === providerId) || null;
}

function findProviderByName(name, options = {}) {
  const normalizedName = normalizeNullableString(name)?.toLowerCase();
  if (!normalizedName) {
    return null;
  }

  const excludeId = normalizeNullableString(options.excludeId);
  return (
    providerStore.find((item) => {
      if (excludeId && item.id === excludeId) {
        return false;
      }
      return normalizeNullableString(item.name)?.toLowerCase() === normalizedName;
    }) || null
  );
}

function safeDecodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function findAccessUserByShareToken(shareToken) {
  return accessUserStore.find((item) => item.share_token === shareToken) || null;
}

function generateAccessUserShareToken() {
  return randomUUID().replace(/-/g, "");
}

function serializeAccessUser(accessUser) {
  if (!accessUser || typeof accessUser !== "object") {
    return null;
  }

  const { share_token: _shareToken, ...rest } = accessUser;
  return rest;
}

function rotateAccessUserShareToken(accessUser) {
  const timestamp = nowIso();
  return {
    ...accessUser,
    share_token: generateAccessUserShareToken(),
    share_token_created_at: accessUser?.share_token_created_at ?? timestamp,
    share_token_updated_at: timestamp,
    updated_at: timestamp,
  };
}

async function ensureAccessUserShareTokens() {
  let changed = false;

  for (let index = 0; index < accessUserStore.length; index += 1) {
    const accessUser = accessUserStore[index];
    if (normalizeNullableString(accessUser?.share_token)) {
      continue;
    }

    const timestamp = nowIso();
    accessUserStore[index] = {
      ...accessUser,
      share_token: generateAccessUserShareToken(),
      share_token_created_at: accessUser?.share_token_created_at ?? timestamp,
      share_token_updated_at: accessUser?.share_token_updated_at ?? timestamp,
      updated_at: accessUser?.updated_at ?? timestamp,
    };
    changed = true;
  }

  if (changed) {
    await persistAccessUserStore();
  }
}

function findSystemUserById(systemUserId) {
  return systemUserStore.find((item) => item.id === systemUserId) || null;
}

function findSystemUserByUsername(username, options = {}) {
  const normalizedUsername = normalizeNullableString(username)?.toLowerCase();
  if (!normalizedUsername) {
    return null;
  }

  const excludeId = normalizeNullableString(options.excludeId);
  return (
    systemUserStore.find((item) => {
      if (!item || item.id === excludeId) {
        return false;
      }

      return String(item.username || "").toLowerCase() === normalizedUsername;
    }) || null
  );
}

function findSystemUserByUid(uid, options = {}) {
  if (!Number.isInteger(uid)) {
    return null;
  }

  const excludeId = normalizeNullableString(options.excludeId);
  return (
    systemUserStore.find((item) => {
      if (!item || item.id === excludeId) {
        return false;
      }

      return Number.isInteger(item.uid) && item.uid === uid;
    }) || null
  );
}

function collectSystemUserConflictMessages(candidate, options = {}) {
  if (!candidate || typeof candidate !== "object") {
    return [];
  }

  const messages = [];
  const excludeId = normalizeNullableString(options.excludeId);
  const duplicateUsername = findSystemUserByUsername(candidate.username, { excludeId });
  if (duplicateUsername) {
    messages.push(
      `system username already exists: ${candidate.username} (${duplicateUsername.id})`,
    );
  }

  if (Number.isInteger(candidate.uid)) {
    const duplicateUid = findSystemUserByUid(candidate.uid, { excludeId });
    if (duplicateUid) {
      messages.push(`system uid already exists: ${candidate.uid} (${duplicateUid.id})`);
    }
  }

  return messages;
}

function findSystemTemplateById(templateId) {
  return systemTemplateStore.find((item) => item.id === templateId) || null;
}

function findProxyProfileById(profileId) {
  return proxyProfileStore.find((item) => item.id === profileId) || null;
}

function findNodeGroupById(groupId) {
  return nodeGroupStore.find((item) => item.id === groupId) || null;
}

function findReleaseRouteForNode(release, nodeId) {
  const routes = Array.isArray(release?.routes) ? release.routes : [];
  return routes.find((route) => route?.node_id === nodeId) || null;
}

function findReleaseDeploymentForNode(release, nodeId) {
  const deployments = Array.isArray(release?.deployments) ? release.deployments : [];
  return deployments.find((deployment) => deployment?.node_id === nodeId) || null;
}

function inferReleaseListenPort(release, nodeId) {
  const deployment = findReleaseDeploymentForNode(release, nodeId);
  const singBoxArtifact = deployment?.artifacts?.sing_box ?? null;
  const manifestListenPort = Number(singBoxArtifact?.manifest?.profile?.listen_port);
  if (Number.isInteger(manifestListenPort) && manifestListenPort > 0) {
    return manifestListenPort;
  }

  const inboundListenPort = Number(
    singBoxArtifact?.rendered_config?.inbounds?.[0]?.listen_port ?? 0,
  );
  if (Number.isInteger(inboundListenPort) && inboundListenPort > 0) {
    return inboundListenPort;
  }

  const profileListenPort = Number(findProxyProfileById(release?.profile_id)?.listen_port ?? 0);
  return Number.isInteger(profileListenPort) && profileListenPort > 0 ? profileListenPort : null;
}

function resolveBusinessProbeContext(node) {
  if (!node?.id) {
    return {
      published: false,
      route: null,
      profile: null,
      release_id: null,
      access_mode: "direct",
      route_label: null,
      entry_node_id: null,
      entry_node: null,
      entry_target: null,
      relay_upstream_target: null,
      problems: ["node_missing"],
    };
  }

  for (const release of configReleaseStore) {
    if (!release?.id || !Array.isArray(release?.node_ids) || !release.node_ids.includes(node.id)) {
      continue;
    }

    const route = findReleaseRouteForNode(release, node.id);
    if (!route) {
      continue;
    }

    const deployment = findReleaseDeploymentForNode(release, node.id);
    const deploymentStatus = String(deployment?.status || release?.status || "").toLowerCase();
    if (deployment && deploymentStatus !== "success") {
      continue;
    }

    const accessMode =
      normalizeNullableString(route.access_mode)?.toLowerCase() === "relay" ? "relay" : "direct";
    const entryHost = normalizeNullableString(route.entry_endpoint);
    const entryPort = Number(route.entry_port);
    const validEntryPort = Number.isInteger(entryPort) && entryPort > 0 ? entryPort : null;
    const entryNodeId =
      normalizeNullableString(route.entry_node_id) ?? (accessMode === "direct" ? node.id : null);
    const entryNode = entryNodeId ? nodeStore.get(entryNodeId) || (entryNodeId === node.id ? node : null) : null;
    const relayUpstreamHost = accessMode === "relay" ? normalizeNullableString(route.relay_upstream_endpoint) : null;
    const upstreamFamily =
      normalizeNullableString(route.upstream_family)?.toLowerCase() === "ipv6"
        ? "ipv6"
        : normalizeNullableString(route.upstream_family)?.toLowerCase() === "ipv4"
          ? "ipv4"
          : relayUpstreamHost?.includes(":")
            ? "ipv6"
            : relayUpstreamHost
              ? "ipv4"
              : null;
    const listenPort = inferReleaseListenPort(release, node.id);
    const profile = findProxyProfileById(release.profile_id) ?? deployment?.artifacts?.sing_box?.manifest?.profile ?? null;
    const problems = [];

    if (!entryHost) {
      problems.push("entry_endpoint_missing");
    }
    if (!validEntryPort) {
      problems.push("entry_port_missing");
    }
    if (accessMode === "relay" && !entryNodeId) {
      problems.push("entry_node_missing");
    }
    if (accessMode === "relay" && !relayUpstreamHost) {
      problems.push("relay_upstream_missing");
    }
    if (accessMode === "relay" && !listenPort) {
      problems.push("listen_port_missing");
    }

    return {
      published: problems.length === 0,
      route,
      profile,
      release_id: release.id,
      access_mode: accessMode,
      route_label: normalizeNullableString(route.route_label) ?? null,
      entry_node_id: entryNodeId,
      entry_node: entryNode,
      entry_target:
        entryHost && validEntryPort
          ? {
              host: entryHost,
              port: validEntryPort,
              family: "ipv4",
              source: "release_route",
            }
          : null,
      relay_upstream_target:
        accessMode === "relay" && relayUpstreamHost && listenPort
          ? {
              host: relayUpstreamHost,
              port: listenPort,
              family: upstreamFamily ?? "ipv4",
              source: "release_route",
            }
          : null,
      problems,
    };
  }

  return {
    published: false,
    route: null,
    profile: null,
    release_id: null,
    access_mode: normalizeNullableString(node?.networking?.access_mode)?.toLowerCase() === "relay" ? "relay" : "direct",
    route_label: null,
    entry_node_id: null,
    entry_node: null,
    entry_target: null,
    relay_upstream_target: null,
    problems: ["business_route_unpublished"],
  };
}

function missingIds(ids, resolver) {
  return ids.filter((id) => !resolver(id));
}

function buildAccessUserRecord(payload, existing = null) {
  const timestamp = nowIso();
  const protocol =
    normalizeNullableString(payload.protocol ?? existing?.protocol)?.toLowerCase() ?? "vless";
  const credentialSource = hasOwn(payload, "credential") ? payload.credential : existing?.credential;
  const uuid = normalizeNullableString(credentialSource?.uuid) ?? existing?.credential?.uuid ?? randomUUID();
  const alterId =
    credentialSource?.alter_id !== undefined &&
    credentialSource?.alter_id !== null &&
    Number.isInteger(Number(credentialSource.alter_id)) &&
    Number(credentialSource.alter_id) >= 0
      ? Number(credentialSource.alter_id)
      : existing?.credential?.alter_id ?? 0;
  const shareToken = normalizeNullableString(existing?.share_token) ?? generateAccessUserShareToken();
  const shareTokenCreatedAt = existing?.share_token_created_at ?? timestamp;
  const shareTokenUpdatedAt = existing?.share_token_updated_at ?? shareTokenCreatedAt;

  return {
    id: existing?.id ?? `access_user_${randomUUID()}`,
    name: normalizeNullableString(payload.name) ?? existing?.name ?? "未命名接入用户",
    protocol,
    credential:
      protocol === "vmess"
        ? {
            uuid,
            alter_id: alterId,
          }
        : {
            uuid,
          },
    status:
      normalizeNullableString(payload.status ?? existing?.status)?.toLowerCase() ?? "active",
    expires_at: hasOwn(payload, "expires_at")
      ? normalizeTimestampValue(payload.expires_at, null)
      : existing?.expires_at ?? null,
    profile_id: hasOwn(payload, "profile_id")
      ? normalizeNullableString(payload.profile_id)
      : existing?.profile_id ?? null,
    node_group_ids: hasOwn(payload, "node_group_ids")
      ? uniqueStringList(payload.node_group_ids)
      : uniqueStringList(existing?.node_group_ids),
    note: hasOwn(payload, "note")
      ? normalizeNullableString(payload.note)
      : existing?.note ?? null,
    share_token: shareToken,
    share_token_created_at: shareTokenCreatedAt,
    share_token_updated_at: shareTokenUpdatedAt,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };
}

function validateAccessUserProfileLink({ protocol, profileId, details }) {
  if (!profileId) {
    return;
  }

  const profile = findProxyProfileById(profileId);
  if (!profile) {
    details.push(`unknown profile id: ${profileId}`);
    return;
  }

  if (String(profile.protocol || "vless").toLowerCase() !== String(protocol || "vless").toLowerCase()) {
    details.push(`access user protocol ${protocol} does not match profile protocol ${profile.protocol}`);
  }
}

function buildSystemUserRecord(payload, existing = null) {
  const timestamp = nowIso();
  const username =
    normalizeNullableString(payload.username ?? existing?.username)?.toLowerCase() ??
    existing?.username ??
    "user";

  return {
    id: existing?.id ?? `system_user_${randomUUID()}`,
    name: normalizeNullableString(payload.name) ?? existing?.name ?? username,
    username,
    uid: hasOwn(payload, "uid")
      ? (Number.isInteger(payload.uid) ? payload.uid : null)
      : existing?.uid ?? null,
    groups: hasOwn(payload, "groups")
      ? uniqueStringList(payload.groups).map((item) => item.toLowerCase())
      : uniqueStringList(existing?.groups).map((item) => item.toLowerCase()),
    sudo_enabled: hasOwn(payload, "sudo_enabled")
      ? Boolean(payload.sudo_enabled)
      : existing?.sudo_enabled ?? false,
    shell: hasOwn(payload, "shell")
      ? normalizeNullableString(payload.shell)
      : existing?.shell ?? "/bin/sh",
    home_dir: hasOwn(payload, "home_dir")
      ? normalizeNullableString(payload.home_dir)
      : existing?.home_dir ?? null,
    ssh_authorized_keys: hasOwn(payload, "ssh_authorized_keys")
      ? uniqueStringList(payload.ssh_authorized_keys)
      : uniqueStringList(existing?.ssh_authorized_keys),
    status:
      normalizeNullableString(payload.status ?? existing?.status)?.toLowerCase() ?? "active",
    node_group_ids: hasOwn(payload, "node_group_ids")
      ? uniqueStringList(payload.node_group_ids)
      : uniqueStringList(existing?.node_group_ids),
    note: hasOwn(payload, "note")
      ? normalizeNullableString(payload.note)
      : existing?.note ?? null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };
}

function buildSystemTemplateRecord(payload, existing = null) {
  const timestamp = nowIso();
  const category =
    normalizeNullableString(payload.category ?? existing?.category)?.toLowerCase() ?? "baseline";

  return {
    id: existing?.id ?? `system_template_${randomUUID()}`,
    name: normalizeNullableString(payload.name) ?? existing?.name ?? "未命名系统模板",
    category,
    script_name: hasOwn(payload, "script_name")
      ? normalizeNullableString(payload.script_name)
      : existing?.script_name ?? "运行系统模板",
    script_body: hasOwn(payload, "script_body")
      ? String(payload.script_body ?? "").trim()
      : String(existing?.script_body ?? "").trim(),
    status:
      normalizeNullableString(payload.status ?? existing?.status)?.toLowerCase() ?? "active",
    node_group_ids: hasOwn(payload, "node_group_ids")
      ? uniqueStringList(payload.node_group_ids)
      : uniqueStringList(existing?.node_group_ids),
    tags: hasOwn(payload, "tags")
      ? uniqueStringList(payload.tags).map((item) => item.toLowerCase())
      : uniqueStringList(existing?.tags).map((item) => item.toLowerCase()),
    note: hasOwn(payload, "note")
      ? normalizeNullableString(payload.note)
      : existing?.note ?? null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };
}

function buildProxyProfileRecord(payload, existing = null) {
  const timestamp = nowIso();
  const protocol =
    normalizeNullableString(payload.protocol ?? existing?.protocol)?.toLowerCase() ?? "vless";
  const security =
    normalizeNullableString(payload.security ?? existing?.security)?.toLowerCase() ??
    (protocol === "vmess" ? "tls" : "reality");
  const tlsEnabled = hasOwn(payload, "tls_enabled")
    ? Boolean(payload.tls_enabled)
    : existing?.tls_enabled ?? security === "tls";
  const realityEnabled = hasOwn(payload, "reality_enabled")
    ? Boolean(payload.reality_enabled)
    : existing?.reality_enabled ?? security === "reality";

  return {
    id: existing?.id ?? `profile_${randomUUID()}`,
    name: normalizeNullableString(payload.name) ?? existing?.name ?? "未命名模板",
    protocol,
    listen_port: hasOwn(payload, "listen_port")
      ? Number(payload.listen_port)
      : existing?.listen_port ?? 443,
    transport:
      normalizeNullableString(payload.transport ?? existing?.transport)?.toLowerCase() ?? "tcp",
    security,
    tls_enabled: tlsEnabled,
    reality_enabled: realityEnabled,
    server_name: hasOwn(payload, "server_name")
      ? normalizeNullableString(payload.server_name)
      : existing?.server_name ?? null,
    flow: hasOwn(payload, "flow")
      ? normalizeNullableString(payload.flow)
      : existing?.flow ?? (protocol === "vless" ? "xtls-rprx-vision" : null),
    mux_enabled: hasOwn(payload, "mux_enabled")
      ? Boolean(payload.mux_enabled)
      : existing?.mux_enabled ?? false,
    tag: hasOwn(payload, "tag")
      ? normalizeNullableString(payload.tag)
      : existing?.tag ?? null,
    template:
      hasOwn(payload, "template") && payload.template && typeof payload.template === "object"
        ? payload.template
        : existing?.template ?? {},
    status:
      normalizeNullableString(payload.status ?? existing?.status)?.toLowerCase() ?? "active",
    note: hasOwn(payload, "note")
      ? normalizeNullableString(payload.note)
      : existing?.note ?? null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };
}

function buildNodeGroupRecord(payload, existing = null) {
  const timestamp = nowIso();

  return {
    id: existing?.id ?? `group_${randomUUID()}`,
    name: normalizeNullableString(payload.name) ?? existing?.name ?? "未命名节点组",
    type: normalizeNullableString(payload.type ?? existing?.type)?.toLowerCase() ?? "static",
    status:
      normalizeNullableString(payload.status ?? existing?.status)?.toLowerCase() ?? "active",
    node_ids: hasOwn(payload, "node_ids")
      ? uniqueStringList(payload.node_ids)
      : uniqueStringList(existing?.node_ids),
    filters:
      hasOwn(payload, "filters") && payload.filters && typeof payload.filters === "object"
        ? payload.filters
        : existing?.filters ?? {},
    note: hasOwn(payload, "note")
      ? normalizeNullableString(payload.note)
      : existing?.note ?? null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };
}

function buildProviderRecord(payload, existing = null) {
  const timestamp = nowIso();

  return {
    id: existing?.id ?? `provider_${randomUUID()}`,
    name: normalizeNullableString(payload.name) ?? existing?.name ?? "未命名厂商",
    account_name: hasOwn(payload, "account_name")
      ? normalizeNullableString(payload.account_name)
      : existing?.account_name ?? null,
    website: hasOwn(payload, "website")
      ? normalizeNullableString(payload.website)
      : existing?.website ?? null,
    api_endpoint: hasOwn(payload, "api_endpoint")
      ? normalizeNullableString(payload.api_endpoint)
      : existing?.api_endpoint ?? null,
    regions: hasOwn(payload, "regions")
      ? uniqueStringList(payload.regions)
      : uniqueStringList(existing?.regions),
    auto_provision_enabled: hasOwn(payload, "auto_provision_enabled")
      ? Boolean(payload.auto_provision_enabled)
      : existing?.auto_provision_enabled ?? false,
    status:
      normalizeNullableString(payload.status ?? existing?.status)?.toLowerCase() ?? "active",
    note: hasOwn(payload, "note")
      ? normalizeNullableString(payload.note)
      : existing?.note ?? null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  };
}

function buildSystemTemplateReleaseRecord(payload, template, resolved, options = {}) {
  const timestamp = nowIso();
  const releaseId = options.releaseId ?? `system_template_release_${randomUUID()}`;

  return {
    id: releaseId,
    type: "apply_system_template",
    title:
      normalizeNullableString(payload.title) ?? `${template.name || template.id} · 系统模板下发`,
    status: "running",
    operator: normalizeNullableString(payload.operator) ?? "console",
    template_id: template.id,
    template_name: template.name,
    category: template.category,
    node_group_ids: resolved.groupIds,
    node_ids: resolved.nodeIds,
    operation_id: null,
    summary: {
      total_nodes: resolved.nodeIds.length,
      success_nodes: 0,
      failed_nodes: 0,
      template_name: template.name,
      category: template.category,
      apply_summary: {
        total: resolved.nodeIds.length,
        success: 0,
        failed: 0,
      },
      failed_nodes_sample: [],
    },
    note: normalizeNullableString(payload.note) ?? null,
    created_at: timestamp,
    started_at: null,
    finished_at: null,
  };
}

function buildSystemUserReleaseRecord(payload, resolved, options = {}) {
  const timestamp = nowIso();
  const releaseId = options.releaseId ?? `system_user_release_${randomUUID()}`;
  const activeCount = resolved.systemUsers.filter((item) => item.status === "active").length;
  const disabledCount = resolved.systemUsers.filter((item) => item.status !== "active").length;

  return {
    id: releaseId,
    type: "apply_system_users",
    title: normalizeNullableString(payload.title) ?? "系统用户批量下发",
    status: "running",
    operator: normalizeNullableString(payload.operator) ?? "console",
    system_user_ids: resolved.systemUsers.map((item) => item.id),
    node_group_ids: resolved.groupIds,
    node_ids: resolved.nodeIds,
    operation_id: null,
    summary: {
      total_nodes: resolved.nodeIds.length,
      success_nodes: 0,
      failed_nodes: 0,
      system_user_count: resolved.systemUsers.length,
      active_user_count: activeCount,
      disabled_user_count: disabledCount,
      change_summary: `下发 ${resolved.systemUsers.length} 个系统用户到 ${resolved.nodeIds.length} 台节点`,
      apply_summary: {
        total: resolved.nodeIds.length,
        success: 0,
        failed: 0,
      },
      failed_nodes_sample: [],
    },
    note: normalizeNullableString(payload.note) ?? null,
    created_at: timestamp,
    started_at: null,
    finished_at: null,
  };
}

function buildConfigReleaseRecord(payload, resolved, options = {}) {
  const timestamp = nowIso();
  const deploymentPlan = options.deploymentPlan ?? null;
  const renderPlan = deploymentPlan?.landingRenderPlan ?? options.renderPlan ?? null;
  const previousRelease = options.previousRelease ?? null;
  const releaseId = options.releaseId ?? `release_${randomUUID()}`;
  const binaryDistribution = options.binaryDistribution ?? null;
  const deploymentNodeIds = deploymentPlan?.deploymentNodeIds ?? resolved.nodeIds;
  const entryNodeIds = deploymentPlan?.entryNodeIds ?? [];
  const routeRecords = Array.isArray(resolved.trafficRoutes)
    ? resolved.trafficRoutes.map((route) => serializeTrafficRoute(route))
    : [];

  return {
    id: releaseId,
    type: normalizeNullableString(payload.type)?.toLowerCase() ?? "publish_proxy_config",
    title: normalizeNullableString(payload.title) ?? "未命名配置发布",
    status: "running",
    operator: normalizeNullableString(payload.operator) ?? "console",
    access_user_ids: uniqueStringList(payload.access_user_ids),
    profile_id: resolved.profile.id,
    node_group_ids: resolved.groupIds,
    node_ids: resolved.nodeIds,
    deployment_node_ids: deploymentNodeIds,
    entry_node_ids: entryNodeIds,
    operation_id: null,
    task_ids: [],
    version: `rel-${compactTimestamp(timestamp)}`,
    routes: routeRecords,
    deployments: [],
    summary: {
      total_nodes: deploymentNodeIds.length,
      success_nodes: 0,
      failed_nodes: 0,
      landing_node_count: resolved.nodeIds.length,
      entry_node_count: entryNodeIds.length,
      access_user_count: resolved.accessUsers.length,
      active_user_count: renderPlan?.eligibleUsers?.length ?? 0,
      skipped_user_count: renderPlan?.skippedUsers?.length ?? 0,
      profile_name: resolved.profile.name,
      engine:
        Array.isArray(deploymentPlan?.engines) && deploymentPlan.engines.length > 0
          ? deploymentPlan.engines.join("+")
          : renderPlan?.metadata?.engine ?? "managed-snapshot",
      action_type: "publish",
      delivery_mode:
        deploymentPlan?.delivery_mode ?? renderPlan?.metadata?.delivery_mode ?? "snapshot_only",
      binary_version: binaryDistribution?.enabled ? binaryDistribution.version : null,
      binary_install_path: binaryDistribution?.enabled ? binaryDistribution.install_path : null,
      binary_variant_count: Array.isArray(binaryDistribution?.variants)
        ? binaryDistribution.variants.length
        : 0,
      rollbackable: Boolean(
        deploymentPlan?.rollbackable ?? renderPlan?.metadata?.rollbackable,
      ),
      based_on_release_id: previousRelease?.id ?? null,
      rollback_target_release_id: previousRelease?.id ?? null,
      config_digest_before:
        previousRelease?.summary?.config_digest_after ??
        previousRelease?.summary?.config_digest ??
        null,
      config_digest_after: deploymentPlan?.digest ?? renderPlan?.digest ?? null,
      change_summary:
        (deploymentPlan?.digest ?? renderPlan?.digest) &&
        (deploymentPlan?.digest ?? renderPlan?.digest) ===
          (previousRelease?.summary?.config_digest_after ??
            previousRelease?.summary?.config_digest ??
            null)
          ? "本次渲染结果与上一版 digest 相同。"
          : deploymentPlan?.change_summary ?? renderPlan?.metadata?.change_summary ?? null,
      apply_summary: {
        total: deploymentNodeIds.length,
        success: 0,
        failed: 0,
        applied: 0,
        rendered_only: 0,
        rolled_back: 0,
      },
      failed_nodes_sample: [],
    },
    note: normalizeNullableString(payload.note) ?? null,
    created_at: timestamp,
    started_at: null,
    finished_at: null,
  };
}

function pruneNodeFromGroups(nodeId) {
  let changed = false;

  for (const group of nodeGroupStore) {
    const nextNodeIds = uniqueStringList(group.node_ids).filter((item) => item !== nodeId);
    if (nextNodeIds.length !== uniqueStringList(group.node_ids).length) {
      group.node_ids = nextNodeIds;
      group.updated_at = nowIso();
      changed = true;
    }
  }

  return changed;
}

async function ensureNodeManagementMigration() {
  let changed = false;
  let migratedCount = 0;

  for (const [nodeId, node] of nodeStore.entries()) {
    const migration = migrateLegacyNodeManagementRecord(node);
    if (!migration.changed) {
      continue;
    }

    nodeStore.set(nodeId, migration.node);
    changed = true;
    migratedCount += 1;
  }

  if (!changed) {
    return false;
  }

  await persistNodeStore();
  console.log(`[startup] migrated explicit management routes for ${migratedCount} nodes`);
  return true;
}

async function ensureDefaultSystemTemplates() {
  const existingIds = new Set(systemTemplateStore.map((item) => item.id));
  const missingTemplates = defaultSystemTemplateRecords().filter((record) => !existingIds.has(record.id));

  if (missingTemplates.length === 0) {
    return false;
  }

  systemTemplateStore.push(...missingTemplates);
  await persistSystemTemplateStore();
  return true;
}

function resolveReleaseNodes(payload) {
  const directNodeIds = uniqueStringList(payload.node_ids);
  const groupIds = uniqueStringList(payload.node_group_ids);
  const groupNodes = groupIds.flatMap((groupId) => findNodeGroupById(groupId)?.node_ids ?? []);
  return uniqueStringList([...directNodeIds, ...groupNodes]).filter((nodeId) => nodeStore.has(nodeId));
}

function serializeTrafficRoute(route) {
  return {
    node_id: route?.landing_node?.id ?? null,
    node_name: route?.landing_node?.facts?.hostname ?? route?.landing_node?.id ?? null,
    access_mode: route?.access_mode ?? "direct",
    route_role: route?.route_role ?? "landing",
    entry_node_id: route?.entry_node?.id ?? null,
    entry_node_name: route?.entry_node?.facts?.hostname ?? route?.entry_node?.id ?? null,
    entry_endpoint: route?.entry_endpoint?.host ?? null,
    entry_port: route?.entry_port ?? null,
    relay_upstream_endpoint: route?.relay_upstream_endpoint?.host ?? null,
    upstream_family: route?.upstream_family ?? null,
    route_label: route?.route_label ?? null,
    route_note: route?.route_note ?? null,
    publishable: Boolean(route?.publishable),
    problems: Array.isArray(route?.problems) ? route.problems : [],
  };
}

function buildCompositePublishScript(components = []) {
  const scripts = (Array.isArray(components) ? components : [])
    .map((component) => ({
      component: normalizeNullableString(component?.component) ?? "component",
      script_body: String(component?.script_body || "").trim(),
    }))
    .filter((component) => component.script_body);

  if (scripts.length === 0) {
    return "#!/bin/sh\nset -eu\nexit 0\n";
  }

  if (scripts.length === 1) {
    return `${scripts[0].script_body.replace(/\r\n/g, "\n")}\n`;
  }

  const parts = ["#!/bin/sh", "set -eu", ""];
  scripts.forEach((component, index) => {
    parts.push(`echo "[publish] composite_component=${component.component}"`);
    parts.push(`/bin/sh <<'EOF_COMPONENT_${index}'`);
    parts.push(component.script_body.replace(/\r\n/g, "\n"));
    parts.push(`EOF_COMPONENT_${index}`);
    parts.push("");
  });
  return `${parts.join("\n").trimEnd()}\n`;
}

function buildConfigReleaseDeploymentPlan({ releaseId, resolved, binaryDistribution }) {
  const landingRenderPlan = buildSingBoxConfig(
    {
      id: releaseId,
    },
    resolved,
  );
  const deploymentMap = new Map();
  const relayBuckets = new Map();

  for (const route of resolved.trafficRoutes) {
    const landingNode = route?.landing_node;
    if (!landingNode?.id) {
      continue;
    }

    const landingPlan = deploymentMap.get(landingNode.id) ?? {
      node_id: landingNode.id,
      node: landingNode,
      node_name: landingNode.name ?? landingNode.facts?.hostname ?? landingNode.id,
      route_roles: new Set(),
      landing_routes: [],
      entry_routes: [],
      components: {},
    };
    landingPlan.route_roles.add("landing");
    landingPlan.landing_routes.push(route);
    landingPlan.components.sing_box = {
      engine: "sing-box",
      renderPlan: landingRenderPlan,
      binaryDistribution,
    };
    deploymentMap.set(landingNode.id, landingPlan);

    if (route?.access_mode === "relay" && route?.entry_node?.id) {
      const bucket = relayBuckets.get(route.entry_node.id) ?? {
        entryNode: route.entry_node,
        routes: [],
      };
      bucket.routes.push(route);
      relayBuckets.set(route.entry_node.id, bucket);
    }
  }

  for (const bucket of relayBuckets.values()) {
    const entryNode = bucket.entryNode;
    const forwarderPlan = buildTrafficForwarderConfig(
      {
        id: releaseId,
      },
      {
        entryNode,
        profile: resolved.profile,
        routes: bucket.routes,
      },
    );
    const entryPlan = deploymentMap.get(entryNode.id) ?? {
      node_id: entryNode.id,
      node: entryNode,
      node_name: entryNode.name ?? entryNode.facts?.hostname ?? entryNode.id,
      route_roles: new Set(),
      landing_routes: [],
      entry_routes: [],
      components: {},
    };
    entryPlan.route_roles.add("entry");
    entryPlan.entry_routes.push(...bucket.routes);
    entryPlan.components.traffic_forwarder = {
      engine: "haproxy",
      renderPlan: forwarderPlan,
    };
    deploymentMap.set(entryNode.id, entryPlan);
  }

  const deploymentPlans = [...deploymentMap.values()].sort((left, right) =>
    String(left.node_name || left.node_id).localeCompare(String(right.node_name || right.node_id), "zh-CN")
  );
  const landingNodeIds = uniqueStringList(resolved.nodeIds);
  const entryNodeIds = uniqueStringList(
    deploymentPlans
      .filter((plan) => plan.route_roles.has("entry"))
      .map((plan) => plan.node_id),
  );
  const deploymentNodeIds = deploymentPlans.map((plan) => plan.node_id);
  const digestPayload = deploymentPlans.map((plan) => ({
    node_id: plan.node_id,
    route_roles: [...plan.route_roles].sort(),
    sing_box_digest: plan.components.sing_box?.renderPlan?.digest ?? null,
    traffic_forwarder_digest: plan.components.traffic_forwarder?.renderPlan?.digest ?? null,
    entry_ports:
      plan.components.traffic_forwarder?.renderPlan?.bindings?.map((binding) => binding.entry_port) ?? [],
  }));
  const digest = createHash("sha256")
    .update(JSON.stringify(digestPayload))
    .digest("hex")
    .slice(0, 12);
  const landingCount = landingNodeIds.length;
  const entryCount = entryNodeIds.length;
  const engines = uniqueStringList(
    deploymentPlans.flatMap((plan) =>
      Object.values(plan.components)
        .map((component) => component?.engine)
        .filter(Boolean),
    ),
  );
  const protocolLabel = String(resolved.profile.protocol || "vless").toUpperCase();
  const securityLabel = String(resolved.profile.security || "none").toUpperCase();
  const changeSummary =
    entryCount > 0
      ? `${protocolLabel} ${securityLabel} 落地配置 ${landingCount} 台，入口 TCP 转发 ${entryCount} 台`
      : `${protocolLabel} ${securityLabel} 落地配置 ${landingCount} 台`;

  return {
    digest,
    change_summary: changeSummary,
    delivery_mode: "node_targeted_publish",
    rollbackable: true,
    engines,
    entryNodeIds,
    landingNodeIds,
    deploymentNodeIds,
    landingRenderPlan,
    deploymentPlans,
  };
}

function buildReleaseManifest(release, resolved, options = {}) {
  const deploymentPlan = options.deploymentPlan ?? null;
  return {
    release: {
      id: release.id,
      type: release.type,
      title: release.title,
      version: release.version,
      created_at: release.created_at,
      operator: release.operator,
      note: release.note,
    },
    profile: {
      id: resolved.profile.id,
      name: resolved.profile.name,
      protocol: resolved.profile.protocol,
      listen_port: resolved.profile.listen_port,
      transport: resolved.profile.transport,
      security: resolved.profile.security,
      tls_enabled: resolved.profile.tls_enabled,
      reality_enabled: resolved.profile.reality_enabled,
      server_name: resolved.profile.server_name,
      flow: resolved.profile.flow,
      mux_enabled: resolved.profile.mux_enabled,
      tag: resolved.profile.tag,
      status: resolved.profile.status,
      note: resolved.profile.note,
    },
    access_users: resolved.accessUsers.map((user) => ({
      id: user.id,
      name: user.name,
      protocol: user.protocol,
      credential: user.credential,
      status: user.status,
      expires_at: user.expires_at,
      note: user.note,
    })),
    scope: {
      node_group_ids: release.node_group_ids,
      node_ids: release.node_ids,
      landing_node_ids: deploymentPlan?.landingNodeIds ?? release.node_ids,
      entry_node_ids: deploymentPlan?.entryNodeIds ?? release.entry_node_ids ?? [],
      deployment_node_ids: deploymentPlan?.deploymentNodeIds ?? release.deployment_node_ids ?? release.node_ids,
    },
    routes: Array.isArray(resolved.trafficRoutes)
      ? resolved.trafficRoutes.map((route) => serializeTrafficRoute(route))
      : [],
    deployments: Array.isArray(deploymentPlan?.deploymentPlans)
      ? deploymentPlan.deploymentPlans.map((plan) => ({
          node_id: plan.node_id,
          node_name: plan.node_name,
          route_roles: [...plan.route_roles].sort(),
          landing_route_count: plan.landing_routes.length,
          entry_route_count: plan.entry_routes.length,
        }))
      : [],
    render: {
      engine: release.summary?.engine ?? "managed-snapshot",
      delivery_mode: release.summary?.delivery_mode ?? "snapshot_only",
      config_digest: release.summary?.config_digest_after ?? null,
      change_summary: release.summary?.change_summary ?? null,
      active_user_count: release.summary?.active_user_count ?? 0,
      skipped_user_count: release.summary?.skipped_user_count ?? 0,
    },
    binary_distribution: {
      version: release.summary?.binary_version ?? null,
      install_path: release.summary?.binary_install_path ?? null,
      variant_count: release.summary?.binary_variant_count ?? 0,
    },
  };
}

async function executeConfigRelease(payload, options = {}) {
  const accessUserIds = uniqueStringList(payload.access_user_ids);
  const requestedGroupIds = uniqueStringList(payload.node_group_ids);
  const directNodeIds = uniqueStringList(payload.node_ids);
  const missingAccessUserIds = missingIds(accessUserIds, findAccessUserById);
  const missingGroupIds = missingIds(requestedGroupIds, findNodeGroupById);
  const missingDirectNodeIds = directNodeIds.filter((nodeId) => !nodeStore.has(nodeId));
  const profile = findProxyProfileById(payload.profile_id);

  if (!profile) {
    throw new Error(`unknown profile id: ${payload.profile_id}`);
  }

  if (missingAccessUserIds.length > 0) {
    throw new Error(`unknown access user ids: ${missingAccessUserIds.join(", ")}`);
  }

  if (missingGroupIds.length > 0) {
    throw new Error(`unknown node group ids: ${missingGroupIds.join(", ")}`);
  }

  if (missingDirectNodeIds.length > 0) {
    throw new Error(`unknown node ids: ${missingDirectNodeIds.join(", ")}`);
  }

  const accessUsers = accessUserIds.map((accessUserId) => findAccessUserById(accessUserId));
  const conflictingUsers = accessUsers.filter((user) => user?.profile_id && user.profile_id !== profile.id);
  if (conflictingUsers.length > 0) {
    throw new Error(
      `access users bound to another profile: ${conflictingUsers.map((item) => item.id).join(", ")}`,
    );
  }
  const protocolMismatchUsers = accessUsers.filter(
    (user) =>
      String(user?.protocol || "vless").toLowerCase() !==
      String(profile.protocol || "vless").toLowerCase(),
  );
  if (protocolMismatchUsers.length > 0) {
    throw new Error(
      `access user protocol does not match profile protocol: ${protocolMismatchUsers
        .map((item) => item.id)
        .join(", ")}`,
    );
  }

  const groupIds =
    requestedGroupIds.length > 0 || directNodeIds.length > 0
      ? requestedGroupIds
      : uniqueStringList(accessUsers.flatMap((user) => user?.node_group_ids ?? []));
  const nodeIds = resolveReleaseNodes({
    ...payload,
    node_group_ids: groupIds,
  });
  if (nodeIds.length === 0) {
    throw new Error("no valid nodes resolved from node_group_ids or node_ids");
  }

  const nodes = nodeIds.map((nodeId) => nodeStore.get(nodeId)).filter(Boolean);
  const allNodes = [...nodeStore.values()];
  const trafficRoutes = nodes.map((node) => resolveTrafficRoute(node, allNodes, profile));
  const routeConflicts = findTrafficRouteConflicts(trafficRoutes);
  const unpublishedRoutes = trafficRoutes.filter((route) => !route.publishable);
  if (unpublishedRoutes.length > 0) {
    throw new Error(
      `存在不可发布线路：${unpublishedRoutes
        .map((route) => `${route.route_label} (${route.problems.join(", ")})`)
        .join("；")}`,
    );
  }
  if (routeConflicts.length > 0) {
    throw new Error(routeConflicts.map((conflict) => buildTrafficConflictMessage(conflict)).join("；"));
  }
  const resolved = {
    accessUsers,
    groupIds,
    profile,
    nodeIds,
    nodes,
    trafficRoutes,
  };

  const releaseId = `release_${randomUUID()}`;
  const binaryDistribution = buildPublishDistribution(options.platformBaseUrl ?? null);
  const deploymentPlan = buildConfigReleaseDeploymentPlan({
    releaseId,
    resolved,
    binaryDistribution,
  });
  const previousRelease =
    configReleaseStore.find(
      (item) => item.profile_id === profile.id && item.status === "success",
    ) || null;
  const release = buildConfigReleaseRecord(payload, resolved, {
    binaryDistribution,
    deploymentPlan,
    previousRelease,
    releaseId,
  });
  const manifest = buildReleaseManifest(release, resolved, {
    deploymentPlan,
  });
  const nodePayloads = {};
  release.deployments = deploymentPlan.deploymentPlans.map((plan) => {
    const routeRoles = [...plan.route_roles].sort();
    const deploymentManifestBase = {
      ...manifest,
      deployment: {
        node_id: plan.node_id,
        node_name: plan.node_name,
        route_roles: routeRoles,
        landing_routes: plan.landing_routes.map((route) => serializeTrafficRoute(route)),
        entry_routes: plan.entry_routes.map((route) => serializeTrafficRoute(route)),
      },
    };
    const componentScripts = [];
    const artifacts = {};

    if (plan.components.sing_box?.renderPlan) {
      const singBoxManifest = {
        ...deploymentManifestBase,
        deployment: {
          ...deploymentManifestBase.deployment,
          artifact_engine: "sing-box",
        },
      };
      const singBoxScript = buildSingBoxPublishScript({
        binaryDistribution,
        release,
        manifest: singBoxManifest,
        renderedConfig: plan.components.sing_box.renderPlan.config,
        renderPlan: plan.components.sing_box.renderPlan,
      });
      componentScripts.push({
        component: "sing-box",
        script_body: singBoxScript,
      });
      artifacts.sing_box = {
        engine: "sing-box",
        config_digest: plan.components.sing_box.renderPlan.digest,
        config_path: plan.components.sing_box.renderPlan.metadata?.config_path ?? null,
        rendered_config: plan.components.sing_box.renderPlan.config,
        manifest: singBoxManifest,
      };
    }

    if (plan.components.traffic_forwarder?.renderPlan) {
      const forwarderManifest = {
        ...deploymentManifestBase,
        deployment: {
          ...deploymentManifestBase.deployment,
          artifact_engine: "haproxy",
        },
      };
      const forwarderScript = buildTrafficForwarderPublishScript({
        release,
        manifest: forwarderManifest,
        renderedConfig: plan.components.traffic_forwarder.renderPlan.config,
        renderPlan: plan.components.traffic_forwarder.renderPlan,
      });
      componentScripts.push({
        component: "traffic_forwarder",
        script_body: forwarderScript,
      });
      artifacts.traffic_forwarder = {
        engine: "haproxy",
        config_digest: plan.components.traffic_forwarder.renderPlan.digest,
        config_path: plan.components.traffic_forwarder.renderPlan.metadata?.config_path ?? null,
        rendered_config: plan.components.traffic_forwarder.renderPlan.config,
        manifest: forwarderManifest,
        bindings: plan.components.traffic_forwarder.renderPlan.bindings ?? [],
      };
    }

    const scriptNameParts = [];
    if (artifacts.sing_box) {
      scriptNameParts.push(`落地 ${String(profile.protocol || "vless").toUpperCase()} 配置`);
    }
    if (artifacts.traffic_forwarder) {
      scriptNameParts.push("入口 TCP 转发");
    }
    nodePayloads[plan.node_id] = {
      script_name: scriptNameParts.join(" + ") || `发布 ${String(profile.protocol || "vless").toUpperCase()} 配置`,
      script_body: buildCompositePublishScript(componentScripts),
    };

    return {
      node_id: plan.node_id,
      node_name: plan.node_name,
      route_roles: routeRoles,
      landing_route_labels: plan.landing_routes.map((route) => route.route_label).filter(Boolean),
      entry_route_labels: plan.entry_routes.map((route) => route.route_label).filter(Boolean),
      artifacts,
      status: "running",
      started_at: null,
      finished_at: null,
      note: null,
    };
  });

  const deploymentNodes = deploymentPlan.deploymentPlans.map((plan) => plan.node).filter(Boolean);
  const tasks = deploymentNodes.map((node) =>
    buildTaskRecord(node, {
      type: "publish_proxy_config",
      title: payload.title,
      status: "running",
      trigger: "manual_release",
      note: "等待控制面对节点执行按业务角色生成的配置下发。",
      started_at: nowIso(),
      payload: {
        release_id: release.id,
        access_user_ids: accessUserIds,
        profile_id: profile.id,
        node_group_ids: groupIds,
        node_ids: nodeIds,
        deployment_node_ids: deploymentPlan.deploymentNodeIds,
        entry_node_ids: deploymentPlan.entryNodeIds,
        protocol: profile.protocol,
        route_roles:
          release.deployments.find((deployment) => deployment.node_id === node.id)?.route_roles ?? [],
        reason: "manual_release",
      },
    }),
  );

  release.task_ids = tasks.map((task) => task.id);
  configReleaseStore.unshift(release);
  for (const task of tasks) {
    upsertTaskRecord(task);
  }

  await Promise.all([persistConfigReleaseStore(), persistTaskStore()]);

  try {
    const operation = await buildOperationRecord({
      mode: "script",
      title: `${release.title} · ${profile.protocol.toUpperCase()}`,
      script_name: `发布 ${profile.protocol.toUpperCase()} 线路配置`,
      script_body: "",
      node_payloads: nodePayloads,
      node_ids: deploymentPlan.deploymentNodeIds,
    });
    pushOperationRecord(operation);
    const publishSummary = summarizeSingBoxTargets(operation.targets);
    release.operation_id = operation.id;
    release.started_at = operation.started_at ?? release.created_at;
    release.finished_at = operation.finished_at ?? nowIso();
    release.status = operation.status;
    release.deployments = release.deployments.map((deployment) => {
      const target = operationTargetForNode(operation, deployment.node_id);
      const targetStatus = String(target?.status || operation.status || "failed").toLowerCase();
      return {
        ...deployment,
        status: targetStatus,
        started_at: target?.started_at ?? operation.started_at ?? nowIso(),
        finished_at: target?.finished_at ?? operation.finished_at ?? nowIso(),
        note: describeSingBoxTargetOutcome(target),
      };
    });
    release.summary = {
      ...release.summary,
      total_nodes: operation.summary?.total ?? deploymentPlan.deploymentNodeIds.length,
      success_nodes: operation.summary?.success ?? 0,
      failed_nodes: operation.summary?.failed ?? deploymentPlan.deploymentNodeIds.length,
      apply_summary: {
        total: operation.summary?.total ?? deploymentPlan.deploymentNodeIds.length,
        success: operation.summary?.success ?? 0,
        failed: operation.summary?.failed ?? deploymentPlan.deploymentNodeIds.length,
        applied: publishSummary.applied_nodes,
        rendered_only: publishSummary.rendered_only_nodes,
        rolled_back: publishSummary.rolled_back_nodes,
      },
      failed_nodes_sample: publishSummary.failed_nodes_sample,
    };

    for (const task of tasks) {
      const target = operationTargetForNode(operation, task.node_id);
      const taskStatus = String(target?.status || operation.status || "failed").toLowerCase();
      task.status = taskStatus === "success" ? "success" : "failed";
      task.operation_id = operation.id;
      task.started_at = target?.started_at ?? operation.started_at ?? task.started_at ?? nowIso();
      task.finished_at = target?.finished_at ?? operation.finished_at ?? nowIso();
      task.note = describeSingBoxTargetOutcome(target);
      task.log_excerpt = taskExcerptFromLines(target?.output || []);
      upsertTaskRecord(task);
    }

    await Promise.all([
      persistOperationStore(),
      persistTaskStore(),
      persistConfigReleaseStore(),
    ]);

    return {
      release,
      operation,
      tasks,
    };
  } catch (error) {
    release.status = "failed";
    release.finished_at = nowIso();
    release.note =
      normalizeNullableString(release.note) ??
      `配置发布执行失败: ${error instanceof Error ? error.message : "unknown error"}`;
    release.deployments = release.deployments.map((deployment) => ({
      ...deployment,
      status: "failed",
      finished_at: nowIso(),
      note: `配置发布执行失败: ${error instanceof Error ? error.message : "unknown error"}`,
    }));

    for (const task of tasks) {
      task.status = "failed";
      task.finished_at = nowIso();
      task.note = `配置发布执行失败: ${error instanceof Error ? error.message : "unknown error"}`;
      task.log_excerpt = [task.note];
      upsertTaskRecord(task);
    }

    await Promise.all([persistTaskStore(), persistConfigReleaseStore()]);
    throw error;
  }
}

async function executeSystemTemplateApply(payload) {
  const requestedGroupIds = uniqueStringList(payload.node_group_ids);
  const directNodeIds = uniqueStringList(payload.node_ids);
  const missingGroupIds = missingIds(requestedGroupIds, findNodeGroupById);
  const missingDirectNodeIds = directNodeIds.filter((nodeId) => !nodeStore.has(nodeId));
  const template = findSystemTemplateById(payload.template_id);

  if (!template) {
    throw new Error(`unknown template id: ${payload.template_id}`);
  }

  if (missingGroupIds.length > 0) {
    throw new Error(`unknown node group ids: ${missingGroupIds.join(", ")}`);
  }

  if (missingDirectNodeIds.length > 0) {
    throw new Error(`unknown node ids: ${missingDirectNodeIds.join(", ")}`);
  }

  const inheritedGroupIds =
    requestedGroupIds.length > 0 || directNodeIds.length > 0
      ? requestedGroupIds
      : uniqueStringList(template.node_group_ids);
  const nodeIds = resolveReleaseNodes({
    ...payload,
    node_group_ids: inheritedGroupIds,
    node_ids: directNodeIds,
  });

  if (nodeIds.length === 0) {
    throw new Error("no valid nodes resolved from node_group_ids or node_ids");
  }

  const resolved = {
    groupIds: inheritedGroupIds,
    nodeIds,
    nodes: nodeIds.map((nodeId) => nodeStore.get(nodeId)).filter(Boolean),
  };
  const release = buildSystemTemplateReleaseRecord(payload, template, resolved, {
    releaseId: `system_template_release_${randomUUID()}`,
  });
  const scriptBody = buildSystemTemplateApplyScript({
    release,
    template,
  });

  systemTemplateReleaseStore.unshift(release);
  await persistSystemTemplateReleaseStore();

  try {
    const operation = await buildOperationRecord({
      mode: "script",
      title: `${release.title} · ${template.name}`,
      script_name: template.script_name || template.name,
      script_body: scriptBody,
      node_ids: nodeIds,
    });
    pushOperationRecord(operation);

    const failedNodesSample = Array.isArray(operation.targets)
      ? operation.targets
          .filter((target) => String(target?.status || "failed").toLowerCase() !== "success")
          .slice(0, 3)
          .map((target) => ({
            node_id: target?.node_id ?? null,
            hostname: target?.hostname ?? target?.node_id ?? "unknown",
            reason_code: target?.timed_out ? "timed_out" : `exit_${target?.exit_code ?? "unknown"}`,
          }))
      : [];

    release.operation_id = operation.id;
    release.started_at = operation.started_at ?? release.created_at;
    release.finished_at = operation.finished_at ?? nowIso();
    release.status = operation.status;
    release.summary = {
      ...release.summary,
      total_nodes: operation.summary?.total ?? nodeIds.length,
      success_nodes: operation.summary?.success ?? 0,
      failed_nodes: operation.summary?.failed ?? nodeIds.length,
      apply_summary: {
        total: operation.summary?.total ?? nodeIds.length,
        success: operation.summary?.success ?? 0,
        failed: operation.summary?.failed ?? nodeIds.length,
      },
      failed_nodes_sample: failedNodesSample,
    };

    await Promise.all([persistOperationStore(), persistSystemTemplateReleaseStore()]);

    return {
      release,
      operation,
    };
  } catch (error) {
    release.status = "failed";
    release.finished_at = nowIso();
    release.note =
      normalizeNullableString(release.note) ??
      `系统模板下发失败: ${error instanceof Error ? error.message : "unknown error"}`;
    await persistSystemTemplateReleaseStore();
    throw error;
  }
}

async function executeSystemUserApply(payload) {
  const systemUserIds = uniqueStringList(payload.system_user_ids);
  const requestedGroupIds = uniqueStringList(payload.node_group_ids);
  const directNodeIds = uniqueStringList(payload.node_ids);
  const missingSystemUserIds = missingIds(systemUserIds, findSystemUserById);
  const missingGroupIds = missingIds(requestedGroupIds, findNodeGroupById);
  const missingDirectNodeIds = directNodeIds.filter((nodeId) => !nodeStore.has(nodeId));

  if (missingSystemUserIds.length > 0) {
    throw new Error(`unknown system user ids: ${missingSystemUserIds.join(", ")}`);
  }

  if (missingGroupIds.length > 0) {
    throw new Error(`unknown node group ids: ${missingGroupIds.join(", ")}`);
  }

  if (missingDirectNodeIds.length > 0) {
    throw new Error(`unknown node ids: ${missingDirectNodeIds.join(", ")}`);
  }

  const systemUsers = systemUserIds.map((systemUserId) => findSystemUserById(systemUserId));
  const inheritedGroupIds =
    requestedGroupIds.length > 0 || directNodeIds.length > 0
      ? requestedGroupIds
      : uniqueStringList(systemUsers.flatMap((systemUser) => systemUser?.node_group_ids ?? []));
  const nodeIds = resolveReleaseNodes({
    ...payload,
    node_group_ids: inheritedGroupIds,
    node_ids: directNodeIds,
  });

  if (nodeIds.length === 0) {
    throw new Error("no valid nodes resolved from node_group_ids or node_ids");
  }

  const resolved = {
    groupIds: inheritedGroupIds,
    nodeIds,
    nodes: nodeIds.map((nodeId) => nodeStore.get(nodeId)).filter(Boolean),
    systemUsers,
  };
  const release = buildSystemUserReleaseRecord(payload, resolved, {
    releaseId: `system_user_release_${randomUUID()}`,
  });
  const scriptBody = buildSystemUserApplyScript({
    release,
    systemUsers,
  });

  systemUserReleaseStore.unshift(release);
  await persistSystemUserReleaseStore();

  try {
    const operation = await buildOperationRecord({
      mode: "script",
      title: `${release.title} · 系统用户`,
      script_name: "下发系统用户配置",
      script_body: scriptBody,
      node_ids: nodeIds,
    });
    pushOperationRecord(operation);

    const failedNodesSample = Array.isArray(operation.targets)
      ? operation.targets
          .filter((target) => String(target?.status || "failed").toLowerCase() !== "success")
          .slice(0, 3)
          .map((target) => ({
            node_id: target?.node_id ?? null,
            hostname: target?.hostname ?? target?.node_id ?? "unknown",
            reason_code: target?.timed_out ? "timed_out" : `exit_${target?.exit_code ?? "unknown"}`,
          }))
      : [];

    release.operation_id = operation.id;
    release.started_at = operation.started_at ?? release.created_at;
    release.finished_at = operation.finished_at ?? nowIso();
    release.status = operation.status;
    release.summary = {
      ...release.summary,
      total_nodes: operation.summary?.total ?? nodeIds.length,
      success_nodes: operation.summary?.success ?? 0,
      failed_nodes: operation.summary?.failed ?? nodeIds.length,
      apply_summary: {
        total: operation.summary?.total ?? nodeIds.length,
        success: operation.summary?.success ?? 0,
        failed: operation.summary?.failed ?? nodeIds.length,
      },
      failed_nodes_sample: failedNodesSample,
    };

    await Promise.all([persistOperationStore(), persistSystemUserReleaseStore()]);

    return {
      release,
      operation,
    };
  } catch (error) {
    release.status = "failed";
    release.finished_at = nowIso();
    release.note =
      normalizeNullableString(release.note) ??
      `系统用户下发失败: ${error instanceof Error ? error.message : "unknown error"}`;
    await persistSystemUserReleaseStore();
    throw error;
  }
}

function redirectResponse(reply, location) {
  reply.writeHead(302, {
    location,
    "cache-control": "no-store",
  });
  reply.end();
}

function sanitizeAuthNextPath(url) {
  return operatorAuth.sanitizeNextPath(`${url.pathname}${url.search}`);
}

function buildLoginPageLocation(nextPath = "/") {
  const sanitizedPath = operatorAuth.sanitizeNextPath(nextPath);
  if (!sanitizedPath || sanitizedPath === "/") {
    return "/login.html";
  }

  return `/login.html?next=${encodeURIComponent(sanitizedPath)}`;
}

function isPublicApiRequest(request, url) {
  if (!url.pathname.startsWith("/api/v1/")) {
    return false;
  }

  if (
    request.method === "POST" &&
    ["/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/nodes/register"].includes(url.pathname)
  ) {
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/auth/session") {
    return true;
  }

  if (request.method === "POST" && /^\/api\/v1\/tasks\/[^/]+\/bootstrap-complete$/.test(url.pathname)) {
    return true;
  }

  if (request.method === "GET" && /^\/api\/v1\/artifacts\/sing-box\/[^/]+\/[^/]+$/.test(url.pathname)) {
    return true;
  }

  return false;
}

function requestRequiresOperatorAuth(request, url) {
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    ["/healthz", "/bootstrap.sh", "/login", "/login.html"].includes(url.pathname)
  ) {
    return false;
  }

  if (
    (request.method === "GET" || request.method === "HEAD") &&
    /^\/sub\/[^/]+$/.test(url.pathname)
  ) {
    return false;
  }

  if (isPublicApiRequest(request, url)) {
    return false;
  }

  if ((request.method === "GET" || request.method === "HEAD") && isHtmlPagePathname(url.pathname)) {
    return true;
  }

  if (url.pathname.startsWith("/api/v1/")) {
    return true;
  }

  return false;
}

const server = createServer(async (request, reply) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const operatorSession = operatorAuth.currentSession(request);

  if ((request.method === "GET" || request.method === "HEAD") && ["/login", "/login.html"].includes(url.pathname)) {
    if (operatorSession) {
      redirectResponse(reply, operatorAuth.sanitizeNextPath(url.searchParams.get("next")));
      return;
    }

    if (url.pathname === "/login") {
      redirectResponse(reply, buildLoginPageLocation(url.searchParams.get("next")));
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/v1/auth/login") {
    try {
      const payload = await readJsonBody(request);
      const result = operatorAuth.login({
        username: payload.username,
        password: payload.password,
        request,
        reply,
      });

      if (!result.ok) {
        jsonResponse(reply, 401, {
          error: result.error,
          message: result.message,
        });
        return;
      }

      jsonResponse(reply, 200, {
        authenticated: true,
        session: result.session,
        next_url: operatorAuth.sanitizeNextPath(payload.next),
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/auth/logout") {
    operatorAuth.logout({ request, reply });
    jsonResponse(reply, 200, {
      authenticated: false,
      message: "已退出登录。",
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/auth/session") {
    jsonResponse(reply, 200, {
      authenticated: Boolean(operatorSession),
      session: operatorSession,
      operator: {
        username: operatorSession?.username || operatorAuth.configuredUsername,
        display_name: operatorSession?.username || operatorAuth.configuredUsername,
        uses_fallback_credentials: operatorAuth.usesFallbackCredentials,
      },
      auth: {
        mode: "session_cookie",
        login_url: buildLoginPageLocation(),
      },
    });
    return;
  }

  if (!operatorSession && requestRequiresOperatorAuth(request, url)) {
    if (url.pathname.startsWith("/api/v1/")) {
      jsonResponse(reply, 401, {
        error: "unauthorized",
        message: "请先登录控制台。",
        login_url: buildLoginPageLocation(sanitizeAuthNextPath(url)),
      });
      return;
    }

    redirectResponse(reply, buildLoginPageLocation(sanitizeAuthNextPath(url)));
    return;
  }

  if (request.method === "GET" && url.pathname === "/healthz") {
    jsonResponse(reply, 200, {
      ok: true,
      service: "airport-control-plane",
      time: new Date().toISOString(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/bootstrap.sh") {
    const served = await serveStaticFile(
      reply,
      path.join(scriptsDir, "bootstrap.sh"),
      "text/plain",
      { readFile, textResponse },
    );

    if (!served) {
      jsonResponse(reply, 500, {
        error: "bootstrap_script_missing",
      });
    }
    return;
  }

  const publicSubscriptionMatch = url.pathname.match(/^\/sub\/([^/]+)$/);
  if ((request.method === "GET" || request.method === "HEAD") && publicSubscriptionMatch) {
    const shareToken = safeDecodePathSegment(publicSubscriptionMatch[1]);
    if (!shareToken) {
      jsonResponse(reply, 400, {
        error: "invalid_request",
        message: "invalid subscription token",
      });
      return;
    }
    const accessUser = findAccessUserByShareToken(shareToken);

    if (!accessUser) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: "subscription token not found",
      });
      return;
    }

    const shareResponse = await buildAccessUserShareResponse({
      accessUser,
      nodes: [...nodeStore.values()],
      operations: operationStore,
      releases: configReleaseStore,
      requestOrigin: resolveRequestOrigin(url),
      options: {
        includeQr: false,
      },
    });
    const requestedNodeId = normalizeNullableString(url.searchParams.get("node_id"));

    if (
      requestedNodeId &&
      !shareResponse.targets.some((target) => target.node_id === requestedNodeId)
    ) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: "subscription target not found",
      });
      return;
    }

    const body = buildSubscriptionContent(shareResponse.targets, requestedNodeId);
    if (request.method === "HEAD") {
      reply.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
      });
      reply.end();
      return;
    }

    textResponse(reply, 200, "text/plain", body);
    return;
  }

  const singBoxArtifactMatch = url.pathname.match(
    /^\/api\/v1\/artifacts\/sing-box\/([^/]+)\/([^/]+)$/,
  );
  if (request.method === "GET" && singBoxArtifactMatch) {
    try {
      const version = decodeURIComponent(singBoxArtifactMatch[1]);
      const target = decodeURIComponent(singBoxArtifactMatch[2]);

      if (!supportedSingBoxTargets.includes(target)) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "unsupported sing-box target",
        });
        return;
      }

      const filePath = singBoxArtifactFilePath(version, target);
      await sendBinaryFile(reply, filePath, "application/gzip", path.basename(filePath));
    } catch (error) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: error instanceof Error ? error.message : "artifact not found",
      });
    }
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const served = await servePublicAsset(reply, url.pathname, {
      publicDir,
      readFile,
      stat,
      textResponse:
        request.method === "HEAD"
          ? (headReply, statusCode, contentType) => {
              headReply.writeHead(statusCode, {
                "content-type": `${contentType}; charset=utf-8`,
              });
              headReply.end();
            }
          : textResponse,
    });
    if (served) {
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/v1/platform-context") {
    jsonResponse(reply, 200, await buildPlatformContext(url));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/platform/sing-box-distribution") {
    jsonResponse(reply, 200, {
      sing_box_distribution: (await buildPlatformContext(url)).sing_box_distribution,
    });
    return;
  }

  if (request.method === "PATCH" && url.pathname === "/api/v1/platform/sing-box-distribution") {
    try {
      const payload = await readJsonBody(request);
      const mappedPayload = {
        ...(hasOwn(payload, "enabled") ? { enabled: payload.enabled } : {}),
        ...(hasOwn(payload, "version")
          ? { version: payload.version }
          : hasOwn(payload, "default_version")
            ? { version: payload.default_version }
            : {}),
        ...(hasOwn(payload, "install_path") ? { install_path: payload.install_path } : {}),
        ...(hasOwn(payload, "variants") ? { variants: payload.variants } : {}),
      };
      const errors = validatePlatformSingBoxDistributionUpdate(mappedPayload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      await updatePlatformSingBoxDistribution(mappedPayload);
      jsonResponse(reply, 200, {
        message: "sing-box 分发配置已更新。",
        platform_context: await buildPlatformContext(url),
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (
    request.method === "POST" &&
    ["/api/v1/platform/sing-box-distribution/mirror", "/api/v1/platform/sing-box-distribution/sync"].includes(
      url.pathname,
    )
  ) {
    try {
      const payload = await readJsonBody(request);
      if (hasOwn(payload, "target")) {
        const errors = validatePlatformSingBoxMirrorRequest(payload);
        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }
      }

      const distribution = buildPublishDistribution(null);
      const targets = hasOwn(payload, "target")
        ? [String(payload.target).trim()]
        : distribution.variants.map((variant) => variant.target);

      if (targets.length === 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: ["no enabled sing-box variants configured"],
        });
        return;
      }

      const results = [];
      for (const target of targets) {
        results.push(await mirrorPlatformSingBoxArtifact(target));
      }

      jsonResponse(reply, 201, {
        message: `已同步 ${results.length} 个 sing-box 镜像。`,
        results,
        platform_context: await buildPlatformContext(url),
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/platform/ssh-key/generate") {
    try {
      await generateManagedPlatformSshKey();
      jsonResponse(reply, 201, {
        message: "平台 SSH 密钥已生成，新的 bootstrap 将自动注入这把公钥。",
        platform_context: await buildPlatformContext(url),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      jsonResponse(reply, message.includes("已存在") ? 409 : 400, {
        error: "bad_request",
        message,
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/nodes") {
    await reconcileTaskStoreFromOperations();
    jsonResponse(reply, 200, {
      items: [...nodeStore.values()].sort((a, b) =>
        String(b.registered_at).localeCompare(String(a.registered_at))
      ),
    });
    return;
  }

  const nodeMatch = url.pathname.match(/^\/api\/v1\/nodes\/([^/]+)$/);
  if (request.method === "DELETE" && nodeMatch) {
    try {
      const nodeId = decodeURIComponent(nodeMatch[1]);
      const existingNode = nodeStore.get(nodeId);

      if (!existingNode) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "node not found",
        });
        return;
      }

      nodeStore.delete(nodeId);
      if (existingNode.fingerprint) {
        fingerprintIndex.delete(existingNode.fingerprint);
      }

      const relayReferenceUpdated = detachRelayNodeReferences(nodeId, existingNode);
      const tasksPruned = pruneTasksForNode(nodeId);
      const probesPruned = pruneProbesForNode(nodeId);
      const operationsPruned = pruneOperationsForNode(nodeId);
      const nodeGroupsUpdated = pruneNodeFromGroups(nodeId);
      closeShellSessionsForNode(nodeId);

      let tokenChanged = false;
      for (const token of bootstrapTokenStore.values()) {
        if (token?.last_used_node_id === nodeId) {
          token.last_used_node_id = null;
          tokenChanged = true;
        }
      }

      await Promise.all([
        persistNodeStore(),
        nodeGroupsUpdated ? persistNodeGroupStore() : Promise.resolve(),
        tasksPruned ? persistTaskStore() : Promise.resolve(),
        probesPruned ? persistProbeStore() : Promise.resolve(),
        operationsPruned ? persistOperationStore() : Promise.resolve(),
        tokenChanged ? persistBootstrapTokens() : Promise.resolve(),
      ]);

      jsonResponse(reply, 200, {
        ok: true,
        deleted_node_id: nodeId,
        summary: {
          relay_reference_updated: relayReferenceUpdated,
          node_groups_updated: nodeGroupsUpdated,
          tasks_pruned: tasksPruned,
          probes_pruned: probesPruned,
          operations_pruned: operationsPruned,
        },
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/tasks") {
    await reconcileTaskStoreFromOperations();
    jsonResponse(reply, 200, {
      items: sortTasks(taskStore),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/probes") {
    const nodeId = normalizeNullableString(url.searchParams.get("node_id"));
    const items = nodeId ? listNodeProbes(nodeId) : sortProbes(probeStore);
    jsonResponse(reply, 200, {
      items,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/bootstrap-tokens") {
    const items = [...bootstrapTokenStore.values()].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
    );
    jsonResponse(reply, 200, {
      items: items.map(serializeBootstrapToken),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/bootstrap-tokens") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateBootstrapTokenCreate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const tokenRecord = buildBootstrapTokenRecord(payload);
      registerBootstrapToken(tokenRecord);
      await persistBootstrapTokens();

      jsonResponse(reply, 201, {
        token: serializeBootstrapToken(tokenRecord),
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  const bootstrapTokenMatch = url.pathname.match(/^\/api\/v1\/bootstrap-tokens\/([^/]+)$/);
  if (bootstrapTokenMatch && request.method === "PATCH") {
    try {
      const tokenId = decodeURIComponent(bootstrapTokenMatch[1]);
      const existingToken = bootstrapTokenStore.get(tokenId);

      if (!existingToken) {
        jsonResponse(reply, 404, {
          error: "not_found",
        });
        return;
      }

      const payload = await readJsonBody(request);
      const errors = validateBootstrapTokenUpdate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const updatedToken = buildBootstrapTokenRecord(payload, existingToken);
      registerBootstrapToken(updatedToken);
      await persistBootstrapTokens();

      jsonResponse(reply, 200, {
        token: serializeBootstrapToken(updatedToken),
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/access-users") {
    jsonResponse(reply, 200, {
      items: sortByUpdatedAt(accessUserStore).map(serializeAccessUser),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/access-users") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateAccessUserCreate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const profileId = hasOwn(payload, "profile_id") ? normalizeNullableString(payload.profile_id) : null;
      const groupIds = hasOwn(payload, "node_group_ids") ? uniqueStringList(payload.node_group_ids) : [];
      const protocol = normalizeNullableString(payload.protocol)?.toLowerCase() ?? "vless";
      const details = [];

      validateAccessUserProfileLink({ protocol, profileId, details });

      const missingGroupIds = missingIds(groupIds, findNodeGroupById);
      if (missingGroupIds.length > 0) {
        details.push(`unknown node group ids: ${missingGroupIds.join(", ")}`);
      }

      if (details.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details,
        });
        return;
      }

      const accessUser = buildAccessUserRecord(payload);
      accessUserStore.unshift(accessUser);
      await persistAccessUserStore();

      jsonResponse(reply, 201, {
        access_user: serializeAccessUser(accessUser),
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  const accessUserShareMatch = url.pathname.match(/^\/api\/v1\/access-users\/([^/]+)\/share$/);
  if (accessUserShareMatch && request.method === "GET") {
    const accessUserId = safeDecodePathSegment(accessUserShareMatch[1]);
    if (!accessUserId) {
      jsonResponse(reply, 400, {
        error: "invalid_request",
        message: "invalid access user id",
      });
      return;
    }
    const existingAccessUser = findAccessUserById(accessUserId);

    if (!existingAccessUser) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: "access user not found",
      });
      return;
    }

    const response = await buildAccessUserShareResponse({
      accessUser: existingAccessUser,
      nodes: [...nodeStore.values()],
      operations: operationStore,
      releases: configReleaseStore,
      requestOrigin: resolveRequestOrigin(url),
    });

    jsonResponse(reply, 200, {
      ...response,
      access_user: serializeAccessUser(response.access_user),
    });
    return;
  }

  const accessUserShareTokenMatch = url.pathname.match(
    /^\/api\/v1\/access-users\/([^/]+)\/share-token\/regenerate$/,
  );
  if (accessUserShareTokenMatch && request.method === "POST") {
    const accessUserId = safeDecodePathSegment(accessUserShareTokenMatch[1]);
    if (!accessUserId) {
      jsonResponse(reply, 400, {
        error: "invalid_request",
        message: "invalid access user id",
      });
      return;
    }
    const existingAccessUser = findAccessUserById(accessUserId);

    if (!existingAccessUser) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: "access user not found",
      });
      return;
    }

    const rotatedAccessUser = rotateAccessUserShareToken(existingAccessUser);
    const index = accessUserStore.findIndex((item) => item.id === accessUserId);
    accessUserStore[index] = rotatedAccessUser;
    await persistAccessUserStore();

    jsonResponse(reply, 200, {
      ok: true,
      access_user: serializeAccessUser(rotatedAccessUser),
    });
    return;
  }

  const accessUserMatch = url.pathname.match(/^\/api\/v1\/access-users\/([^/]+)$/);
  if (accessUserMatch && request.method === "PATCH") {
    try {
      const accessUserId = decodeURIComponent(accessUserMatch[1]);
      const existingAccessUser = findAccessUserById(accessUserId);

      if (!existingAccessUser) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "access user not found",
        });
        return;
      }

      const payload = await readJsonBody(request);
      const errors = validateAccessUserUpdate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const details = [];
      if (hasOwn(payload, "profile_id")) {
        const profileId = normalizeNullableString(payload.profile_id);
        const protocol =
          normalizeNullableString(payload.protocol ?? existingAccessUser.protocol)?.toLowerCase() ??
          "vless";
        validateAccessUserProfileLink({ protocol, profileId, details });
      } else if (hasOwn(payload, "protocol")) {
        validateAccessUserProfileLink({
          protocol: normalizeNullableString(payload.protocol)?.toLowerCase() ?? "vless",
          profileId: existingAccessUser.profile_id,
          details,
        });
      }

      if (hasOwn(payload, "node_group_ids")) {
        const missingGroupIds = missingIds(uniqueStringList(payload.node_group_ids), findNodeGroupById);
        if (missingGroupIds.length > 0) {
          details.push(`unknown node group ids: ${missingGroupIds.join(", ")}`);
        }
      }

      if (details.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details,
        });
        return;
      }

      const updatedAccessUser = buildAccessUserRecord(payload, existingAccessUser);
      const index = accessUserStore.findIndex((item) => item.id === accessUserId);
      accessUserStore[index] = updatedAccessUser;
      await persistAccessUserStore();

      jsonResponse(reply, 200, {
        access_user: serializeAccessUser(updatedAccessUser),
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (accessUserMatch && request.method === "DELETE") {
    const accessUserId = decodeURIComponent(accessUserMatch[1]);
    const existingAccessUser = findAccessUserById(accessUserId);

    if (!existingAccessUser) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: "access user not found",
      });
      return;
    }

    const referencedRelease = configReleaseStore.find((release) =>
      Array.isArray(release.access_user_ids) && release.access_user_ids.includes(accessUserId),
    );
    if (referencedRelease) {
      jsonResponse(reply, 409, {
        error: "conflict",
        message: `access user is referenced by release ${referencedRelease.id}`,
      });
      return;
    }

    const nextAccessUsers = accessUserStore.filter((item) => item.id !== accessUserId);
    accessUserStore.length = 0;
    accessUserStore.push(...nextAccessUsers);
    await persistAccessUserStore();

    jsonResponse(reply, 200, {
      ok: true,
      deleted_access_user_id: accessUserId,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/system-templates") {
    jsonResponse(reply, 200, {
      items: sortByUpdatedAt(systemTemplateStore),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/system-templates") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateSystemTemplateCreate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const groupIds = hasOwn(payload, "node_group_ids") ? uniqueStringList(payload.node_group_ids) : [];
      const missingGroupIds = missingIds(groupIds, findNodeGroupById);
      if (missingGroupIds.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: [`unknown node group ids: ${missingGroupIds.join(", ")}`],
        });
        return;
      }

      const template = buildSystemTemplateRecord(payload);
      systemTemplateStore.unshift(template);
      await persistSystemTemplateStore();

      jsonResponse(reply, 201, {
        system_template: template,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  const systemTemplateMatch = url.pathname.match(/^\/api\/v1\/system-templates\/([^/]+)$/);
  if (systemTemplateMatch && request.method === "PATCH") {
    try {
      const templateId = decodeURIComponent(systemTemplateMatch[1]);
      const existingTemplate = findSystemTemplateById(templateId);

      if (!existingTemplate) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "system template not found",
        });
        return;
      }

      const payload = await readJsonBody(request);
      const errors = validateSystemTemplateUpdate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      if (hasOwn(payload, "node_group_ids")) {
        const missingGroupIds = missingIds(uniqueStringList(payload.node_group_ids), findNodeGroupById);
        if (missingGroupIds.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: [`unknown node group ids: ${missingGroupIds.join(", ")}`],
          });
          return;
        }
      }

      const updatedTemplate = buildSystemTemplateRecord(payload, existingTemplate);
      const index = systemTemplateStore.findIndex((item) => item.id === templateId);
      systemTemplateStore[index] = updatedTemplate;
      await persistSystemTemplateStore();

      jsonResponse(reply, 200, {
        system_template: updatedTemplate,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (systemTemplateMatch && request.method === "DELETE") {
    const templateId = decodeURIComponent(systemTemplateMatch[1]);
    const existingTemplate = findSystemTemplateById(templateId);

    if (!existingTemplate) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: "system template not found",
      });
      return;
    }

    const referencedRelease = systemTemplateReleaseStore.find((release) => release.template_id === templateId);
    if (referencedRelease) {
      jsonResponse(reply, 409, {
        error: "conflict",
        message: `system template is referenced by release ${referencedRelease.id}`,
      });
      return;
    }

    const nextTemplates = systemTemplateStore.filter((item) => item.id !== templateId);
    systemTemplateStore.length = 0;
    systemTemplateStore.push(...nextTemplates);
    await persistSystemTemplateStore();

    jsonResponse(reply, 200, {
      ok: true,
      deleted_system_template_id: templateId,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/system-template-releases") {
    jsonResponse(reply, 200, {
      items: sortByUpdatedAt(systemTemplateReleaseStore),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/system-templates/apply") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateSystemTemplateApply(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const result = await executeSystemTemplateApply(payload);
      jsonResponse(reply, 201, {
        release: result.release,
        operation: result.operation,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/system-users") {
    jsonResponse(reply, 200, {
      items: sortByUpdatedAt(systemUserStore),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/system-users") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateSystemUserCreate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const groupIds = hasOwn(payload, "node_group_ids") ? uniqueStringList(payload.node_group_ids) : [];
      const missingGroupIds = missingIds(groupIds, findNodeGroupById);
      if (missingGroupIds.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: [`unknown node group ids: ${missingGroupIds.join(", ")}`],
        });
        return;
      }

      const systemUser = buildSystemUserRecord(payload);
      const conflictMessages = collectSystemUserConflictMessages(systemUser);
      if (conflictMessages.length > 0) {
        jsonResponse(reply, 409, {
          error: "conflict",
          details: conflictMessages,
          message: conflictMessages[0],
        });
        return;
      }

      systemUserStore.unshift(systemUser);
      await persistSystemUserStore();

      jsonResponse(reply, 201, {
        system_user: systemUser,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  const systemUserMatch = url.pathname.match(/^\/api\/v1\/system-users\/([^/]+)$/);
  if (systemUserMatch && request.method === "PATCH") {
    try {
      const systemUserId = decodeURIComponent(systemUserMatch[1]);
      const existingSystemUser = findSystemUserById(systemUserId);

      if (!existingSystemUser) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "system user not found",
        });
        return;
      }

      const payload = await readJsonBody(request);
      const errors = validateSystemUserUpdate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      if (hasOwn(payload, "node_group_ids")) {
        const missingGroupIds = missingIds(uniqueStringList(payload.node_group_ids), findNodeGroupById);
        if (missingGroupIds.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: [`unknown node group ids: ${missingGroupIds.join(", ")}`],
          });
          return;
        }
      }

      const updatedSystemUser = buildSystemUserRecord(payload, existingSystemUser);
      const conflictMessages = collectSystemUserConflictMessages(updatedSystemUser, {
        excludeId: existingSystemUser.id,
      });
      if (conflictMessages.length > 0) {
        jsonResponse(reply, 409, {
          error: "conflict",
          details: conflictMessages,
          message: conflictMessages[0],
        });
        return;
      }

      const index = systemUserStore.findIndex((item) => item.id === systemUserId);
      systemUserStore[index] = updatedSystemUser;
      await persistSystemUserStore();

      jsonResponse(reply, 200, {
        system_user: updatedSystemUser,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (systemUserMatch && request.method === "DELETE") {
    const systemUserId = decodeURIComponent(systemUserMatch[1]);
    const existingSystemUser = findSystemUserById(systemUserId);

    if (!existingSystemUser) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: "system user not found",
      });
      return;
    }

    const referencedRelease = systemUserReleaseStore.find((release) =>
      Array.isArray(release.system_user_ids) && release.system_user_ids.includes(systemUserId),
    );
    if (referencedRelease) {
      jsonResponse(reply, 409, {
        error: "conflict",
        message: `system user is referenced by release ${referencedRelease.id}`,
      });
      return;
    }

    const nextSystemUsers = systemUserStore.filter((item) => item.id !== systemUserId);
    systemUserStore.length = 0;
    systemUserStore.push(...nextSystemUsers);
    await persistSystemUserStore();

    jsonResponse(reply, 200, {
      ok: true,
      deleted_system_user_id: systemUserId,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/system-user-releases") {
    jsonResponse(reply, 200, {
      items: sortByUpdatedAt(systemUserReleaseStore),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/system-users/apply") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateSystemUserApply(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const result = await executeSystemUserApply(payload);
      jsonResponse(reply, 201, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      jsonResponse(reply, 400, {
        error: "bad_request",
        message,
        ...(Array.isArray(error?.details) ? { details: error.details } : {}),
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/proxy-profiles") {
    jsonResponse(reply, 200, {
      items: sortByUpdatedAt(proxyProfileStore),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/proxy-profiles") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateProxyProfileCreate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const profile = buildProxyProfileRecord(payload);
      proxyProfileStore.unshift(profile);
      await persistProxyProfileStore();

      jsonResponse(reply, 201, {
        profile,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  const proxyProfileMatch = url.pathname.match(/^\/api\/v1\/proxy-profiles\/([^/]+)$/);
  if (proxyProfileMatch && request.method === "PATCH") {
    try {
      const profileId = decodeURIComponent(proxyProfileMatch[1]);
      const existingProfile = findProxyProfileById(profileId);

      if (!existingProfile) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "profile not found",
        });
        return;
      }

      const payload = await readJsonBody(request);
      const errors = validateProxyProfileUpdate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const updatedProfile = buildProxyProfileRecord(payload, existingProfile);
      const index = proxyProfileStore.findIndex((item) => item.id === profileId);
      proxyProfileStore[index] = updatedProfile;
      await persistProxyProfileStore();

      jsonResponse(reply, 200, {
        profile: updatedProfile,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (proxyProfileMatch && request.method === "DELETE") {
    const profileId = decodeURIComponent(proxyProfileMatch[1]);
    const existingProfile = findProxyProfileById(profileId);

    if (!existingProfile) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: "profile not found",
      });
      return;
    }

    const boundAccessUser = accessUserStore.find((accessUser) => accessUser.profile_id === profileId);
    if (boundAccessUser) {
      jsonResponse(reply, 409, {
        error: "conflict",
        message: `profile is still bound by access user ${boundAccessUser.id}`,
      });
      return;
    }

    const referencedRelease = configReleaseStore.find((release) => release.profile_id === profileId);
    if (referencedRelease) {
      jsonResponse(reply, 409, {
        error: "conflict",
        message: `profile is referenced by release ${referencedRelease.id}`,
      });
      return;
    }

    const nextProfiles = proxyProfileStore.filter((item) => item.id !== profileId);
    proxyProfileStore.length = 0;
    proxyProfileStore.push(...nextProfiles);
    await persistProxyProfileStore();

    jsonResponse(reply, 200, {
      ok: true,
      deleted_profile_id: profileId,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/node-groups") {
    jsonResponse(reply, 200, {
      items: sortByUpdatedAt(nodeGroupStore),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/node-groups") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateNodeGroupCreate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const nodeIds = hasOwn(payload, "node_ids") ? uniqueStringList(payload.node_ids) : [];
      const missingNodeIds = nodeIds.filter((nodeId) => !nodeStore.has(nodeId));
      if (missingNodeIds.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: [`unknown node ids: ${missingNodeIds.join(", ")}`],
        });
        return;
      }

      const group = buildNodeGroupRecord(payload);
      nodeGroupStore.unshift(group);
      await persistNodeGroupStore();

      jsonResponse(reply, 201, {
        group,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  const nodeGroupMatch = url.pathname.match(/^\/api\/v1\/node-groups\/([^/]+)$/);
  if (nodeGroupMatch && request.method === "PATCH") {
    try {
      const groupId = decodeURIComponent(nodeGroupMatch[1]);
      const existingGroup = findNodeGroupById(groupId);

      if (!existingGroup) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "node group not found",
        });
        return;
      }

      const payload = await readJsonBody(request);
      const errors = validateNodeGroupUpdate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      if (hasOwn(payload, "node_ids")) {
        const missingNodeIds = uniqueStringList(payload.node_ids).filter((nodeId) => !nodeStore.has(nodeId));
        if (missingNodeIds.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: [`unknown node ids: ${missingNodeIds.join(", ")}`],
          });
          return;
        }
      }

      const updatedGroup = buildNodeGroupRecord(payload, existingGroup);
      const index = nodeGroupStore.findIndex((item) => item.id === groupId);
      nodeGroupStore[index] = updatedGroup;
      await persistNodeGroupStore();

      jsonResponse(reply, 200, {
        group: updatedGroup,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (nodeGroupMatch && request.method === "DELETE") {
    const groupId = decodeURIComponent(nodeGroupMatch[1]);
    const existingGroup = findNodeGroupById(groupId);

    if (!existingGroup) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: "node group not found",
      });
      return;
    }

    const boundAccessUser = accessUserStore.find((accessUser) =>
      Array.isArray(accessUser.node_group_ids) && accessUser.node_group_ids.includes(groupId),
    );
    if (boundAccessUser) {
      jsonResponse(reply, 409, {
        error: "conflict",
        message: `node group is still bound by access user ${boundAccessUser.id}`,
      });
      return;
    }

    const boundSystemUser = systemUserStore.find((systemUser) =>
      Array.isArray(systemUser.node_group_ids) && systemUser.node_group_ids.includes(groupId),
    );
    if (boundSystemUser) {
      jsonResponse(reply, 409, {
        error: "conflict",
        message: `node group is still bound by system user ${boundSystemUser.id}`,
      });
      return;
    }

    const boundSystemTemplate = systemTemplateStore.find((template) =>
      Array.isArray(template.node_group_ids) && template.node_group_ids.includes(groupId),
    );
    if (boundSystemTemplate) {
      jsonResponse(reply, 409, {
        error: "conflict",
        message: `node group is still bound by system template ${boundSystemTemplate.id}`,
      });
      return;
    }

    const referencedRelease = configReleaseStore.find((release) =>
      Array.isArray(release.node_group_ids) && release.node_group_ids.includes(groupId),
    );
    if (referencedRelease) {
      jsonResponse(reply, 409, {
        error: "conflict",
        message: `node group is referenced by release ${referencedRelease.id}`,
      });
      return;
    }

    const referencedSystemUserRelease = systemUserReleaseStore.find((release) =>
      Array.isArray(release.node_group_ids) && release.node_group_ids.includes(groupId),
    );
    if (referencedSystemUserRelease) {
      jsonResponse(reply, 409, {
        error: "conflict",
        message: `node group is referenced by system user release ${referencedSystemUserRelease.id}`,
      });
      return;
    }

    const referencedSystemTemplateRelease = systemTemplateReleaseStore.find((release) =>
      Array.isArray(release.node_group_ids) && release.node_group_ids.includes(groupId),
    );
    if (referencedSystemTemplateRelease) {
      jsonResponse(reply, 409, {
        error: "conflict",
        message: `node group is referenced by system template release ${referencedSystemTemplateRelease.id}`,
      });
      return;
    }

    const nextGroups = nodeGroupStore.filter((item) => item.id !== groupId);
    nodeGroupStore.length = 0;
    nodeGroupStore.push(...nextGroups);
    await persistNodeGroupStore();

    jsonResponse(reply, 200, {
      ok: true,
      deleted_group_id: groupId,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/providers") {
    jsonResponse(reply, 200, {
      items: sortByUpdatedAt(providerStore),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/providers") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateProviderCreate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const duplicateProvider = findProviderByName(payload.name);
      if (duplicateProvider) {
        jsonResponse(reply, 409, {
          error: "conflict",
          message: `provider name already exists: ${duplicateProvider.name}`,
        });
        return;
      }

      const provider = buildProviderRecord(payload);
      providerStore.unshift(provider);
      await persistProviderStore();

      jsonResponse(reply, 201, {
        provider,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  const providerMatch = url.pathname.match(/^\/api\/v1\/providers\/([^/]+)$/);
  if (providerMatch && request.method === "PATCH") {
    try {
      const providerId = decodeURIComponent(providerMatch[1]);
      const existingProvider = findProviderById(providerId);

      if (!existingProvider) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "provider not found",
        });
        return;
      }

      const payload = await readJsonBody(request);
      const errors = validateProviderUpdate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      if (hasOwn(payload, "name")) {
        const duplicateProvider = findProviderByName(payload.name, {
          excludeId: providerId,
        });
        if (duplicateProvider) {
          jsonResponse(reply, 409, {
            error: "conflict",
            message: `provider name already exists: ${duplicateProvider.name}`,
          });
          return;
        }
      }

      const updatedProvider = buildProviderRecord(payload, existingProvider);
      const index = providerStore.findIndex((item) => item.id === providerId);
      providerStore[index] = updatedProvider;
      await persistProviderStore();

      jsonResponse(reply, 200, {
        provider: updatedProvider,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (providerMatch && request.method === "DELETE") {
    const providerId = decodeURIComponent(providerMatch[1]);
    const existingProvider = findProviderById(providerId);

    if (!existingProvider) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: "provider not found",
      });
      return;
    }

    const nextProviders = providerStore.filter((item) => item.id !== providerId);
    providerStore.length = 0;
    providerStore.push(...nextProviders);
    await persistProviderStore();

    jsonResponse(reply, 200, {
      ok: true,
      deleted_provider_id: providerId,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/config-releases") {
    jsonResponse(reply, 200, {
      items: sortByUpdatedAt(configReleaseStore),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/config-releases") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateConfigReleaseCreate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const platformContext = await buildPlatformContext(url);
      const result = await executeConfigRelease(payload, {
        platformBaseUrl: platformContext.bootstrap_base_url,
      });
      jsonResponse(reply, 201, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      jsonResponse(reply, 400, {
        error: "bad_request",
        message,
        ...(Array.isArray(error?.details) ? { details: error.details } : {}),
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/operations") {
    jsonResponse(reply, 200, {
      items: [...operationStore].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at))
      ),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/operations/execute") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateOperationRequest(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const missingNodes = payload.node_ids.filter((nodeId) => !nodeStore.has(nodeId));
      if (missingNodes.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: [`unknown node ids: ${missingNodes.join(", ")}`],
        });
        return;
      }

      const operation = await buildOperationRecord(payload);
      pushOperationRecord(operation);
      await persistOperationStore();

      jsonResponse(reply, 201, {
        operation,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  const taskBootstrapCompleteMatch = url.pathname.match(
    /^\/api\/v1\/tasks\/([^/]+)\/bootstrap-complete$/,
  );
  if (taskBootstrapCompleteMatch && request.method === "POST") {
    try {
      const taskId = decodeURIComponent(taskBootstrapCompleteMatch[1]);
      const task = taskStore.find((item) => item.id === taskId);

      if (!task) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "task not found",
        });
        return;
      }

      if (task.type !== "init_alpine") {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: ["task is not bootstrap-initializable"],
        });
        return;
      }

      const node = nodeStore.get(task.node_id);
      if (!node) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "node not found",
        });
        return;
      }

      const payload = await readJsonBody(request);
      const tokenValue =
        typeof payload.bootstrap_token === "string"
          ? payload.bootstrap_token.trim()
          : String(payload.bootstrap_token ?? "");
      const bootstrapToken = findBootstrapTokenByValue(tokenValue);
      const tokenErrorInfo = bootstrapTokenError(bootstrapToken);

      if (tokenErrorInfo) {
        jsonResponse(reply, 403, {
          error: tokenErrorInfo.code,
          message: tokenErrorInfo.message,
        });
        return;
      }

      if (node.bootstrap_token_id && bootstrapToken?.id !== node.bootstrap_token_id) {
        jsonResponse(reply, 403, {
          error: "bootstrap_token_mismatch",
          message: "bootstrap token 与当前节点不匹配",
        });
        return;
      }

      await reconcileTaskStoreFromOperations();
      const freshTask = taskStore.find((item) => item.id === taskId) || task;
      const freshNode = nodeStore.get(freshTask.node_id) || node;

      if (freshTask.status === "running") {
        const probeState = bootstrapAutoProbeState(freshNode, freshTask.id);
        jsonResponse(reply, 200, {
          task: freshTask,
          node: freshNode,
          operation: freshTask.operation_id
            ? operationStore.find((item) => item.id === freshTask.operation_id) || null
            : null,
          probe_task: probeState.task,
          probe: probeState.probe,
          probe_summary: probeState.summary,
          transport: probeState.transport,
          capability: probeState.capability,
        });
        return;
      }

      const existingOperation = freshTask.operation_id
        ? operationStore.find((item) => item.id === freshTask.operation_id) || null
        : null;
      const result =
        freshTask.status === "success"
          ? {
              task: freshTask,
              node: freshNode,
              operation: existingOperation,
            }
          : await executeBootstrapInitTask(freshTask, payload);
      const initTaskStatus = String(result.task?.status || freshTask.status || "new").toLowerCase();
      const canAutoProbe = initTaskStatus === "success" && result.skipped !== true;
      const existingProbeState = bootstrapAutoProbeState(
        result.node ?? freshNode,
        (result.task ?? freshTask).id,
      );
      const probeState = canAutoProbe
        ? await ensureBootstrapAutoProbe(result.node ?? freshNode, result.task ?? freshTask, {
            note: "节点已完成 bootstrap 回报，控制面开始执行首轮自动探测。",
          })
        : {
            ...existingProbeState,
            summary:
              existingProbeState.summary ??
              (result.skipped
                ? "初始化尚未真正执行完成，本次未触发自动首探。"
                : "初始化未成功，本次未触发自动首探。"),
          };
      const responseNode = probeState.node ?? result.node ?? nodeStore.get(freshNode.id) ?? freshNode;

      jsonResponse(reply, 200, {
        task: result.task,
        node: responseNode,
        operation: result.operation,
        probe_task: probeState.task,
        probe: probeState.probe,
        probe_summary: probeState.summary,
        transport: probeState.transport,
        capability: probeState.capability,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/shell/sessions") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateShellSessionCreate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const node = nodeStore.get(payload.node_id);
      if (!node) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "node not found",
        });
        return;
      }

      const session = await createShellSession(node);
      jsonResponse(reply, 201, {
        session: serializeShellSession(session),
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  const shellSessionMatch = url.pathname.match(/^\/api\/v1\/shell\/sessions\/([^/]+)$/);
  if (shellSessionMatch && request.method === "GET") {
    const sessionId = decodeURIComponent(shellSessionMatch[1]);
    const session = shellSessionStore.get(sessionId);

    if (!session) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: "shell session not found",
      });
      return;
    }

    jsonResponse(reply, 200, {
      session: serializeShellSession(session),
    });
    return;
  }

  if (shellSessionMatch && request.method === "DELETE") {
    const sessionId = decodeURIComponent(shellSessionMatch[1]);
    const session = shellSessionStore.get(sessionId);

    if (!session) {
      jsonResponse(reply, 404, {
        error: "not_found",
        message: "shell session not found",
      });
      return;
    }

    closeShellSession(session);
    jsonResponse(reply, 200, {
      session: serializeShellSession(session),
    });
    return;
  }

  const shellInputMatch = url.pathname.match(/^\/api\/v1\/shell\/sessions\/([^/]+)\/input$/);
  if (shellInputMatch && request.method === "POST") {
    try {
      const sessionId = decodeURIComponent(shellInputMatch[1]);
      const session = shellSessionStore.get(sessionId);

      if (!session) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "shell session not found",
        });
        return;
      }

      const payload = await readJsonBody(request);
      const errors = validateShellSessionInput(payload);
      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      if (!session.process || session.status !== "open" || session.process.killed) {
        jsonResponse(reply, 409, {
          error: "session_not_writable",
          message: "shell session is not writable",
        });
        return;
      }

      session.process.stdin.write(payload.data);
      session.updated_at = nowIso();

      jsonResponse(reply, 200, {
        session: serializeShellSession(session),
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  const nodeAssetsMatch = url.pathname.match(/^\/api\/v1\/nodes\/([^/]+)\/assets$/);
  if (request.method === "PATCH" && nodeAssetsMatch) {
    try {
      const nodeId = decodeURIComponent(nodeAssetsMatch[1]);
      const existingNode = nodeStore.get(nodeId);

      if (!existingNode) {
        jsonResponse(reply, 404, {
          error: "not_found",
        });
        return;
      }

      const payload = await readJsonBody(request);
      const errors = validateAssetUpdate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const updatedNode = updateNodeAssetRecord(existingNode, payload);
      nodeStore.set(updatedNode.id, updatedNode);
      await persistNodeStore();

      jsonResponse(reply, 200, {
        node: updatedNode,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  const nodeInitMatch = url.pathname.match(/^\/api\/v1\/nodes\/([^/]+)\/init$/);
  if (request.method === "POST" && nodeInitMatch) {
    try {
      await reconcileTaskStoreFromOperations();
      const nodeId = decodeURIComponent(nodeInitMatch[1]);
      const node = nodeStore.get(nodeId);

      if (!node) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "node not found",
        });
        return;
      }

      const payload = await readJsonBody(request);
      const requestedTemplateName =
        typeof payload.template === "string" && payload.template.trim()
          ? payload.template.trim()
          : "alpine-base";
      const requestedSystemTemplateId =
        typeof payload.system_template_id === "string" && payload.system_template_id.trim()
          ? payload.system_template_id.trim()
          : requestedTemplateName.startsWith("system-template:")
            ? requestedTemplateName.slice("system-template:".length).trim() || null
            : null;
      const requestedTemplateSnapshot =
        payload.template_snapshot && typeof payload.template_snapshot === "object"
          ? payload.template_snapshot
          : null;

      if (
        requestedSystemTemplateId &&
        !findSystemTemplateById(requestedSystemTemplateId) &&
        !requestedTemplateSnapshot
      ) {
        throw new Error(`unknown system template id: ${requestedSystemTemplateId}`);
      }

      const latestTask = latestNodeTask(node.id, "init_alpine");
      const task = ensureNodeInitTask(node, {
        ...(requestedSystemTemplateId
          ? {
              system_template_id: requestedSystemTemplateId,
              template_snapshot: requestedTemplateSnapshot,
            }
          : {
              template: requestedTemplateName,
            }),
        trigger: "manual_retry",
        force_new: latestTask ? String(latestTask.status || "").toLowerCase() === "success" : false,
        note: "已由控制台手动触发初始化任务。",
        reason: "manual_retry",
      });
      const result = await executeInitTask(task, {
        note: "已由控制台手动触发，控制面开始执行初始化模板。",
      });

      jsonResponse(reply, 201, {
        task: result.task,
        node: result.node,
        operation: result.operation,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  const nodeProbeMatch = url.pathname.match(/^\/api\/v1\/nodes\/([^/]+)\/probe$/);
  if (request.method === "POST" && nodeProbeMatch) {
    try {
      const nodeId = decodeURIComponent(nodeProbeMatch[1]);
      const node = nodeStore.get(nodeId);

      if (!node) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "node not found",
        });
        return;
      }

      const payload = await readJsonBody(request);
      const requestedProbeType =
        typeof payload.probe_type === "string" && payload.probe_type.trim()
          ? payload.probe_type.trim().toLowerCase()
          : "full_stack";
      const allowedProbeTypes = new Set([
        "ssh_auth",
        "business_entry_tcp",
        "relay_upstream_tcp",
        "full_stack",
      ]);
      const probeType = allowedProbeTypes.has(requestedProbeType)
        ? requestedProbeType
        : "full_stack";
      const task = buildProbeTask(node, {
        trigger: "manual_probe",
        reason: "manual_probe",
        probe_type: probeType,
      });
      upsertTaskRecord(task);
      await persistTaskStore();

      const result = await executeProbeTask(task, {
        note:
          probeType === "business_entry_tcp"
            ? "已由控制台手动触发，控制面开始验证业务入口 TCP 可达性。"
            : probeType === "relay_upstream_tcp"
              ? "已由控制台手动触发，控制面开始验证入口到落地上游链路。"
              : probeType === "ssh_auth"
                ? "已由控制台手动触发，控制面开始验证 SSH 接管链路。"
                : "已由控制台手动触发，控制面开始执行综合巡检，校验管理链路、业务入口与 relay 上游状态。",
      });

      jsonResponse(reply, 201, {
        task: result.task,
        node: result.node,
        probe: result.probe,
        transport: result.transport,
        summary: result.probe?.summary ?? result.task?.note ?? null,
        capability: result.capability,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/nodes/manual") {
    try {
      const payload = await readJsonBody(request);
      const errors = validateManualNode(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const node = buildManualNodeRecord(payload);
      nodeStore.set(node.id, node);
      if (node.fingerprint) {
        fingerprintIndex.set(node.fingerprint, node.id);
      }
      await persistNodeStore();

      jsonResponse(reply, 201, {
        node,
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/nodes/register") {
    try {
      const payload = await readJsonBody(request);
      if (!payload.facts || typeof payload.facts !== "object") {
        payload.facts = {};
      }
      payload.facts = normalizeNodeFacts(payload.facts, {
        remoteAddress: extractRemoteAddress(request),
        existingFacts: null,
      });

      const errors = validateRegistration(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const tokenValue =
        typeof payload.bootstrap_token === "string"
          ? payload.bootstrap_token.trim()
          : String(payload.bootstrap_token ?? "");
      const bootstrapToken = findBootstrapTokenByValue(tokenValue);
      const tokenErrorInfo = bootstrapTokenError(bootstrapToken);
      if (tokenErrorInfo) {
        jsonResponse(reply, 403, {
          error: tokenErrorInfo.code,
          message: tokenErrorInfo.message,
        });
        return;
      }

      const existingNode = findExistingBootstrapNode(payload);
      const node = buildNodeRecord(payload, existingNode);
      node.bootstrap_token_id = bootstrapToken?.id ?? node.bootstrap_token_id ?? null;
      nodeStore.set(node.id, node);
      if (existingNode?.fingerprint && existingNode.fingerprint !== payload.fingerprint) {
        fingerprintIndex.delete(existingNode.fingerprint);
      }
      fingerprintIndex.set(payload.fingerprint, node.id);
      recordBootstrapTokenUsage(bootstrapToken, node.id);

      const nodeStatus = String(node.status || "new").toLowerCase();
      const initTask =
        nodeStatus === "active"
          ? latestNodeTask(node.id, "init_alpine")
          : ensureNodeInitTask(node, {
              template: "alpine-base",
              trigger: existingNode ? "bootstrap_refresh" : "bootstrap_register",
              reason: existingNode ? "bootstrap_refresh" : "bootstrap_register",
            });
      const scheduleInitTask = nodeStatus === "active" ? null : initTask;
      const platformKeyState = await platformSshKeyState();

      await Promise.all([persistNodeStore(), persistBootstrapTokens(), persistTaskStore()]);

      jsonResponse(reply, 200, {
        node: {
          id: node.id,
          status: node.status,
          registered_at: node.registered_at,
          last_seen_at: node.last_seen_at,
          bootstrap_token_id: node.bootstrap_token_id,
        },
        bootstrap: {
          init_task_id: scheduleInitTask?.id ?? null,
          init_template: scheduleInitTask?.template ?? null,
        },
        actions: [
          ...(platformKeyState.public_key
            ? [
                {
                  type: "install_ssh_key",
                  public_key: platformKeyState.public_key,
                },
              ]
            : []),
          ...(scheduleInitTask
            ? [
                {
                  type: "schedule_init",
                  id: scheduleInitTask.id,
                  template: scheduleInitTask.template || "alpine-base",
                },
              ]
            : []),
        ],
      });
    } catch (error) {
      jsonResponse(reply, 400, {
        error: "bad_request",
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
    return;
  }

  jsonResponse(reply, 404, {
    error: "not_found",
  });
});

const { start } = createServerStartupRuntime({
  ensureNodeManagementMigration,
  ensureBootstrapInitTasks,
  listen: () => {
    server.listen(port, () => {
      console.log(`airport-control-plane listening on http://localhost:${port}`);
    });
  },
  startProbeScheduler,
  loadAccessUserStore: async () => {
    await loadAccessUserStore();
    await ensureAccessUserShareTokens();
  },
  loadBootstrapTokens,
  loadConfigReleaseStore,
  loadNodeStore,
  loadNodeGroupStore,
  loadOperationStore,
  loadPlatformSingBoxDistribution,
  loadProviderStore,
  loadProbeStore,
  loadProxyProfileStore,
  loadSystemTemplateReleaseStore,
  loadSystemTemplateStore,
  loadSystemUserReleaseStore,
  loadSystemUserStore,
  loadTaskStore,
  ensureDefaultSystemTemplates,
  reconcileTaskStoreFromOperations,
});

start().catch((error) => {
  console.error("failed to start airport-control-plane", error);
  process.exitCode = 1;
});
