const REFRESH_INTERVAL_MS = 60 * 1000;

function formatBytes(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Math.max(0, value);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const text = index === 0 || size >= 10 ? String(Math.round(size)) : size.toFixed(1);
  return `${text} ${units[index]}`;
}

function formatMegabytes(value) {
  return Number.isFinite(value) ? formatBytes(value * 1024 * 1024) : "—";
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function ratioPct(used, total) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, (used / total) * 100));
}

function toneFor(pct) {
  if (pct === null) {
    return "";
  }
  if (pct >= 90) {
    return "tone-danger";
  }
  if (pct >= 75) {
    return "tone-warn";
  }
  return "";
}

function hourLabel(hour) {
  const text = String(hour || "");
  return text.length >= 13 ? `${text.slice(11, 13)} 时` : text;
}

export function createMetricsPageModule(dependencies) {
  const {
    appState,
    collectNodeMetrics,
    documentRef,
    escapeHtml,
    formatRelativeTime,
    getCollectionHealth = () => null,
    getNodeDisplayName = (node) => node?.id || "",
    nodeDetailHref = (nodeId) => `/node.html?id=${encodeURIComponent(nodeId)}`,
    page,
    refreshMetrics,
    renderCurrentContent,
    statusClassName,
    statusText,
    windowRef,
  } = dependencies;

  function latestSample(nodeId) {
    return appState.metrics.samples.find((sample) => sample.node_id === nodeId) || null;
  }

  function latestFailure(nodeId) {
    return appState.metrics.failures.find((item) => item.node_id === nodeId) || null;
  }

  function nodeBuckets(nodeId) {
    return appState.metrics.buckets.filter((bucket) => bucket.node_id === nodeId);
  }

  function renderMeter(label, pct, valueText, subText) {
    const isUnknown = pct === null;
    return `
      <div class="metric-meter${isUnknown ? " meter-unknown" : ""}">
        <div class="metric-meter-head">
          <span class="stat-label">${escapeHtml(label)}</span>
          <strong>${escapeHtml(valueText)}</strong>
        </div>
        <div class="bar" role="img" aria-label="${escapeHtml(`${label} ${valueText}`)}">
          <span class="${toneFor(pct)}" style="width:${isUnknown ? 0 : Math.round(pct)}%"></span>
        </div>
        <div class="metric-meter-foot">${escapeHtml(subText)}</div>
      </div>
    `;
  }

  function renderSparkline(buckets) {
    if (buckets.length === 0) {
      return "";
    }
    const valueOf = (bucket) =>
      Number.isFinite(bucket.cpu_used_pct_max) ? bucket.cpu_used_pct_max : bucket.cpu_used_pct_avg;
    const finite = buckets.map(valueOf).filter((value) => Number.isFinite(value));
    // 这些机器常年跑在 1% 以下：按配额出图会是一条看不见的平线，所以形状按窗口峰值归一，
    // 颜色仍按占配额的比例，趋势可读、严重程度也不会被夸大。
    const peak = finite.length ? Math.max(...finite) : 0;
    const bars = buckets
      .map((bucket) => {
        const value = valueOf(bucket);
        const pct = ratioPct(value, Number.isFinite(bucket.cpu_quota_pct) ? bucket.cpu_quota_pct : 100);
        const height =
          !Number.isFinite(value) || value <= 0
            ? 0
            : Math.max(12, Math.min(100, (value / peak) * 100));
        return `<i class="${toneFor(pct)}" style="height:${Math.round(height)}%" title="${escapeHtml(
          `${hourLabel(bucket.hour)} CPU ${formatNumber(value)}% / 内存 ${formatNumber(
            ratioPct(bucket.mem_used_max_bytes, bucket.mem_limit_bytes),
          )}%`,
        )}"></i>`;
      })
      .join("");
    const first = hourLabel(buckets[0].hour);
    const last = hourLabel(buckets[buckets.length - 1].hour);
    return `
      <div class="metric-spark">
        <div class="metric-spark-head">
          <span class="tiny muted">CPU 趋势（按窗口峰值归一）</span>
          <span class="tiny mono">峰值 ${escapeHtml(formatNumber(peak))}%</span>
        </div>
        <div class="metric-spark-bars" aria-hidden="true">${bars}</div>
        <div class="metric-spark-axis"><span>${escapeHtml(first)}</span><span>${escapeHtml(last)}</span></div>
      </div>
    `;
  }

  function renderForeignListeners(sample) {
    const listeners = Array.isArray(sample?.listeners) ? sample.listeners : [];
    if (listeners.length === 0) {
      return "";
    }
    // 与后端 summarizeCollectorOutput 同一口径：平台只拉起 sing-box 与 sshd。
    const isPlatform = (listener) =>
      /sing-box|sshd|systemd\b.*ssh/.test(`${listener?.address || ""} ${listener?.process || ""}`.toLowerCase());
    const portOf = (listener) => String(listener.address || "").match(/:(\d+)$/)?.[1] || listener.address;
    // netstat 的 PID/程序列会被截断成 "658/bin/xray-linux-"，取可读的那段
    const nameOf = (listener) => {
      const raw = String(listener.process || "").replace(/^\d+\//, "").split(/\s/)[0];
      const base = raw.split("/").pop().replace(/-+$/, "");
      return base || "?";
    };
    // v4/v6 各占一条记录，端口要去重后再展示
    const ports = [...new Set(listeners.map(portOf))];
    const foreign = listeners.filter((listener) => !isPlatform(listener));
    const foreignPorts = [...new Set(foreign.map(portOf))];
    if (foreignPorts.length === 0) {
      return `
        <div class="metric-listeners ok">监听 ${ports.length} 个端口（${escapeHtml(
          ports.join("、"),
        )}），全部由平台服务持有。</div>
      `;
    }
    const items = [...new Map(
      foreign.map((listener) => [portOf(listener), nameOf(listener)]),
    ).entries()]
      .map(([port, name]) => `<span class="metric-port mono">${escapeHtml(`${port} · ${name}`)}</span>`)
      .join("");
    return `
      <div class="metric-listeners warn">
        <span>外来监听 ${foreignPorts.length}/${ports.length} 个端口：${
          foreignPorts.length
        } 个不是平台起的进程</span>
        <div class="metric-listener-pills">${items}</div>
      </div>
    `;
  }

  // 桶按小时倒序；首末相差的小时数就是这些计数器覆盖的窗口
  function hourSpan(buckets) {
    const toTime = (hour) => Date.parse(`${String(hour).slice(0, 13)}:00:00Z`);
    const oldest = toTime(buckets[buckets.length - 1]?.hour);
    const newest = toTime(buckets[0]?.hour);
    if (!Number.isFinite(oldest) || !Number.isFinite(newest)) {
      return null;
    }
    return Math.max(1, Math.round((newest - oldest) / 3600000) + 1);
  }

  function renderAlerts(sample, buckets) {
    const newest = buckets[0] || null;
    const oldest = buckets[buckets.length - 1] || null;
    const span = hourSpan(buckets);
    const windowText = span === null ? "" : ` · 近 ${span} 小时`;
    const alerts = [];
    // cgroup 计数器自容器创建起一直累加，只有窗口内的增量才说明"现在还在发生"
    const growth = (key) => {
      const last = Number(newest?.[key]);
      const first = Number(oldest?.[key]);
      return Number.isFinite(last) && Number.isFinite(first) ? Math.max(0, last - first) : 0;
    };
    const throttled = growth("cpu_nr_throttled_max");
    if (throttled > 0) {
      alerts.push(
        `<span class="metric-chip warn" title="累计 ${
          Number(newest?.cpu_nr_throttled_max) || 0
        } 次">CPU 限流 +${throttled} 次${windowText}</span>`,
      );
    }
    const memEvents = growth("mem_events_max");
    if (memEvents > 0) {
      alerts.push(
        `<span class="metric-chip warn" title="累计 ${
          Number(newest?.mem_events_max) || 0
        } 次">内存触顶 +${memEvents} 次${windowText}</span>`,
      );
    }
    const oomBucket = buckets.find((bucket) => bucket.oom_kill_seen);
    if (oomBucket) {
      alerts.push(`<span class="metric-chip danger">${escapeHtml(hourLabel(oomBucket.hour))}发生过 OOM Kill</span>`);
    }
    const failedCount = buckets.reduce((total, bucket) => total + Number(bucket.failed_count || 0), 0);
    if (failedCount > 0) {
      alerts.push(
        `<span class="metric-chip danger">采集失败 ${failedCount} 次${windowText}</span>`,
      );
    }
    return alerts.length ? `<div class="metric-alerts">${alerts.join("")}</div>` : "";
  }

  function renderNodeCard(node) {
    const sample = latestSample(node.id);
    const buckets = nodeBuckets(node.id);
    const failure = latestFailure(node.id);
    const metrics = sample?.metrics || {};
    const summary = sample?.summary || {};
    const displayName = getNodeDisplayName(node);
    const hostLabel = sample?.hostname || node.id;
    // 有的厂商把容器主机名给成 UUID，光看名字分不清是哪台，所以副行固定给归属
    const ownershipLabel = `${node.labels?.provider || "未标记"} / ${node.labels?.region || "-"}`;

    const quotaPct = Number.isFinite(summary.cpu_quota_pct) ? summary.cpu_quota_pct : null;
    const cpuPct = ratioPct(summary.cpu_used_pct, quotaPct ?? 100);
    const memPct = ratioPct(summary.mem_current_bytes, summary.mem_max_bytes);
    // summary 只给绝对值，占比在前端按同一口径现算
    const diskPct = ratioPct(summary.disk_used_mb, summary.disk_total_mb);

    const latestBucket = buckets[0] || null;
    // 增量要两个点才算得出来：本小时只有 1 次采样时退到最近一个有区间的小时
    const netBucket =
      buckets.find((bucket) => bucket.net_rx_bytes !== null || bucket.net_tx_bytes !== null) || null;
    const netText = netBucket
      ? `↓ ${formatBytes(netBucket.net_rx_bytes)} · ↑ ${formatBytes(netBucket.net_tx_bytes)}`
      : "↓ — · ↑ —";

    const body = sample
      ? `
        <div class="metric-meters">
          ${renderMeter(
            "CPU",
            cpuPct,
            `${formatNumber(summary.cpu_used_pct)}%`,
            quotaPct === null ? "配额未知，按 1 核折算" : `配额 ${formatNumber(quotaPct / 100, 2)} 核`,
          )}
          ${renderMeter(
            "内存",
            memPct,
            memPct === null ? "—" : `${Math.round(memPct)}%`,
            `${formatBytes(summary.mem_current_bytes)} / ${formatBytes(summary.mem_max_bytes)}`,
          )}
          ${renderMeter(
            "磁盘 /",
            diskPct,
            diskPct === null ? "—" : `${Math.round(diskPct)}%`,
            `${formatMegabytes(summary.disk_used_mb)} / ${formatMegabytes(summary.disk_total_mb)}`,
          )}
        </div>
        <div class="metric-facts">
          <div class="metric-fact"><span>负载 1m</span><strong>${formatNumber(summary.loadavg_1m, 2)}</strong></div>
          <div class="metric-fact"><span>进程</span><strong>${Number.isFinite(summary.proc_total) ? summary.proc_total : "—"}</strong></div>
          <div class="metric-fact"><span>${
            netBucket && netBucket.hour !== latestBucket?.hour
              ? `${hourLabel(netBucket.hour)}流量`
              : "本小时流量"
          }</span><strong>${escapeHtml(netText)}</strong></div>
          <div class="metric-fact"><span>本小时采样</span><strong>${latestBucket?.sample_count ?? 0} 次</strong></div>
        </div>
        ${renderAlerts(sample, buckets)}
        ${renderSparkline([...buckets].slice(0, 12).reverse())}
        ${renderForeignListeners(sample)}
        <div class="metric-card-foot">
          <span class="tiny muted">采集于 ${escapeHtml(formatRelativeTime(sample.collected_at))} · ${escapeHtml(
            sample.transport_label || sample.transport_kind || "-",
          )}${Number.isFinite(sample.duration_ms) ? ` · ${Math.round(sample.duration_ms / 100) / 10}s` : ""}</span>
          <button class="button quiet" type="button" data-metric-collect="${escapeHtml(
            node.id,
          )}"${appState.metrics.isCollecting ? " disabled" : ""}>采集这台</button>
        </div>
        ${
          failure
            ? `<div class="metric-card-failure tiny">最近一次采集失败：${escapeHtml(failure.error || "未知原因")}</div>`
            : ""
        }
      `
      : `
        <div class="metric-card-empty">
          <div class="empty">${
            failure
              ? `这台节点还没有可用数据：${escapeHtml(failure.error || "采集失败")}。`
              : "这台节点还没有采集记录。调度器每轮会自动采一次，也可以手动触发。"
          }</div>
          <button class="button ghost" type="button" data-metric-collect="${escapeHtml(node.id)}">立即采集</button>
        </div>
      `;

    return `
      <article class="panel metric-card">
        <div class="panel-body">
          <div class="metric-card-head">
            <div class="node-meta">
              <a class="node-name" href="${escapeHtml(nodeDetailHref(node.id))}" title="${escapeHtml(hostLabel)}">${escapeHtml(displayName)}</a>
              <span class="node-id" title="${escapeHtml(ownershipLabel)}">${escapeHtml(ownershipLabel)}</span>
            </div>
            <span class="${statusClassName(node.status)}">${escapeHtml(statusText(node.status))}</span>
          </div>
          ${body}
        </div>
      </article>
    `;
  }

  function renderSchedulerPanel() {
    const scheduler = appState.metrics.scheduler;
    const health = getCollectionHealth("metrics");
    if (!scheduler) {
      return `
        <div class="kv-row"><span>调度状态</span><strong>${
          health?.status === "error" ? "读取失败" : "未知"
        }</strong></div>
        ${
          health?.status === "error"
            ? `<div class="tiny muted">监控数据读取失败（${escapeHtml(
                health.error || "未知原因",
              )}），这里的空白不代表节点没有跑。</div>`
            : ""
        }
      `;
    }
    const summary = scheduler.last_run_summary || null;
    const summaryText = summary
      ? summary.skipped_reason === "no_nodes"
        ? "台账为空，本轮跳过"
        : `成功 ${summary.success} / 失败 ${summary.failed} / 共 ${summary.total}`
      : "还没有跑过";
    return `
      <div class="detail-kv">
        <div class="kv-row"><span>自动采集</span><strong>${scheduler.enabled ? "已开启" : "已关闭"}</strong></div>
        <div class="kv-row"><span>周期</span><strong>${Math.round((scheduler.interval_ms || 0) / 60000)} 分钟</strong></div>
        <div class="kv-row"><span>下一轮</span><strong>${escapeHtml(
          scheduler.next_run_at ? formatRelativeTime(scheduler.next_run_at) : "—",
        )}</strong></div>
        <div class="kv-row"><span>上一轮</span><strong>${escapeHtml(
          scheduler.last_run_at ? formatRelativeTime(scheduler.last_run_at) : "—",
        )}</strong></div>
        <div class="kv-row"><span>上一轮结果</span><strong>${escapeHtml(summaryText)}</strong></div>
        ${
          scheduler.last_error
            ? `<div class="kv-row"><span>调度错误</span><strong>${escapeHtml(scheduler.last_error)}</strong></div>`
            : ""
        }
      </div>
    `;
  }

  function renderFailurePanel() {
    const failures = appState.metrics.failures;
    if (failures.length === 0) {
      return '<div class="empty">最近没有采集失败。</div>';
    }
    const items = failures
      .map((item) => {
        const node = appState.nodes.find((candidate) => candidate.id === item.node_id);
        return `
          <div class="event">
            <strong>${escapeHtml(node ? getNodeDisplayName(node) : item.node_id)}</strong>
            <p>${escapeHtml(item.error || "未知原因")}</p>
            <p class="tiny muted">${escapeHtml(formatRelativeTime(item.collected_at))} · ${escapeHtml(
              item.status || "-",
            )}${Number.isFinite(item.duration_ms) ? ` · ${Math.round(item.duration_ms / 100) / 10}s` : ""}</p>
            ${
              item.raw_excerpt
                ? `<pre class="metric-raw">${escapeHtml(item.raw_excerpt)}</pre>`
                : ""
            }
          </div>
        `;
      })
      .join("");
    return `<div class="event-list">${items}</div>`;
  }

  function renderMetricsPage() {
    const nodes = appState.nodes;
    const metrics = appState.metrics;
    const health = getCollectionHealth("metrics");
    const coveredNodes = new Set(metrics.samples.map((sample) => sample.node_id));
    const failedNodes = new Set(metrics.failures.map((item) => item.node_id));
    // 与卡片上 tone-danger 的同一条阈值线：首屏数字要能指到需要点开的机器
    const atLimit = (node) => {
      const summary = latestSample(node.id)?.summary;
      if (!summary) {
        return false;
      }
      const memPct = ratioPct(summary.mem_current_bytes, summary.mem_max_bytes);
      const diskPct = ratioPct(summary.disk_used_mb, summary.disk_total_mb);
      const cpuPct = ratioPct(summary.cpu_used_pct, summary.cpu_quota_pct ?? 100);
      return [memPct, diskPct, cpuPct].some((pct) => pct !== null && pct >= 90);
    };
    const attention = nodes.filter(
      (node) =>
        failedNodes.has(node.id) ||
        atLimit(node) ||
        (coveredNodes.has(node.id) &&
          (latestSample(node.id)?.summary?.foreign_listener_count ?? 0) > 0),
    ).length;

    const cards = nodes.length
      ? nodes.map((node) => renderNodeCard(node)).join("")
      : `
        <div class="empty">${
          health?.status === "error"
            ? `监控数据读取失败（${escapeHtml(health.error || "未知原因")}），这里的空不代表节点已停。`
            : "台账里还没有节点。先把机器纳管上来，监控会自动开始采样。"
        }</div>
      `;

    return `
      <section class="metrics-grid fade-up">
        <article class="panel"><div class="panel-body"><div class="stat-label">有采样节点</div><div class="stat-value">${
          nodes.filter((node) => coveredNodes.has(node.id)).length
        } / ${nodes.length}</div><div class="stat-foot">已拿到至少一次成功采样的节点数。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">小时桶</div><div class="stat-value">${
          metrics.buckets.length
        }</div><div class="stat-foot">按节点、按小时聚合，保留 30 天。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">采集失败</div><div class="stat-value">${
          metrics.failures.length
        }</div><div class="stat-foot">失败会留痕，避免"没数据"和"节点离线"混成一回事。</div></div></article>
        <article class="panel"><div class="panel-body"><div class="stat-label">需关注</div><div class="stat-value">${attention}</div><div class="stat-foot">配额用到 90% 以上、有失败记录，或端口被非平台进程监听。</div></div></article>
      </section>
      <section class="workspace fade-up metrics-workspace">
        <article class="panel metrics-list-panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>节点资源占用</h3>
                <p>数值取自节点自身的 cgroup 配额，不是宿主机总量；LXC 里看到的 /proc/meminfo 是假的。</p>
              </div>
              <label class="metric-auto"><input id="metrics-auto-refresh" type="checkbox"${
                metrics.autoRefresh ? " checked" : ""
              } /> 自动刷新</label>
            </div>
            ${
              metrics.lastCollectMessage
                ? `<div class="metric-collect-note">${escapeHtml(metrics.lastCollectMessage)}</div>`
                : ""
            }
            <div class="metric-card-grid">${cards}</div>
          </div>
        </article>
        <aside class="aside-stack">
          <article class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>采集调度</h3><p>控制面定时 SSH 上去跑一段只读脚本，不在节点装常驻 agent。</p></div></div>
              ${renderSchedulerPanel()}
            </div>
          </article>
          <article class="panel">
            <div class="panel-body">
              <div class="panel-title"><div><h3>采集失败</h3><p>超时、无输出、执行通道缺失都会留在这里。</p></div></div>
              ${renderFailurePanel()}
            </div>
          </article>
        </aside>
      </section>
    `;
  }

  async function runCollect(nodeIds, button) {
    if (appState.metrics.isCollecting) {
      return;
    }
    appState.metrics.isCollecting = true;
    appState.metrics.lastCollectMessage = nodeIds.length
      ? `正在采集 ${nodeIds.length} 台节点…`
      : "正在采集全部节点…";
    if (button) {
      button.disabled = true;
    }
    renderCurrentContent();

    try {
      const result = await collectNodeMetrics(nodeIds);
      appState.metrics.lastCollectMessage = `采集完成：成功 ${result.success} / 失败 ${result.failed}。`;
      appState.metrics.lastCollectedAt = result.collected_at || new Date().toISOString();
    } catch (error) {
      appState.metrics.lastCollectMessage = `采集失败：${
        error instanceof Error ? error.message : "未知原因"
      }`;
    } finally {
      appState.metrics.isCollecting = false;
      if (button) {
        button.disabled = false;
      }
    }

    await refreshMetrics();
    renderCurrentContent();
  }

  function setupMetricsPage() {
    if (page !== "metrics") {
      return;
    }

    documentRef.getElementById("metrics-collect-all")?.addEventListener("click", (event) => {
      void runCollect([], event.currentTarget);
    });
    documentRef.getElementById("metrics-reload")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      await refreshMetrics();
      button.disabled = false;
      renderCurrentContent();
    });

    documentRef.querySelectorAll("[data-metric-collect]").forEach((button) => {
      button.addEventListener("click", (event) => {
        void runCollect([event.currentTarget.dataset.metricCollect], event.currentTarget);
      });
    });

    documentRef.getElementById("metrics-auto-refresh")?.addEventListener("change", (event) => {
      appState.metrics.autoRefresh = Boolean(event.currentTarget.checked);
      syncAutoRefreshTimer();
    });

    syncAutoRefreshTimer();
  }

  function syncAutoRefreshTimer() {
    const enabled = Boolean(appState.metrics.autoRefresh);
    if (enabled && !appState.metrics._refreshTimer) {
      appState.metrics._refreshTimer = windowRef.setInterval(() => {
        if (!appState.metrics.isCollecting && !appState.metrics.isRefreshing) {
          void refreshMetrics().then(() => {
            renderCurrentContent();
          });
        }
      }, REFRESH_INTERVAL_MS);
    } else if (!enabled && appState.metrics._refreshTimer) {
      windowRef.clearInterval(appState.metrics._refreshTimer);
      appState.metrics._refreshTimer = null;
    }
  }

  return {
    renderMetricsPage,
    setupMetricsPage,
  };
}
