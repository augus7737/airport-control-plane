import {
  buildNodeDetailViewModel,
  renderNodeDetailAside,
  renderNodeDetailHero,
  renderNodeDetailMain,
} from "./node-detail-page-helpers.js";

export function createNodeDetailPageRenderer({
  appState,
  buildNodeRecommendations,
  daysUntil,
  escapeHtml,
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
  getCurrentNode,
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
  resolveRelayNode,
  sortProbes,
  sortTasks,
  statusClassName,
  statusText,
}) {
  function renderNodeDetail(nodes) {
    const node = getCurrentNode(nodes);
    if (!node) {
      return '<div class="empty">当前还没有可查看详情的节点。</div>';
    }

    const viewModel = buildNodeDetailViewModel({
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
      nodeDetailState: appState.nodeDetail,
      nodes,
      resolveRelayNode,
      sortProbes,
      sortTasks,
      statusClassName,
      statusText,
      systemTemplates: appState.systemTemplates,
    });

    return `
      ${renderNodeDetailHero({ escapeHtml, viewModel })}
      <section class="workspace fade-up">
        ${renderNodeDetailMain({ escapeHtml, formatRelativeTime, viewModel })}
        ${renderNodeDetailAside({ escapeHtml, formatRelativeTime, viewModel })}
      </section>
    `;
  }

  return {
    renderNodeDetail,
  };
}
