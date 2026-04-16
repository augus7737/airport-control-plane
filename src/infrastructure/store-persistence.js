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
    writeFile,
  } = dependencies;

  async function ensureDataDir() {
    await mkdir(dataDir, { recursive: true });
  }

  async function persistNodeStore() {
    await ensureDataDir();
    const payload = {
      items: [...nodeStore.values()],
    };
    await writeFile(nodesFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadNodeStore() {
    try {
      const raw = await readFile(nodesFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: operationStore,
    };
    await writeFile(operationsFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadOperationStore() {
    try {
      const raw = await readFile(operationsFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: providerStore,
    };
    await writeFile(providersFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadProviderStore() {
    try {
      const raw = await readFile(providersFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: taskStore,
    };
    await writeFile(tasksFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadTaskStore() {
    try {
      const raw = await readFile(tasksFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: probeStore,
    };
    await writeFile(probesFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadProbeStore() {
    try {
      const raw = await readFile(probesFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: diagnosticStore,
    };
    await writeFile(diagnosticsFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadDiagnosticStore() {
    try {
      const raw = await readFile(diagnosticsFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: accessUserStore,
    };
    await writeFile(accessUsersFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadAccessUserStore() {
    try {
      const raw = await readFile(accessUsersFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: proxyProfileStore,
    };
    await writeFile(proxyProfilesFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadProxyProfileStore() {
    try {
      const raw = await readFile(proxyProfilesFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: systemUserStore,
    };
    await writeFile(systemUsersFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadSystemUserStore() {
    try {
      const raw = await readFile(systemUsersFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: systemTemplateStore,
    };
    await writeFile(systemTemplatesFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadSystemTemplateStore() {
    try {
      const raw = await readFile(systemTemplatesFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: nodeGroupStore,
    };
    await writeFile(nodeGroupsFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadNodeGroupStore() {
    try {
      const raw = await readFile(nodeGroupsFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: configReleaseStore,
    };
    await writeFile(configReleasesFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadConfigReleaseStore() {
    try {
      const raw = await readFile(configReleasesFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: systemUserReleaseStore,
    };
    await writeFile(systemUserReleasesFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadSystemUserReleaseStore() {
    try {
      const raw = await readFile(systemUserReleasesFile, "utf8");
      const payload = JSON.parse(raw);
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
    await ensureDataDir();
    const payload = {
      items: systemTemplateReleaseStore,
    };
    await writeFile(systemTemplateReleasesFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadSystemTemplateReleaseStore() {
    try {
      const raw = await readFile(systemTemplateReleasesFile, "utf8");
      const payload = JSON.parse(raw);
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

function isMissingFileError(error) {
  return error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
