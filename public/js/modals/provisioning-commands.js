export function createProvisioningCommandModule(dependencies = {}) {
  const {
    escapeHtml,
    getBootstrapScriptUrl,
    getPlatformBaseUrl,
    getPrimaryBootstrapToken,
    shellQuote,
  } = dependencies;

  function getBootstrapPrepareCommand() {
    return 'command -v apk >/dev/null 2>&1 && { apk update && apk add --no-cache curl openssh ca-certificates; } || echo "当前不是 Alpine，或 apk 不可用" >&2; ssh-keygen -A >/dev/null 2>&1 || true; rc-update add sshd default >/dev/null 2>&1 || true; rc-service sshd start >/dev/null 2>&1 || /usr/sbin/sshd >/dev/null 2>&1 || true';
  }

  function getBootstrapMirrorCommand() {
    return "command -v apk >/dev/null 2>&1 && [ -f /etc/apk/repositories ] && [ ! -f /etc/apk/repositories.airport.bak ] && cp /etc/apk/repositories /etc/apk/repositories.airport.bak 2>/dev/null || true; command -v apk >/dev/null 2>&1 && [ -f /etc/apk/repositories ] && sed -i 's#https\\?://[^ ]*alpinelinux\\.org/alpine#https://mirrors.aliyun.com/alpine#g' /etc/apk/repositories || true";
  }

  function getBootstrapEnrollCommand(tokenValue = null) {
    const resolvedToken = tokenValue || getPrimaryBootstrapToken()?.token || "";
    if (!resolvedToken) {
      return "# 请先创建一个可用的注册令牌";
    }

    const bootstrapUrl = shellQuote(getBootstrapScriptUrl());
    const serverUrl = shellQuote(getPlatformBaseUrl());
    const token = shellQuote(resolvedToken);

    return `if command -v curl >/dev/null 2>&1; then curl -fsSL ${bootstrapUrl} | sh -s -- --server ${serverUrl} --token ${token} --ssh-port 19822; elif command -v wget >/dev/null 2>&1; then wget -qO- ${bootstrapUrl} | sh -s -- --server ${serverUrl} --token ${token} --ssh-port 19822; else echo "请先执行步骤 2，安装 curl 后再执行接管" >&2; fi`;
  }

  function getBootstrapCommand(tokenValue = null) {
    const mirror = getBootstrapMirrorCommand();
    const prepare = getBootstrapPrepareCommand();
    const enroll = getBootstrapEnrollCommand(tokenValue);
    return `# 步骤 1：切换国内镜像源\n${mirror}\n\n# 步骤 2：更新并安装必要软件\n${prepare}\n\n# 步骤 3：执行一键接管\n${enroll}`;
  }

  function renderBootstrapCommandPair(tokenValue = null, options = {}) {
    const mirrorCommand = getBootstrapMirrorCommand();
    const prepareCommand = getBootstrapPrepareCommand();
    const enrollCommand = getBootstrapEnrollCommand(tokenValue);
    const containerClass = options.compact
      ? "bootstrap-command-pair bootstrap-command-pair-compact"
      : "bootstrap-command-pair";
    const mirrorId = options.mirrorId ? ` id="${options.mirrorId}"` : "";
    const prepareId = options.prepareId ? ` id="${options.prepareId}"` : "";
    const enrollId = options.enrollId ? ` id="${options.enrollId}"` : "";
    const mirrorLabel = options.mirrorLabel || "步骤 1";
    const mirrorTitle = options.mirrorTitle || "切换国内镜像源";
    const mirrorHint = options.mirrorHint || "国内 Alpine 节点建议先切到阿里云镜像。";
    const prepareLabel = options.prepareLabel || "步骤 2";
    const prepareTitle = options.prepareTitle || "更新并安装必要软件";
    const prepareHint = options.prepareHint || "补齐 curl、openssh 和证书后，再继续接管。";
    const enrollLabel = options.enrollLabel || "步骤 3";
    const enrollTitle = options.enrollTitle || "执行一键接管脚本";
    const enrollHint = options.enrollHint || "前两步完成后，再执行真正的注册接管。";

    return `
      <div class="${containerClass}">
        <div class="bootstrap-command-step">
          <div class="bootstrap-command-step-head">
            <span class="bootstrap-command-step-index">${mirrorLabel}</span>
            <strong>${mirrorTitle}</strong>
            <span>${mirrorHint}</span>
          </div>
          <div class="command-box"><code${mirrorId}>${escapeHtml(mirrorCommand)}</code></div>
        </div>
        <div class="bootstrap-command-step">
          <div class="bootstrap-command-step-head">
            <span class="bootstrap-command-step-index">${prepareLabel}</span>
            <strong>${prepareTitle}</strong>
            <span>${prepareHint}</span>
          </div>
          <div class="command-box"><code${prepareId}>${escapeHtml(prepareCommand)}</code></div>
        </div>
        <div class="bootstrap-command-step">
          <div class="bootstrap-command-step-head">
            <span class="bootstrap-command-step-index">${enrollLabel}</span>
            <strong>${enrollTitle}</strong>
            <span>${enrollHint}</span>
          </div>
          <div class="command-box"><code${enrollId}>${escapeHtml(enrollCommand)}</code></div>
        </div>
      </div>
    `;
  }

  return {
    getBootstrapCommand,
    getBootstrapEnrollCommand,
    getBootstrapMirrorCommand,
    getBootstrapPrepareCommand,
    renderBootstrapCommandPair,
  };
}
