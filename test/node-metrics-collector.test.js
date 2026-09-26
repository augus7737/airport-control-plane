import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createMetricsCollectorDomain,
  parseCollectorOutput,
  summarizeCollectorOutput,
} from "../src/domain/metrics/collector.js";

// 两份 fixture 都是 2026-09-26 从真机采回来的原始 stdout（独角鲸云 巴西 / 美国洛杉矶），
// 保留真实数值口径：容器内存 128MB、宿主 meminfo 与 cgroup 不一致、美国节点上有外来 x-ui/xray。
const brazilOutput = `metric collector_version=1
metric mem_max_bytes=134217728
metric mem_current_bytes=12505088
metric mem_swap_current_bytes=864256
metric mem_swap_max_bytes=134217728
metric proc_memtotal_kb=131072
metric mem_events_max=395
metric mem_events_oom=0
metric mem_events_oom_kill=0
metric cpu_quota_pct=100
metric cpu_quota_source=cgroup_cpu_max
metric cpu_used_pct=1
metric cpu_usage_usec=36089435
metric cpu_nr_throttled=1
metric cpu_throttled_usec=33
metric pids_current=7
metric pids_max=2048
metric loadavg_1m=0.34
metric uptime_sec=200043
metric disk_total_mb=1024
metric disk_used_mb=66
metric disk_avail_mb=958
metric disk_used_pct=6
metric net_rx_bytes=79031210
metric net_tx_bytes=1756802
metric proc_total=10
metric listeners_source=netstat
metric listeners_total=2
proc 536|2844|sshd
proc 2287|1024|sh
listen 0.0.0.0:22|536/sshd: /usr/sbin/
listen :::22|536/sshd: /usr/sbin/
`;

const losAngelesOutput = `metric collector_version=1
metric mem_max_bytes=134217728
metric mem_current_bytes=125014016
metric cpu_quota_pct=100
metric cpu_quota_source=cgroup_cpu_max
metric cpu_used_pct=0
metric cpu_nr_throttled=2394
metric disk_total_mb=1024
metric disk_used_mb=195
metric net_rx_bytes=107520846
metric net_tx_bytes=7734503
metric proc_total=24
metric listeners_source=netstat
metric listeners_total=5
proc 535|3868|fail2ban-server
proc 317429|2936|sshd
listen 127.0.0.1:62789|8/bin/xray-linux-amd64
listen 0.0.0.0:22|9/sshd: /usr/sbin/
listen :::12942|8/bin/xray-linux-amd64
listen :::56316|4/x-ui
listen :::22|9/sshd: /usr/sbin/
`;

function createCollector(fixtures, options = {}) {
  const outputs = Array.isArray(fixtures) ? fixtures : [fixtures];
  const metricsBucketStore = [];
  const metricsSampleStore = [];
  const persisted = [];
  let clock = Date.parse("2026-09-26T09:00:00.000Z");
  let call = 0;

  const domain = createMetricsCollectorDomain({
    collectTimeoutMs: 5000,
    getNodeById: (nodeId) => (nodeId === "node_br" ? node : null),
    listNodes: () => [node],
    metricsBucketStore,
    metricsSampleStore,
    nowIso: () => new Date(clock++).toISOString(),
    persistMetricStore: async () => {
      persisted.push({ buckets: metricsBucketStore.length, samples: metricsSampleStore.length });
    },
    readFile: async () => "#!/bin/sh\necho metric collector_version=1\n",
    resolveExecutionTransport: async () =>
      options.transport === null
        ? null
        : { kind: "ssh-direct", label: "SSH 直连", command: "ssh", args: ["-T"], env: {} },
    scriptPath: "/nowhere/metrics-collect.sh",
    spawn: () => {
      const child = new EventEmitter();
      const fixture = outputs[Math.min(call, outputs.length - 1)];
      call += 1;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { write() {}, end() {}, on() {} };
      child.kill = () => {};
      setTimeout(() => {
        child.stdout.emit("data", Buffer.from(fixture));
        child.emit("close", 0, null);
      }, 0);
      return child;
    },
  });

  const node = {
    id: "node_br",
    status: "active",
    facts: { hostname: "narwhal-br" },
    labels: { provider: "独角鲸云" },
  };

  return { domain, metricsBucketStore, metricsSampleStore, persisted, node };
}

test("collector output parses into metrics, processes and listeners", () => {
  const parsed = parseCollectorOutput(brazilOutput);

  assert.equal(parsed.metrics.mem_max_bytes, 134217728);
  assert.equal(parsed.metrics.mem_current_bytes, 12505088);
  assert.equal(parsed.metrics.loadavg_1m, 0.34);
  assert.equal(parsed.metrics.cpu_quota_source, "cgroup_cpu_max");
  assert.equal(parsed.metrics.listeners_source, "netstat");
  assert.equal(parsed.processes.length, 2);
  assert.deepEqual(parsed.processes[0], { pid: 536, rss_kb: 2844, command: "sshd" });
  assert.equal(parsed.listeners.length, 2);
  assert.equal(parsed.listeners[0].address, "0.0.0.0:22");
  // 程序名里带空格也必须整段保留，按空白切列会把它截成 "536/sshd:"
  assert.equal(parsed.listeners[0].process, "536/sshd: /usr/sbin/");
});

test("empty or junk lines never produce NaN metrics", () => {
  const parsed = parseCollectorOutput(
    "metric pids_current=\nmetric disk_used_pct=abc\nmetric \nnoise line\nproc ||\n",
  );

  assert.equal(parsed.metrics.pids_current, null);
  assert.equal(parsed.metrics.disk_used_pct, null);
  // 全空的 proc 行直接丢掉：宁可少一条，也不要在图上画出 pid=null 的进程
  assert.equal(parsed.processes.length, 0);
});

test("foreign listeners are flagged separately from platform services", () => {
  const summary = summarizeCollectorOutput(parseCollectorOutput(losAngelesOutput));

  assert.equal(summary.foreign_listener_count, 3);
  assert.deepEqual(summary.foreign_ports.sort((a, b) => a - b), [12942, 56316, 62789]);
  // 内存口径必须取 cgroup 而不是宿主：125014016 是容器实际占用
  assert.equal(summary.mem_current_bytes, 125014016);
  assert.equal(summary.mem_max_bytes, 134217728);

  const clean = summarizeCollectorOutput(parseCollectorOutput(brazilOutput));
  assert.equal(clean.foreign_listener_count, 0);
  assert.deepEqual(clean.foreign_ports, []);
});

test("successful collection stores a sample and an hourly bucket", async () => {
  const { domain, metricsBucketStore, metricsSampleStore, persisted } = createCollector(brazilOutput);

  const result = await domain.collectMetrics([]);

  assert.equal(result.total, 1);
  assert.equal(result.success, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.samples[0].status, "success");
  assert.equal(metricsSampleStore.length, 1);
  assert.equal(metricsBucketStore.length, 1);
  assert.equal(persisted.length, 1, "collection must persist once per cycle");

  const buckets = domain.listMetricBuckets("node_br");
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].hour, "2026-09-26T09");
  assert.equal(buckets[0].sample_count, 1);
  assert.equal(buckets[0].mem_used_max_bytes, 12505088);
  assert.equal(buckets[0].mem_limit_bytes, 134217728);
  assert.equal(buckets[0].cpu_used_pct_avg, 1);
  assert.equal(buckets[0].oom_kill_seen, false);
  // 单样本小时桶没有区间，流量增量是未知而不是 0
  assert.equal(buckets[0].net_rx_bytes, null);
  assert.equal(buckets[0].net_tx_bytes, null);
});

test("cpu usage keeps sub-percent precision from the collector", async () => {
  const parsed = parseCollectorOutput(brazilOutput.replace("metric cpu_used_pct=1", "metric cpu_used_pct=0.40"));

  assert.equal(parsed.metrics.cpu_used_pct, 0.4);
  assert.equal(summarizeCollectorOutput(parsed).cpu_used_pct, 0.4);
});

test("two samples in the same hour average out and keep maxima", async () => {
  const secondSample = brazilOutput
    .replace("metric mem_current_bytes=12505088", "metric mem_current_bytes=25010176")
    .replace("metric cpu_used_pct=1", "metric cpu_used_pct=31")
    .replace("metric net_rx_bytes=79031210", "metric net_rx_bytes=79031210")
    .replace("metric net_tx_bytes=1756802", "metric net_tx_bytes=2756802");

  const { domain, metricsBucketStore } = createCollector([brazilOutput, secondSample]);

  await domain.collectMetrics(["node_br"]);
  await domain.collectMetrics(["node_br"]);

  assert.equal(metricsBucketStore.length, 1, "same hour must reuse one bucket");
  const [bucket] = domain.listMetricBuckets("node_br");
  assert.equal(bucket.sample_count, 2);
  assert.equal(bucket.cpu_used_pct_avg, 16);
  assert.equal(bucket.cpu_used_pct_max, 31);
  assert.equal(bucket.mem_used_avg_bytes, 18757632);
  assert.equal(bucket.mem_used_max_bytes, 25010176);
  assert.equal(bucket.net_tx_bytes, 1000000, "计数型指标按首末差值出增量");
});

test("collection without transport lands as a visible failure, not as missing data", async () => {
  const { domain, metricsSampleStore, metricsBucketStore, persisted } = createCollector(
    brazilOutput,
    { transport: null },
  );

  const result = await domain.collectMetrics(["node_br"]);

  assert.equal(result.success, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.samples[0].status, "unavailable");
  assert.match(result.samples[0].error, /执行通道/);
  assert.equal(metricsSampleStore.length, 1);
  // 失败必须留下小时痕迹，但只进 failed_count：count 是均值分母，不能被失败点稀释
  assert.equal(metricsBucketStore.length, 1);
  const [failureBucket] = domain.listMetricBuckets("node_br");
  assert.equal(failureBucket.sample_count, 0);
  assert.equal(failureBucket.failed_count, 1);
  assert.equal(failureBucket.cpu_used_pct_avg, null);
  assert.equal(failureBucket.mem_used_max_bytes, null);
  assert.equal(failureBucket.net_rx_bytes, null);
  assert.equal(persisted.length, 1);
});
