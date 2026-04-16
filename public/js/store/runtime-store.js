import {
  getEffectiveTokenStatus,
  normalizeBaseUrl,
  sortBootstrapTokens,
} from "../shared/core-formatters.js";

const browserOrigin =
  typeof window !== "undefined" && window.location ? window.location.origin : "";

const defaultSshKeyState = Object.freeze({
  status: "missing",
  available: false,
  bootstrap_ready: false,
  source: "missing",
  private_key_path: null,
  public_key: null,
  note: "平台还没有可用 SSH 私钥。",
  can_generate: true,
});

const defaultSingBoxDistributionState = Object.freeze({
  enabled: false,
  mode: "disabled",
  default_version: "",
  mirror_base_url: "",
  auto_sync: false,
  sync_status: "idle",
  last_sync_at: null,
  last_sync_message: "",
  artifact_count: 0,
  supported_platforms: [],
});

function cloneDefaultSshKeyState() {
  return { ...defaultSshKeyState };
}

function cloneDefaultSingBoxDistributionState() {
  return {
    ...defaultSingBoxDistributionState,
    supported_platforms: [],
  };
}

function normalizeDistributionContext(context = {}) {
  const candidate =
    context?.sing_box_distribution ||
    context?.singbox_distribution ||
    context?.distribution?.sing_box ||
    context?.distribution ||
    {};
  return candidate && typeof candidate === "object" ? candidate : {};
}

function createDefaultPlatformState(origin = browserOrigin) {
  return {
    request_origin: origin,
    bootstrap_base_url: origin,
    detected_lan_ipv4: null,
    detected_lan_base_url: null,
    source: "browser",
    ssh_key: cloneDefaultSshKeyState(),
    sing_box_distribution: cloneDefaultSingBoxDistributionState(),
    probe_scheduler: {
      enabled: false,
      running: false,
      interval_ms: 0,
      batch_size: 0,
      min_probe_gap_ms: 0,
      jitter_ms: 0,
      next_run_at: null,
      last_run_at: null,
      last_finished_at: null,
      last_run_summary: null,
      last_error: null,
    },
  };
}

const runtimeStoreHooks = {
  onBootstrapStateChange: null,
};

export const appState = {
  nodes: [],
  tasks: [],
  probes: [],
  diagnostics: [],
  operations: [],
  tokens: [],
  accessUsers: [],
  systemUsers: [],
  systemTemplates: [],
  proxyProfiles: [],
  nodeGroups: [],
  providers: [],
  configReleases: [],
  systemTemplateReleases: [],
  systemUserReleases: [],
  costs: {
    summary: null,
    nodes: [],
    providers: [],
    releases: [],
    accessUsers: [],
  },
  platform: createDefaultPlatformState(),
  assetEditor: {
    targetNodeId: null,
  },
  filters: {
    query: "",
    provider: "",
    region: "",
    renewal: "all",
    expiry: "all",
    source: "all",
    accessMode: "all",
  },
  tokenConsole: {
    lastCreatedToken: null,
  },
  taskCenter: {
    query: "",
    status: "all",
    type: "all",
    onlyActionable: false,
    selectedTaskId: null,
    pendingActionTaskIds: new Set(),
    operationOutputExpanded: false,
    message: null,
  },
  nodeDetail: {
    initTemplateValue: "",
    applyTemplateId: "",
    pendingAction: null,
    message: null,
  },
  terminal: {
    mode: "command",
    title: "",
    command: "apk update && apk add --no-cache curl openssh bash",
    script_name: "Alpine 节点基础初始化（含 sing-box 准备）",
    script_body:
      "#!/bin/sh\nset -eu\n\n# Alpine 轻量节点初始化（可重复执行，含 sing-box best-effort 预装）\nexport PATH=\"/usr/sbin:/usr/bin:/sbin:/bin:${PATH}\"\n\nretry_command() {\n  ATTEMPTS=\"$1\"\n  DELAY_SECONDS=\"$2\"\n  shift 2\n  COUNT=1\n\n  while [ \"$COUNT\" -le \"$ATTEMPTS\" ]; do\n    if \"$@\"; then\n      return 0\n    fi\n\n    if [ \"$COUNT\" -lt \"$ATTEMPTS\" ]; then\n      sleep \"$DELAY_SECONDS\"\n    fi\n\n    COUNT=$((COUNT + 1))\n  done\n\n  return 1\n}\n\nrun_with_timeout() {\n  TIMEOUT_SECONDS=\"$1\"\n  shift\n\n  if command -v timeout >/dev/null 2>&1; then\n    timeout \"$TIMEOUT_SECONDS\" \"$@\"\n    return $?\n  fi\n\n  if command -v busybox >/dev/null 2>&1; then\n    busybox timeout \"$TIMEOUT_SECONDS\" \"$@\"\n    return $?\n  fi\n\n  \"$@\"\n}\n\nensure_sshd_setting() {\n  KEY=\"$1\"\n  VALUE=\"$2\"\n  FILE=/etc/ssh/sshd_config\n\n  if [ ! -f \"$FILE\" ]; then\n    return 0\n  fi\n\n  if grep -Eq \"^[#[:space:]]*$KEY[[:space:]]+\" \"$FILE\"; then\n    sed -i \"s|^[#[:space:]]*$KEY[[:space:]].*|$KEY $VALUE|\" \"$FILE\" || true\n  else\n    printf '%s %s\\n' \"$KEY\" \"$VALUE\" >>\"$FILE\"\n  fi\n}\n\ninstall_sing_box() {\n  if command -v sing-box >/dev/null 2>&1; then\n    echo \"[init] sing-box 已存在，跳过安装\"\n    return 0\n  fi\n\n  if pgrep -x apk >/dev/null 2>&1; then\n    echo \"[init] 检测到 apk 正在运行，暂时跳过 sing-box 自动安装\" >&2\n    return 1\n  fi\n\n  rm -f /lib/apk/db/lock >/dev/null 2>&1 || true\n\n  if run_with_timeout 60 apk add --no-cache sing-box sing-box-openrc >/dev/null 2>&1; then\n    echo \"[init] sing-box 已通过当前镜像安装\"\n    return 0\n  fi\n\n  if run_with_timeout 60 apk add --no-cache sing-box >/dev/null 2>&1; then\n    echo \"[init] sing-box 已通过当前镜像安装\"\n    return 0\n  fi\n\n  REPO_FILE=/tmp/airport-apk-repositories\n  cat >\"$REPO_FILE\" <<'EOF_REPOS'\nhttps://dl-cdn.alpinelinux.org/alpine/v3.22/main\nhttps://dl-cdn.alpinelinux.org/alpine/v3.22/community\nhttps://dl-cdn.alpinelinux.org/alpine/edge/main\nhttps://dl-cdn.alpinelinux.org/alpine/edge/community\nEOF_REPOS\n\n  if ! run_with_timeout 20 apk --repositories-file \"$REPO_FILE\" update >/dev/null 2>&1; then\n    echo \"[init] sing-box 仓库索引刷新失败，继续尝试直接安装\" >&2\n  fi\n\n  if run_with_timeout 60 apk --repositories-file \"$REPO_FILE\" add --no-cache sing-box sing-box-openrc >/dev/null 2>&1; then\n    echo \"[init] sing-box 已通过官方仓库安装\"\n    return 0\n  fi\n\n  if run_with_timeout 60 apk --repositories-file \"$REPO_FILE\" add --no-cache sing-box >/dev/null 2>&1; then\n    echo \"[init] sing-box 已通过官方仓库安装\"\n    return 0\n  fi\n\n  echo \"[init] sing-box 安装失败，已跳过，不阻断整体初始化\" >&2\n  return 1\n}\n\nensure_sing_box_service() {\n  if ! command -v sing-box >/dev/null 2>&1; then\n    return 1\n  fi\n\n  install -d -m 755 /etc/sing-box /var/lib/sing-box /var/log/sing-box\n\n  if [ ! -f /etc/sing-box/config.json ]; then\n    cat >/etc/sing-box/config.json <<'EOF_SINGBOX_CONFIG'\n{\n  \"log\": {\n    \"level\": \"warn\"\n  },\n  \"outbounds\": [\n    {\n      \"type\": \"direct\",\n      \"tag\": \"direct\"\n    }\n  ]\n}\nEOF_SINGBOX_CONFIG\n  fi\n\n  if [ ! -x /etc/init.d/sing-box ]; then\n    SINGBOX_BIN=\"$(command -v sing-box)\"\n    cat >/etc/init.d/sing-box <<EOF_SINGBOX_INIT\n#!/sbin/openrc-run\ndescription=\"sing-box service\"\ncommand=\"$SINGBOX_BIN\"\ncommand_args=\"run -c /etc/sing-box/config.json\"\ncommand_background=\"yes\"\npidfile=\"/run/${RC_SVCNAME}.pid\"\n\ndepend() {\n  need net\n}\nEOF_SINGBOX_INIT\n    chmod 755 /etc/init.d/sing-box\n  fi\n\n  rc-update add sing-box default >/dev/null 2>&1 || true\n  return 0\n}\n\necho \"[init] 开始初始化\"\nif ! retry_command 3 2 apk update; then\n  echo \"[init] apk update 失败，继续尝试使用现有索引安装依赖\" >&2\nfi\nretry_command 3 2 apk add --no-cache bash curl ca-certificates tzdata openssh iproute2 iputils bind-tools\n\n# 基础时区与计划任务\ncp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime || true\necho \"Asia/Shanghai\" > /etc/timezone || true\nrc-update add crond default >/dev/null 2>&1 || true\nrc-service crond start >/dev/null 2>&1 || true\nmkdir -p /run/sshd /var/run/sshd\nssh-keygen -A >/dev/null 2>&1 || true\nensure_sshd_setting \"AllowTcpForwarding\" \"yes\"\nensure_sshd_setting \"PermitOpen\" \"any\"\nrc-update add sshd default >/dev/null 2>&1 || true\nif pgrep -x sshd >/dev/null 2>&1; then\n  rc-service sshd restart >/dev/null 2>&1 || true\nelse\n  rc-service sshd start >/dev/null 2>&1 || sshd >/dev/null 2>&1 || /usr/sbin/sshd >/dev/null 2>&1 || true\nfi\n\n# 平台目录与环境文件（按需替换）\ninstall -d -m 755 /opt/airport/bin /opt/airport/log /etc/airport /etc/sing-box /var/lib/sing-box /var/log/sing-box\ncat >/etc/airport/node.env <<'EOF'\nNODE_ROLE=edge\nPANEL_ENDPOINT=https://example.com\nPANEL_TOKEN=replace_me\nSING_BOX_CONFIG=/etc/sing-box/config.json\nEOF\nchmod 600 /etc/airport/node.env\n\n# sing-box 预装（best effort，不阻断整体初始化）\ninstall_sing_box || true\n\nif ensure_sing_box_service; then\n  sing-box version >/dev/null 2>&1 || true\n  echo \"[init] sing-box 已完成预装准备\"\nelse\n  echo \"[init] sing-box 当前不可用，可后续手动补装\" >&2\nfi\n\necho \"[init] 初始化完成\"",
    selectedNodeIds: [],
    activeOperationId: null,
    message: null,
  },
  nodeTerminal: {
    command: "uname -a && uptime",
    activeOperationId: null,
    message: null,
    history: [],
    historyIndex: -1,
    sessionId: null,
    sessionStatus: "idle",
    sessionTransportLabel: "未建立会话",
    sessionTransportNote: "点击“打开 Web Shell”后，平台会尝试为当前节点建立一个实时会话。",
    sessionOutput: "",
    sessionUpdatedAt: null,
    sessionClosedAt: null,
  },
};

function notifyBootstrapStateChange() {
  if (typeof runtimeStoreHooks.onBootstrapStateChange === "function") {
    runtimeStoreHooks.onBootstrapStateChange();
  }
}

export function registerRuntimeStoreHooks(hooks = {}) {
  runtimeStoreHooks.onBootstrapStateChange = hooks.onBootstrapStateChange || null;
}

export function setBootstrapTokens(tokens) {
  appState.tokens = sortBootstrapTokens(tokens);
  notifyBootstrapStateChange();
}

export function setPlatformContext(context) {
  const distribution = normalizeDistributionContext(context);
  const previousDistribution =
    appState.platform?.sing_box_distribution || cloneDefaultSingBoxDistributionState();
  const hasMirrorBaseUrl = Object.prototype.hasOwnProperty.call(distribution, "mirror_base_url");
  const nextSupportedPlatforms = Array.isArray(distribution.supported_platforms)
    ? distribution.supported_platforms
    : previousDistribution.supported_platforms;

  appState.platform = {
    ...appState.platform,
    ...context,
    ssh_key: {
      ...appState.platform.ssh_key,
      ...(context?.ssh_key || {}),
    },
    sing_box_distribution: {
      ...cloneDefaultSingBoxDistributionState(),
      ...previousDistribution,
      ...distribution,
      mirror_base_url:
        hasMirrorBaseUrl
          ? normalizeBaseUrl(distribution?.mirror_base_url)
          : previousDistribution.mirror_base_url || "",
      supported_platforms: Array.isArray(nextSupportedPlatforms)
        ? [...nextSupportedPlatforms]
        : [],
    },
    probe_scheduler: {
      ...(appState.platform.probe_scheduler || {}),
      ...(context?.probe_scheduler || {}),
    },
    request_origin: normalizeBaseUrl(context?.request_origin) || browserOrigin,
    bootstrap_base_url:
      normalizeBaseUrl(context?.bootstrap_base_url) ||
      normalizeBaseUrl(appState.platform.bootstrap_base_url) ||
      browserOrigin,
    detected_lan_base_url: normalizeBaseUrl(context?.detected_lan_base_url) || null,
  };
  notifyBootstrapStateChange();
}

export function getPlatformBaseUrl() {
  return normalizeBaseUrl(appState.platform?.bootstrap_base_url) || browserOrigin;
}

export function getBootstrapScriptUrl() {
  return `${getPlatformBaseUrl()}/bootstrap.sh`;
}

export function upsertBootstrapToken(token) {
  const nextTokens = [...appState.tokens];
  const index = nextTokens.findIndex((item) => item.id === token.id);
  if (index >= 0) {
    nextTokens[index] = token;
  } else {
    nextTokens.unshift(token);
  }
  setBootstrapTokens(nextTokens);
}

export function getPrimaryBootstrapToken() {
  return appState.tokens.find((token) => getEffectiveTokenStatus(token) === "active") || null;
}

export function getPlatformSshKeyState() {
  return appState.platform?.ssh_key || cloneDefaultSshKeyState();
}

export function getProbeSchedulerState() {
  return appState.platform?.probe_scheduler || createDefaultPlatformState().probe_scheduler;
}

export function getPlatformSingBoxDistributionState() {
  const distribution = appState.platform?.sing_box_distribution || {};
  return {
    ...cloneDefaultSingBoxDistributionState(),
    ...distribution,
    supported_platforms: Array.isArray(distribution.supported_platforms)
      ? [...distribution.supported_platforms]
      : [],
  };
}

export function sortNodes(nodes) {
  return [...nodes].sort((a, b) => String(b.registered_at).localeCompare(String(a.registered_at)));
}

export function setNodes(nodes) {
  appState.nodes = sortNodes(nodes);
  if (appState.terminal.selectedNodeIds.length === 0 && appState.nodes.length > 0) {
    appState.terminal.selectedNodeIds = appState.nodes
      .slice(0, Math.min(2, appState.nodes.length))
      .map((node) => node.id);
  } else if (appState.terminal.selectedNodeIds.length > 0) {
    appState.terminal.selectedNodeIds = appState.terminal.selectedNodeIds.filter((nodeId) =>
      appState.nodes.some((node) => node.id === nodeId),
    );
  }
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) =>
    String(b.scheduled_at || b.created_at || "").localeCompare(
      String(a.scheduled_at || a.created_at || ""),
    ),
  );
}

export function setTasks(tasks) {
  appState.tasks = sortTasks(tasks);
}

export function sortProbes(probes) {
  return [...probes].sort((a, b) =>
    String(b.observed_at || "").localeCompare(String(a.observed_at || "")),
  );
}

export function setProbes(probes) {
  appState.probes = sortProbes(probes);
}

export function sortDiagnostics(diagnostics) {
  return [...diagnostics].sort((a, b) =>
    String(b.started_at || b.created_at || "").localeCompare(
      String(a.started_at || a.created_at || ""),
    ),
  );
}

export function setDiagnostics(diagnostics) {
  appState.diagnostics = sortDiagnostics(diagnostics);
}

export function setOperations(operations) {
  appState.operations = [...operations].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );
  if (!appState.terminal.activeOperationId && appState.operations.length > 0) {
    appState.terminal.activeOperationId = appState.operations[0].id;
  }
}

export function sortAccessUsers(accessUsers) {
  return [...accessUsers].sort((a, b) =>
    String(b.updated_at || b.created_at || "").localeCompare(
      String(a.updated_at || a.created_at || ""),
    ),
  );
}

export function setAccessUsers(accessUsers) {
  appState.accessUsers = sortAccessUsers(accessUsers);
}

export function sortSystemUsers(systemUsers) {
  return [...systemUsers].sort((a, b) =>
    String(b.updated_at || b.created_at || "").localeCompare(
      String(a.updated_at || a.created_at || ""),
    ),
  );
}

export function setSystemUsers(systemUsers) {
  appState.systemUsers = sortSystemUsers(systemUsers);
}

export function sortSystemTemplates(systemTemplates) {
  return [...systemTemplates].sort((a, b) =>
    String(b.updated_at || b.created_at || "").localeCompare(
      String(a.updated_at || a.created_at || ""),
    ),
  );
}

export function setSystemTemplates(systemTemplates) {
  appState.systemTemplates = sortSystemTemplates(systemTemplates);
}

export function sortProxyProfiles(proxyProfiles) {
  return [...proxyProfiles].sort((a, b) =>
    String(b.updated_at || b.created_at || "").localeCompare(
      String(a.updated_at || a.created_at || ""),
    ),
  );
}

export function setProxyProfiles(proxyProfiles) {
  appState.proxyProfiles = sortProxyProfiles(proxyProfiles);
}

export function sortNodeGroups(nodeGroups) {
  return [...nodeGroups].sort((a, b) =>
    String(b.updated_at || b.created_at || "").localeCompare(
      String(a.updated_at || a.created_at || ""),
    ),
  );
}

export function setNodeGroups(nodeGroups) {
  appState.nodeGroups = sortNodeGroups(nodeGroups);
}

export function sortProviders(providers) {
  return [...providers].sort((a, b) =>
    String(b.updated_at || b.created_at || "").localeCompare(
      String(a.updated_at || a.created_at || ""),
    ),
  );
}

export function setProviders(providers) {
  appState.providers = sortProviders(providers);
}

export function setCostSummary(summary) {
  appState.costs.summary = summary && typeof summary === "object" ? { ...summary } : null;
}

export function setCostNodes(items) {
  appState.costs.nodes = Array.isArray(items) ? [...items] : [];
}

export function setCostProviders(items) {
  appState.costs.providers = Array.isArray(items) ? [...items] : [];
}

export function setCostReleases(items) {
  appState.costs.releases = Array.isArray(items) ? [...items] : [];
}

export function setCostAccessUsers(items) {
  appState.costs.accessUsers = Array.isArray(items) ? [...items] : [];
}

export function sortConfigReleases(configReleases) {
  return [...configReleases].sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || "")),
  );
}

export function setConfigReleases(configReleases) {
  appState.configReleases = sortConfigReleases(configReleases);
}

export function sortSystemTemplateReleases(systemTemplateReleases) {
  return [...systemTemplateReleases].sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || "")),
  );
}

export function setSystemTemplateReleases(systemTemplateReleases) {
  appState.systemTemplateReleases = sortSystemTemplateReleases(systemTemplateReleases);
}

export function sortSystemUserReleases(systemUserReleases) {
  return [...systemUserReleases].sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || "")),
  );
}

export function setSystemUserReleases(systemUserReleases) {
  appState.systemUserReleases = sortSystemUserReleases(systemUserReleases);
}

export function upsertNode(node) {
  const nextNodes = [...appState.nodes];
  const index = nextNodes.findIndex((item) => item.id === node.id);
  if (index >= 0) {
    nextNodes[index] = node;
  } else {
    nextNodes.unshift(node);
  }
  setNodes(nextNodes);
}

export function upsertTask(task) {
  const nextTasks = [...appState.tasks];
  const index = nextTasks.findIndex((item) => item.id === task.id);
  if (index >= 0) {
    nextTasks[index] = task;
  } else {
    nextTasks.unshift(task);
  }
  setTasks(nextTasks);
}

export function upsertDiagnostic(diagnostic) {
  const nextDiagnostics = [...appState.diagnostics];
  const index = nextDiagnostics.findIndex((item) => item.id === diagnostic.id);
  if (index >= 0) {
    nextDiagnostics[index] = diagnostic;
  } else {
    nextDiagnostics.unshift(diagnostic);
  }
  setDiagnostics(nextDiagnostics);
}

export function upsertAccessUser(accessUser) {
  const nextAccessUsers = [...appState.accessUsers];
  const index = nextAccessUsers.findIndex((item) => item.id === accessUser.id);
  if (index >= 0) {
    nextAccessUsers[index] = accessUser;
  } else {
    nextAccessUsers.unshift(accessUser);
  }
  setAccessUsers(nextAccessUsers);
}

export function upsertSystemUser(systemUser) {
  const nextSystemUsers = [...appState.systemUsers];
  const index = nextSystemUsers.findIndex((item) => item.id === systemUser.id);
  if (index >= 0) {
    nextSystemUsers[index] = systemUser;
  } else {
    nextSystemUsers.unshift(systemUser);
  }
  setSystemUsers(nextSystemUsers);
}

export function upsertSystemTemplate(systemTemplate) {
  const nextSystemTemplates = [...appState.systemTemplates];
  const index = nextSystemTemplates.findIndex((item) => item.id === systemTemplate.id);
  if (index >= 0) {
    nextSystemTemplates[index] = systemTemplate;
  } else {
    nextSystemTemplates.unshift(systemTemplate);
  }
  setSystemTemplates(nextSystemTemplates);
}

export function upsertProxyProfile(proxyProfile) {
  const nextProxyProfiles = [...appState.proxyProfiles];
  const index = nextProxyProfiles.findIndex((item) => item.id === proxyProfile.id);
  if (index >= 0) {
    nextProxyProfiles[index] = proxyProfile;
  } else {
    nextProxyProfiles.unshift(proxyProfile);
  }
  setProxyProfiles(nextProxyProfiles);
}

export function upsertNodeGroup(nodeGroup) {
  const nextNodeGroups = [...appState.nodeGroups];
  const index = nextNodeGroups.findIndex((item) => item.id === nodeGroup.id);
  if (index >= 0) {
    nextNodeGroups[index] = nodeGroup;
  } else {
    nextNodeGroups.unshift(nodeGroup);
  }
  setNodeGroups(nextNodeGroups);
}

export function upsertConfigRelease(configRelease) {
  const nextConfigReleases = [...appState.configReleases];
  const index = nextConfigReleases.findIndex((item) => item.id === configRelease.id);
  if (index >= 0) {
    nextConfigReleases[index] = configRelease;
  } else {
    nextConfigReleases.unshift(configRelease);
  }
  setConfigReleases(nextConfigReleases);
}

export function upsertSystemTemplateRelease(systemTemplateRelease) {
  const nextSystemTemplateReleases = [...appState.systemTemplateReleases];
  const index = nextSystemTemplateReleases.findIndex((item) => item.id === systemTemplateRelease.id);
  if (index >= 0) {
    nextSystemTemplateReleases[index] = systemTemplateRelease;
  } else {
    nextSystemTemplateReleases.unshift(systemTemplateRelease);
  }
  setSystemTemplateReleases(nextSystemTemplateReleases);
}

export function upsertSystemUserRelease(systemUserRelease) {
  const nextSystemUserReleases = [...appState.systemUserReleases];
  const index = nextSystemUserReleases.findIndex((item) => item.id === systemUserRelease.id);
  if (index >= 0) {
    nextSystemUserReleases[index] = systemUserRelease;
  } else {
    nextSystemUserReleases.unshift(systemUserRelease);
  }
  setSystemUserReleases(nextSystemUserReleases);
}
