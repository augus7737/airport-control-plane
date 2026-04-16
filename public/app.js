import {
  daysUntil,
  escapeHtml,
  formatDate,
  formatDateInput,
  formatDateTime,
  formatDuration,
  formatOperationMode,
  formatRelativeTime,
  formatRenewal,
  formatTokenUsage,
  formatTraffic,
  formatExitCode,
  getEffectiveTokenStatus,
  maskTokenValue,
  normalizeOperationOutput,
  resolveDurationMs,
  resolveTransportLabel,
  shellQuote,
  shellStatusClassName,
  shellStatusText,
  statusClassName,
  statusText,
  summarizeOperationExitCode,
  summarizeOperationTransport,
  toNumberOrNull,
} from "./js/shared/core-formatters.js";
import {
  formatAccessMode,
  formatManagementAccessMode,
  formatDiskConfig,
  formatExpiryCountdown,
  formatIpSourceLabel,
  formatMemoryConfig,
  formatNodeConfiguration,
  formatNodeConfigMeta,
  formatNodeConfigSpecs,
  formatNodeIpOwnershipSummary,
  formatNodeSshPort,
  getAccessMode,
  getExpiryTone,
  getNodeDisplayName,
  getPrimaryPublicIpRecord,
  getPublicIpRecords,
  shortenIpAddress,
} from "./js/shared/node-formatters.js";
import { createHoverPanelsModule } from "./js/shared/hover-panels.js";
import {
  formatProbeCapability,
  formatProbeLongSummary,
  formatProbeStageCompact,
  formatProbeSummary,
  formatProbeType,
  getProbeSshStage,
  getProbeTcpStage,
  normalizeProbeCode,
  probeReasonLabel,
} from "./js/shared/probe-formatters.js";
import {
  buildCurvePath,
  buildRelayGroups,
  buildRouteGraph,
  formatRouteSummary,
  getCountryStats,
  getNodeCountry,
  getRelayDisplayName,
  resolveRelayNode,
} from "./js/shared/route-helpers.js";
import {
  getDiagnosticsForNode,
  formatTaskAttempt,
  getProbesForNode,
  getTaskDisplayTitle,
  getTasksForNode,
  getTaskSummary,
  resolveTaskNode,
} from "./js/shared/task-helpers.js";
import {
  appState,
  getBootstrapScriptUrl,
  getPlatformBaseUrl,
  getProbeSchedulerState,
  getPlatformSshKeyState,
  getPrimaryBootstrapToken,
  registerRuntimeStoreHooks,
  setDiagnostics,
  setOperations,
  setPlatformContext,
  setProbes,
  sortDiagnostics,
  sortProbes,
  sortTasks,
  upsertBootstrapToken,
  upsertDiagnostic,
  upsertNode,
  upsertTask,
} from "./js/store/runtime-store.js";
import {
  createAccessUser,
  createConfigRelease,
  createNodeGroup,
  createProvider,
  createProxyProfile,
  createSystemTemplate,
  createSystemUser,
  applySystemTemplate,
  deleteAccessUser,
  deleteNodeGroup,
  deleteProvider,
  deleteProxyProfile,
  deleteSystemTemplate,
  deleteSystemUser,
  getAccessUserShare,
  hydrateRuntimeStore,
  regenerateAccessUserShareToken,
  refreshOperations,
  refreshRuntimeData,
  runNodeDiagnostic,
  applySystemUsers,
  updateAccessUser,
  updateNodeGroup,
  updateProvider,
  updateProxyProfile,
  updateSystemTemplate,
  updateSystemUser,
} from "./js/services/runtime-api.js";
import {
  buildLoginUrl,
  fetchWithAuth,
  getOperatorDisplayName,
  logoutOperator,
  requireOperatorSession,
} from "./js/auth/auth-client.js";
import { createNodeDetailActionsModule } from "./js/actions/node-detail-actions.js";
import { createNodeTableRenderer } from "./js/components/node-table.js";
import { createShellTemplateModule } from "./js/layout/shell-template.js";
import { createNodeAssetModalsModule } from "./js/modals/node-asset-modals.js";
import { createProvisioningModalsModule } from "./js/modals/provisioning-modals.js";
import { createOverviewPageRenderer } from "./js/pages/overview-page.js";
import { createAccessUsersPageModule } from "./js/pages/access-users-page.js";
import { createNodeCellHelpersModule } from "./js/pages/node-cell-helpers.js";
import { createNodeDetailPageRenderer } from "./js/pages/node-detail-page.js";
import { createNodeShellPageModule } from "./js/pages/node-shell-page.js";
import { createNodesPageModule } from "./js/pages/nodes-page.js";
import { createProvidersPageModule } from "./js/pages/providers-page.js";
import { createPageRenderRuntime } from "./js/pages/page-render-runtime.js";
import { createProxyProfilesPageModule } from "./js/pages/proxy-profiles-page.js";
import { createReleasesPageModule } from "./js/pages/releases-page.js";
import { createRoutesPageModule } from "./js/pages/routes-page.js";
import { createSystemTemplatesPageModule } from "./js/pages/system-templates-page.js";
import { createSystemUsersPageModule } from "./js/pages/system-users-page.js";
import { createTerminalPageModule } from "./js/pages/terminal-page.js";
import { createTasksPageModule } from "./js/pages/tasks-page.js";
import { createTokensPageModule } from "./js/pages/tokens-page.js";
import { createPlatformSshPageModule } from "./js/platform/platform-ssh-page.js";
import { createNodeNavigationModule } from "./js/shared/node-navigation.js";
import { createNodeShellRuntimeModule } from "./js/shell/node-shell-runtime.js";

const page = document.body.dataset.page || "overview";
const authFetch = (input, init = {}) => fetchWithAuth(input, init, { windowRef: window });

const pageMeta = {
  overview: {
    title: "总览",
    subtitle: "先看控制面当前状态，再看节点进入平台后的主链路。",
    actions: [
      { label: "手动录入节点", kind: "default", id: "open-manual-modal" },
      { label: "纳管新节点", kind: "primary", id: "open-enroll-modal" },
    ],
  },
  nodes: {
    title: "节点清单",
    subtitle: "统一查看节点状态、配置规格、到期信息和接入链路。",
    actions: [
      { label: "批量终端", kind: "default", href: "/terminal.html" },
      { label: "手动录入节点", kind: "default", id: "open-manual-modal" },
      { label: "纳管新节点", kind: "primary", id: "open-enroll-modal" },
    ],
  },
  "node-detail": {
    title: "节点详情",
    subtitle: "查看单个节点的事实信息、状态、最近任务和后续动作。",
    actions: [
      { label: "返回节点清单", kind: "default", href: "/nodes.html" },
    ],
  },
  shell: {
    title: "节点终端",
    subtitle: "为单台节点打开独立 Web Shell，会话、回显和快捷操作都单独承载。",
    actions: [
      { label: "返回节点清单", kind: "default", href: "/nodes.html" },
      { label: "批量终端", kind: "default", href: "/terminal.html" },
    ],
  },
  tasks: {
    title: "任务中心",
    subtitle: "把初始化、重试、修复、纳管这些动作变成可追踪的任务流。",
    actions: [
      { label: "创建任务模板", kind: "default" },
      { label: "新建一次性任务", kind: "primary" },
    ],
  },
  terminal: {
    title: "运维终端",
    subtitle: "在一个控制台里批量挑选节点、下发命令或脚本，并查看逐台回显结果。",
    actions: [
      { label: "返回节点清单", kind: "default", href: "/nodes.html" },
    ],
  },
  tokens: {
    title: "注册令牌",
    subtitle: "用可审计、可失效、可分组的令牌管理节点入网入口。",
    actions: [
      { label: "查看审计日志", kind: "default" },
      { label: "创建新令牌", kind: "primary", id: "open-token-modal" },
    ],
  },
  providers: {
    title: "云厂商",
    subtitle: "管理供应商账户、区域、自动建机能力和到期信息来源。",
    actions: [
      { label: "同步云资源", kind: "default", id: "providers-sync-placeholder" },
      { label: "接入新厂商", kind: "primary", id: "focus-provider-form" },
    ],
  },
  "access-users": {
    title: "接入用户",
    subtitle: "集中维护代理接入身份、有效期、挂载模板和投放范围。",
    actions: [
      { label: "查看发布中心", kind: "default", href: "/releases.html" },
      { label: "新建接入用户", kind: "primary", id: "focus-access-user-form" },
    ],
  },
  "system-users": {
    title: "系统用户",
    subtitle: "集中维护 Linux 系统账号、SSH 公钥、sudo 权限和默认投放范围。",
    actions: [
      { label: "查看运维终端", kind: "default", href: "/terminal.html" },
      { label: "批量下发", kind: "default", id: "focus-system-user-apply" },
      { label: "新建系统用户", kind: "primary", id: "focus-system-user-form" },
    ],
  },
  "system-templates": {
    title: "系统模板",
    subtitle: "沉淀一键初始化、系统基线和批量运维脚本，统一下发到节点。",
    actions: [
      { label: "查看运维终端", kind: "default", href: "/terminal.html" },
      { label: "批量下发", kind: "default", id: "focus-system-template-apply" },
      { label: "新建系统模板", kind: "primary", id: "focus-system-template-form" },
    ],
  },
  "proxy-profiles": {
    title: "协议模板",
    subtitle: "维护 VLESS 等协议模板，把端口、传输和安全参数统一起来。",
    actions: [
      { label: "查看接入用户", kind: "default", href: "/access-users.html" },
      { label: "新建协议模板", kind: "primary", id: "focus-proxy-profile-form" },
    ],
  },
  releases: {
    title: "发布中心",
    subtitle: "把用户、模板和节点组拼成一次可追踪的配置发布动作。",
    actions: [
      { label: "管理节点组", kind: "default", id: "focus-node-group-form" },
      { label: "发起发布", kind: "primary", id: "focus-release-builder" },
    ],
  },
  routes: {
    title: "中转拓扑",
    subtitle: "把直连节点和经中转节点分开看，避免链路关系只留在备注里。",
    actions: [
      { label: "返回节点清单", kind: "default", href: "/nodes.html" },
      { label: "手动录入节点", kind: "primary", id: "open-manual-modal" },
    ],
  },
};

let nodeShellAutoLaunchHandled = false;
let pageRenderRuntime = null;
const { getCurrentNode, nodeDetailHref, nodeShellHref } = createNodeNavigationModule({
  windowRef: window,
});

function renderCurrentContent() {
  return pageRenderRuntime?.renderCurrentContent();
}

async function renderPage() {
  return pageRenderRuntime?.renderPage();
}

const {
  assetModalTemplate,
  manualModalTemplate,
  setupAssetModal,
  setupManualModal,
} = createNodeAssetModalsModule({
  appState,
  documentRef: document,
  escapeHtml,
  fetchImpl: authFetch,
  formatDateInput,
  getCurrentNode,
  getNodeDisplayName,
  page,
  refreshRuntimeData,
  renderCurrentContent,
  toNumberOrNull,
  upsertNode,
});

const {
  enrollModalTemplate,
  formatPlatformPublicKeyPreview,
  formatPlatformSshBootstrapState,
  formatPlatformSshSource,
  getBootstrapCommand,
  getBootstrapEnrollCommand,
  getBootstrapMirrorCommand,
  getBootstrapPrepareCommand,
  platformSshStatusClass,
  platformSshStatusLabel,
  refreshBootstrapCommandDom,
  renderBootstrapCommandPair,
  setupModal,
  setupTokenModal,
  shouldShowBootstrapHero,
  shouldShowProvisioningChips,
  tokenModalTemplate,
} = createProvisioningModalsModule({
  appState,
  documentRef: document,
  escapeHtml,
  fetchImpl: authFetch,
  getBootstrapScriptUrl,
  getPlatformBaseUrl,
  getPlatformSshKeyState,
  getPrimaryBootstrapToken,
  navigatorRef: navigator,
  page,
  renderCurrentContent,
  shellQuote,
  toNumberOrNull,
  upsertBootstrapToken,
  windowRef: window,
});

const { renderNodeConfigurationCell, renderPublicIpCell } = createNodeCellHelpersModule({
  escapeHtml,
  formatIpSourceLabel,
  formatNodeConfigMeta,
  formatNodeConfigSpecs,
  formatNodeConfiguration,
  formatNodeSshPort,
  getPrimaryPublicIpRecord,
  getPublicIpRecords,
  shortenIpAddress,
});
const {
  renderPlatformSshPanel,
  renderPlatformSshSummaryPanel,
  setupPlatformKeyActions,
} = createPlatformSshPageModule({
  documentRef: document,
  escapeHtml,
  fetchImpl: authFetch,
  formatPlatformPublicKeyPreview,
  formatPlatformSshBootstrapState,
  formatPlatformSshSource,
  getPlatformSshKeyState,
  navigatorRef: navigator,
  platformSshStatusClass,
  platformSshStatusLabel,
  renderCurrentContent,
  setPlatformContext,
  windowRef: window,
});

const { buildNodeRecommendations, nodeTable } = createNodeTableRenderer({
  daysUntil,
  escapeHtml,
  formatAccessMode,
  formatDate,
  formatExpiryCountdown,
  formatProbeCapability,
  formatProbeLongSummary,
  formatProbeStageCompact,
  formatProbeSummary,
  formatProbeType,
  formatRelativeTime,
  formatRenewal,
  formatRouteSummary,
  formatTraffic,
  getAccessMode,
  getExpiryTone,
  getLatestProbeForNode: (node) => getProbesForNode(node, appState.probes, sortProbes)[0] || null,
  getNodeCountry,
  getNodeCostSnapshot: (nodeId) =>
    appState.costs.nodes.find((item) => item.node_id === nodeId) || null,
  getNodeDisplayName,
  getProbeSchedulerState,
  getProbeSshStage,
  getRouteNodes: () => appState.nodes,
  nodeDetailHref,
  nodeShellHref,
  normalizeProbeCode,
  renderNodeConfigurationCell,
  renderPublicIpCell,
  statusClassName,
  statusText,
});
const { setupHoverPanels } = createHoverPanelsModule({
  documentRef: document,
  windowRef: window,
});
const {
  renderCountryDistribution,
  renderRouteGraph,
  renderRoutesPage,
} = createRoutesPageModule({
  buildCurvePath,
  buildRelayGroups,
  buildRouteGraph,
  formatRouteSummary,
  getAccessMode,
  getCountryStats,
  getNodeDisplayName,
  nodeTable,
  statusClassName,
  statusText,
});
const { renderTokensPage, setupTokensPage } = createTokensPageModule({
  appState,
  daysUntil,
  documentRef: document,
  escapeHtml,
  fetchImpl: authFetch,
  formatDate,
  formatRelativeTime,
  formatTokenUsage,
  getBootstrapCommand,
  getBootstrapEnrollCommand,
  getBootstrapMirrorCommand,
  getBootstrapPrepareCommand,
  getEffectiveTokenStatus,
  getPrimaryBootstrapToken,
  maskTokenValue,
  navigatorRef: navigator,
  page,
  renderBootstrapCommandPair,
  renderCurrentContent,
  renderPlatformSshPanel,
  statusClassName,
  statusText,
  upsertBootstrapToken,
  windowRef: window,
});
const {
  renderNodesPage,
  setupNodesFilters,
} = createNodesPageModule({
  appState,
  daysUntil,
  documentRef: document,
  getAccessMode,
  nodeTable,
  page,
  pageMeta,
  renderCurrentContent,
});
const { renderTasksPage, setupTasksPage } = createTasksPageModule({
  appState,
  documentRef: document,
  escapeHtml,
  fetchImpl: authFetch,
  formatRelativeTime,
  formatTaskAttempt,
  getNodeDisplayName,
  getTaskDisplayTitle,
  getTaskSummary,
  nodeDetailHref,
  page,
  refreshRuntimeData,
  renderCurrentContent,
  resolveTaskNode,
  statusClassName,
  statusText,
  windowRef: window,
});
const { renderProvidersPage, setupProvidersPage } = createProvidersPageModule({
  appState,
  createProvider,
  deleteProvider,
  documentRef: document,
  escapeHtml,
  formatRelativeTime,
  page,
  refreshRuntimeData,
  renderCurrentContent,
  statusClassName,
  statusText,
  updateProvider,
  windowRef: window,
});
const { renderAccessUsersPage, setupAccessUsersPage } = createAccessUsersPageModule({
  appState,
  createAccessUser,
  deleteAccessUser,
  documentRef: document,
  escapeHtml,
  formatDate,
  formatRelativeTime,
  getAccessUserShare,
  regenerateAccessUserShareToken,
  page,
  refreshRuntimeData,
  renderCurrentContent,
  statusClassName,
  statusText,
  updateAccessUser,
  windowRef: window,
});
const { renderSystemUsersPage, setupSystemUsersPage } = createSystemUsersPageModule({
  appState,
  applySystemUsers,
  createSystemUser,
  deleteSystemUser,
  documentRef: document,
  escapeHtml,
  formatDateTime,
  formatRelativeTime,
  page,
  refreshRuntimeData,
  renderCurrentContent,
  statusClassName,
  statusText,
  updateSystemUser,
  windowRef: window,
});
const { renderSystemTemplatesPage, setupSystemTemplatesPage } = createSystemTemplatesPageModule({
  appState,
  applySystemTemplate,
  createSystemTemplate,
  deleteSystemTemplate,
  documentRef: document,
  escapeHtml,
  formatDateTime,
  formatRelativeTime,
  page,
  refreshRuntimeData,
  renderCurrentContent,
  statusClassName,
  statusText,
  updateSystemTemplate,
  windowRef: window,
});
const { renderProxyProfilesPage, setupProxyProfilesPage } = createProxyProfilesPageModule({
  appState,
  createProxyProfile,
  deleteProxyProfile,
  documentRef: document,
  escapeHtml,
  formatDate,
  formatRelativeTime,
  page,
  refreshRuntimeData,
  renderCurrentContent,
  statusClassName,
  statusText,
  updateProxyProfile,
  windowRef: window,
});
const { renderReleasesPage, setupReleasesPage } = createReleasesPageModule({
  appState,
  createConfigRelease,
  createNodeGroup,
  deleteNodeGroup,
  documentRef: document,
  escapeHtml,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  page,
  refreshRuntimeData,
  renderCurrentContent,
  statusClassName,
  statusText,
  updateNodeGroup,
  windowRef: window,
});
const { renderOverview } = createOverviewPageRenderer({
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
  getCostSummary: () => appState.costs.summary,
  getTokens: () => appState.tokens,
  maskTokenValue,
  nodeDetailHref,
  nodeShellHref,
  nodeTable,
  platformSshStatusLabel,
  renderCountryDistribution,
  statusText,
});
let nodeShellRuntime = null;
const {
  getNodeOperations,
  getNodeTerminalPresetCommand,
  renderNodeTerminalSection,
  renderTerminalPage,
  setupTerminalPage,
} = createTerminalPageModule({
  appState,
  escapeHtml,
  fetchImpl: authFetch,
  formatAccessMode,
  formatDateTime,
  formatDuration,
  formatExitCode,
  formatNodeSshPort,
  formatOperationMode,
  formatRelativeTime,
  formatRouteSummary,
  getAccessMode,
  getNodeDisplayName,
  getRelayDisplayName,
  nodeShellScreenContent: (...args) => nodeShellRuntime?.nodeShellScreenContent(...args) || "",
  nodeShellWritable: (...args) => nodeShellRuntime?.nodeShellWritable(...args) || false,
  normalizeOperationOutput,
  page,
  refreshOperations,
  renderCurrentContent,
  resolveDurationMs,
  resolveRelayNode,
  resolveTransportLabel,
  setOperations,
  shellStatusClassName,
  shellStatusText,
  statusClassName,
  statusText,
  summarizeOperationExitCode,
  summarizeOperationTransport,
});
nodeShellRuntime = createNodeShellRuntimeModule({
  appState,
  documentRef: document,
  escapeHtml,
  fetchImpl: authFetch,
  formatRelativeTime,
  getCurrentNode,
  getNodeDisplayName,
  getNodeTerminalPresetCommand,
  getNodeShellAutoLaunchHandled: () => nodeShellAutoLaunchHandled,
  navigatorRef: navigator,
  page,
  renderCurrentContent,
  setNodeShellAutoLaunchHandled: (value) => {
    nodeShellAutoLaunchHandled = value;
  },
  shellStatusClassName,
  shellStatusText,
  windowRef: window,
});
const { nodeShellScreenContent, nodeShellWritable, setupNodeTerminal } = nodeShellRuntime;
const { renderNodeShellEntry, renderNodeShellPage } = createNodeShellPageModule({
  appState,
  escapeHtml,
  formatAccessMode,
  formatManagementAccessMode,
  formatNodeConfiguration,
  formatNodeSshPort,
  formatRelativeTime,
  getAccessMode,
  getCurrentNode,
  getNodeDisplayName,
  getNodeOperations,
  nodeDetailHref,
  nodeShellHref,
  renderNodeTerminalSection,
  shellStatusClassName,
  shellStatusText,
});
const { renderNodeDetail } = createNodeDetailPageRenderer({
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
  getNodeCostSnapshot: (nodeId) =>
    appState.costs.nodes.find((item) => item.node_id === nodeId) || null,
  getDiagnostics: () => appState.diagnostics,
  getDiagnosticsForNode,
  getNodeDisplayName,
  getOperations: () => appState.operations,
  getPrimaryPublicIpRecord,
  getProbes: () => appState.probes,
  getProbesForNode,
  getPublicIpRecords,
  getRelayDisplayName,
  getSystemTemplateReleases: () => appState.systemTemplateReleases,
  getTaskDisplayTitle,
  getTasks: () => appState.tasks,
  getTaskSummary,
  getTasksForNode,
  nodeShellHref,
  renderNodeShellEntry,
  resolveRelayNode,
  sortDiagnostics,
  sortProbes,
  sortTasks,
  statusClassName,
  statusText,
});

const navItems = [
  { key: "overview", label: "总览", href: "/" },
  { key: "nodes", label: "节点清单", href: "/nodes.html" },
  { key: "tasks", label: "任务中心", href: "/tasks.html" },
  { key: "terminal", label: "运维终端", href: "/terminal.html" },
  { key: "tokens", label: "注册令牌", href: "/tokens.html" },
  { key: "access-users", label: "接入用户", href: "/access-users.html" },
  { key: "system-users", label: "系统用户", href: "/system-users.html" },
  { key: "system-templates", label: "系统模板", href: "/system-templates.html" },
  { key: "proxy-profiles", label: "协议模板", href: "/proxy-profiles.html" },
  { key: "releases", label: "发布中心", href: "/releases.html" },
  { key: "providers", label: "云厂商", href: "/providers.html" },
  { key: "routes", label: "中转拓扑", href: "/routes.html" },
];
const { shellTemplate } = createShellTemplateModule({
  assetModalTemplate,
  enrollModalTemplate,
  escapeHtml,
  getPlatformBaseUrl,
  manualModalTemplate,
  navItems,
  platformSshStatusLabel,
  renderBootstrapCommandPair,
  shouldShowBootstrapHero,
  shouldShowProvisioningChips,
  tokenModalTemplate,
});

registerRuntimeStoreHooks({
  onBootstrapStateChange: () => refreshBootstrapCommandDom(),
});

const { setupNodeDeleteActions, setupNodeDetailActions } = createNodeDetailActionsModule({
  appState,
  documentRef: document,
  fetchImpl: authFetch,
  getCurrentNode,
  getDiagnosticsForNode,
  getNodeDisplayName,
  getNodeShellAutoLaunchHandled: () => nodeShellAutoLaunchHandled,
  nodeShellHref,
  page,
  refreshRuntimeData,
  runNodeDiagnostic,
  renderCurrentContent,
  setNodeShellAutoLaunchHandled: (value) => {
    nodeShellAutoLaunchHandled = value;
  },
  setDiagnostics,
  setOperations,
  setProbes,
  sortDiagnostics,
  statusText,
  upsertDiagnostic,
  upsertNode,
  upsertTask,
  windowRef: window,
});

pageRenderRuntime = createPageRenderRuntime({
  appState,
  documentRef: document,
  hydrateRuntimeStore,
  page,
  pageMeta,
  refreshBootstrapCommandDom,
  renderAccessUsersPage,
  renderNodeDetail,
  renderNodeShellPage,
  renderNodesPage,
  renderOverview,
  renderProvidersPage,
  renderProxyProfilesPage,
  renderReleasesPage,
  renderRoutesPage,
  renderSystemTemplatesPage,
  renderSystemUsersPage,
  renderTasksPage,
  renderTerminalPage,
  renderTokensPage,
  setupAccessUsersPage,
  setupAssetModal,
  setupManualModal,
  setupModal,
  setupNodeDeleteActions,
  setupNodeDetailActions,
  setupNodeTerminal,
  setupHoverPanels,
  setupNodesFilters,
  setupPlatformKeyActions,
  setupProvidersPage,
  setupProxyProfilesPage,
  setupReleasesPage,
  setupSystemTemplatesPage,
  setupSystemUsersPage,
  setupTasksPage,
  setupTerminalPage,
  setupTokenModal,
  setupTokensPage,
  shellTemplate,
});

function syncOperatorSessionChrome(session) {
  const sessionPill = document.getElementById("operator-session-pill");
  const sessionLabel = document.getElementById("operator-session-label");
  const logoutButton = document.getElementById("operator-logout-button");

  if (sessionPill) {
    if (session?.authenticated) {
      sessionPill.dataset.authState = "authenticated";
    } else if (session?.reason === "error" || session?.reason === "network_error") {
      sessionPill.dataset.authState = "disabled";
    } else {
      sessionPill.dataset.authState = session?.enabled ? "guest" : "disabled";
    }
  }

  if (sessionLabel) {
    if (session?.authenticated) {
      sessionLabel.textContent = getOperatorDisplayName(session);
    } else if (session?.reason === "error" || session?.reason === "network_error") {
      sessionLabel.textContent = "鉴权异常";
    } else if (session?.enabled) {
      sessionLabel.textContent = "未登录";
    } else {
      sessionLabel.textContent = "未启用鉴权";
    }
  }

  if (logoutButton) {
    logoutButton.hidden = !session?.authenticated;
  }
}

function setupLogoutAction() {
  const logoutButton = document.getElementById("operator-logout-button");
  if (!logoutButton || logoutButton.dataset.bound === "true") {
    return;
  }

  logoutButton.dataset.bound = "true";
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    logoutButton.textContent = "退出中...";

    try {
      await logoutOperator();
    } catch (error) {
      console.error("logout failed", error);
    }

    window.location.assign(buildLoginUrl("/", window));
  });
}

async function startApp() {
  const session = await requireOperatorSession({ windowRef: window });
  if (session === null) {
    return;
  }

  try {
    await renderPage();
    syncOperatorSessionChrome(session);
    setupLogoutAction();
  } catch (error) {
    if (error?.status === 401 || error?.code === "UNAUTHORIZED") {
      return;
    }
    console.error("render page failed", error);
  }
}

startApp();
