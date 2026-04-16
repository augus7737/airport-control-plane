export function createServerStartupRuntime(dependencies) {
  const {
    ensureNodeManagementMigration,
    ensureProviderRegionNormalization,
    ensureNodeProviderLinkMigration,
    ensureBootstrapInitTasks,
    listen,
    loadAccessUserStore,
    loadBootstrapTokens,
    loadConfigReleaseStore,
    loadDiagnosticStore,
    loadNodeStore,
    loadNodeGroupStore,
    loadOperationStore,
    loadPlatformSingBoxDistribution,
    loadProviderStore,
    loadProbeStore,
    loadProxyProfileStore,
    loadSystemTemplateReleaseStore,
    loadSystemTemplateStore,
    loadSystemUserReleaseStore,
    loadSystemUserStore,
    loadTaskStore,
    ensureDefaultSystemTemplates,
    reconcileTaskStoreFromOperations,
    startProbeScheduler,
  } = dependencies;

  async function start() {
    await loadNodeStore();
    await ensureNodeManagementMigration?.();
    await loadProviderStore?.();
    await ensureProviderRegionNormalization?.();
    await ensureNodeProviderLinkMigration?.();
    await loadOperationStore();
    await loadTaskStore();
    await loadProbeStore();
    await loadDiagnosticStore?.();
    await loadBootstrapTokens();
    await loadAccessUserStore();
    await loadProxyProfileStore();
    await loadSystemUserStore?.();
    await loadSystemTemplateStore?.();
    await loadNodeGroupStore();
    await loadConfigReleaseStore();
    await loadSystemUserReleaseStore?.();
    await loadSystemTemplateReleaseStore?.();
    await ensureDefaultSystemTemplates?.();
    await loadPlatformSingBoxDistribution?.();
    await reconcileTaskStoreFromOperations();
    await ensureBootstrapInitTasks();
    listen();
    startProbeScheduler?.();
  }

  return {
    start,
  };
}
