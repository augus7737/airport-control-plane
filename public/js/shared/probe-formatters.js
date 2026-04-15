export function formatProbeType(probe) {
  if (probe?.probe_type === "ssh_auth") {
    return "SSH 接管探测";
  }
  if (probe?.probe_type === "tcp_ssh") {
    return "TCP SSH 端口";
  }
  return probe?.probe_type || "探测";
}

export function normalizeProbeCode(value) {
  return String(value || "").trim().toLowerCase();
}

export function probeReasonLabel(code) {
  const value = normalizeProbeCode(code);
  if (!value) return "未知状态";
  if (value === "ssh_control_ready") return "已验证 SSH 接管";
  if (value === "platform_ssh_key_missing") return "平台未配置 SSH 私钥";
  if (value === "platform_ssh_key_invalid") return "平台 SSH 私钥不可用";
  if (value === "probe_target_missing") return "缺少可探测地址";
  if (value === "tcp_only_requested") return "仅执行 TCP 探测";
  if (value === "tcp_only_success") return "TCP 已连通";
  if (value === "tcp_unreachable") return "TCP 未连通";
  if (value === "tcp_connection_refused" || value === "econnrefused") return "SSH 端口拒绝";
  if (value === "tcp_timeout") return "TCP 超时";
  if (value === "tcp_host_unreachable" || value === "ehostunreach") return "主机不可达";
  if (value === "tcp_network_unreachable" || value === "enetunreach") return "网络不可达";
  if (value === "tcp_connection_reset" || value === "econnreset") return "连接被重置";
  if (value === "ssh_permission_denied") return "SSH 公钥认证失败";
  if (value === "ssh_timeout") return "SSH 握手超时";
  if (value === "ssh_connection_refused") return "SSH 连接被拒绝";
  if (value === "ssh_no_route") return "SSH 路由不可达";
  if (value === "ssh_dns_failed") return "SSH 目标解析失败";
  if (value === "ssh_host_key_failed") return "SSH 主机校验失败";
  if (value === "ssh_connection_closed") return "SSH 连接被远端关闭";
  if (value === "ssh_handshake_failed") return "SSH 握手失败";
  if (value === "ssh_probe_failed") return "SSH 探测失败";
  return code || "未知状态";
}

export function getProbeTcpStage(probe) {
  return probe?.stages?.tcp || null;
}

export function getProbeSshStage(probe) {
  return probe?.stages?.ssh || null;
}

export function formatProbeSummary(probe) {
  if (!probe) {
    return "尚未探测";
  }

  if (probe.control_ready) {
    return probe.latency_ms != null ? `可接管 · ${probe.latency_ms}ms` : "可接管";
  }

  const reasonCode = normalizeProbeCode(probe.reason_code || probe.error_message);
  if (!probe.success) {
    return probe.latency_ms != null
      ? `${probeReasonLabel(reasonCode)} · ${probe.latency_ms}ms`
      : probeReasonLabel(reasonCode);
  }

  if (["platform_ssh_key_missing", "platform_ssh_key_invalid", "tcp_only_success", "tcp_only_requested"].includes(reasonCode)) {
    return probe.latency_ms != null ? `TCP 已通 · ${probe.latency_ms}ms` : "TCP 已通";
  }

  return probe.latency_ms != null ? `已连通 · ${probe.latency_ms}ms` : "已连通";
}

export function formatProbeLongSummary(probe) {
  if (!probe) {
    return "等待首次探测";
  }

  if (probe.summary) {
    return probe.summary;
  }

  if (!probe.success) {
    return `探测失败：${probeReasonLabel(probe.reason_code || probe.error_message)}。`;
  }

  return probe.control_ready ? "平台已验证 SSH 接管能力。" : "平台已确认 TCP 连通性。";
}

export function formatProbeCapability(probe) {
  if (!probe) {
    return "待验证";
  }

  const tcpStage = getProbeTcpStage(probe);
  const sshStage = getProbeSshStage(probe);
  const reasonCode = normalizeProbeCode(
    sshStage?.skipped_reason || probe.reason_code || probe.error_message,
  );

  if (probe.control_ready) {
    return "已验证";
  }

  if (sshStage?.attempted && !sshStage.success) {
    return "接管失败";
  }

  if (tcpStage?.success) {
    if (reasonCode === "platform_ssh_key_missing") return "待配私钥";
    if (reasonCode === "platform_ssh_key_invalid") return "私钥异常";
    return "仅 TCP";
  }

  return "未通过";
}

export function formatProbeStageCompact(probe) {
  if (!probe) {
    return "待首次探测";
  }

  const tcpStage = getProbeTcpStage(probe);
  const sshStage = getProbeSshStage(probe);

  if (!tcpStage?.success) {
    return probeReasonLabel(tcpStage?.error_message || probe.error_message);
  }

  if (probe.control_ready) {
    return "TCP 已通 / SSH 可接管";
  }

  if (sshStage?.attempted && !sshStage.success) {
    return `TCP 已通 / ${probeReasonLabel(sshStage.error_message)}`;
  }

  if (sshStage?.skipped_reason && !["tcp_only_requested", "tcp_only_success"].includes(normalizeProbeCode(sshStage.skipped_reason))) {
    return `TCP 已通 / ${probeReasonLabel(sshStage.skipped_reason)}`;
  }

  return "TCP 已通";
}
