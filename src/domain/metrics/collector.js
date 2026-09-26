const NUMERIC_METRIC_KEYS = [
  "collector_version",
  "cpu_nr_throttled",
  "cpu_quota_pct",
  "cpu_throttled_usec",
  "cpu_used_pct",
  "cpu_usage_usec",
  "disk_avail_mb",
  "disk_total_mb",
  "disk_used_mb",
  "disk_used_pct",
  "loadavg_1m",
  "listeners_total",
  "mem_current_bytes",
  "mem_events_max",
  "mem_events_oom",
  "mem_events_oom_kill",
  "mem_max_bytes",
  "mem_swap_current_bytes",
  "mem_swap_max_bytes",
  "net_rx_bytes",
  "net_tx_bytes",
  "pids_current",
  "pids_max",
  "proc_memtotal_kb",
  "proc_total",
  "uptime_sec",
];

const STRING_METRIC_KEYS = ["cpu_quota_source", "listeners_source"];

function toNumber(value) {
  const text = String(value ?? "").trim();
  // Number("") === 0：空字段必须留成 null，否则图上会出现"内存占用 0 字节"这种假数据
  if (!text) {
    return null;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function normalizeMetricValue(key, raw) {
  if (NUMERIC_METRIC_KEYS.includes(key)) {
    return toNumber(raw);
  }
  if (STRING_METRIC_KEYS.includes(key)) {
    const text = String(raw ?? "").trim();
    return text || null;
  }
  return String(raw ?? "").trim() || null;
}

export function parseCollectorOutput(text) {
  const metrics = {};
  const processes = [];
  const listeners = [];
  const lines = String(text ?? "").split("\n");

  for (const line of lines) {
    if (line.startsWith("metric ")) {
      const body = line.slice(7);
      const separator = body.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      const key = body.slice(0, separator).trim();
      metrics[key] = normalizeMetricValue(key, body.slice(separator + 1));
      continue;
    }

    if (line.startsWith("proc ")) {
      const [pid, rss, ...rest] = line.slice(5).split("|");
      if (pid) {
        processes.push({ pid: toNumber(pid), rss_kb: toNumber(rss), command: rest.join("|") || null });
      }
      continue;
    }

    if (line.startsWith("listen ")) {
      const [address, ...rest] = line.slice(7).split("|");
      if (address) {
        listeners.push({ address: address.trim(), process: rest.join("|").trim() || null });
      }
    }
  }

  return { metrics, processes, listeners };
}

function portOf(address) {
  const text = String(address || "");
  const match = text.match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function isPlatformListener(listener) {
  const detail = `${listener?.address || ""} ${listener?.process || ""}`.toLowerCase();
  // 平台只拉起 sing-box 与 sshd；其余监听端口都是节点上原本就在跑的东西。
  return /sing-box|sshd|systemd\b.*ssh/.test(detail);
}

export function summarizeCollectorOutput(parsed) {
  const metrics = parsed?.metrics || {};
  const listeners = Array.isArray(parsed?.listeners) ? parsed.listeners : [];
  const foreignListeners = listeners.filter((listener) => !isPlatformListener(listener));

  return {
    mem_max_bytes: metrics.mem_max_bytes ?? null,
    mem_current_bytes: metrics.mem_current_bytes ?? null,
    cpu_quota_pct: metrics.cpu_quota_pct ?? null,
    cpu_used_pct: metrics.cpu_used_pct ?? null,
    cpu_nr_throttled: metrics.cpu_nr_throttled ?? null,
    disk_total_mb: metrics.disk_total_mb ?? null,
    disk_used_mb: metrics.disk_used_mb ?? null,
    net_rx_bytes: metrics.net_rx_bytes ?? null,
    net_tx_bytes: metrics.net_tx_bytes ?? null,
    loadavg_1m: metrics.loadavg_1m ?? null,
    pids_current: metrics.pids_current ?? null,
    proc_total: metrics.proc_total ?? null,
    foreign_listener_count: foreignListeners.length,
    foreign_ports: foreignListeners
      .map((listener) => portOf(listener.address))
      .filter((value) => Number.isFinite(value)),
  };
}

export function createMetricsCollectorDomain(dependencies) {
  const {
    cwdProvider = () => process.cwd(),
    collectTimeoutMs,
    getNodeById,
    listNodes,
    metricSampleLimit = 240,
    metricsBucketStore,
    metricsSampleStore,
    nowIso,
    persistMetricStore,
    readFile,
    resolveExecutionTransport,
    scriptPath,
    spawn,
  } = dependencies;

  const defaultCollectTimeoutMs =
    Number.isFinite(Number(collectTimeoutMs)) && Number(collectTimeoutMs) > 0
      ? Number(collectTimeoutMs)
      : 30000;

  let scriptCache = null;

  function terminateChildProcess(child) {
    if (!child || child.killed) {
      return;
    }
    try {
      child.kill("SIGKILL");
    } catch {
      // 进程可能已经自行退出，这里不需要额外处理。
    }
  }

  async function loadCollectorScript(force = false) {
    if (scriptCache && !force) {
      return scriptCache;
    }
    scriptCache = await readFile(scriptPath, "utf8");
    return scriptCache;
  }

  function buildSpawnSpec(transport) {
    if (transport.kind === "local-demo") {
      return {
        command: transport.command,
        args: ["-s"],
        env: { ...transport.env, AIRPORT_EXECUTION_CONTEXT: "metrics-collect" },
      };
    }
    return { command: transport.command, args: [...transport.args, "sh", "-s", "--"], env: transport.env };
  }

  function runCollector(spawnSpec, scriptBody, timeoutMs) {
    return new Promise((resolve) => {
      let output = "";
      let settled = false;
      let timedOut = false;
      let timer = null;

      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolve(result);
      };

      const child = spawn(spawnSpec.command, spawnSpec.args, {
        cwd: cwdProvider(),
        env: spawnSpec.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const append = (chunk) => {
        // 采集输出很小，但仍设上限，避免异常节点把控制面内存吃掉。
        if (output.length < 64000) {
          output += chunk.toString();
        }
      };

      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.stdin.on("error", () => {});

      child.on("error", (error) => {
        finish({ output, exit_code: null, signal: null, timed_out: false, error: error.message });
      });

      child.on("close", (code, signal) => {
        finish({ output, exit_code: timedOut ? 124 : code, signal, timed_out: timedOut, error: null });
      });

      child.stdin.write(scriptBody);
      child.stdin.end();

      timer = setTimeout(() => {
        timedOut = true;
        output += "\n[control-plane] 采集超时，已终止。\n";
        terminateChildProcess(child);
      }, timeoutMs);
      timer.unref?.();
    });
  }

  function hourKey(isoTime) {
    return String(isoTime || "").slice(0, 13);
  }

  function mergeBucket(bucket, sample) {
    const metrics = sample.metrics || {};
    const numericAvg = [
      "cpu_used_pct",
      "mem_current_bytes",
      "mem_swap_current_bytes",
      "loadavg_1m",
      "pids_current",
    ];
    const numericMax = [
      "cpu_used_pct",
      "cpu_nr_throttled",
      "cpu_throttled_usec",
      "mem_current_bytes",
      "loadavg_1m",
      "pids_current",
      "mem_events_max",
      "mem_events_oom",
      "mem_events_oom_kill",
    ];

    bucket.count += 1;
    bucket.updated_at = sample.collected_at;

    for (const key of numericAvg) {
      const value = metrics[key];
      if (Number.isFinite(value)) {
        bucket[`sum_${key}`] = (bucket[`sum_${key}`] ?? 0) + value;
      }
    }

    for (const key of numericMax) {
      const value = metrics[key];
      if (Number.isFinite(value) && !(Number.isFinite(bucket[`max_${key}`]) && bucket[`max_${key}`] >= value)) {
        bucket[`max_${key}`] = value;
      }
    }

    // 磁盘与配额取最后一个值；网络计数取首末，用于算本小时增量。
    for (const key of ["disk_used_mb", "disk_total_mb", "disk_used_pct", "mem_max_bytes", "cpu_quota_pct"]) {
      if (Number.isFinite(metrics[key])) {
        bucket[`last_${key}`] = metrics[key];
      }
    }
    if (Number.isFinite(metrics.net_rx_bytes)) {
      bucket.first_net_rx_bytes = bucket.first_net_rx_bytes ?? metrics.net_rx_bytes;
      bucket.last_net_rx_bytes = metrics.net_rx_bytes;
    }
    if (Number.isFinite(metrics.net_tx_bytes)) {
      bucket.first_net_tx_bytes = bucket.first_net_tx_bytes ?? metrics.net_tx_bytes;
      bucket.last_net_tx_bytes = metrics.net_tx_bytes;
    }

    if (sample.status !== "success") {
      bucket.failed_count += 1;
    } else {
      bucket.max_proc_total = Number.isFinite(metrics.proc_total)
        ? Math.max(bucket.max_proc_total ?? 0, metrics.proc_total)
        : bucket.max_proc_total ?? null;
      if (Number.isFinite(metrics.mem_events_oom_kill) && metrics.mem_events_oom_kill > 0) {
        bucket.oom_kill_seen = true;
      }
    }
  }

  function hourBucket(nodeId, hour, startedAt) {
    let bucket = metricsBucketStore.find(
      (item) => item.node_id === nodeId && item.hour === hour,
    );
    if (!bucket) {
      bucket = {
        node_id: nodeId,
        hour,
        count: 0,
        failed_count: 0,
        started_at: startedAt,
        updated_at: startedAt,
      };
      metricsBucketStore.push(bucket);
    }
    return bucket;
  }

  function recordSample(sample) {
    metricsSampleStore.unshift(sample);
    if (metricsSampleStore.length > metricSampleLimit) {
      metricsSampleStore.length = metricSampleLimit;
    }

    const hour = hourKey(sample.collected_at);
    if (sample.status !== "success") {
      // 失败也要留下小时痕迹，否则"这一小时没采到"和"这一小时没事发生"在数据上无法区分。
      // 只记 failed_count：count 是均值分母，掺进失败点会把平均值稀释。
      const bucket = hourBucket(sample.node_id, hour, sample.collected_at);
      bucket.failed_count += 1;
      bucket.updated_at = sample.collected_at;
      return bucket;
    }

    const bucket = hourBucket(sample.node_id, hour, sample.collected_at);
    mergeBucket(bucket, sample);
    return bucket;
  }

  function pruneBuckets(nowTime) {
    const cutoff = hourKey(new Date(nowTime - 30 * 24 * 60 * 60 * 1000).toISOString());
    if (!cutoff) {
      return;
    }
    for (let index = metricsBucketStore.length - 1; index >= 0; index -= 1) {
      const bucket = metricsBucketStore[index];
      if (String(bucket.hour || "") < cutoff) {
        metricsBucketStore.splice(index, 1);
      }
    }
  }

  async function collectNode(node, options = {}) {
    const startedAt = nowIso();
    const base = {
      id: `metric_${startedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}_${node.id.slice(-6)}`,
      node_id: node.id,
      hostname: node.facts?.hostname || node.name || node.id,
      collected_at: startedAt,
    };

    const transport = await resolveExecutionTransport(node);
    if (!transport) {
      return { ...base, status: "unavailable", error: "当前节点缺少可用执行通道", metrics: {}, processes: [], listeners: [], summary: null };
    }

    let script;
    try {
      script = await loadCollectorScript(options.forceReloadScript);
    } catch (error) {
      return {
        ...base,
        status: "failed",
        error: `采集脚本不可读: ${error instanceof Error ? error.message : "unknown"}`,
        metrics: {},
        processes: [],
        listeners: [],
      };
    }

    const timeoutMs = defaultCollectTimeoutMs;
    const execution = await runCollector(buildSpawnSpec(transport), script, timeoutMs);
    const finishedAt = nowIso();
    const parsed = parseCollectorOutput(execution.output);
    const metricCount = Object.keys(parsed.metrics).length;
    const success = !execution.timed_out && execution.exit_code === 0 && metricCount > 0;

    return {
      ...base,
      finished_at: finishedAt,
      duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      status: success ? "success" : "failed",
      error: success
        ? null
        : execution.timed_out
          ? "采集超时"
          : metricCount === 0
            ? `采集脚本无输出（exit=${execution.exit_code ?? "-"}）`
            : `采集脚本部分失败（exit=${execution.exit_code ?? "-"}）`,
      transport_kind: transport.kind,
      transport_label: transport.label,
      metrics: parsed.metrics,
      processes: parsed.processes,
      listeners: parsed.listeners,
      summary: summarizeCollectorOutput(parsed),
      raw_excerpt: success ? null : String(execution.output || "").slice(-600),
    };
  }

  async function collectMetrics(nodeIds = []) {
    const requested = Array.isArray(nodeIds) && nodeIds.length > 0
      ? nodeIds.map((id) => getNodeById(id)).filter(Boolean)
      : listNodes().filter((node) =>
          ["active", "degraded", "failed"].includes(String(node?.status || "").toLowerCase()),
        );

    const samples = [];
    for (const node of requested) {
      const sample = await collectNode(node);
      recordSample(sample);
      samples.push(sample);
    }

    pruneBuckets(Date.now());
    await persistMetricStore();

    return {
      collected_at: nowIso(),
      total: requested.length,
      success: samples.filter((item) => item.status === "success").length,
      failed: samples.filter((item) => item.status !== "success").length,
      samples,
    };
  }

  function publicBucket(bucket) {
    const count = bucket.count || 1;
    const avg = (key) =>
      Number.isFinite(bucket[`sum_${key}`]) ? Math.round((bucket[`sum_${key}`] / count) * 100) / 100 : null;
    const pick = (key) => (Number.isFinite(bucket[`max_${key}`]) ? bucket[`max_${key}`] : null);
    const last = (key) => (Number.isFinite(bucket[`last_${key}`]) ? bucket[`last_${key}`] : null);
    // 只有一个样本时首末相等，增量不是 0 而是未知
    const netDelta = (prefix) =>
      bucket.count >= 2 &&
      Number.isFinite(bucket[`last_${prefix}_bytes`]) &&
      Number.isFinite(bucket[`first_${prefix}_bytes`])
        ? Math.max(0, bucket[`last_${prefix}_bytes`] - bucket[`first_${prefix}_bytes`])
        : null;

    return {
      node_id: bucket.node_id,
      hour: bucket.hour,
      sample_count: bucket.count,
      failed_count: bucket.failed_count,
      cpu_used_pct_avg: avg("cpu_used_pct"),
      cpu_used_pct_max: pick("cpu_used_pct"),
      cpu_quota_pct: last("cpu_quota_pct"),
      mem_used_avg_bytes: avg("mem_current_bytes"),
      mem_used_max_bytes: pick("mem_current_bytes"),
      mem_limit_bytes: last("mem_max_bytes"),
      mem_swap_avg_bytes: avg("mem_swap_current_bytes"),
      mem_events_max: pick("mem_events_max"),
      oom_kill_seen: Boolean(bucket.oom_kill_seen),
      cpu_nr_throttled_max: pick("cpu_nr_throttled"),
      loadavg_1m_avg: avg("loadavg_1m"),
      loadavg_1m_max: pick("loadavg_1m"),
      pids_current_max: pick("pids_current"),
      proc_total_max: Number.isFinite(bucket.max_proc_total) ? bucket.max_proc_total : null,
      disk_used_mb: last("disk_used_mb"),
      disk_total_mb: last("disk_total_mb"),
      disk_used_pct: last("disk_used_pct"),
      net_rx_bytes: netDelta("net_rx"),
      net_tx_bytes: netDelta("net_tx"),
      updated_at: bucket.updated_at,
    };
  }

  function listMetricBuckets(nodeId = null) {
    return metricsBucketStore
      .filter((bucket) => !nodeId || bucket.node_id === nodeId)
      .map(publicBucket)
      .sort((left, right) => String(right.hour).localeCompare(String(left.hour)));
  }

  function listMetricSamples(nodeId = null, limit = 40) {
    return metricsSampleStore
      .filter((sample) => (!nodeId ? true : sample.node_id === nodeId) && sample.status === "success")
      .slice(0, limit);
  }

  return {
    collectMetrics,
    listMetricBuckets,
    listMetricSamples,
    parseCollectorOutput,
    summarizeCollectorOutput,
  };
}
