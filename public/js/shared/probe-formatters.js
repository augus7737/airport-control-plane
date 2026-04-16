export function formatProbeType(probe) {
  if (probe?.probe_type === "full_stack") {
    return "综合巡检";
  }
  if (probe?.probe_type === "ssh_auth") {
    return "SSH 接管探测";
  }
  if (probe?.probe_type === "business_entry_tcp") {
    return "业务入口探测";
  }
  if (probe?.probe_type === "relay_upstream_tcp") {
    return "入口上游探测";
  }
  if (probe?.probe_type === "tcp_ssh") {
    return "SSH TCP 端口";
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
  if (value === "business_route_ready") return "业务链路已就绪";
  if (value === "business_entry_ready") return "业务入口可达";
  if (value === "relay_upstream_ready") return "入口上游可达";
  if (value === "management_only_ready") return "管理链路已就绪";
  if (value === "platform_ssh_key_missing") return "平台未配置 SSH 私钥";
  if (value === "platform_ssh_key_invalid") return "平台 SSH 私钥不可用";
  if (value === "probe_target_missing") return "缺少可探测地址";
  if (value === "business_route_unpublished") return "尚无已发布业务线路";
  if (value === "business_entry_target_missing") return "缺少业务入口地址";
  if (value === "business_entry_port_missing") return "缺少业务入口端口";
  if (value === "entry_endpoint_missing") return "缺少业务入口地址";
  if (value === "entry_port_missing") return "缺少业务入口端口";
  if (value === "entry_node_missing") return "缺少入口节点";
  if (value === "relay_not_applicable") return "当前线路无需中转探测";
  if (value === "relay_upstream_missing") return "缺少入口到落地上游地址";
  if (value === "relay_probe_tool_missing") return "入口机缺少 TCP 探测工具";
  if (value === "relay_upstream_timeout") return "入口到上游链路超时";
  if (value === "relay_upstream_probe_failed") return "入口到上游探测失败";
  if (value === "relay_tcp_forwarding_disabled") return "跳板禁用了 TCP 转发";
  if (value === "relay_exec_bridge_missing") return "跳板缺少 NC 桥接能力";
  if (value === "relay_target_unreachable_from_jump") return "跳板到目标 SSH 端口不通";
  if (value === "relay_jump_auth_failed") return "平台无法登录跳板";
  if (value === "relay_jump_probe_failed") return "跳板能力预检失败";
  if (value === "relay_tcp_forward_probe_failed") return "跳板 TCP 转发预检失败";
  if (value === "tcp_only_requested") return "仅执行 TCP 探测";
  if (value === "tcp_only_success") return "TCP 已连通";
  if (value === "tcp_unreachable") return "TCP 未连通";
  if (value === "tcp_connection_refused" || value === "econnrefused") return "端口拒绝";
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

function isExplicitFalse(value) {
  return value === false;
}

function formatLatencySuffix(probe) {
  return probe?.latency_ms != null ? ` · ${probe.latency_ms}ms` : "";
}

function getManagementTcpStage(probe) {
  return probe?.stages?.management_tcp || probe?.stages?.tcp || null;
}

function getBusinessEntryStage(probe) {
  return probe?.stages?.business_entry_tcp || null;
}

function getRelayUpstreamStage(probe) {
  return probe?.stages?.relay_upstream_tcp || null;
}

export function getProbeTcpStage(probe) {
  return getManagementTcpStage(probe) || getBusinessEntryStage(probe) || null;
}

export function getProbeSshStage(probe) {
  return probe?.stages?.ssh || null;
}

function formatManagementStageCompact(probe) {
  const tcpStage = getManagementTcpStage(probe);
  const sshStage = getProbeSshStage(probe);
  const reasonCode = normalizeProbeCode(
    sshStage?.skipped_reason || sshStage?.error_message || probe?.reason_code || probe?.error_message,
  );

  if (!tcpStage?.success) {
    return `管理 ${probeReasonLabel(tcpStage?.error_message || probe?.error_message)}`;
  }

  if (probe?.control_ready) {
    return "管理 SSH 已通";
  }

  if (sshStage?.attempted && !sshStage.success) {
    return `管理 ${probeReasonLabel(sshStage.error_message)}`;
  }

  if (reasonCode === "platform_ssh_key_missing") return "管理待配私钥";
  if (reasonCode === "platform_ssh_key_invalid") return "管理私钥异常";
  return "管理 TCP 已通";
}

export function formatProbeSummary(probe) {
  if (!probe) {
    return "尚未探测";
  }

  const latencySuffix = formatLatencySuffix(probe);
  if (probe.probe_type === "full_stack") {
    const parts = [probe.control_ready ? "管理已通" : "管理异常"];
    if (probe.business_ready === true) {
      parts.push("入口已通");
    } else if (isExplicitFalse(probe.business_ready)) {
      parts.push("入口异常");
    }

    if (probe.relay_upstream_ready === true) {
      parts.push("上游已通");
    } else if (isExplicitFalse(probe.relay_upstream_ready)) {
      parts.push("上游异常");
    }

    return `${parts.join(" / ")}${latencySuffix}`;
  }

  if (probe.probe_type === "business_entry_tcp") {
    if (probe.success) {
      return `入口已通${latencySuffix}`;
    }
    return latencySuffix
      ? `${probeReasonLabel(probe.reason_code || probe.error_message)}${latencySuffix}`
      : probeReasonLabel(probe.reason_code || probe.error_message);
  }

  if (probe.probe_type === "relay_upstream_tcp") {
    if (probe.success) {
      return `上游已通${latencySuffix}`;
    }
    return latencySuffix
      ? `${probeReasonLabel(probe.reason_code || probe.error_message)}${latencySuffix}`
      : probeReasonLabel(probe.reason_code || probe.error_message);
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

  if (
    ["platform_ssh_key_missing", "platform_ssh_key_invalid", "tcp_only_success", "tcp_only_requested"].includes(
      reasonCode,
    )
  ) {
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

  if (probe.probe_type === "full_stack") {
    return "管理链路、业务入口与 relay 上游均已完成本轮探测。";
  }

  if (probe.probe_type === "business_entry_tcp") {
    return "平台已确认当前业务入口可达。";
  }

  if (probe.probe_type === "relay_upstream_tcp") {
    return "平台已确认入口节点到落地上游链路可达。";
  }

  return probe.control_ready ? "平台已验证 SSH 接管能力。" : "平台已确认 TCP 连通性。";
}

export function formatProbeCapability(probe) {
  if (!probe) {
    return "待验证";
  }

  if (probe.probe_type === "full_stack") {
    const relayMode = normalizeProbeCode(probe.access_mode) === "relay";
    if (
      probe.control_ready &&
      probe.business_ready === true &&
      (!relayMode || probe.relay_upstream_ready === true)
    ) {
      return "全链路就绪";
    }
    if (isExplicitFalse(probe.business_ready)) {
      return "业务入口异常";
    }
    if (isExplicitFalse(probe.relay_upstream_ready)) {
      return "入口上游异常";
    }
    if (probe.control_ready) {
      return "已验证接管";
    }
  }

  if (probe.probe_type === "business_entry_tcp") {
    return probe.success ? "入口可达" : "业务入口异常";
  }

  if (probe.probe_type === "relay_upstream_tcp") {
    return probe.success ? "上游可达" : "入口上游异常";
  }

  const tcpStage = getManagementTcpStage(probe);
  const sshStage = getProbeSshStage(probe);
  const reasonCode = normalizeProbeCode(
    sshStage?.skipped_reason || probe.reason_code || probe.error_message,
  );

  if (probe.control_ready) {
    return "已验证接管";
  }

  if (sshStage?.attempted && !sshStage.success) {
    return "接管失败";
  }

  if (tcpStage?.success) {
    if (reasonCode === "platform_ssh_key_missing") return "待配私钥";
    if (reasonCode === "platform_ssh_key_invalid") return "私钥异常";
    return "仅管理 TCP";
  }

  return "未通过";
}

export function formatProbeStageCompact(probe) {
  if (!probe) {
    return "待首次探测";
  }

  if (probe.probe_type === "full_stack") {
    const businessStage = getBusinessEntryStage(probe);
    const relayStage = getRelayUpstreamStage(probe);
    const parts = [formatManagementStageCompact(probe)];

    if (probe.business_ready === true) {
      parts.push("入口已通");
    } else if (isExplicitFalse(probe.business_ready)) {
      parts.push(`入口 ${probeReasonLabel(businessStage?.error_message || probe.reason_code)}`);
    }

    if (probe.relay_upstream_ready === true) {
      parts.push("上游已通");
    } else if (isExplicitFalse(probe.relay_upstream_ready)) {
      parts.push(`上游 ${probeReasonLabel(relayStage?.error_message || probe.reason_code)}`);
    }

    return parts.join(" / ");
  }

  const tcpStage = getManagementTcpStage(probe);
  const sshStage = getProbeSshStage(probe);

  if (probe.probe_type === "business_entry_tcp") {
    const businessStage = getBusinessEntryStage(probe);
    return businessStage?.success
      ? "入口 TCP 已通"
      : probeReasonLabel(businessStage?.error_message || probe.error_message);
  }

  if (probe.probe_type === "relay_upstream_tcp") {
    const relayStage = getRelayUpstreamStage(probe);
    return relayStage?.success
      ? "入口到上游已通"
      : probeReasonLabel(relayStage?.error_message || probe.error_message);
  }

  if (!tcpStage?.success) {
    return probeReasonLabel(tcpStage?.error_message || probe.error_message);
  }

  if (probe.control_ready) {
    return "TCP 已通 / SSH 可接管";
  }

  if (sshStage?.attempted && !sshStage.success) {
    return `TCP 已通 / ${probeReasonLabel(sshStage.error_message)}`;
  }

  if (
    sshStage?.skipped_reason &&
    !["tcp_only_requested", "tcp_only_success"].includes(normalizeProbeCode(sshStage.skipped_reason))
  ) {
    return `TCP 已通 / ${probeReasonLabel(sshStage.skipped_reason)}`;
  }

  return "TCP 已通";
}
