const alpineBootstrapScript = `#!/bin/sh
set -eu

# Alpine 轻量节点初始化（可重复执行）
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

echo "[init] 开始初始化"
if ! retry_command 3 2 apk update; then
  echo "[init] apk update 失败，继续尝试使用现有索引安装依赖" >&2
fi
retry_command 3 2 apk add --no-cache bash curl ca-certificates tzdata openssh iproute2 iputils bind-tools

# 基础时区与计划任务
cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime || true
echo "Asia/Shanghai" > /etc/timezone || true
rc-update add crond default >/dev/null 2>&1 || true
rc-service crond start >/dev/null 2>&1 || true
ssh-keygen -A >/dev/null 2>&1 || true
rc-update add sshd default >/dev/null 2>&1 || true
if ! pgrep -x sshd >/dev/null 2>&1; then
  rc-service sshd start >/dev/null 2>&1 || sshd >/dev/null 2>&1 || /usr/sbin/sshd >/dev/null 2>&1 || true
fi

# 平台目录与环境文件（按需替换）
install -d -m 755 /opt/airport/bin /opt/airport/log /etc/airport
cat >/etc/airport/node.env <<'EOF'
NODE_ROLE=edge
PANEL_ENDPOINT=https://example.com
PANEL_TOKEN=replace_me
EOF
chmod 600 /etc/airport/node.env

echo "[init] 初始化完成"`;

export function getNodeTerminalPresetCommand(preset) {
  if (preset === "system") {
    return "cat /etc/os-release && uname -a && uptime";
  }

  if (preset === "disk") {
    return "df -h && free -m";
  }

  if (preset === "network") {
    return "ip a && ss -lntp";
  }

  if (preset === "proxy") {
    return "rc-service sing-box status || systemctl status sing-box --no-pager || pgrep -a sing-box";
  }

  return "";
}

export function applyTerminalPreset(appState, preset) {
  if (preset === "apk") {
    appState.terminal.mode = "command";
    appState.terminal.title = "批量安装基础依赖";
    appState.terminal.command = "apk update && apk add curl bash ca-certificates";
    return;
  }

  if (preset === "restart") {
    appState.terminal.mode = "command";
    appState.terminal.title = "批量重启代理服务";
    appState.terminal.command = "rc-service sing-box restart || systemctl restart sing-box";
    return;
  }

  if (preset === "probe") {
    appState.terminal.mode = "command";
    appState.terminal.title = "批量网络自检";
    appState.terminal.command = "ping -c 4 1.1.1.1 && ss -lntp";
    return;
  }

  if (preset === "bootstrap") {
    appState.terminal.mode = "script";
    appState.terminal.title = "Alpine 节点基础初始化";
    appState.terminal.script_name = "Alpine 节点基础初始化";
    appState.terminal.script_body = alpineBootstrapScript;
  }
}
