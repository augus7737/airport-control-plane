export function createPageRenderRuntime({
  appState,
  documentRef,
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
  setupNodesFilters,
  setupPlatformKeyActions,
  setupProxyProfilesPage,
  setupReleasesPage,
  setupHoverPanels,
  setupSystemTemplatesPage,
  setupSystemUsersPage,
  setupTasksPage,
  setupTerminalPage,
  setupTokenModal,
  setupTokensPage,
  shellTemplate,
}) {
  function renderCurrentContent() {
    const navCount = documentRef.getElementById("nav-node-count");
    if (navCount) navCount.textContent = String(appState.nodes.length);

    const pageContent = documentRef.getElementById("page-content");
    if (!pageContent) {
      return;
    }

    if (page === "overview") {
      pageContent.innerHTML = renderOverview(appState.nodes);
    } else if (page === "nodes") {
      pageContent.innerHTML = renderNodesPage(appState.nodes);
    } else if (page === "access-users") {
      pageContent.innerHTML = renderAccessUsersPage();
    } else if (page === "system-users") {
      pageContent.innerHTML = renderSystemUsersPage();
    } else if (page === "system-templates") {
      pageContent.innerHTML = renderSystemTemplatesPage();
    } else if (page === "proxy-profiles") {
      pageContent.innerHTML = renderProxyProfilesPage();
    } else if (page === "releases") {
      pageContent.innerHTML = renderReleasesPage();
    } else if (page === "node-detail") {
      pageContent.innerHTML = renderNodeDetail(appState.nodes);
    } else if (page === "shell") {
      pageContent.innerHTML = renderNodeShellPage(appState.nodes, appState.operations);
    } else if (page === "tasks") {
      pageContent.innerHTML = renderTasksPage();
    } else if (page === "terminal") {
      pageContent.innerHTML = renderTerminalPage(appState.nodes, appState.operations);
    } else if (page === "tokens") {
      pageContent.innerHTML = renderTokensPage();
    } else if (page === "providers") {
      pageContent.innerHTML = renderProvidersPage();
    } else if (page === "routes") {
      pageContent.innerHTML = renderRoutesPage(appState.nodes);
    }

    setupNodesFilters();
    setupTerminalPage();
    setupNodeDeleteActions();
    setupNodeDetailActions();
    setupNodeTerminal();
    setupTasksPage();
    setupTokensPage();
    setupAccessUsersPage();
    setupSystemUsersPage();
    setupSystemTemplatesPage();
    setupProxyProfilesPage();
    setupReleasesPage();
    setupPlatformKeyActions();
    setupHoverPanels();
    refreshBootstrapCommandDom();
  }

  async function renderPage() {
    const app = documentRef.getElementById("app");
    if (!app) {
      return;
    }

    const meta = pageMeta[page] || pageMeta.overview;
    app.innerHTML = shellTemplate(meta, page === "node-detail" || page === "shell" ? "nodes" : page);

    await hydrateRuntimeStore();
    renderCurrentContent();

    setupModal();
    setupManualModal();
    setupAssetModal();
    setupTokenModal();
  }

  return {
    renderCurrentContent,
    renderPage,
  };
}
