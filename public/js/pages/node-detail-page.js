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
  formatManagementAccessMode,
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
  getNodeCostSnapshot,
  getDiagnostics,
  getDiagnosticsForNode,
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
  sortDiagnostics,
  sortProbes,
  sortTasks,
  statusClassName,
  statusText,
}) {
  function renderNodeDetail(nodes) {
    const node = getCurrentNode(nodes);
    if (!node) {
      return `<div class="empty">${
        nodes.length > 0
          ? "没有找到该节点，可能已被删除或链接有误。返回节点清单重新选择。"
          : "当前还没有节点可查看详情。先执行纳管命令把第一台机器接入平台。"
      }</div>`;
    }

    const viewModel = buildNodeDetailViewModel({
      buildNodeRecommendations,
      daysUntil,
      formatAccessMode,
      formatDate,
      formatManagementAccessMode,
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
      getNodeCostSnapshot,
      getDiagnostics,
      getDiagnosticsForNode,
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
      sortDiagnostics,
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
