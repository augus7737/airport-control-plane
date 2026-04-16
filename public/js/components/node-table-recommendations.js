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
    const accessMode = node?.management?.access_mode || getAccessMode(node);
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
          : "先跑一轮真实探测，把管理链路、业务入口和上游状态确认下来。",
      );
    }

    if (latestProbe?.business_ready === false) {
      pushRecommendation(
        items,
        "检查业务入口",
        "管理链路可能已经恢复，但当前业务入口仍不可达，建议优先排查入口地址、入口端口与发布状态。",
      );
    }

    if (latestProbe?.relay_upstream_ready === false) {
      pushRecommendation(
        items,
        "检查入口到落地链路",
        "当前 relay 入口到落地上游链路异常，建议核对入口机出口、IPv6 可达性与落地端监听状态。",
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
        "检查管理中转",
        node?.management?.proxy_host
          ? "当前节点需要经 SSH 代理接入，建议先检查代理主机到目标节点之间的管理链路是否稳定。"
          : "当前节点需要经 SSH 跳板接入，建议先检查入口机与目标节点之间的管理链路是否稳定。",
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

    if (
      accessMode === "relay" &&
      !node.management?.relay_node_id &&
      !node.management?.relay_label &&
      !node.management?.proxy_host &&
      !node.management?.proxy_label
    ) {
      pushRecommendation(
        items,
        "补全管理中转",
        "当前节点已标记为经 SSH 中转，但还没有绑定实际跳板节点或代理主机，后续排障会很费劲。",
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
