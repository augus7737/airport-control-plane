export function normalizePercent(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getLastSeenMinutes(node) {
  const raw = node.last_seen_at || node.registered_at;
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
}

export function buildCapabilityGauge(probeCapabilityText) {
  if (probeCapabilityText === "已验证") return { value: "SSH", percent: 100, tone: "green", foot: "已验证接管" };
  if (probeCapabilityText === "仅 TCP") return { value: "TCP", percent: 68, tone: "blue", foot: "仅端口已通" };
  if (probeCapabilityText === "待配私钥") return { value: "待配", percent: 54, tone: "yellow", foot: "补平台私钥" };
  if (probeCapabilityText === "接管失败") return { value: "失败", percent: 28, tone: "red", foot: "认证或链路异常" };
  if (probeCapabilityText === "未通过") return { value: "异常", percent: 16, tone: "red", foot: "当前不可接管" };
  return { value: "待判", percent: 40, tone: "blue", foot: "等待更多探测" };
}

export function buildFreshnessGauge(lastSeenMinutes, lastSeenText) {
  if (lastSeenMinutes == null) {
    return { value: "待补", percent: 24, tone: "blue", foot: "暂无上报时间" };
  }
  if (lastSeenMinutes <= 30) {
    return { value: "在线", percent: 100, tone: "green", foot: lastSeenText };
  }
  if (lastSeenMinutes <= 180) {
    return { value: "活跃", percent: 78, tone: "green", foot: lastSeenText };
  }
  if (lastSeenMinutes <= 720) {
    return { value: "平稳", percent: 58, tone: "yellow", foot: lastSeenText };
  }
  if (lastSeenMinutes <= 1440) {
    return { value: "偏慢", percent: 42, tone: "yellow", foot: lastSeenText };
  }
  return { value: "陈旧", percent: 18, tone: "red", foot: lastSeenText };
}

export function buildExpiryGauge(expiryDays, expiryNote) {
  if (expiryDays == null) {
    return { value: "待补", percent: 24, tone: "blue", foot: "补资产到期时间" };
  }
  if (expiryDays < 0) {
    return { value: "过期", percent: 100, tone: "red", foot: expiryNote };
  }
  if (expiryDays <= 7) {
    return { value: `${expiryDays}d`, percent: 100, tone: "red", foot: expiryNote };
  }
  if (expiryDays <= 30) {
    return {
      value: `${expiryDays}d`,
      percent: normalizePercent((expiryDays / 30) * 100, 42),
      tone: "yellow",
      foot: expiryNote,
    };
  }
  return {
    value: `${Math.min(expiryDays, 99)}d`,
    percent: normalizePercent((Math.min(expiryDays, 90) / 90) * 100, 100),
    tone: "green",
    foot: expiryNote,
  };
}

export function renderKvRows(escapeHtml, items) {
  return items
    .map(
      ([label, value]) => `
        <div class="kv-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `,
    )
    .join("");
}

export function renderMetaRows(escapeHtml, items) {
  return items
    .map(
      ([label, value]) => `
        <div class="node-detail-meta-item">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `,
    )
    .join("");
}

export function buildRecommendationAction(item) {
  const title = String(item?.title || "");

  if (title.includes("初始化")) {
    return {
      command: "retry-init",
      label: "立即执行",
      tone: "blue",
      hint: "初始化",
    };
  }

  if (title.includes("资产") || title.includes("到期") || title.includes("带宽") || title.includes("流量")) {
    return {
      command: "edit-asset",
      label: "编辑资产",
      tone: "yellow",
      hint: "台账",
    };
  }

  if (
    title.includes("探测") ||
    title.includes("SSH") ||
    title.includes("中转") ||
    title.includes("公钥") ||
    title.includes("私钥")
  ) {
    return {
      command: "probe",
      label: "立即复探",
      tone: "green",
      hint: "排障",
    };
  }

  return {
    command: "open-shell",
    label: "进入终端",
    tone: "blue",
    hint: "后续",
  };
}

export function renderRecommendationItems(escapeHtml, items) {
  return items
    .map((item) => {
      const action = buildRecommendationAction(item);

      return `
        <article class="node-detail-recommendation tone-${action.tone}">
          <div class="node-detail-recommendation-body">
            <span class="node-detail-recommendation-hint">${escapeHtml(action.hint)}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.description)}</p>
          </div>
          <button
            class="button ghost node-detail-inline-action"
            type="button"
            data-node-detail-command="${escapeHtml(action.command)}"
          >
            ${escapeHtml(action.label)}
          </button>
        </article>
      `;
    })
    .join("");
}

export function renderDiagnosticRows(escapeHtml, items) {
  return items
    .map(
      ([label, value]) => `
        <div class="node-detail-diagnostic-item">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `,
    )
    .join("");
}

export function renderTemplateSelectOptions(escapeHtml, options, selectedValue, valueKey = "value") {
  return options
    .map((option) => {
      const value = String(option?.[valueKey] || "");
      return `<option value="${escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(option.label || value)}</option>`;
    })
    .join("");
}

export function buildNodeDetailViewModel({
  buildNodeRecommendations,
  daysUntil,
  formatAccessMode,
  formatDate,
  formatNodeConfiguration,
  formatNodeIpOwnershipSummary,
  formatNodeSshPort,
  formatProbeCapability,
  formatProbeLongSummary,
  formatProbeStageCompact,
  formatProbeSummary,
  formatProbeType,
  formatRelativeTime,
  formatRenewal,
  formatRouteSummary,
  formatTaskAttempt,
  formatTraffic,
  getAccessMode,
  getNodeDisplayName,
  getPrimaryPublicIpRecord,
  getProbes,
  getProbesForNode,
  getPublicIpRecords,
  getRelayDisplayName,
  getSystemTemplateReleases,
  getTaskDisplayTitle,
  getTasks,
  getTaskSummary,
  getTasksForNode,
  node,
  nodeDetailState,
  nodes,
  resolveRelayNode,
  sortProbes,
  sortTasks,
  statusClassName,
  statusText,
  systemTemplates,
}) {
  const relayNode = resolveRelayNode(node, nodes);
  const relayLabel = relayNode ? getNodeDisplayName(relayNode) : getRelayDisplayName(node, nodes);
  const nodeTasks = getTasksForNode(node, getTasks(), sortTasks);
  const recentNodeTasks = nodeTasks.slice(0, 4);
  const nodeProbes = getProbesForNode(node, getProbes(), sortProbes).slice(0, 4);
  const latestProbe = nodeProbes[0] || null;
  const recommendedActions = buildNodeRecommendations(node, latestProbe, nodeTasks);
  const accessMode = getAccessMode(node);
  const accessModeText = formatAccessMode(accessMode);
  const sshPort = formatNodeSshPort(node);
  const publicIpRecords = getPublicIpRecords(node);
  const primaryPublicIp = getPrimaryPublicIpRecord(publicIpRecords);
  const nodeName = getNodeDisplayName(node);
  const sourceText = node.source === "bootstrap" ? "自动注册" : "手工录入";
  const systemText = [node.facts?.os_name, node.facts?.os_version].filter(Boolean).join(" ") || "-";
  const configSummary = formatNodeConfiguration(node);
  const lastSeenText = formatRelativeTime(node.last_seen_at || node.registered_at);
  const lastProbeText = node.last_probe_at ? formatRelativeTime(node.last_probe_at) : "尚未探测";
  const expiryDays = daysUntil(node.commercial?.expires_at);
  const expiryText = formatDate(node.commercial?.expires_at);
  const expiryNote =
    expiryDays == null
      ? "资产信息待补充"
      : expiryDays < 0
        ? `已过期 ${Math.abs(expiryDays)} 天`
        : expiryDays === 0
          ? "今天到期"
          : `剩余 ${expiryDays} 天`;
  const healthScoreText = node.health_score != null ? String(node.health_score) : "待评估";
  const probeStageText = formatProbeStageCompact(latestProbe);
  const probeCapabilityText = formatProbeCapability(latestProbe);
  const probeSummaryText = latestProbe ? formatProbeSummary(latestProbe) : "尚未探测";
  const probeLongSummary = formatProbeLongSummary(latestProbe);
  const publicIpSummary =
    publicIpRecords.length > 0
      ? publicIpRecords
          .map((record) => `${record.family} ${record.address}${record.location ? ` · ${record.location}` : ""}`)
          .join(" / ")
      : "未探测到公网 IP";
  const primaryPublicLabel = primaryPublicIp
    ? [primaryPublicIp.address, primaryPublicIp.location || primaryPublicIp.owner].filter(Boolean).join(" · ")
    : "未探测到公网入口";
  const healthScoreNumber = Number.isFinite(Number(node.health_score)) ? Number(node.health_score) : null;
  const lastSeenMinutes = getLastSeenMinutes(node);
  const capabilityGauge = buildCapabilityGauge(probeCapabilityText);
  const freshnessGauge = buildFreshnessGauge(lastSeenMinutes, lastSeenText);
  const expiryGauge = buildExpiryGauge(expiryDays, expiryNote);
  const routeSummaryText = formatRouteSummary(node, nodes);
  const dashboardCards = [
    {
      label: "健康",
      value: healthScoreNumber == null ? "待评" : String(Math.round(healthScoreNumber)),
      percent: normalizePercent(healthScoreNumber, latestProbe ? 46 : 24),
      tone:
        healthScoreNumber == null
          ? "blue"
          : healthScoreNumber >= 80
            ? "green"
            : healthScoreNumber >= 55
              ? "yellow"
              : "red",
      foot: node.status ? statusText(node.status) : "待确认",
    },
    {
      label: "接管",
      value: capabilityGauge.value,
      percent: capabilityGauge.percent,
      tone: capabilityGauge.tone,
      foot: capabilityGauge.foot,
    },
    {
      label: "到期",
      value: expiryGauge.value,
      percent: expiryGauge.percent,
      tone: expiryGauge.tone,
      foot: expiryGauge.foot,
    },
    {
      label: "活跃",
      value: freshnessGauge.value,
      percent: freshnessGauge.percent,
      tone: freshnessGauge.tone,
      foot: freshnessGauge.foot,
    },
  ];
  const activityItems = [
    ...nodeProbes.map((probe) => ({
      badgeClass: probe.success ? "badge badge-active" : "badge badge-degraded",
      badgeText: formatProbeType(probe),
      title: formatProbeSummary(probe),
      summary: probe.target || publicIpSummary,
      detail: formatProbeLongSummary(probe),
      at: probe.observed_at,
      sortTime: new Date(probe.observed_at || 0).getTime() || 0,
    })),
    ...recentNodeTasks.map((task) => ({
      badgeClass: statusClassName(task.status),
      badgeText: statusText(task.status),
      title: getTaskDisplayTitle(task),
      summary: getTaskSummary(task),
      detail: `${statusText(task.status)} / ${formatTaskAttempt(task)}`,
      at: task.started_at || task.scheduled_at || task.created_at,
      sortTime: new Date(task.started_at || task.scheduled_at || task.created_at || 0).getTime() || 0,
    })),
  ]
    .sort((left, right) => right.sortTime - left.sortTime)
    .slice(0, 5);
  const systemOverviewRows = [
    ["系统版本", systemText],
    ["系统架构", node.facts?.arch || "-"],
    ["内核版本", node.facts?.kernel_version || "-"],
    ["采集来源", sourceText],
    ["基础配置", configSummary],
  ];
  const networkOverviewRows = [
    ["公网 IPv4", node.facts?.public_ipv4 || "-"],
    ["公网入口", primaryPublicIp?.address || "未探测"],
    ["SSH 端口", sshPort],
    ["IP 归属", formatNodeIpOwnershipSummary(node)],
    ["最近上报", lastSeenText],
  ];
  const recommendationItems = recommendedActions.length
    ? recommendedActions
    : [
        {
          title: "当前没有必须立刻处理的动作",
          description: "最近探测与任务没有暴露新的阻塞项，可以继续观察，或进入终端页做更细的确认。",
        },
      ];
  const heroChips = [
    { label: "云厂商", value: node.labels?.provider || "未标记" },
    { label: "区域", value: node.labels?.region || "-" },
    { label: "接入方式", value: accessModeText },
    { label: "基础配置", value: configSummary },
    { label: "公网入口", value: primaryPublicIp?.address || "未探测" },
    { label: "SSH", value: sshPort },
  ];
  const heroHighlights = [
    { label: "健康分", value: healthScoreText },
    { label: "接管能力", value: probeCapabilityText },
    { label: "最近探测", value: lastProbeText },
  ];
  const activeSystemTemplates = Array.isArray(systemTemplates)
    ? systemTemplates.filter((template) => String(template?.status || "active").toLowerCase() === "active")
    : [];
  const baselineTemplates = activeSystemTemplates.filter(
    (template) => String(template?.category || "").toLowerCase() === "baseline",
  );
  const initTemplateOptions = [
    ...baselineTemplates.map((template) => ({
      value: `system-template:${template.id}`,
      label: template.name || template.id,
      meta: template.note || template.script_name || "使用系统模板执行初始化链路。",
    })),
    {
      value: "alpine-base",
      label: "内置 Alpine 初始化",
      meta: "控制面的兜底基线模板，模板中心异常时仍可直接执行。",
    },
  ];
  const selectedInitTemplateValue = initTemplateOptions.some(
    (option) => option.value === nodeDetailState?.initTemplateValue,
  )
    ? nodeDetailState.initTemplateValue
    : initTemplateOptions[0]?.value || "alpine-base";
  const selectedInitTemplate =
    initTemplateOptions.find((option) => option.value === selectedInitTemplateValue) ||
    initTemplateOptions[0] ||
    null;
  const preferredApplyTemplate =
    activeSystemTemplates.find((template) => String(template?.category || "").toLowerCase() !== "baseline") ||
    activeSystemTemplates[0] ||
    null;
  const selectedApplyTemplateId = activeSystemTemplates.some(
    (template) => template.id === nodeDetailState?.applyTemplateId,
  )
    ? nodeDetailState.applyTemplateId
    : preferredApplyTemplate?.id || "";
  const selectedApplyTemplate =
    activeSystemTemplates.find((template) => template.id === selectedApplyTemplateId) || null;
  const latestSystemTemplateRelease =
    (Array.isArray(getSystemTemplateReleases?.()) ? getSystemTemplateReleases() : []).filter(
      (release) => Array.isArray(release?.node_ids) && release.node_ids.includes(node.id),
    )[0] || null;
  const latestSystemTemplateName = latestSystemTemplateRelease
    ? activeSystemTemplates.find((template) => template.id === latestSystemTemplateRelease.template_id)?.name ||
      latestSystemTemplateRelease.template_id ||
      "未知模板"
    : null;
  const commercialOverview = [
    ["到期时间", expiryText],
    ["续费方式", formatRenewal(node.commercial?.auto_renew)],
    ["计费周期", node.commercial?.billing_cycle || "-"],
    ["带宽", node.commercial?.bandwidth_mbps ? `${node.commercial.bandwidth_mbps} Mbps` : "-"],
    ["流量", formatTraffic(node.commercial?.traffic_used_gb, node.commercial?.traffic_quota_gb)],
    ["备注", node.commercial?.note || "-"],
  ];
  const routeOverview = [
    ["接入方式", accessModeText],
    ["入口区域", node.networking?.entry_region || "中国大陆"],
    ["中转节点", accessMode === "relay" ? relayLabel : "无需中转"],
    ["中转区域", accessMode === "relay" ? node.networking?.relay_region || relayNode?.labels?.region || "-" : "-"],
    ["链路摘要", routeSummaryText],
    ["链路说明", node.networking?.route_note || "-"],
  ];
  const healthOverviewRows = [
    ["探测阶段", probeStageText],
    ["公网入口", primaryPublicIp?.address || "未探测"],
    ["入口归属", primaryPublicIp?.location || primaryPublicIp?.owner || "待识别"],
    ["最近探测", lastProbeText],
  ];

  return {
    activityItems,
    commercialOverview,
    dashboardCards,
    healthOverviewRows,
    healthSummaryMeta: `${lastProbeText} · ${primaryPublicLabel}`,
    healthSummaryText: probeLongSummary,
    heroChips,
    heroHighlights,
    networkOverviewRows,
    node,
    nodeName,
    nodeStatusClass: statusClassName(node.status),
    nodeStatusText: statusText(node.status),
    probeLongSummary,
    probeSummaryText,
    recommendationItems,
    routeOverview,
    routeSummaryText,
    selectedApplyTemplate,
    selectedApplyTemplateId,
    selectedInitTemplate,
    selectedInitTemplateValue,
    sourceText,
    systemOverviewRows,
    systemTemplateActionHref: `/system-templates.html?node_id=${encodeURIComponent(node.id)}${
      selectedApplyTemplateId ? `&template_id=${encodeURIComponent(selectedApplyTemplateId)}` : ""
    }`,
    systemTemplateApplyOptions: activeSystemTemplates.map((template) => ({
      id: template.id,
      label: template.name || template.id,
      meta: template.note || template.script_name || "下发后会写入系统模板发布记录。",
    })),
    systemTemplateInitOptions: initTemplateOptions,
    systemTemplateLatestReleaseAt: latestSystemTemplateRelease?.created_at || null,
    systemTemplateLatestReleaseName: latestSystemTemplateName,
    systemTemplateMessage: nodeDetailState?.message || null,
    systemTemplatePendingAction: nodeDetailState?.pendingAction || null,
    systemText,
  };
}

export function renderNodeDetailHero({ escapeHtml, viewModel }) {
  const {
    heroChips,
    heroHighlights,
    node,
    nodeName,
    nodeStatusClass,
    nodeStatusText,
    sourceText,
    systemText,
  } =
    viewModel;

  return `
    <section class="node-detail-hero fade-up">
      <div class="node-detail-hero-head">
        <div class="node-detail-hero-copy">
          <div class="node-detail-hero-caption">
            <span>节点控制台</span>
            <span class="provider-pill">${escapeHtml(node.id)}</span>
            <span>${escapeHtml(sourceText)}</span>
          </div>
          <div class="node-detail-hero-title-row">
            <h3>${escapeHtml(nodeName)}</h3>
            <span class="${nodeStatusClass}">${nodeStatusText}</span>
          </div>
          <p class="node-detail-hero-subtitle">${escapeHtml(
            `${node.labels?.provider || "未标记"} / ${node.labels?.region || "-"} · ${systemText}`,
          )}</p>
        </div>
        <div class="topbar-actions node-detail-hero-actions">
          <button class="button primary" type="button" id="open-node-shell-shortcut">进入终端</button>
          <button class="button" type="button" id="probe-node">立即复探</button>
          <button class="button ghost" type="button" data-open-asset-modal="${escapeHtml(node.id)}">编辑资产</button>
          <button class="button ghost node-detail-danger-button" type="button" id="delete-node">删除节点</button>
        </div>
      </div>
      <div class="node-detail-hero-status-list">
        ${heroHighlights
          .map(
            (item) => `
              <div class="node-detail-hero-status-item">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.value)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="node-detail-chip-row">
        ${heroChips
          .map(
            (item) => `
              <div class="node-detail-chip">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.value)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

export function renderNodeDetailTemplateActions({ escapeHtml, formatRelativeTime, viewModel }) {
  const {
    selectedApplyTemplate,
    selectedApplyTemplateId,
    selectedInitTemplate,
    selectedInitTemplateValue,
    systemTemplateActionHref,
    systemTemplateApplyOptions,
    systemTemplateInitOptions,
    systemTemplateLatestReleaseAt,
    systemTemplateLatestReleaseName,
    systemTemplateMessage,
    systemTemplatePendingAction,
  } = viewModel;

  const initDisabled = !selectedInitTemplateValue || systemTemplatePendingAction === "init";
  const applyDisabled = !selectedApplyTemplateId || systemTemplatePendingAction === "apply";
  const latestReleaseSummary = systemTemplateLatestReleaseAt
    ? `最近一次模板下发：${systemTemplateLatestReleaseName || "未知模板"} · ${formatRelativeTime(
        systemTemplateLatestReleaseAt,
      )}`
    : "下发记录会同步沉淀到系统模板发布历史与终端回显。";

  return `
    <section class="node-detail-section" id="node-detail-templates">
      <div class="node-detail-section-head">
        <div>
          <h4>模板动作</h4>
          <p>把初始化和运维脚本收口到同一处，避免详情页顶部堆按钮。</p>
        </div>
      </div>
      ${
        systemTemplateMessage
          ? `<div class="message ${escapeHtml(systemTemplateMessage.type || "success")}">${escapeHtml(systemTemplateMessage.text || "")}</div>`
          : ""
      }
      <div class="node-detail-template-stack">
        <article class="node-detail-template-card">
          <div class="node-detail-template-card-head">
            <div>
              <span class="node-detail-template-kicker">初始化模板</span>
              <strong>${escapeHtml(selectedInitTemplate?.label || "选择初始化模板")}</strong>
            </div>
            <span class="provider-pill">Init</span>
          </div>
          <p>${escapeHtml(selectedInitTemplate?.meta || "会沿用初始化任务链路，完成后回写节点状态。")}</p>
          <div class="node-detail-template-action-row">
            <select id="node-init-template-select">
              ${renderTemplateSelectOptions(
                escapeHtml,
                systemTemplateInitOptions,
                selectedInitTemplateValue,
              )}
            </select>
            <button class="button" type="button" id="run-node-init-template"${
              initDisabled ? ' disabled aria-busy="true"' : ""
            }>${systemTemplatePendingAction === "init" ? "初始化中..." : "执行初始化"}</button>
          </div>
        </article>
        <article class="node-detail-template-card">
          <div class="node-detail-template-card-head">
            <div>
              <span class="node-detail-template-kicker">运维模板</span>
              <strong>${escapeHtml(selectedApplyTemplate?.name || selectedApplyTemplate?.label || "选择下发模板")}</strong>
            </div>
            <span class="provider-pill">Ops</span>
          </div>
          <p>${escapeHtml(
            selectedApplyTemplate?.note ||
              selectedApplyTemplate?.script_name ||
              "直接对当前节点执行一次系统模板下发。",
          )}</p>
          <div class="node-detail-template-action-row">
            <select id="node-apply-template-select"${
              systemTemplateApplyOptions.length > 0 ? "" : " disabled"
            }>
              ${
                systemTemplateApplyOptions.length > 0
                  ? renderTemplateSelectOptions(
                      escapeHtml,
                      systemTemplateApplyOptions,
                      selectedApplyTemplateId,
                      "id",
                    )
                  : '<option value="">暂无可下发模板</option>'
              }
            </select>
            <button class="button ghost" type="button" id="run-node-apply-template"${
              applyDisabled ? ' disabled aria-busy="true"' : ""
            }>${systemTemplatePendingAction === "apply" ? "下发中..." : "立即下发"}</button>
          </div>
          <div class="node-detail-template-foot">
            <span>${escapeHtml(latestReleaseSummary)}</span>
            <a class="button ghost" href="${escapeHtml(systemTemplateActionHref)}">进入模板中心</a>
          </div>
        </article>
      </div>
    </section>
  `;
}

export function renderNodeDetailMain({ escapeHtml, formatRelativeTime, viewModel }) {
  const {
    activityItems,
    commercialOverview,
    dashboardCards,
    networkOverviewRows,
    probeLongSummary,
    probeSummaryText,
    routeOverview,
    systemOverviewRows,
  } = viewModel;

  return `
    <article class="stack node-detail-main">
      <section class="node-detail-section" id="node-detail-overview">
        <div class="node-detail-section-head">
          <div>
            <h4>运行概览</h4>
            <p>先看可用性、入口和时效，再决定下一步处理动作。</p>
          </div>
        </div>
        <div class="node-detail-overview-grid">
          <div class="node-detail-overview-strip">
            ${dashboardCards
              .map(
                (item) => `
                  <article class="node-detail-overview-card tone-${item.tone}">
                    <div class="node-detail-overview-card-head">
                      <span>${escapeHtml(item.label)}</span>
                      <strong>${escapeHtml(item.value)}</strong>
                    </div>
                    <div class="node-detail-overview-card-bar">
                      <span style="width:${item.percent}%;"></span>
                    </div>
                    <p>${escapeHtml(item.foot)}</p>
                  </article>
                `,
              )
              .join("")}
          </div>
          <div class="node-detail-overview-meta-grid">
            <article class="node-detail-meta-group">
              <div class="node-detail-meta-group-label">系统事实</div>
              <div class="node-detail-meta-list">
                ${renderMetaRows(escapeHtml, systemOverviewRows)}
              </div>
            </article>
            <article class="node-detail-meta-group">
              <div class="node-detail-meta-group-label">网络入口</div>
              <div class="node-detail-meta-list">
                ${renderMetaRows(escapeHtml, networkOverviewRows)}
              </div>
            </article>
          </div>
        </div>
        <div class="node-detail-overview-brief">
          <span>最新探测</span>
          <strong>${escapeHtml(probeSummaryText)}</strong>
          <p>${escapeHtml(probeLongSummary)}</p>
        </div>
      </section>
      <section class="node-detail-section" id="node-detail-assets">
        <div class="node-detail-section-head">
          <div>
            <h4>资产与链路</h4>
            <p>把资产台账和接入链路集中在一个视图里。</p>
          </div>
        </div>
        <div class="node-detail-two-column">
          <article class="node-detail-subsection">
            <div class="node-detail-subsection-label">资产信息</div>
            <div class="detail-kv node-detail-compact-kv">
              ${renderKvRows(escapeHtml, commercialOverview)}
            </div>
          </article>
          <article class="node-detail-subsection">
            <div class="node-detail-subsection-label">链路信息</div>
            <div class="detail-kv node-detail-compact-kv">
              ${renderKvRows(escapeHtml, routeOverview)}
            </div>
          </article>
        </div>
      </section>
      <section class="node-detail-section" id="node-detail-activity">
        <div class="node-detail-section-head">
          <div>
            <h4>最近活动</h4>
            <p>只保留最近的探测与任务，方便快速扫一眼。</p>
          </div>
        </div>
        <div class="node-detail-timeline">
          ${
            activityItems.length > 0
              ? activityItems
                  .map(
                    (item) => `
                      <article class="node-detail-timeline-item">
                        <span class="node-detail-timeline-time">${escapeHtml(formatRelativeTime(item.at))}</span>
                        <div class="node-detail-timeline-body">
                          <div class="node-detail-timeline-head">
                            <strong>${escapeHtml(item.title)}</strong>
                            <span class="${item.badgeClass}">${escapeHtml(item.badgeText)}</span>
                          </div>
                          <p>${escapeHtml(item.summary)}</p>
                          <p class="tiny">${escapeHtml(item.detail)}</p>
                        </div>
                      </article>
                    `,
                  )
                  .join("")
              : `
                <article class="node-detail-timeline-item">
                  <div class="node-detail-timeline-body">
                    <strong>暂无最近活动</strong>
                    <p>这台节点还没有探测或任务记录，后续初始化、复探和脚本执行都会在这里串起来。</p>
                  </div>
                </article>
              `
          }
        </div>
      </section>
    </article>
  `;
}

export function renderNodeDetailAside({ escapeHtml, formatRelativeTime, viewModel }) {
  const { healthOverviewRows, healthSummaryMeta, healthSummaryText, recommendationItems } = viewModel;

  return `
    <aside class="aside-stack node-detail-side">
      <section class="node-detail-section" id="node-detail-health">
        <div class="node-detail-section-head">
          <div>
            <h4>接管诊断</h4>
            <p>聚焦入口识别与接管阻塞点，不再重复罗列概览信息。</p>
          </div>
        </div>
        <div class="node-detail-diagnostic-grid">
          ${renderDiagnosticRows(escapeHtml, healthOverviewRows)}
        </div>
        <div class="event">
          <strong>当前判断</strong>
          <p>${escapeHtml(healthSummaryText)}</p>
          <p class="tiny">${escapeHtml(healthSummaryMeta)}</p>
        </div>
      </section>
      ${renderNodeDetailTemplateActions({ escapeHtml, formatRelativeTime, viewModel })}
      <section class="node-detail-section">
        <div class="node-detail-section-head">
          <div>
            <h4>待处理动作</h4>
            <p>只保留当前最值得做的下一步，让详情页更像操作台。</p>
          </div>
        </div>
        <div class="node-detail-recommendations">
          ${renderRecommendationItems(escapeHtml, recommendationItems)}
        </div>
      </section>
    </aside>
  `;
}
