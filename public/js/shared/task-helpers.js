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

export function getDiagnosticsForNode(node, diagnostics = [], sortDiagnostics = (items) => items) {
  if (!node) {
    return [];
  }

  return sortDiagnostics(diagnostics.filter((diagnostic) => diagnostic.node_id === node.id));
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
  if (task?.type === "node_diagnostic") {
    const profile = String(task?.payload?.profile || "").toLowerCase();
    return profile === "deep" ? "深度诊断" : "轻量诊断";
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

const TASK_STATUS_LABELS = {
  new: "待执行",
  queued: "排队中",
  running: "执行中",
  success: "已成功",
  failed: "失败",
  partial: "部分成功",
};

export function taskStatusText(status) {
  const value = String(status || "new").toLowerCase();
  return TASK_STATUS_LABELS[value] || value;
}

export function taskStatusClassName(status) {
  const value = String(status || "new").toLowerCase();
  if (value === "success") {
    return "badge badge-active";
  }
  if (value === "failed") {
    return "badge badge-degraded";
  }
  if (value === "running") {
    return "badge badge-running";
  }
  if (value === "queued" || value === "partial") {
    return "badge badge-new";
  }
  return "badge badge-new";
}

export function resolveTaskTimestamp(task) {
  return task?.scheduled_at || task?.created_at || null;
}

export function formatTaskRound(task) {
  const attempt = Number(task?.attempt ?? 0);
  return attempt > 0 ? `第 ${attempt} 轮` : "尚未执行";
}
