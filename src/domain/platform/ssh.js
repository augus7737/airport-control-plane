import {
  normalizeManagementRelayStrategy,
  relayStrategyCandidates,
} from "../routes/management-strategies.js";

const RELAY_CAPABILITY_CACHE_TTL_MS = 120000;
const RELAY_SSH_TIMEOUT_MS = 8000;
const TCP_FORWARD_PREFLIGHT_TIMEOUT_MS = 4000;

function compactOutput(text) {
  const raw = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!raw) {
    return null;
  }

  const singleLine = raw.replace(/\s+/g, " ").trim();
  return singleLine.length > 240 ? `${singleLine.slice(0, 237)}...` : singleLine;
}

function parseBooleanCapability(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "yes" || normalized === "true") {
    return true;
  }

  if (normalized === "no" || normalized === "false") {
    return false;
  }

  return null;
}

function relayStrategyNote(strategy) {
  if (strategy === "tcp_forward") {
    return "标准 SSH TCP 转发";
  }

  if (strategy === "exec_nc") {
    return "NC 命令桥接";
  }

  return "自动";
}

function inferRelayCapabilityFailure(output) {
  const text = String(output ?? "").toLowerCase();
  if (!text) {
    return "relay_jump_probe_failed";
  }

  if (text.includes("permission denied")) {
    return "relay_jump_auth_failed";
  }

  if (text.includes("connection timed out") || text.includes("operation timed out")) {
    return "ssh_timeout";
  }

  if (text.includes("connection refused")) {
    return "ssh_connection_refused";
  }

  if (text.includes("no route to host")) {
    return "ssh_no_route";
  }

  if (text.includes("could not resolve hostname")) {
    return "ssh_dns_failed";
  }

  if (text.includes("host key verification failed")) {
    return "ssh_host_key_failed";
  }

  if (text.includes("connection closed by remote host")) {
    return "ssh_connection_closed";
  }

  return "relay_jump_probe_failed";
}

function inferTcpForwardPreflightResult(output) {
  const text = String(output ?? "").toLowerCase();
  if (text.includes("administratively prohibited")) {
    return "relay_tcp_forwarding_disabled";
  }

  if (
    text.includes("stdio forwarding failed") &&
    text.includes("open failed") &&
    text.includes("administratively prohibited")
  ) {
    return "relay_tcp_forwarding_disabled";
  }

  if (text.includes("permission denied")) {
    return "relay_jump_auth_failed";
  }

  if (
    text.includes("open failed") &&
    (text.includes("connection refused") ||
      text.includes("no route to host") ||
      text.includes("name or service not known") ||
      text.includes("network is unreachable") ||
      text.includes("connection timed out"))
  ) {
    return "relay_target_unreachable_from_jump";
  }

  return null;
}

function formatForwardTarget(host, port) {
  if (!host) {
    return null;
  }

  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

export function createPlatformSshDomain(dependencies) {
  const {
    cwdProvider = () => process.cwd(),
    defaultNodeSshUser,
    demoShellBinary,
    envPlatformPublicKey,
    envPlatformSshPrivateKeyPath,
    baseEnv = process.env,
    managedPlatformSshDir,
    managedPlatformSshPrivateKeyPath,
    managedPlatformSshPublicKeyPath,
    mkdir,
    normalizeNullableString,
    readFile,
    resolveManagementRoute,
    shellSessionLabel,
    spawn,
    sshConnectTimeoutSeconds,
    stat,
  } = dependencies;
  const relayCapabilityCache = new Map();

  async function readTrimmedFileIfExists(filePath) {
    try {
      const raw = await readFile(filePath, "utf8");
      return normalizeNullableString(raw);
    } catch {
      return null;
    }
  }

  async function fileExists(filePath) {
    try {
      const info = await stat(filePath);
      return info.isFile();
    } catch {
      return false;
    }
  }

  async function resolvePlatformSshMaterial() {
    if (envPlatformSshPrivateKeyPath) {
      return {
        source: "env",
        private_key_path: envPlatformSshPrivateKeyPath,
        public_key:
          envPlatformPublicKey ??
          (await readTrimmedFileIfExists(`${envPlatformSshPrivateKeyPath}.pub`)),
      };
    }

    if (await fileExists(managedPlatformSshPrivateKeyPath)) {
      return {
        source: "managed",
        private_key_path: managedPlatformSshPrivateKeyPath,
        public_key: await readTrimmedFileIfExists(managedPlatformSshPublicKeyPath),
      };
    }

    return {
      source: "missing",
      private_key_path: null,
      public_key: envPlatformPublicKey,
    };
  }

  function runLocalCommand(command, args, options = {}) {
    return new Promise((resolve) => {
      let output = "";
      const child = spawn(command, args, {
        cwd: options.cwd ?? cwdProvider(),
        env: options.env ?? baseEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const append = (chunk) => {
        output += chunk.toString();
      };

      child.stdout.on("data", append);
      child.stderr.on("data", append);

      child.on("error", (error) => {
        resolve({
          output: `${output}\n${error.message}\n`,
          exit_code: null,
          signal: null,
        });
      });

      child.on("close", (code, signal) => {
        resolve({
          output,
          exit_code: code,
          signal,
        });
      });
    });
  }

  function terminateChildProcess(child) {
    if (!child || child.killed) {
      return;
    }

    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 1000).unref?.();
  }

  function buildCommonSshArgs(privateKeyPath, options = {}) {
    return [
      options.forceTty ? "-tt" : "-T",
      "-F",
      "/dev/null",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "BatchMode=yes",
      "-o",
      "PreferredAuthentications=publickey",
      "-o",
      "PasswordAuthentication=no",
      "-o",
      "NumberOfPasswordPrompts=0",
      "-o",
      `ConnectTimeout=${String(sshConnectTimeoutSeconds)}`,
      "-o",
      "ServerAliveInterval=20",
      "-i",
      privateKeyPath,
    ];
  }

  function buildDirectSshTargetArgs(endpoint) {
    return [
      "-p",
      String(endpoint.port),
      endpoint.login_target,
    ];
  }

  function formatSshJumpTarget(host, port, sshUser = defaultNodeSshUser) {
    if (!host) {
      return null;
    }

    if (host.includes(":")) {
      return `${sshUser}@[${host}]${port === 19822 ? "" : `:${port}`}`;
    }

    return `${sshUser}@${host}${port === 19822 ? "" : `:${port}`}`;
  }

  function formatSshLoginTarget(host, sshUser = defaultNodeSshUser) {
    if (!host) {
      return null;
    }

    return `${sshUser}@${host}`;
  }

  function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
  }

  function buildRelayEndpoint(route) {
    if (route?.proxy_target?.host) {
      const host = route.proxy_target.host;
      const port = route.proxy_target.port ?? 22;
      const sshUser = route.proxy_target.ssh_user ?? defaultNodeSshUser;
      return {
        host,
        port,
        family: route.proxy_target.family ?? null,
        ssh_user: sshUser,
        label: route.proxy_target.label ?? host,
        route_kind: "ssh-proxy",
        login_target: formatSshLoginTarget(host, sshUser),
        display_target: formatSshJumpTarget(host, port, sshUser),
      };
    }

    if (route?.relay_target?.host) {
      const host = route.relay_target.host;
      const port =
        route.relay_target.port ??
        route.relay_node?.management?.ssh_port ??
        route.relay_node?.facts?.ssh_port ??
        19822;
      const sshUser = route.relay_node?.management?.ssh_user ?? defaultNodeSshUser;
      return {
        host,
        port,
        family: route.relay_target.family ?? null,
        ssh_user: sshUser,
        label: shellSessionLabel(route.relay_node),
        route_kind: "managed-node",
        login_target: formatSshLoginTarget(host, sshUser),
        display_target: formatSshJumpTarget(host, port, sshUser),
      };
    }

    return null;
  }

  function relayBaseLabel(routeKind) {
    return routeKind === "ssh-proxy" ? "SSH 经代理" : "SSH 经跳板";
  }

  function relayTransportLabel(routeKind, strategy) {
    const prefix = relayBaseLabel(routeKind);
    if (strategy === "exec_nc") {
      return `${prefix} / NC 桥接`;
    }

    return `${prefix} / TCP 转发`;
  }

  function relayTransportKind(strategy) {
    if (strategy === "exec_nc") {
      return "ssh-relay-exec-nc";
    }

    return "ssh-relay-tcp-forward";
  }

  async function platformSshKeyState() {
    const material = await resolvePlatformSshMaterial();

    if (!material.private_key_path) {
      return {
        ok: false,
        source: material.source,
        private_key_path: null,
        public_key: material.public_key ?? null,
        bootstrap_ready: false,
        reason_code: "platform_ssh_key_missing",
        note: "平台还没有可用 SSH 私钥，当前无法从控制面对节点发起真实 SSH 连接。",
      };
    }

    try {
      const info = await stat(material.private_key_path);
      if (!info.isFile()) {
        throw new Error("ssh private key path is not a file");
      }

      const publicKey = normalizeNullableString(material.public_key);

      return {
        ok: true,
        source: material.source,
        private_key_path: material.private_key_path,
        public_key: publicKey,
        bootstrap_ready: Boolean(publicKey),
        reason_code: publicKey ? null : "platform_ssh_public_key_missing",
        note: publicKey
          ? null
          : "平台私钥可用，但缺少配套公钥，bootstrap 暂时无法自动写入 authorized_keys。",
      };
    } catch {
      return {
        ok: false,
        source: material.source,
        private_key_path: material.private_key_path,
        public_key: material.public_key ?? null,
        bootstrap_ready: false,
        reason_code: "platform_ssh_key_invalid",
        note: "平台 SSH 私钥文件不可用，当前无法完成真实 SSH 接管验证。",
      };
    }
  }

  async function generateManagedPlatformSshKey() {
    if (envPlatformSshPrivateKeyPath) {
      throw new Error("当前已通过环境变量托管平台 SSH 私钥，页面内不可生成新密钥。");
    }

    if (await fileExists(managedPlatformSshPrivateKeyPath)) {
      throw new Error("平台托管 SSH 密钥已存在，无需重复生成。");
    }

    await mkdir(managedPlatformSshDir, { recursive: true });

    const result = await runLocalCommand("ssh-keygen", [
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-f",
      managedPlatformSshPrivateKeyPath,
      "-C",
      "airport-control-plane",
    ]);

    if (result.exit_code !== 0) {
      throw new Error(
        normalizeNullableString(result.output) || "平台 SSH 密钥生成失败，请确认 ssh-keygen 可用。",
      );
    }

    return platformSshKeyState();
  }

  function buildLocalDemoTransport(node, note) {
    return {
      kind: "local-demo",
      label: "控制面本机兜底",
      note,
      command: demoShellBinary,
      args: [],
      env: {
        ...baseEnv,
        AIRPORT_NODE_ID: node.id,
        AIRPORT_NODE_NAME: shellSessionLabel(node),
        AIRPORT_NODE_PROVIDER: node.labels?.provider ?? "",
        AIRPORT_NODE_REGION: node.labels?.region ?? "",
        AIRPORT_NODE_ACCESS_MODE: node.management?.access_mode ?? "direct",
      },
    };
  }

  function executeSshScript(sshArgs, scriptBody, args = [], timeoutMs = RELAY_SSH_TIMEOUT_MS) {
    return new Promise((resolve) => {
      let output = "";
      let settled = false;
      let timedOut = false;
      let timer = null;
      const child = spawn("ssh", [...sshArgs, "sh", "-s", "--", ...args.map((item) => String(item))], {
        cwd: cwdProvider(),
        env: baseEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolve(result);
      };

      const append = (chunk) => {
        output += chunk.toString();
      };

      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.stdin.on("error", () => {});

      child.on("error", (error) => {
        finish({
          output: `${output}\n${error.message}\n`,
          exit_code: null,
          signal: null,
          timed_out: false,
        });
      });

      child.on("close", (code, signal) => {
        finish({
          output,
          exit_code: timedOut ? 124 : code,
          signal,
          timed_out: timedOut,
        });
      });

      child.stdin.write(scriptBody);
      child.stdin.end();

      timer = setTimeout(() => {
        timedOut = true;
        output += "\nrelay capability probe timeout\n";
        terminateChildProcess(child);
      }, timeoutMs);
      timer.unref?.();
    });
  }

  function parseRelayCapabilities(output) {
    const lines = String(output ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n");
    const startIndex = lines.findIndex((line) => line.trim() === "__airport_relay_caps_begin__");
    const endIndex = lines.findIndex((line) => line.trim() === "__airport_relay_caps_end__");

    if (startIndex < 0 || endIndex <= startIndex) {
      return null;
    }

    const payload = {};
    for (const line of lines.slice(startIndex + 1, endIndex)) {
      const [key, ...rest] = line.split("=");
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) {
        continue;
      }
      payload[normalizedKey] = rest.join("=").trim();
    }

    return {
      allow_tcp_forwarding: parseBooleanCapability(payload.allow_tcp_forwarding),
      exec_bridge: payload.exec_bridge || "none",
      has_nc: ["nc", "busybox_nc"].includes(String(payload.exec_bridge || "").trim().toLowerCase()),
      checked_at: new Date().toISOString(),
    };
  }

  function relayCapabilityCacheKey(relayEndpoint) {
    return [
      relayEndpoint.route_kind,
      relayEndpoint.host,
      relayEndpoint.port,
      relayEndpoint.ssh_user,
    ].join("|");
  }

  async function resolveRelayCapabilities(relayEndpoint, keyState) {
    const cacheKey = relayCapabilityCacheKey(relayEndpoint);
    const cached = relayCapabilityCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.cached_at < RELAY_CAPABILITY_CACHE_TTL_MS) {
      return cached.value;
    }

    const sshArgs = [
      ...buildCommonSshArgs(keyState.private_key_path),
      ...buildDirectSshTargetArgs(relayEndpoint),
    ];
    const scriptBody = `#!/bin/sh
set -eu
ALLOW="unknown"
if command -v sshd >/dev/null 2>&1; then
  ALLOW_RAW="$(sshd -T 2>/dev/null | awk '/^allowtcpforwarding / {print $2; exit}' || true)"
  case "$ALLOW_RAW" in
    yes|all|local|remote)
      ALLOW="yes"
      ;;
    no)
      ALLOW="no"
      ;;
  esac
fi

BRIDGE="none"
if command -v nc >/dev/null 2>&1; then
  BRIDGE="nc"
elif command -v busybox >/dev/null 2>&1 && busybox nc -h >/dev/null 2>&1; then
  BRIDGE="busybox_nc"
fi

printf '__airport_relay_caps_begin__\\n'
printf 'allow_tcp_forwarding=%s\\n' "$ALLOW"
printf 'exec_bridge=%s\\n' "$BRIDGE"
printf '__airport_relay_caps_end__\\n'
`;
    const execution = await executeSshScript(sshArgs, scriptBody);
    const parsed = parseRelayCapabilities(execution.output);

    if (execution.timed_out || execution.exit_code !== 0 || !parsed) {
      const failure = {
        ok: false,
        allow_tcp_forwarding: null,
        exec_bridge: "none",
        has_nc: false,
        checked_at: new Date().toISOString(),
        reason_code: inferRelayCapabilityFailure(execution.output),
        output_excerpt: compactOutput(execution.output),
      };
      relayCapabilityCache.set(cacheKey, {
        cached_at: now,
        value: failure,
      });
      return failure;
    }

    const success = {
      ok: true,
      ...parsed,
      reason_code: null,
      output_excerpt: compactOutput(execution.output),
    };
    relayCapabilityCache.set(cacheKey, {
      cached_at: now,
      value: success,
    });
    return success;
  }

  function runTcpForwardPreflight(relayEndpoint, target, keyState) {
    return new Promise((resolve) => {
      const forwardTarget = formatForwardTarget(target?.host, target?.port);
      const sshArgs = [
        ...buildCommonSshArgs(keyState.private_key_path),
        "-o",
        "ExitOnForwardFailure=yes",
        "-W",
        forwardTarget,
        ...buildDirectSshTargetArgs(relayEndpoint),
      ];
      let output = "";
      let settled = false;
      let sawStdout = false;
      let timer = null;
      const child = spawn("ssh", sshArgs, {
        cwd: cwdProvider(),
        env: baseEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolve(result);
      };

      child.stdout.on("data", (chunk) => {
        sawStdout = true;
        output += chunk.toString();
        finish({
          success: true,
          reason_code: null,
          output_excerpt: compactOutput(output),
        });
        terminateChildProcess(child);
      });

      child.stderr.on("data", (chunk) => {
        output += chunk.toString();
      });

      child.on("error", (error) => {
        finish({
          success: false,
          reason_code: inferRelayCapabilityFailure(error?.message),
          output_excerpt: compactOutput(`${output}\n${error.message}\n`),
        });
      });

      child.on("close", () => {
        const reasonCode = inferTcpForwardPreflightResult(output);
        if (!reasonCode && sawStdout) {
          finish({
            success: true,
            reason_code: null,
            output_excerpt: compactOutput(output),
          });
          return;
        }

        finish({
          success: false,
          reason_code: reasonCode || "relay_tcp_forward_probe_failed",
          output_excerpt: compactOutput(output),
        });
      });

      timer = setTimeout(() => {
        finish({
          success: !output.trim(),
          reason_code: !output.trim() ? null : inferTcpForwardPreflightResult(output) || "relay_tcp_forward_probe_failed",
          output_excerpt: compactOutput(output),
        });
        terminateChildProcess(child);
      }, TCP_FORWARD_PREFLIGHT_TIMEOUT_MS);
      timer.unref?.();
    });
  }

  function buildTcpForwardProxyCommand(relayEndpoint, keyState) {
    return [
      "ssh",
      ...buildCommonSshArgs(keyState.private_key_path),
      "-W",
      "%h:%p",
      ...buildDirectSshTargetArgs(relayEndpoint),
    ]
      .map((part) => shellQuote(part))
      .join(" ");
  }

  function buildExecNcProxyCommand(relayEndpoint, keyState) {
    const remoteScript = `HOST="$1"
PORT="$2"
if command -v nc >/dev/null 2>&1; then
  exec nc -w 15 "$HOST" "$PORT"
fi
if command -v busybox >/dev/null 2>&1 && busybox nc -h >/dev/null 2>&1; then
  exec busybox nc -w 15 "$HOST" "$PORT"
fi
echo "__airport_relay_bridge_missing__" >&2
exit 127`;

    return [
      "ssh",
      ...buildCommonSshArgs(keyState.private_key_path),
      ...buildDirectSshTargetArgs(relayEndpoint),
      "sh",
      "-lc",
      remoteScript,
      "airport-relay",
      "%h",
      "%p",
    ]
      .map((part) => shellQuote(part))
      .join(" ");
  }

  async function resolveRelaySelection(route, target, keyState) {
    const requestedStrategy = normalizeManagementRelayStrategy(route?.relay_strategy, "auto");
    const strategyCandidates = relayStrategyCandidates(requestedStrategy);
    const relayEndpoint = buildRelayEndpoint(route);

    if (!relayEndpoint?.host) {
      return {
        status: "blocked",
        reason_code: "management_relay_target_missing",
        note: "当前节点已配置 SSH 中转，但跳板目标缺少可用地址。",
        requested_strategy: requestedStrategy,
        strategy_candidates: strategyCandidates,
        strategy_used: null,
        relay_capabilities: null,
        relay_endpoint: relayEndpoint,
      };
    }

    const capabilities = await resolveRelayCapabilities(relayEndpoint, keyState);
    if (!capabilities.ok) {
      return {
        status: "blocked",
        reason_code: capabilities.reason_code,
        note:
          capabilities.reason_code === "relay_jump_auth_failed"
            ? `无法登录管理中转 ${relayEndpoint.label}，平台当前还不能用平台私钥接入这台跳板。`
            : `无法完成管理中转 ${relayEndpoint.label} 的能力预检。`,
        requested_strategy: requestedStrategy,
        strategy_candidates: strategyCandidates,
        strategy_used: null,
        relay_capabilities: capabilities,
        relay_endpoint: relayEndpoint,
      };
    }

    const tcpForwardCheck =
      requestedStrategy === "exec_nc" || capabilities.allow_tcp_forwarding === true
        ? null
        : await runTcpForwardPreflight(relayEndpoint, target, keyState);

    const tcpForwardAvailable =
      capabilities.allow_tcp_forwarding === true || tcpForwardCheck?.success === true;
    const tcpForwardDisabled =
      capabilities.allow_tcp_forwarding === false ||
      tcpForwardCheck?.reason_code === "relay_tcp_forwarding_disabled";
    const targetUnreachableFromJump =
      tcpForwardCheck?.reason_code === "relay_target_unreachable_from_jump";

    if (requestedStrategy === "tcp_forward") {
      if (tcpForwardDisabled) {
        return {
          status: "blocked",
          reason_code: "relay_tcp_forwarding_disabled",
          note: `管理中转 ${relayEndpoint.label} 的 sshd 当前禁止 TCP forwarding，无法按“TCP 转发”策略接入目标节点。`,
          requested_strategy: requestedStrategy,
          strategy_candidates: strategyCandidates,
          strategy_used: null,
          relay_capabilities: capabilities,
          relay_endpoint: relayEndpoint,
        };
      }

      if (targetUnreachableFromJump) {
        return {
          status: "blocked",
          reason_code: "relay_target_unreachable_from_jump",
          note: `管理中转 ${relayEndpoint.label} 当前无法连通目标节点 ${formatForwardTarget(target?.host, target?.port)}。`,
          requested_strategy: requestedStrategy,
          strategy_candidates: strategyCandidates,
          strategy_used: null,
          relay_capabilities: capabilities,
          relay_endpoint: relayEndpoint,
        };
      }

      return {
        status: "ready",
        requested_strategy: requestedStrategy,
        strategy_candidates: strategyCandidates,
        strategy_used: "tcp_forward",
        relay_capabilities: capabilities,
        relay_endpoint: relayEndpoint,
        proxy_command: buildTcpForwardProxyCommand(relayEndpoint, keyState),
        transport_kind: relayTransportKind("tcp_forward"),
        label: relayTransportLabel(relayEndpoint.route_kind, "tcp_forward"),
        note: `已按管理中转策略 ${relayStrategyNote("tcp_forward")} 通过 ${relayEndpoint.label} 连接目标节点。`,
      };
    }

    if (requestedStrategy === "exec_nc") {
      if (!capabilities.has_nc) {
        return {
          status: "blocked",
          reason_code: "relay_exec_bridge_missing",
          note: `管理中转 ${relayEndpoint.label} 未发现可用 nc / busybox nc，当前无法按“NC 桥接”策略接入目标节点。`,
          requested_strategy: requestedStrategy,
          strategy_candidates: strategyCandidates,
          strategy_used: null,
          relay_capabilities: capabilities,
          relay_endpoint: relayEndpoint,
        };
      }

      return {
        status: "ready",
        requested_strategy: requestedStrategy,
        strategy_candidates: strategyCandidates,
        strategy_used: "exec_nc",
        relay_capabilities: capabilities,
        relay_endpoint: relayEndpoint,
        proxy_command: buildExecNcProxyCommand(relayEndpoint, keyState),
        transport_kind: relayTransportKind("exec_nc"),
        label: relayTransportLabel(relayEndpoint.route_kind, "exec_nc"),
        note: `已按管理中转策略 ${relayStrategyNote("exec_nc")} 通过 ${relayEndpoint.label} 连接目标节点。`,
      };
    }

    if (tcpForwardAvailable) {
      return {
        status: "ready",
        requested_strategy: requestedStrategy,
        strategy_candidates: strategyCandidates,
        strategy_used: "tcp_forward",
        relay_capabilities: capabilities,
        relay_endpoint: relayEndpoint,
        proxy_command: buildTcpForwardProxyCommand(relayEndpoint, keyState),
        transport_kind: relayTransportKind("tcp_forward"),
        label: relayTransportLabel(relayEndpoint.route_kind, "tcp_forward"),
        note: `管理中转策略 auto 已选中 ${relayStrategyNote("tcp_forward")}，通过 ${relayEndpoint.label} 连接目标节点。`,
      };
    }

    if (targetUnreachableFromJump) {
      return {
        status: "blocked",
        reason_code: "relay_target_unreachable_from_jump",
        note: `管理中转 ${relayEndpoint.label} 当前无法连通目标节点 ${formatForwardTarget(target?.host, target?.port)}。`,
        requested_strategy: requestedStrategy,
        strategy_candidates: strategyCandidates,
        strategy_used: null,
        relay_capabilities: capabilities,
        relay_endpoint: relayEndpoint,
      };
    }

    if (capabilities.has_nc) {
      return {
        status: "ready",
        requested_strategy: requestedStrategy,
        strategy_candidates: strategyCandidates,
        strategy_used: "exec_nc",
        relay_capabilities: capabilities,
        relay_endpoint: relayEndpoint,
        proxy_command: buildExecNcProxyCommand(relayEndpoint, keyState),
        transport_kind: relayTransportKind("exec_nc"),
        label: relayTransportLabel(relayEndpoint.route_kind, "exec_nc"),
        note:
          tcpForwardDisabled
            ? `管理中转策略 auto 检测到 ${relayEndpoint.label} 已禁用 TCP forwarding，已自动退回 NC 桥接。`
            : `管理中转策略 auto 已选中 ${relayStrategyNote("exec_nc")}，通过 ${relayEndpoint.label} 连接目标节点。`,
      };
    }

    return {
      status: "blocked",
      reason_code:
        tcpForwardDisabled ? "relay_exec_bridge_missing" : "relay_exec_bridge_missing",
      note:
        tcpForwardDisabled
          ? `管理中转 ${relayEndpoint.label} 已禁用 TCP forwarding，且未发现可用 nc / busybox nc，当前无法完成 SSH 中转。`
          : `管理中转 ${relayEndpoint.label} 未发现可用 nc / busybox nc，auto 也无法退回命令桥接。`,
      requested_strategy: requestedStrategy,
      strategy_candidates: strategyCandidates,
      strategy_used: null,
      relay_capabilities: capabilities,
      relay_endpoint: relayEndpoint,
    };
  }

  async function resolveNodeSshTransport(node, options = {}) {
    const allowDemoFallback = options.allowDemoFallback !== false;
    const route = resolveManagementRoute(node, options);
    const target = route?.target ?? null;
    const accessMode = route?.access_mode ?? "direct";
    const relayNode = route?.relay_node ?? null;
    const keyState = await platformSshKeyState();

    if (!keyState.ok) {
      if (allowDemoFallback) {
        return {
          status: "demo",
          reason_code: keyState.reason_code,
          note: keyState.note,
          target,
          relay_node: relayNode,
          relay_target: route?.relay_target ?? null,
          relay_capabilities: null,
          requested_relay_strategy: route?.relay_strategy ?? null,
          strategy_candidates: route?.strategy_candidates ?? [],
          transport: buildLocalDemoTransport(
            node,
            keyState.reason_code === "platform_ssh_key_missing"
              ? "平台还没有可用 SSH 私钥，当前会话运行在控制面宿主机，作为临时兜底终端。"
              : "平台 SSH 私钥文件不可用，当前已退回控制面本机兜底模式。",
          ),
        };
      }

      return {
        status: "blocked",
        reason_code: keyState.reason_code,
        note: keyState.note,
        target,
        relay_node: relayNode,
        relay_target: route?.relay_target ?? null,
        relay_capabilities: null,
        requested_relay_strategy: route?.relay_strategy ?? null,
        strategy_candidates: route?.strategy_candidates ?? [],
        transport: null,
      };
    }

    if (!target) {
      const note = route?.problems?.length
        ? `当前节点缺少可用管理地址，暂时无法发起 SSH 连接（${route.problems.join(", ")}）。`
        : "当前节点缺少可用管理地址，暂时无法发起 SSH 连接。";
      if (allowDemoFallback) {
        return {
          status: "demo",
          reason_code: "probe_target_missing",
          note,
          target: null,
          relay_node: relayNode,
          relay_target: route?.relay_target ?? null,
          relay_capabilities: null,
          requested_relay_strategy: route?.relay_strategy ?? null,
          strategy_candidates: route?.strategy_candidates ?? [],
          transport: buildLocalDemoTransport(
            node,
            "当前节点缺少可用地址，暂时无法发起 SSH，会话已退回控制面本机兜底模式。",
          ),
        };
      }

      return {
        status: "blocked",
        reason_code: "probe_target_missing",
        note,
        target: null,
        relay_node: relayNode,
        relay_target: route?.relay_target ?? null,
        relay_capabilities: null,
        requested_relay_strategy: route?.relay_strategy ?? null,
        strategy_candidates: route?.strategy_candidates ?? [],
        transport: null,
      };
    }

    const sshArgs = buildCommonSshArgs(keyState.private_key_path);
    let label = "SSH 直连";
    let note = route?.route_label
      ? `已尝试使用平台 SSH 密钥按“${route.route_label}”连接 ${shellSessionLabel(node)}。`
      : `已尝试使用平台 SSH 密钥连接 ${shellSessionLabel(node)}。`;
    let kind = "ssh-direct";
    let relayTarget = route?.relay_target ?? route?.proxy_target ?? null;
    let relayCapabilities = null;
    let strategyRequested = route?.relay_strategy ?? null;
    let strategyCandidates = route?.strategy_candidates ?? [];
    let strategyUsed = null;

    if (target?.host && target.host === node.facts?.private_ipv4) {
      label = "SSH 局域网";
      note = `已尝试通过节点内网地址 ${target.host} 建立 SSH 会话。`;
      kind = "ssh-lan";
    }

    if (accessMode === "relay") {
      const selection = await resolveRelaySelection(route, target, keyState);
      relayCapabilities = selection.relay_capabilities ?? null;
      strategyRequested = selection.requested_strategy ?? strategyRequested;
      strategyCandidates = selection.strategy_candidates ?? strategyCandidates;
      strategyUsed = selection.strategy_used ?? null;
      relayTarget = selection.relay_endpoint ?? relayTarget;

      if (selection.status !== "ready") {
        return {
          status: "blocked",
          reason_code: selection.reason_code,
          note: selection.note,
          target,
          relay_node: relayNode,
          relay_target: relayTarget,
          relay_capabilities: relayCapabilities,
          requested_relay_strategy: strategyRequested,
          strategy_candidates: strategyCandidates,
          transport: null,
        };
      }

      sshArgs.push("-o", `ProxyCommand=${selection.proxy_command}`);
      label = selection.label;
      note = selection.note;
      kind = selection.transport_kind;
    }

    const loginTarget = formatSshLoginTarget(target.host, route?.ssh_user ?? defaultNodeSshUser);
    sshArgs.push("-p", String(target.port), loginTarget);

    return {
      status: "ready",
      reason_code: null,
      note,
      target,
      relay_node: relayNode,
      relay_target: relayTarget,
      relay_capabilities: relayCapabilities,
      requested_relay_strategy: strategyRequested,
      strategy_candidates: strategyCandidates,
      transport: {
        kind,
        label,
        note,
        command: "ssh",
        args: sshArgs,
        env: baseEnv,
        strategy_requested: strategyRequested,
        strategy_used: strategyUsed,
        relay_capabilities: relayCapabilities,
        strategy_candidates: strategyCandidates,
      },
    };
  }

  async function resolveExecutionTransport(node) {
    const context = await resolveNodeSshTransport(node, {
      allowDemoFallback: true,
    });
    if (!context.transport) {
      return null;
    }

    return context.transport;
  }

  async function resolveShellTransport(node) {
    const transport = await resolveExecutionTransport(node);
    if (!transport) {
      return null;
    }

    if (transport.command !== "ssh") {
      return transport;
    }

    const interactiveArgs = transport.args.filter((arg) => arg !== "-T");

    return {
      ...transport,
      args: ["-tt", ...interactiveArgs],
      env: {
        ...transport.env,
        TERM: baseEnv.TERM || "xterm-256color",
      },
    };
  }

  async function hasUsablePlatformSshKey() {
    const keyState = await platformSshKeyState();
    return Boolean(keyState.ok && keyState.private_key_path);
  }

  return {
    generateManagedPlatformSshKey,
    hasUsablePlatformSshKey,
    platformSshKeyState,
    resolveExecutionTransport,
    resolveNodeSshTransport,
    resolveShellTransport,
  };
}
