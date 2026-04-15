function clampPositiveInteger(value, fallback) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function addMs(isoTime, ms) {
  const base = typeof isoTime === "string" ? Date.parse(isoTime) : Date.now();
  const timestamp = Number.isFinite(base) ? base : Date.now();
  return new Date(timestamp + ms).toISOString();
}

function toTimestamp(value) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function createProbeSchedulerRuntime(dependencies) {
  const {
    buildProbeTask,
    executeProbeTask,
    enabled = true,
    intervalMs = 15 * 60 * 1000,
    batchSize = 4,
    jitterMs = 10 * 1000,
    listNodes,
    nowIso,
    minProbeGapMs = 10 * 60 * 1000,
    persistTaskStore,
    taskStore,
    upsertTaskRecord,
  } = dependencies;

  const schedulerState = {
    enabled: Boolean(enabled),
    running: false,
    interval_ms: clampPositiveInteger(intervalMs, 15 * 60 * 1000),
    batch_size: clampPositiveInteger(batchSize, 4),
    min_probe_gap_ms: clampPositiveInteger(minProbeGapMs, 10 * 60 * 1000),
    jitter_ms: clampPositiveInteger(jitterMs, 10 * 1000),
    next_run_at: null,
    last_run_at: null,
    last_finished_at: null,
    last_run_summary: null,
    last_error: null,
  };

  let activeTimer = null;

  function clearTimer() {
    if (!activeTimer) {
      return;
    }

    clearTimeout(activeTimer);
    activeTimer = null;
  }

  function hasPendingProbeTask(nodeId) {
    return taskStore.some((task) => {
      if (task?.node_id !== nodeId || task?.type !== "probe_node") {
        return false;
      }

      const status = String(task.status || "new").toLowerCase();
      return ["new", "queued", "running"].includes(status);
    });
  }

  function shouldScheduleNode(node, nowTime) {
    const status = String(node?.status || "new").toLowerCase();
    if (!["active", "degraded", "failed"].includes(status)) {
      return false;
    }

    if (hasPendingProbeTask(node.id)) {
      return false;
    }

    const lastProbeAt = toTimestamp(node?.last_probe_at);
    if (lastProbeAt > 0 && nowTime - lastProbeAt < schedulerState.min_probe_gap_ms) {
      return false;
    }

    return true;
  }

  function listCandidateNodes() {
    const nowTime = Date.now();

    return listNodes()
      .filter((node) => shouldScheduleNode(node, nowTime))
      .sort((left, right) => {
        const leftTime = toTimestamp(left?.last_probe_at || left?.registered_at);
        const rightTime = toTimestamp(right?.last_probe_at || right?.registered_at);
        return leftTime - rightTime;
      })
      .slice(0, schedulerState.batch_size);
  }

  function scheduleNextRun(delayMs = schedulerState.interval_ms) {
    if (!schedulerState.enabled) {
      schedulerState.next_run_at = null;
      return;
    }

    clearTimer();
    const safeDelay = Math.max(1000, clampPositiveInteger(delayMs, schedulerState.interval_ms));
    schedulerState.next_run_at = addMs(nowIso(), safeDelay);
    activeTimer = setTimeout(() => {
      void runCycle();
    }, safeDelay);
    activeTimer.unref?.();
  }

  async function runCycle() {
    if (!schedulerState.enabled) {
      schedulerState.next_run_at = null;
      return;
    }

    if (schedulerState.running) {
      scheduleNextRun(schedulerState.interval_ms);
      return;
    }

    schedulerState.running = true;
    schedulerState.last_run_at = nowIso();
    schedulerState.last_error = null;

    const summary = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      node_ids: [],
    };

    try {
      const nodes = listCandidateNodes();
      summary.total = nodes.length;
      summary.node_ids = nodes.map((node) => node.id);

      for (const node of nodes) {
        const task = buildProbeTask(node, {
          trigger: "scheduled_probe",
          reason: "scheduled_probe",
          probe_type: "full_stack",
          title: "周期巡检",
          note: "控制面按计划执行周期巡检，持续刷新管理链路、业务入口与 relay 上游状态。",
        });
        upsertTaskRecord(task);
        await persistTaskStore();

        const result = await executeProbeTask(task, {
          note: "控制面按计划执行周期巡检，正在执行综合探测并刷新链路健康状态。",
        });
        const status = String(result?.task?.status || "failed").toLowerCase();
        if (status === "success") {
          summary.success += 1;
        } else {
          summary.failed += 1;
        }
      }
    } catch (error) {
      schedulerState.last_error = error instanceof Error ? error.message : "unknown error";
    } finally {
      schedulerState.running = false;
      schedulerState.last_finished_at = nowIso();
      schedulerState.last_run_summary = summary;
      const nextDelay =
        schedulerState.interval_ms +
        Math.max(0, Math.min(schedulerState.jitter_ms, schedulerState.interval_ms / 4));
      scheduleNextRun(nextDelay);
    }
  }

  function startProbeScheduler() {
    if (!schedulerState.enabled) {
      schedulerState.next_run_at = null;
      return;
    }

    scheduleNextRun(
      Math.min(
        schedulerState.interval_ms,
        Math.max(2000, schedulerState.jitter_ms || 2000),
      ),
    );
  }

  function stopProbeScheduler() {
    clearTimer();
    schedulerState.running = false;
    schedulerState.next_run_at = null;
  }

  function getProbeSchedulerState() {
    return {
      ...schedulerState,
      last_run_summary: schedulerState.last_run_summary
        ? {
            ...schedulerState.last_run_summary,
            node_ids: [...schedulerState.last_run_summary.node_ids],
          }
        : null,
    };
  }

  return {
    getProbeSchedulerState,
    runProbeSchedulerCycle: runCycle,
    startProbeScheduler,
    stopProbeScheduler,
  };
}
