import { validateAssetUpdate, validateManualNode, validateNodeLabelsUpdate, validateRegistration } from "../../http/validators.js";
import { extractRemoteAddress, jsonResponse, readJsonBody } from "../../utils/http.js";

export function createNodesRoutes(ctx) {
  const {
    bootstrapTokenError,
    bootstrapTokenStore,
    buildManualNodeRecord,
    buildNodeRecord,
    buildProbeTask,
    closeShellSessionsForNode,
    defaultInitTemplateForNode,
    detachRelayNodeReferences,
    ensureNodeInitTask,
    executeInitTask,
    executeProbeTask,
    exhaustedTokenBelongsToNode,
    findBootstrapTokenByValue,
    findExistingBootstrapNode,
    findSystemTemplateById,
    fingerprintIndex,
    isBootstrapTokenExhaustedError,
    latestNodeTask,
    nodeStore,
    normalizeNodeFacts,
    persistBootstrapTokens,
    persistDiagnosticStore,
    persistNodeGroupStore,
    persistNodeStore,
    persistOperationStore,
    persistProbeStore,
    persistTaskStore,
    platformSshKeyState,
    pruneDiagnosticsForNode,
    pruneNodeFromGroups,
    pruneOperationsForNode,
    pruneProbesForNode,
    pruneTasksForNode,
    reconcileTaskStoreFromOperations,
    recordBootstrapTokenUsage,
    safeDecodePathSegment,
    triggerDiagnostic,
    updateNodeAssetRecord,
    updateNodeLabelsRecord,
    upsertTaskRecord,
  } = ctx;

  return async function handleNodesRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/nodes") {
      await reconcileTaskStoreFromOperations();
      jsonResponse(reply, 200, {
        items: [...nodeStore.values()].sort((a, b) =>
          String(b.registered_at).localeCompare(String(a.registered_at))
        ),
      });
      return;
    }

    const nodeMatch = url.pathname.match(/^\/api\/v1\/nodes\/([^/]+)$/);
    if (request.method === "GET" && nodeMatch) {
      const nodeId = safeDecodePathSegment(nodeMatch[1]);

      if (!nodeId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid node id",
        });
        return;
      }

      const existingNode = nodeStore.get(nodeId);

      if (!existingNode) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "node not found",
        });
        return;
      }

      jsonResponse(reply, 200, {
        node: existingNode,
      });
      return;
    }

    if (request.method === "DELETE" && nodeMatch) {
      try {
        const nodeId = safeDecodePathSegment(nodeMatch[1]);
        if (!nodeId) {
          jsonResponse(reply, 400, {
            error: "bad_request",
            message: "invalid node id",
          });
          return;
        }

        const existingNode = nodeStore.get(nodeId);

        if (!existingNode) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "node not found",
          });
          return;
        }

        nodeStore.delete(nodeId);
        if (existingNode.fingerprint) {
          fingerprintIndex.delete(existingNode.fingerprint);
        }

        const relayReferenceUpdated = detachRelayNodeReferences(nodeId, existingNode);
        const tasksPruned = pruneTasksForNode(nodeId);
        const probesPruned = pruneProbesForNode(nodeId);
        const diagnosticsPruned = pruneDiagnosticsForNode(nodeId);
        const operationsPruned = pruneOperationsForNode(nodeId);
        const nodeGroupsUpdated = pruneNodeFromGroups(nodeId);
        closeShellSessionsForNode(nodeId);

        let tokenChanged = false;
        for (const token of bootstrapTokenStore.values()) {
          if (token?.last_used_node_id === nodeId) {
            token.last_used_node_id = null;
            tokenChanged = true;
          }
        }

        await Promise.all([
          persistNodeStore(),
          nodeGroupsUpdated ? persistNodeGroupStore() : Promise.resolve(),
          tasksPruned ? persistTaskStore() : Promise.resolve(),
          probesPruned ? persistProbeStore() : Promise.resolve(),
          diagnosticsPruned ? persistDiagnosticStore() : Promise.resolve(),
          operationsPruned ? persistOperationStore() : Promise.resolve(),
          tokenChanged ? persistBootstrapTokens() : Promise.resolve(),
        ]);

        jsonResponse(reply, 200, {
          ok: true,
          deleted_node_id: nodeId,
          summary: {
            relay_reference_updated: relayReferenceUpdated,
            node_groups_updated: nodeGroupsUpdated,
            tasks_pruned: tasksPruned,
            probes_pruned: probesPruned,
            diagnostics_pruned: diagnosticsPruned,
            operations_pruned: operationsPruned,
          },
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    const nodeAssetsMatch = url.pathname.match(/^\/api\/v1\/nodes\/([^/]+)\/assets$/);
    if (request.method === "PATCH" && nodeAssetsMatch) {
      try {
        const nodeId = safeDecodePathSegment(nodeAssetsMatch[1]);
        if (!nodeId) {
          jsonResponse(reply, 400, {
            error: "bad_request",
            message: "invalid node id",
          });
          return;
        }

        const existingNode = nodeStore.get(nodeId);

        if (!existingNode) {
          jsonResponse(reply, 404, {
            error: "not_found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const errors = validateAssetUpdate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const updatedNode = updateNodeAssetRecord(existingNode, payload);
        nodeStore.set(updatedNode.id, updatedNode);
        await persistNodeStore();

        jsonResponse(reply, 200, {
          node: updatedNode,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    const nodeLabelsMatch = url.pathname.match(/^\/api\/v1\/nodes\/([^/]+)\/labels$/);
    if (request.method === "PATCH" && nodeLabelsMatch) {
      const nodeId = safeDecodePathSegment(nodeLabelsMatch[1]);

      if (!nodeId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid node id",
        });
        return;
      }

      const existingNode = nodeStore.get(nodeId);

      if (!existingNode) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "node not found",
        });
        return;
      }

      let payload;
      try {
        payload = await readJsonBody(request);
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
        return;
      }

      const errors = validateNodeLabelsUpdate(payload);

      if (errors.length > 0) {
        jsonResponse(reply, 400, {
          error: "validation_failed",
          details: errors,
        });
        return;
      }

      const updatedNode = updateNodeLabelsRecord(existingNode, payload);
      nodeStore.set(updatedNode.id, updatedNode);
      await persistNodeStore();

      jsonResponse(reply, 200, {
        node: updatedNode,
      });
      return;
    }

    const nodeInitMatch = url.pathname.match(/^\/api\/v1\/nodes\/([^/]+)\/init$/);
    if (request.method === "POST" && nodeInitMatch) {
      try {
        await reconcileTaskStoreFromOperations();
        const nodeId = safeDecodePathSegment(nodeInitMatch[1]);
        if (!nodeId) {
          jsonResponse(reply, 400, {
            error: "bad_request",
            message: "invalid node id",
          });
          return;
        }

        const node = nodeStore.get(nodeId);

        if (!node) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "node not found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const requestedTemplateName =
          typeof payload.template === "string" && payload.template.trim()
            ? payload.template.trim()
            : defaultInitTemplateForNode(node);
        const requestedSystemTemplateId =
          typeof payload.system_template_id === "string" && payload.system_template_id.trim()
            ? payload.system_template_id.trim()
            : requestedTemplateName.startsWith("system-template:")
              ? requestedTemplateName.slice("system-template:".length).trim() || null
              : null;
        const requestedTemplateSnapshot =
          payload.template_snapshot && typeof payload.template_snapshot === "object"
            ? payload.template_snapshot
            : null;

        if (
          requestedSystemTemplateId &&
          !findSystemTemplateById(requestedSystemTemplateId) &&
          !requestedTemplateSnapshot
        ) {
          throw new Error(`unknown system template id: ${requestedSystemTemplateId}`);
        }

        const latestTask = latestNodeTask(node.id, "init_alpine");
        const task = ensureNodeInitTask(node, {
          ...(requestedSystemTemplateId
            ? {
                system_template_id: requestedSystemTemplateId,
                template_snapshot: requestedTemplateSnapshot,
              }
            : {
                template: requestedTemplateName,
              }),
          trigger: "manual_retry",
          force_new: latestTask ? String(latestTask.status || "").toLowerCase() === "success" : false,
          note: "已由控制台手动触发初始化任务。",
          reason: "manual_retry",
        });
        const result = await executeInitTask(task, {
          note: "已由控制台手动触发，控制面开始执行初始化模板。",
        });

        jsonResponse(reply, 201, {
          task: result.task,
          node: result.node,
          operation: result.operation,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    const nodeDiagnosticMatch = url.pathname.match(/^\/api\/v1\/nodes\/([^/]+)\/diagnostics$/);
    if (request.method === "POST" && nodeDiagnosticMatch) {
      try {
        const nodeId = safeDecodePathSegment(nodeDiagnosticMatch[1]);
        if (!nodeId) {
          jsonResponse(reply, 400, {
            error: "bad_request",
            message: "invalid node id",
          });
          return;
        }

        const node = nodeStore.get(nodeId);

        if (!node) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "node not found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const profile =
          String(payload?.profile || "light").trim().toLowerCase() === "deep" ? "deep" : "light";
        const result = await triggerDiagnostic(node, {
          profile,
          trigger: "manual_diagnostic",
          reason: "manual_diagnostic",
        });

        jsonResponse(reply, 202, {
          task: result.task,
          diagnostic: result.diagnostic,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        jsonResponse(reply, message.includes("当前节点已有诊断") || message.includes("同一公网入口宿主已有深度诊断")
          ? 409
          : 400, {
          error: "bad_request",
          message,
        });
      }
      return;
    }

    const nodeProbeMatch = url.pathname.match(/^\/api\/v1\/nodes\/([^/]+)\/probe$/);
    if (request.method === "POST" && nodeProbeMatch) {
      try {
        const nodeId = safeDecodePathSegment(nodeProbeMatch[1]);
        if (!nodeId) {
          jsonResponse(reply, 400, {
            error: "bad_request",
            message: "invalid node id",
          });
          return;
        }

        const node = nodeStore.get(nodeId);

        if (!node) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "node not found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const requestedProbeType =
          typeof payload.probe_type === "string" && payload.probe_type.trim()
            ? payload.probe_type.trim().toLowerCase()
            : "full_stack";
        const allowedProbeTypes = new Set([
          "ssh_auth",
          "business_entry_tcp",
          "relay_upstream_tcp",
          "full_stack",
        ]);
        const probeType = allowedProbeTypes.has(requestedProbeType)
          ? requestedProbeType
          : "full_stack";
        const task = buildProbeTask(node, {
          trigger: "manual_probe",
          reason: "manual_probe",
          probe_type: probeType,
        });
        upsertTaskRecord(task);
        await persistTaskStore();

        const result = await executeProbeTask(task, {
          note:
            probeType === "business_entry_tcp"
              ? "已由控制台手动触发，控制面开始验证业务入口 TCP 可达性。"
              : probeType === "relay_upstream_tcp"
                ? "已由控制台手动触发，控制面开始验证入口到落地上游链路。"
                : probeType === "ssh_auth"
                  ? "已由控制台手动触发，控制面开始验证 SSH 接管链路。"
                  : "已由控制台手动触发，控制面开始执行综合巡检，校验管理链路、业务入口与 relay 上游状态。",
        });

        jsonResponse(reply, 201, {
          task: result.task,
          node: result.node,
          probe: result.probe,
          transport: result.transport,
          summary: result.probe?.summary ?? result.task?.note ?? null,
          capability: result.capability,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/nodes/manual") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateManualNode(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const node = buildManualNodeRecord(payload);
        nodeStore.set(node.id, node);
        if (node.fingerprint) {
          fingerprintIndex.set(node.fingerprint, node.id);
        }
        await persistNodeStore();

        jsonResponse(reply, 201, {
          node,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/nodes/register") {
      try {
        const payload = await readJsonBody(request);
        const requestPeerAddress = extractRemoteAddress(request);
        if (!payload.facts || typeof payload.facts !== "object") {
          payload.facts = {};
        }
        payload.facts = normalizeNodeFacts(payload.facts, {
          remoteAddress: requestPeerAddress,
          existingFacts: null,
        });
        console.log(
          `[register] hostname=${payload.facts.hostname ?? "-"} public_ipv4=${payload.facts.public_ipv4 ?? "null"} public_ipv6=${payload.facts.public_ipv6 ?? "null"} request_peer=${requestPeerAddress ?? "null"}`,
        );

        const errors = validateRegistration(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const tokenValue =
          typeof payload.bootstrap_token === "string"
            ? payload.bootstrap_token.trim()
            : String(payload.bootstrap_token ?? "");
        const bootstrapToken = findBootstrapTokenByValue(tokenValue);
        const existingNode = findExistingBootstrapNode(payload);
        const tokenErrorInfo = bootstrapTokenError(bootstrapToken);
        const allowExhaustedRefresh =
          isBootstrapTokenExhaustedError(tokenErrorInfo) &&
          exhaustedTokenBelongsToNode(bootstrapToken, existingNode);

        if (tokenErrorInfo && !allowExhaustedRefresh) {
          jsonResponse(reply, 403, {
            error: tokenErrorInfo.code,
            message: tokenErrorInfo.message,
          });
          return;
        }

        const node = buildNodeRecord(payload, existingNode);
        node.bootstrap_token_id = bootstrapToken?.id ?? node.bootstrap_token_id ?? null;
        nodeStore.set(node.id, node);
        if (existingNode?.fingerprint && existingNode.fingerprint !== payload.fingerprint) {
          fingerprintIndex.delete(existingNode.fingerprint);
        }
        fingerprintIndex.set(payload.fingerprint, node.id);
        if (!allowExhaustedRefresh) {
          recordBootstrapTokenUsage(bootstrapToken, node.id);
        }

        const nodeStatus = String(node.status || "new").toLowerCase();
        const initTask =
          nodeStatus === "active"
            ? latestNodeTask(node.id, "init_alpine")
            : ensureNodeInitTask(node, {
                template: defaultInitTemplateForNode(node),
                trigger: existingNode ? "bootstrap_refresh" : "bootstrap_register",
                reason: existingNode ? "bootstrap_refresh" : "bootstrap_register",
              });
        const scheduleInitTask = nodeStatus === "active" ? null : initTask;
        const platformKeyState = await platformSshKeyState();

        await Promise.all([persistNodeStore(), persistBootstrapTokens(), persistTaskStore()]);

        jsonResponse(reply, 200, {
          node: {
            id: node.id,
            status: node.status,
            registered_at: node.registered_at,
            last_seen_at: node.last_seen_at,
            bootstrap_token_id: node.bootstrap_token_id,
          },
          bootstrap: {
            init_task_id: scheduleInitTask?.id ?? null,
            init_template: scheduleInitTask?.template ?? null,
          },
          actions: [
            ...(platformKeyState.public_key
              ? [
                  {
                    type: "install_ssh_key",
                    public_key: platformKeyState.public_key,
                  },
                ]
              : []),
            ...(scheduleInitTask
              ? [
                  {
                    type: "schedule_init",
                    id: scheduleInitTask.id,
                    template: scheduleInitTask.template || defaultInitTemplateForNode(node),
                  },
                ]
              : []),
          ],
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }
  };
}
