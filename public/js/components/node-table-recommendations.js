export function createNodeRecommendationsModule(dependencies = {}) {
  const {
    getAccessMode,
    getProbeSshStage,
    normalizeProbeCode,
  } = dependencies;

  function pushRecommendation(items, title, description) {
    if (items.some((item) => item.title === title)) {
      return;
    }

    items.push({ title, description });
  }

  function buildNodeRecommendations(node, latestProbe, tasks) {
    const items = [];
    const latestInitTask = tasks.find((task) => task.type === "init_alpine") || null;
    const reasonCode = normalizeProbeCode(
      getProbeSshStage(latestProbe)?.skipped_reason ||
        latestProbe?.reason_code ||
        latestProbe?.error_message,
    );
    const accessMode = getAccessMode(node);
    const missingCommercialInfo =
      !node.commercial?.expires_at ||
      node.commercial?.bandwidth_mbps == null ||
      node.commercial?.traffic_quota_gb == null;

    if (!latestProbe) {
      pushRecommendation(
        items,
        node.source === "bootstrap" ? "等待自动首探" : "执行首次探测",
        node.source === "bootstrap"
          ? "节点完成 bootstrap 后，平台会自动补一轮首探；如果迟迟没有结果，再手动补跑。"
          : "先跑一轮真实探测，把 TCP 连通性和 SSH 接管能力确认下来。",
      );
    }

    if (reasonCode === "platform_ssh_key_missing" || reasonCode === "platform_ssh_key_invalid") {
      pushRecommendation(
        items,
        "配置平台 SSH 私钥",
        "当前只能确认端口可达，还没有办法完成真实 SSH 接管验证。",
      );
    }

    if (reasonCode === "ssh_permission_denied") {
      pushRecommendation(
        items,
        "重新写入平台公钥",
        "节点能连通，但平台公钥尚未被当前 SSH 用户接受，建议重新跑 bootstrap 或补写 authorized_keys。",
      );
    }

    if (["tcp_connection_refused", "tcp_timeout", "tcp_host_unreachable", "tcp_network_unreachable"].includes(reasonCode)) {
      pushRecommendation(
        items,
        "检查 SSH 服务",
        "先确认节点 SSH 监听是否正常，再继续初始化或下发批量命令。",
      );
    }

    if (["ssh_timeout", "ssh_no_route", "ssh_connection_closed"].includes(reasonCode) && accessMode === "relay") {
      pushRecommendation(
        items,
        "检查中转链路",
        "当前节点经中转接入，建议先检查香港入口与中转机的 SSH 路径是否稳定。",
      );
    }

    if (
      node.status === "new" ||
      (latestInitTask && ["new", "failed"].includes(String(latestInitTask.status || "").toLowerCase()))
    ) {
      pushRecommendation(
        items,
        "执行初始化模板",
        "新节点建议先补齐基础依赖、时区、计划任务和平台目录。",
      );
    }

    if (accessMode === "relay" && !node.networking?.relay_node_id && !node.networking?.relay_label) {
      pushRecommendation(
        items,
        "补全中转节点",
        "当前节点已标记为经中转，但还没有绑定实际的中转机标识，后续排障会很费劲。",
      );
    }

    if (missingCommercialInfo) {
      pushRecommendation(
        items,
        "补齐资产台账",
        "把到期时间、带宽和流量额度补完整，后续节点淘汰与续费决策会更清晰。",
      );
    }

    if (items.length < 3) {
      pushRecommendation(
        items,
        "同步到面板",
        "待节点状态稳定后，可以继续把它接入你已有的面板或控制系统。",
      );
    }

    return items.slice(0, 4);
  }

  return {
    buildNodeRecommendations,
    pushRecommendation,
  };
}
