export function createPlatformSshPresentationModule(dependencies = {}) {
  const {
    getPlatformSshKeyState,
  } = dependencies;

  function platformSshStatusClass(value = getPlatformSshKeyState()) {
    const status = typeof value === "string" ? value : value?.status;
    if (status === "ready") return "active";
    if (status === "partial") return "degraded";
    if (status === "invalid") return "failed";
    return "new";
  }

  function platformSshStatusLabel(value = getPlatformSshKeyState()) {
    const status = typeof value === "string" ? value : value?.status;
    if (status === "ready") return "已就绪";
    if (status === "partial") return "缺少公钥";
    if (status === "invalid") return "私钥异常";
    return "待生成";
  }

  function formatPlatformSshSource(value = getPlatformSshKeyState()) {
    const source = typeof value === "string" ? value : value?.source;
    if (source === "env") return "环境变量";
    if (source === "managed") return "平台托管";
    return "尚未配置";
  }

  function formatPlatformSshBootstrapState(value = getPlatformSshKeyState()) {
    if (value?.bootstrap_ready) {
      return "可自动写入 authorized_keys";
    }
    if (value?.available) {
      return "私钥可用，但暂时不能自动注入公钥";
    }
    return "尚不能自动注入";
  }

  function formatPlatformPublicKeyPreview(value = getPlatformSshKeyState()) {
    const raw = String(value?.public_key || "").trim();
    if (!raw) {
      return "当前还没有平台公钥";
    }
    return raw.length > 110 ? `${raw.slice(0, 108)}...` : raw;
  }

  return {
    formatPlatformPublicKeyPreview,
    formatPlatformSshBootstrapState,
    formatPlatformSshSource,
    platformSshStatusClass,
    platformSshStatusLabel,
  };
}
