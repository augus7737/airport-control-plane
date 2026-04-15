export function createNodeLifecycleDomain(dependencies) {
  const {
    nodeStore,
    operationStore,
    probeStore,
    taskStore,
  } = dependencies;

  function replaceStoreItems(store, items) {
    store.length = 0;
    store.push(...items);
  }

  function summarizeOperationTargets(targets) {
    const total = targets.length;
    const success = targets.filter((item) => item.status === "success").length;
    const failed = total - success;

    let status = "success";
    if (success === 0) {
      status = "failed";
    } else if (failed > 0) {
      status = "partial";
    }

    return {
      total,
      success,
      failed,
      status,
    };
  }

  function pruneOperationsForNode(nodeId) {
    let changed = false;
    const nextOperations = [];

    for (const operation of operationStore) {
      const nextNodeIds = Array.isArray(operation.node_ids)
        ? operation.node_ids.filter((value) => value !== nodeId)
        : [];
      const nextTargets = Array.isArray(operation.targets)
        ? operation.targets.filter((target) => target?.node_id !== nodeId)
        : [];

      if (nextNodeIds.length === 0 || nextTargets.length === 0) {
        if (
          (Array.isArray(operation.node_ids) && operation.node_ids.length > 0) ||
          (Array.isArray(operation.targets) && operation.targets.length > 0)
        ) {
          changed = true;
        }
        continue;
      }

      if (
        nextNodeIds.length !== (operation.node_ids?.length ?? 0) ||
        nextTargets.length !== (operation.targets?.length ?? 0)
      ) {
        const summary = summarizeOperationTargets(nextTargets);
        nextOperations.push({
          ...operation,
          node_ids: nextNodeIds,
          targets: nextTargets,
          summary: {
            total: summary.total,
            success: summary.success,
            failed: summary.failed,
          },
          status: summary.status,
        });
        changed = true;
        continue;
      }

      nextOperations.push(operation);
    }

    if (changed) {
      replaceStoreItems(operationStore, nextOperations);
    }

    return changed;
  }

  function pruneTasksForNode(nodeId) {
    const nextTasks = taskStore.filter((task) => task?.node_id !== nodeId);
    const changed = nextTasks.length !== taskStore.length;
    if (changed) {
      replaceStoreItems(taskStore, nextTasks);
    }
    return changed;
  }

  function pruneProbesForNode(nodeId) {
    const nextProbes = probeStore.filter((probe) => probe?.node_id !== nodeId);
    const changed = nextProbes.length !== probeStore.length;
    if (changed) {
      replaceStoreItems(probeStore, nextProbes);
    }
    return changed;
  }

  function detachRelayNodeReferences(nodeId, deletedNode) {
    let changed = false;
    const fallbackRelayLabel =
      deletedNode?.networking?.relay_label || deletedNode?.facts?.hostname || deletedNode?.id;
    const fallbackRelayRegion = deletedNode?.labels?.region || null;

    for (const node of nodeStore.values()) {
      if (node?.id === nodeId || node?.networking?.relay_node_id !== nodeId) {
        continue;
      }

      nodeStore.set(node.id, {
        ...node,
        networking: {
          ...(node.networking || {}),
          relay_node_id: null,
          relay_label: node.networking?.relay_label || fallbackRelayLabel || null,
          relay_region: node.networking?.relay_region || fallbackRelayRegion,
        },
      });
      changed = true;
    }

    return changed;
  }

  return {
    replaceStoreItems,
    summarizeOperationTargets,
    pruneOperationsForNode,
    pruneTasksForNode,
    pruneProbesForNode,
    detachRelayNodeReferences,
  };
}
