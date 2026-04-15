export function getTasksForNode(node, tasks = [], sortTasks = (items) => items) {
  if (!node) {
    return [];
  }

  return sortTasks(tasks.filter((task) => task.node_id === node.id));
}

export function getProbesForNode(node, probes = [], sortProbes = (items) => items) {
  if (!node) {
    return [];
  }

  return sortProbes(probes.filter((probe) => probe.node_id === node.id));
}

export function resolveTaskNode(task, nodes = []) {
  return nodes.find((node) => node.id === task.node_id) || null;
}

export function getTaskDisplayTitle(task) {
  if (task?.title) {
    return task.title;
  }
  if (task?.type === "init_alpine") {
    return "初始化 Alpine";
  }
  if (task?.type === "restart_service") {
    return "重启服务";
  }
  if (task?.type === "panel_enroll") {
    return "同步到面板";
  }
  if (task?.type === "probe_node") {
    if (task?.trigger === "bootstrap_auto_probe") {
      return "自动首探";
    }
    if (task?.trigger === "scheduled_probe") {
      return "周期巡检";
    }
    if (task?.trigger === "manual_probe") {
      return "手动复探";
    }
    return "节点健康探测";
  }
  return task?.type || "平台任务";
}

export function getTaskSummary(task) {
  if (task?.note) {
    return task.note;
  }
  if (Array.isArray(task?.log_excerpt) && task.log_excerpt.length > 0) {
    return task.log_excerpt[task.log_excerpt.length - 1];
  }
  return "等待平台调度执行。";
}

export function formatTaskAttempt(task) {
  const attempt = Number(task?.attempt ?? 0);
  return attempt > 0 ? `第 ${attempt} 次` : "待执行";
}
