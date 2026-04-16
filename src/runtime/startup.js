export function createServerStartupRuntime(dependencies) {
  const {
    ensureNodeManagementMigration,
    ensureProviderRegionNormalization,
    ensureBootstrapInitTasks,
    listen,
    loadAccessUserStore,
    loadBootstrapTokens,
    loadConfigReleaseStore,
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
    await loadOperationStore();
    await loadTaskStore();
    await loadProbeStore();
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
