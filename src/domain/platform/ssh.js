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

    return host.includes(":")
      ? `${sshUser}@[${host}]`
      : `${sshUser}@${host}`;
  }

  function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
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
        transport: null,
      };
    }

    const sshArgs = [
      "-T",
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
      keyState.private_key_path,
    ];

    let label = "SSH 直连";
    let note = route?.route_label
      ? `已尝试使用平台 SSH 密钥按“${route.route_label}”连接 ${shellSessionLabel(node)}。`
      : `已尝试使用平台 SSH 密钥连接 ${shellSessionLabel(node)}。`;
    let kind = "ssh-direct";
    let relayTarget = route?.relay_target ?? null;

    if (target?.host && target.host === node.facts?.private_ipv4) {
      label = "SSH 局域网";
      note = `已尝试通过节点内网地址 ${target.host} 建立 SSH 会话。`;
      kind = "ssh-lan";
    }

    if (accessMode === "relay") {
      const relayHost = route?.relay_target?.host ?? null;
      const relayPort =
        route?.relay_target?.port ??
        relayNode?.management?.ssh_port ??
        relayNode?.facts?.ssh_port ??
        19822;
      const relayLoginTarget = formatSshLoginTarget(
        relayHost,
        route?.relay_node?.management?.ssh_user ?? defaultNodeSshUser,
      );

      if (relayHost && relayLoginTarget) {
        relayTarget = {
          ...route?.relay_target,
          login_target: formatSshJumpTarget(
            relayHost,
            relayPort,
            route?.relay_node?.management?.ssh_user ?? defaultNodeSshUser,
          ),
        };
        const proxyCommand = [
          "ssh",
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
          keyState.private_key_path,
          "-p",
          String(relayPort),
          relayLoginTarget,
          "-W",
          "%h:%p",
        ]
          .map((part) => shellQuote(part))
          .join(" ");
        sshArgs.push("-o", `ProxyCommand=${proxyCommand}`);
        label = "SSH 经跳板";
        note = `已尝试通过管理跳板 ${shellSessionLabel(relayNode)} 建立 SSH 会话。`;
        kind = "ssh-relay";
      } else {
        note = "节点标记为经管理跳板，但跳板缺少可用地址，当前已退回直接尝试目标 SSH 连接。";
      }
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
      transport: {
        kind,
        label,
        note,
        command: "ssh",
        args: sshArgs,
        env: baseEnv,
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
