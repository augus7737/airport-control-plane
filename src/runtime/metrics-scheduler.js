function clampPositiveInteger(value, fallback) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function createMetricsSchedulerRuntime(dependencies) {
  const {
    collectMetrics,
    enabled = true,
    intervalMs = 5 * 60 * 1000,
    jitterMs = 15 * 1000,
    listNodes,
    nowIso,
  } = dependencies;

  const state = {
    enabled: Boolean(enabled),
    running: false,
    interval_ms: clampPositiveInteger(intervalMs, 5 * 60 * 1000),
    next_run_at: null,
    last_run_at: null,
    last_finished_at: null,
    last_run_summary: null,
    last_error: null,
  };

  let timer = null;

  function clearTimer() {
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    timer = null;
  }

  function scheduleNextRun(delayMs = state.interval_ms) {
    if (!state.enabled) {
      state.next_run_at = null;
      return;
    }
    clearTimer();
    const safeDelay = Math.max(1000, clampPositiveInteger(delayMs, state.interval_ms));
    state.next_run_at = new Date(Date.parse(nowIso()) + safeDelay).toISOString();
    timer = setTimeout(() => {
      void runCycle();
    }, safeDelay);
    timer.unref?.();
  }

  async function runCycle() {
    if (!state.enabled || state.running) {
      return null;
    }

    state.running = true;
    state.last_run_at = nowIso();
    state.last_error = null;
    const startedAt = Date.now();

    try {
      const nodeCount = listNodes().length;
      if (nodeCount === 0) {
        state.last_run_summary = { total: 0, success: 0, failed: 0, skipped_reason: "no_nodes" };
      } else {
        const summary = await collectMetrics([]);
        state.last_run_summary = {
          total: summary.total,
          success: summary.success,
          failed: summary.failed,
          skipped_reason: null,
        };
      }
      return state.last_run_summary;
    } catch (error) {
      state.last_error = error instanceof Error ? error.message : "unknown error";
      return null;
    } finally {
      state.running = false;
      state.last_finished_at = nowIso();
      const elapsed = Math.max(0, Date.now() - startedAt);
      scheduleNextRun(
        Math.max(1000, state.interval_ms - elapsed + Math.min(clampPositiveInteger(jitterMs, 15000), state.interval_ms / 4)),
      );
    }
  }

  function startMetricsScheduler() {
    if (!state.enabled) {
      state.next_run_at = null;
      return;
    }
    // 启动后先等一个短抖动再采一次：控制面重启时节点列表已经落盘，
    // 但没有样本的监控页在运维眼里等同于坏掉。
    scheduleNextRun(Math.max(2000, clampPositiveInteger(jitterMs, 15000)));
  }

  function stopMetricsScheduler() {
    clearTimer();
    state.running = false;
    state.next_run_at = null;
  }

  function getMetricsSchedulerState() {
    return {
      ...state,
      last_run_summary: state.last_run_summary ? { ...state.last_run_summary } : null,
    };
  }

  return {
    getMetricsSchedulerState,
    runMetricsSchedulerCycle: runCycle,
    startMetricsScheduler,
    stopMetricsScheduler,
  };
}
