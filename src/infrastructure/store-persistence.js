import {
  atomicWriteJson,
  createFileWriteQueue,
  isMissingFileError,
  readJsonWithBackup,
} from "./json-file-store.js";

export function createStorePersistenceInfrastructure(dependencies) {
  const {
    accessUserStore,
    accessUsersFile,
    configReleaseStore,
    configReleasesFile,
    dataDir,
    diagnosticStore,
    diagnosticsFile,
    fingerprintIndex,
    mkdir,
    nodeStore,
    nodeGroupStore,
    nodeGroupsFile,
    nodesFile,
    normalizeNodeFacts,
    nowIso,
    operationStore,
    operationsFile,
    providerStore,
    providersFile,
    probeStore,
    proxyProfileStore,
    proxyProfilesFile,
    probesFile,
    readFile,
    systemTemplateReleaseStore,
    systemTemplateReleasesFile,
    systemTemplateStore,
    systemTemplatesFile,
    systemUserReleaseStore,
    systemUserReleasesFile,
    systemUserStore,
    systemUsersFile,
    taskStore,
    tasksFile,
  } = dependencies;
  const writeQueues = new Map();

  async function ensureDataDir() {
    await mkdir(dataDir, { recursive: true });
  }

  function writeQueueFor(filePath) {
    if (!writeQueues.has(filePath)) {
      writeQueues.set(filePath, createFileWriteQueue());
    }
    return writeQueues.get(filePath);
  }

  async function persistJsonFile(filePath, payload) {
    await ensureDataDir();
    return writeQueueFor(filePath)(() => atomicWriteJson(filePath, payload));
  }

  async function readJsonFile(filePath) {
    return readJsonWithBackup(filePath);
  }

  async function persistNodeStore() {
    const payload = {
      items: [...nodeStore.values()],
    };
    await persistJsonFile(nodesFile, payload);
  }

  async function loadNodeStore() {
    try {
      const payload = await readJsonFile(nodesFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      let mutated = false;

      nodeStore.clear();
      fingerprintIndex.clear();

      for (const item of items) {
        if (!item?.id) {
          continue;
        }

        const normalizedItem = {
          ...item,
          facts: normalizeNodeFacts(item.facts, { existingFacts: item.facts }),
        };

        if (JSON.stringify(normalizedItem.facts) !== JSON.stringify(item.facts ?? {})) {
          mutated = true;
        }

        nodeStore.set(normalizedItem.id, normalizedItem);
        if (normalizedItem.fingerprint) {
          fingerprintIndex.set(normalizedItem.fingerprint, normalizedItem.id);
        }
      }

      if (mutated) {
        await persistNodeStore();
      }
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistOperationStore() {
    const payload = {
      items: operationStore,
    };
    await persistJsonFile(operationsFile, payload);
  }

  async function loadOperationStore() {
    try {
      const payload = await readJsonFile(operationsFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      operationStore.length = 0;
      operationStore.push(...items);
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistProviderStore() {
    const payload = {
      items: providerStore,
    };
    await persistJsonFile(providersFile, payload);
  }

  async function loadProviderStore() {
    try {
      const payload = await readJsonFile(providersFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      providerStore.length = 0;
      providerStore.push(...items);
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistTaskStore() {
    const payload = {
      items: taskStore,
    };
    await persistJsonFile(tasksFile, payload);
  }

  async function loadTaskStore() {
    try {
      const payload = await readJsonFile(tasksFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      let mutated = false;
      taskStore.length = 0;

      for (const item of items) {
        const status = String(item?.status || "").toLowerCase();
        if (status === "running") {
          taskStore.push({
            ...item,
            status: "failed",
            finished_at: item?.finished_at || nowIso(),
            updated_at: nowIso(),
            note: item?.note || "控制面重启后发现任务仍停留在执行中，已按异常中断回收。",
            log_excerpt:
              Array.isArray(item?.log_excerpt) && item.log_excerpt.length > 0
                ? item.log_excerpt
                : ["控制面重启后发现任务仍停留在执行中，已按异常中断回收。"],
          });
          mutated = true;
          continue;
        }

        taskStore.push(item);
      }

      if (mutated) {
        await persistTaskStore();
      }
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistProbeStore() {
    const payload = {
      items: probeStore,
    };
    await persistJsonFile(probesFile, payload);
  }

  async function loadProbeStore() {
    try {
      const payload = await readJsonFile(probesFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      probeStore.length = 0;
      probeStore.push(...items);
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistDiagnosticStore() {
    const payload = {
      items: diagnosticStore,
    };
    await persistJsonFile(diagnosticsFile, payload);
  }

  async function loadDiagnosticStore() {
    try {
      const payload = await readJsonFile(diagnosticsFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      let mutated = false;
      diagnosticStore.length = 0;

      for (const item of items) {
        const status = String(item?.status || "").toLowerCase();
        if (status === "running" || status === "queued") {
          diagnosticStore.push({
            ...item,
            status: "failed",
            result_quality: item?.result_quality ?? "failed",
            finished_at: item?.finished_at || nowIso(),
            updated_at: nowIso(),
            summary:
              item?.summary ||
              "控制面重启后发现诊断仍停留在执行中，已按异常中断回收。",
          });
          mutated = true;
          continue;
        }

        diagnosticStore.push(item);
      }

      if (mutated) {
        await persistDiagnosticStore();
      }
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistAccessUserStore() {
    const payload = {
      items: accessUserStore,
    };
    await persistJsonFile(accessUsersFile, payload);
  }

  async function loadAccessUserStore() {
    try {
      const payload = await readJsonFile(accessUsersFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      accessUserStore.length = 0;
      accessUserStore.push(...items);
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistProxyProfileStore() {
    const payload = {
      items: proxyProfileStore,
    };
    await persistJsonFile(proxyProfilesFile, payload);
  }

  async function loadProxyProfileStore() {
    try {
      const payload = await readJsonFile(proxyProfilesFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      proxyProfileStore.length = 0;
      proxyProfileStore.push(...items);
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistSystemUserStore() {
    const payload = {
      items: systemUserStore,
    };
    await persistJsonFile(systemUsersFile, payload);
  }

  async function loadSystemUserStore() {
    try {
      const payload = await readJsonFile(systemUsersFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      systemUserStore.length = 0;
      systemUserStore.push(...items);
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistSystemTemplateStore() {
    const payload = {
      items: systemTemplateStore,
    };
    await persistJsonFile(systemTemplatesFile, payload);
  }

  async function loadSystemTemplateStore() {
    try {
      const payload = await readJsonFile(systemTemplatesFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      systemTemplateStore.length = 0;
      systemTemplateStore.push(...items);
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistNodeGroupStore() {
    const payload = {
      items: nodeGroupStore,
    };
    await persistJsonFile(nodeGroupsFile, payload);
  }

  async function loadNodeGroupStore() {
    try {
      const payload = await readJsonFile(nodeGroupsFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      nodeGroupStore.length = 0;
      nodeGroupStore.push(...items);
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistConfigReleaseStore() {
    const payload = {
      items: configReleaseStore,
    };
    await persistJsonFile(configReleasesFile, payload);
  }

  async function loadConfigReleaseStore() {
    try {
      const payload = await readJsonFile(configReleasesFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      configReleaseStore.length = 0;
      configReleaseStore.push(...items);
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistSystemUserReleaseStore() {
    const payload = {
      items: systemUserReleaseStore,
    };
    await persistJsonFile(systemUserReleasesFile, payload);
  }

  async function loadSystemUserReleaseStore() {
    try {
      const payload = await readJsonFile(systemUserReleasesFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      systemUserReleaseStore.length = 0;
      systemUserReleaseStore.push(...items);
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  async function persistSystemTemplateReleaseStore() {
    const payload = {
      items: systemTemplateReleaseStore,
    };
    await persistJsonFile(systemTemplateReleasesFile, payload);
  }

  async function loadSystemTemplateReleaseStore() {
    try {
      const payload = await readJsonFile(systemTemplateReleasesFile);
      const items = Array.isArray(payload.items) ? payload.items : [];
      systemTemplateReleaseStore.length = 0;
      systemTemplateReleaseStore.push(...items);
    } catch (error) {
      if (isMissingFileError(error)) {
        await ensureDataDir();
        return;
      }

      throw error;
    }
  }

  return {
    ensureDataDir,
    loadAccessUserStore,
    loadConfigReleaseStore,
    loadDiagnosticStore,
    loadNodeStore,
    loadNodeGroupStore,
    loadOperationStore,
    loadProviderStore,
    loadProbeStore,
    loadProxyProfileStore,
    loadSystemTemplateReleaseStore,
    loadSystemTemplateStore,
    loadSystemUserReleaseStore,
    loadSystemUserStore,
    loadTaskStore,
    persistAccessUserStore,
    persistConfigReleaseStore,
    persistDiagnosticStore,
    persistNodeStore,
    persistNodeGroupStore,
    persistOperationStore,
    persistProviderStore,
    persistProbeStore,
    persistProxyProfileStore,
    persistSystemTemplateReleaseStore,
    persistSystemTemplateStore,
    persistSystemUserReleaseStore,
    persistSystemUserStore,
    persistTaskStore,
  };
}
