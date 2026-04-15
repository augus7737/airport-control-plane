export function createOverviewPageRenderer({
  daysUntil,
  escapeHtml,
  formatNodeConfiguration,
  formatPlatformSshBootstrapState,
  formatRelativeTime,
  getCountryStats,
  getEffectiveTokenStatus,
  getNodeDisplayName,
  getProbeSchedulerState,
  getPlatformSshKeyState,
  getTokens,
  maskTokenValue,
  nodeDetailHref,
  nodeShellHref,
  nodeTable,
  platformSshStatusLabel,
  renderCountryDistribution,
  statusText,
}) {
  const overviewClockFormatter = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  function parseOverviewTime(value) {
    const timestamp = Date.parse(value ?? "");
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  }

  function formatOverviewClock(value, fallback = "未安排") {
    const date = parseOverviewTime(value);
    return date ? overviewClockFormatter.format(date) : fallback;
  }

  function formatProbeInterval(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) {
      return "按计划";
    }

    const minutes = Math.round(value / 60000);
    if (minutes < 60) {
      return `每 ${minutes} 分钟`;
    }

    const hours = Math.floor(minutes / 60);
    const remainMinutes = minutes % 60;
    return remainMinutes > 0 ? `每 ${hours} 小时 ${remainMinutes} 分` : `每 ${hours} 小时`;
  }

  function trimProbeMessage(message, limit = 60) {
    const value = String(message || "").trim();
    if (!value) {
      return "";
    }

    return value.length > limit ? `${value.slice(0, Math.max(0, limit - 1))}…` : value;
  }

  function buildProbeSchedulerSummary() {
    const scheduler =
      typeof getProbeSchedulerState === "function" ? getProbeSchedulerState() || {} : {};
    const enabled = Boolean(scheduler.enabled);
    const running = Boolean(scheduler.running);
    const summary = scheduler.last_run_summary || null;
    const total = Number(summary?.total || 0);
    const success = Number(summary?.success || 0);
    const failed = Number(summary?.failed || 0);
    const batchSize = Number(scheduler.batch_size || 0);
    const intervalLabel = formatProbeInterval(scheduler.interval_ms);
    const batchLabel = batchSize > 0 ? `每轮最多 ${batchSize} 台` : "轻量批量执行";
    const stateLabel = !enabled ? "已关闭" : running ? "运行中" : "空闲";
    const nextRunLabel = enabled
      ? running
        ? "本轮结束后"
        : scheduler.next_run_at
          ? formatRelativeTime(scheduler.next_run_at)
          : "等待调度"
      : "未安排";
    const nextRunNote = enabled
      ? running
        ? "调度器正在发起新一轮巡检"
        : scheduler.next_run_at
          ? formatOverviewClock(scheduler.next_run_at)
          : `${intervalLabel} · ${batchLabel}`
      : "关闭后不会自动发起巡检任务";

    let headline = "等待首轮自动巡检";
    let headlineNote = `${intervalLabel} · ${batchLabel}`;
    let cardTone = enabled ? "blue" : "muted";
    let resultValue = "暂无记录";
    let resultNote = enabled ? "启用后会自动补齐首轮巡检" : "当前不会创建周期巡检任务";

    if (!enabled) {
      headline = "自动巡检已暂停";
      headlineNote = "目前仅支持手动复探和手动任务触发";
      resultValue = "暂停中";
      resultNote = "恢复启用后会重新安排下一轮";
    } else if (running) {
      headline = "本轮自动巡检执行中";
      headlineNote = "控制面正在批量校验管理链路、业务入口与 relay 上游状态";
      cardTone = "blue";
    }

    if (summary) {
      if (total === 0) {
        resultValue = "0 台待巡检";
        resultNote = scheduler.last_finished_at
          ? `${formatRelativeTime(scheduler.last_finished_at)} 完成，无符合条件节点`
          : "上一轮没有符合条件的节点";
        if (enabled && !running) {
          headline = "最近一轮无需巡检";
          headlineNote = "当前节点状态比较稳定，调度器仍会继续按计划执行";
          cardTone = "green";
        }
      } else {
        resultValue = `${success} 成功 / ${failed} 异常`;
        resultNote = scheduler.last_finished_at
          ? `${formatRelativeTime(scheduler.last_finished_at)} 完成，共 ${total} 台`
          : `最近一轮共巡检 ${total} 台`;
        if (failed > 0) {
          headline = "最近一轮发现异常节点";
          headlineNote = `${success} 台通过，${failed} 台异常，建议继续看任务中心明细`;
          cardTone = "yellow";
        } else if (!running) {
          headline = "最近一轮巡检正常";
          headlineNote = `${success} 台已刷新健康状态，下一轮会继续按计划执行`;
          cardTone = "green";
        }
      }
    }

    const errorMessage = trimProbeMessage(scheduler.last_error);
    if (errorMessage) {
      headline = "调度器最近一次执行出错";
      headlineNote = errorMessage;
      cardTone = "yellow";
    }

    const errorBlock =
      errorMessage || failed > 0
        ? {
            label: errorMessage ? "最近错误" : "异常提示",
            message: errorMessage || `上一轮有 ${failed} 台节点探测异常，建议到任务中心继续排查。`,
          }
        : null;

    return {
      badge: enabled ? "已启用" : "已关闭",
      badgeTone: enabled ? "green" : "muted",
      runningLabel: running ? "运行中" : "待机",
      runningTone: running ? "blue" : enabled ? "green" : "muted",
      stateLabel,
      headline,
      headlineNote,
      cardTone,
      resultValue,
      resultNote,
      nextRunLabel,
      nextRunNote,
      statusNote: `${intervalLabel} · ${batchLabel}`,
      errorBlock,
    };
  }

  function renderMetrics(nodes) {
    const counts = nodes.reduce(
      (acc, node) => {
        acc.total += 1;
        const status = String(node.status || "new").toLowerCase();
        if (status === "active") acc.active += 1;
        if (status === "new") acc.new += 1;
        if (status === "degraded" || status === "failed") acc.risk += 1;
        return acc;
      },
      { total: 0, active: 0, new: 0, risk: 0 },
    );
    const expiringSoon = nodes.filter((node) => {
      const days = daysUntil(node.commercial?.expires_at);
      return days != null && days <= 7;
    }).length;
    const total = Math.max(counts.total, 1);
    const metrics = [
      {
        label: "节点总数",
        value: counts.total,
        foot: "全部纳管",
        ratio: 100,
        tone: "var(--text)",
      },
      {
        label: "可用节点",
        value: counts.active,
        foot: `${Math.round((counts.active / total) * 100)}% 在线`,
        ratio: Math.max(8, Math.round((counts.active / total) * 100)),
        tone: "var(--green)",
      },
      {
        label: "待初始化",
        value: counts.new,
        foot: `${counts.new} 台待处理`,
        ratio: counts.new > 0 ? Math.max(8, Math.round((counts.new / total) * 100)) : 0,
        tone: "var(--blue)",
      },
      {
        label: "即将到期",
        value: expiringSoon,
        foot: "近 7 天窗口",
        ratio: expiringSoon > 0 ? Math.max(8, Math.round((expiringSoon / total) * 100)) : 0,
        tone: "var(--yellow)",
      },
    ];

    return `
      <section class="metrics-grid fade-up">
        ${metrics
          .map(
            (item) => `
              <article class="panel">
                <div class="panel-body">
                  <div class="stat-label">${item.label}</div>
                  <div class="stat-value">${item.value}</div>
                  <div class="stat-rail"><span style="width:${item.ratio}%;background:${item.tone};"></span></div>
                  <div class="stat-foot">${item.foot}</div>
                </div>
              </article>
            `,
          )
          .join("")}
      </section>
    `;
  }

  function getOverviewNodeTimestamp(node) {
    const value = node.last_seen_at || node.registered_at;
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
  }

  function buildOverviewAttentionItems(nodes) {
    const items = new Map();
    const upsert = (node, priority, tone, label, note) => {
      const current = items.get(node.id) || {
        node,
        priority,
        note,
        tags: [],
      };
      const previousPriority = current.priority;

      current.priority = Math.max(current.priority, priority);
      if (!current.note || priority >= previousPriority) {
        current.note = note;
      }
      if (!current.tags.some((item) => item.label === label)) {
        current.tags.push({ tone, label });
      }

      items.set(node.id, current);
    };

    nodes.forEach((node) => {
      const status = String(node.status || "new").toLowerCase();
      const expiryDays = daysUntil(node.commercial?.expires_at);
      const healthScore = Number(node.health_score);

      if (status === "failed") {
        upsert(node, 100, "red", "初始化失败", "初始化或接管流程失败，建议先进入终端排查。");
      } else if (status === "degraded") {
        upsert(node, 90, "red", "状态退化", "最近探测或链路表现异常，建议先检查节点连通性。");
      } else if (status === "new") {
        upsert(node, 70, "blue", "待初始化", "节点已经登记，但基础模板和初始化任务还没收口。");
      }

      if (expiryDays != null && expiryDays < 0) {
        upsert(node, 95, "red", "已过期", "资产记录显示已经过期，建议尽快续费或下线。");
      } else if (expiryDays != null && expiryDays <= 7) {
        upsert(node, 82, "yellow", `${expiryDays} 天到期`, "进入近 7 天续费窗口，建议提前确认是否保留。");
      }

      if (Number.isFinite(healthScore) && healthScore < 60) {
        upsert(
          node,
          80,
          healthScore < 40 ? "red" : "yellow",
          `健康 ${Math.round(healthScore)}`,
          "健康分偏低，适合优先复探并确认代理可用性。",
        );
      }
    });

    return [...items.values()]
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          getOverviewNodeTimestamp(right.node) - getOverviewNodeTimestamp(left.node),
      )
      .slice(0, 6);
  }

  function renderOverviewControlPanel(nodes, sortedNodes, countryStats) {
    const sshKey = getPlatformSshKeyState();
    const probeScheduler = buildProbeSchedulerSummary();
    const tokens = Array.isArray(getTokens?.()) ? getTokens() : [];
    const activeTokens = tokens.filter((token) => getEffectiveTokenStatus(token) === "active");
    const primaryToken = activeTokens[0] || null;
    const topCountry = countryStats[0] || null;
    const relayCountries = countryStats.filter((item) => item.relay > 0).length;
    const summaryItems = [
      {
        label: "接管状态",
        value: platformSshStatusLabel(sshKey),
        note: formatPlatformSshBootstrapState(sshKey),
        tone: sshKey.status === "ready" ? "green" : "yellow",
      },
      {
        label: "注册令牌",
        value: `${activeTokens.length} 条`,
        note: primaryToken ? `主令牌 ${maskTokenValue(primaryToken.token)}` : "前往令牌页创建",
        tone: activeTokens.length > 0 ? "blue" : "yellow",
      },
      {
        label: "覆盖国家",
        value: `${countryStats.length}`,
        note: topCountry ? `TOP ${topCountry.code} · ${topCountry.total} 台` : "暂无分布",
        tone: "blue",
      },
      {
        label: "中转落地",
        value: `${relayCountries}`,
        note: relayCountries > 0 ? "含中转链路" : "当前全直连",
        tone: relayCountries > 0 ? "yellow" : "green",
      },
    ];
    const recentEvents = sortedNodes
      .slice(0, 3)
      .map(
        (node) => `
          <div class="event">
            <strong>${getNodeDisplayName(node)}</strong>
            <p>${statusText(node.status)} · ${node.labels?.provider || "未标记"} / ${node.labels?.region || "-"}</p>
            <p class="tiny">${formatRelativeTime(node.last_seen_at || node.registered_at)}</p>
          </div>
        `,
      )
      .join("");
    const showBootstrapAlert = sshKey.status !== "ready";

    return `
      <section class="panel overview-control-panel">
        <div class="panel-body">
          <div class="panel-title">
            <div>
              <h3>控制摘要</h3>
              <p>把接管能力、最近变更和国家覆盖收在同一列。</p>
            </div>
            <a class="table-action-pill" href="/nodes.html">进入台账</a>
          </div>
          <div class="overview-mini-grid">
            ${summaryItems
              .map(
                (item) => `
                  <article class="overview-mini-card tone-${item.tone}">
                    <span class="overview-mini-label">${item.label}</span>
                    <strong class="overview-mini-value">${escapeHtml(item.value)}</strong>
                    <span class="overview-mini-note">${escapeHtml(item.note)}</span>
                  </article>
                `,
              )
              .join("")}
          </div>
          ${
            showBootstrapAlert
              ? `
                <div class="overview-inline-alert">
                  <div>
                    <strong>平台 SSH 还没完全就绪</strong>
                    <p>先补齐平台密钥和令牌，后续自动注册节点才能继续完成真实接管。</p>
                  </div>
                  <a class="table-action-primary" href="/tokens.html">去令牌页</a>
                </div>
              `
              : ""
          }
          <div class="overview-summary-section overview-probe-section">
            <div class="overview-summary-section-head">
              <strong>自动巡检</strong>
              <span>${escapeHtml(probeScheduler.badge)}</span>
            </div>
            <article class="overview-probe-card tone-${probeScheduler.cardTone}">
              <div class="overview-probe-topline">
                <div class="overview-probe-copy">
                  <strong>${escapeHtml(probeScheduler.headline)}</strong>
                  <p>${escapeHtml(probeScheduler.headlineNote)}</p>
                </div>
                <div class="overview-probe-badges">
                  <span class="overview-probe-badge tone-${probeScheduler.badgeTone}">${escapeHtml(probeScheduler.badge)}</span>
                  <span class="overview-probe-badge tone-${probeScheduler.runningTone}">${escapeHtml(probeScheduler.runningLabel)}</span>
                </div>
              </div>
              <div class="overview-probe-metrics">
                <div class="overview-probe-metric">
                  <span>当前状态</span>
                  <strong>${escapeHtml(probeScheduler.stateLabel)}</strong>
                  <small>${escapeHtml(probeScheduler.statusNote)}</small>
                </div>
                <div class="overview-probe-metric">
                  <span>最近一轮</span>
                  <strong>${escapeHtml(probeScheduler.resultValue)}</strong>
                  <small>${escapeHtml(probeScheduler.resultNote)}</small>
                </div>
                <div class="overview-probe-metric">
                  <span>下一轮</span>
                  <strong>${escapeHtml(probeScheduler.nextRunLabel)}</strong>
                  <small>${escapeHtml(probeScheduler.nextRunNote)}</small>
                </div>
              </div>
              ${
                probeScheduler.errorBlock
                  ? `
                    <div class="overview-probe-error">
                      <span>${escapeHtml(probeScheduler.errorBlock.label)}</span>
                      <strong>${escapeHtml(probeScheduler.errorBlock.message)}</strong>
                    </div>
                  `
                  : ""
              }
            </article>
          </div>
          <div class="overview-summary-section">
            <div class="overview-summary-section-head">
              <strong>最近事件</strong>
              <span>${sortedNodes.length > 0 ? `最近 ${Math.min(sortedNodes.length, 3)} 条` : "暂无记录"}</span>
            </div>
            <div class="event-list">${recentEvents || '<div class="empty">还没有节点事件。</div>'}</div>
          </div>
          <div class="overview-summary-section">
            <div class="overview-summary-section-head">
              <strong>国家覆盖</strong>
              <span>${countryStats.length} 个国家</span>
            </div>
            <div class="overview-country-list">
              ${renderCountryDistribution(nodes, { compact: true, limit: 5 })}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderOverview(nodes) {
    const sortedNodes = [...nodes].sort(
      (left, right) => getOverviewNodeTimestamp(right) - getOverviewNodeTimestamp(left),
    );
    const countryStats = getCountryStats(nodes);
    const recentPreview = sortedNodes.slice(0, 6);
    const attentionItems = buildOverviewAttentionItems(nodes);
    const previewTable =
      recentPreview.length > 0
        ? nodeTable(recentPreview, { variant: "preview", showPlacement: false })
        : '<div class="empty">当前还没有节点，先执行纳管命令把第一台机器接入平台。</div>';
    const attentionHtml =
      attentionItems.length > 0
        ? `
          <div class="overview-attention-list">
            ${attentionItems
              .map((item) => {
                const node = item.node;
                const metaParts = [
                  node.labels?.provider || "未标记",
                  node.labels?.region || "-",
                  formatNodeConfiguration(node),
                ].filter(Boolean);

                return `
                  <div class="overview-attention-item">
                    <div class="overview-attention-main">
                      <div class="overview-attention-head">
                        <a class="node-name" href="${nodeDetailHref(node.id)}">${getNodeDisplayName(node)}</a>
                        <span class="tiny">${statusText(node.status)}</span>
                      </div>
                      <p class="overview-attention-meta">${escapeHtml(metaParts.join(" / "))}</p>
                      <p class="overview-attention-note">${escapeHtml(item.note)}</p>
                    </div>
                    <div class="overview-attention-tags">
                      ${item.tags
                        .slice(0, 2)
                        .map(
                          (tag) =>
                            `<span class="overview-issue-pill ${tag.tone}">${escapeHtml(tag.label)}</span>`,
                        )
                        .join("")}
                    </div>
                    <div class="table-actions overview-attention-actions">
                      <a class="table-action-primary" href="${nodeShellHref(node.id)}">终端</a>
                      <a class="table-action-pill" href="${nodeDetailHref(node.id)}">详情</a>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        `
        : '<div class="empty">当前没有待优先处理的节点，首页会优先把异常、到期和待初始化节点放在这里。</div>';
    const controlPanel = renderOverviewControlPanel(nodes, sortedNodes, countryStats);

    return `
      ${renderMetrics(nodes)}
      <section class="overview-focus fade-up">
        <article class="panel">
          <div class="panel-body">
            <div class="panel-title">
              <div>
                <h3>待处理节点</h3>
                <p>失败、到期和待初始化节点优先顶上来，进入首页就能直接排障。</p>
              </div>
              <div class="provider-pill">${attentionItems.length > 0 ? `优先 ${attentionItems.length} 台` : "当前无积压"}</div>
            </div>
            ${attentionHtml}
          </div>
        </article>
        <aside class="aside-stack overview-side-stack">${controlPanel}</aside>
      </section>
      <section class="panel fade-up overview-table-stage">
        <div class="panel-body">
          <div class="panel-title">
            <div>
              <h3>节点预览</h3>
              <p>首页只保留最近活跃节点的紧凑视图，完整资产台账放在节点清单页。</p>
            </div>
            <div class="overview-panel-actions">
              <div class="provider-pill">最近 ${recentPreview.length} 台</div>
              <a class="table-action-pill" href="/nodes.html">查看全部</a>
            </div>
          </div>
          ${previewTable}
        </div>
      </section>
    `;
  }

  return {
    getOverviewNodeTimestamp,
    buildOverviewAttentionItems,
    renderOverviewControlPanel,
    renderOverview,
  };
}
