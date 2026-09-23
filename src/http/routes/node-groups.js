import { validateNodeGroupCreate, validateNodeGroupUpdate } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";

export function createNodeGroupsRoutes(ctx) {
  const {
    accessUserStore,
    buildNodeGroupRecord,
    configReleaseStore,
    findNodeGroupById,
    hasOwn,
    nodeGroupStore,
    nodeStore,
    persistNodeGroupStore,
    safeDecodePathSegment,
    sortByUpdatedAt,
    systemTemplateReleaseStore,
    systemTemplateStore,
    systemUserReleaseStore,
    systemUserStore,
    uniqueStringList,
  } = ctx;

  // 与前端发布页口径一致：发布列表按新到旧排列，每个 profile 第一条 success 即当前生效版本。
  function getEffectiveReleasesReferencingGroup(groupId) {
    const seenProfileIds = new Set();
    const effectiveReleases = [];

    for (const release of configReleaseStore) {
      if (String(release?.status || "") !== "success" || !release?.profile_id) {
        continue;
      }
      if (seenProfileIds.has(release.profile_id)) {
        continue;
      }
      seenProfileIds.add(release.profile_id);
      if (Array.isArray(release.node_group_ids) && release.node_group_ids.includes(groupId)) {
        effectiveReleases.push(release);
      }
    }

    return effectiveReleases;
  }

  return async function handleNodeGroupsRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/node-groups") {
      jsonResponse(reply, 200, {
        items: sortByUpdatedAt(nodeGroupStore),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/node-groups") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateNodeGroupCreate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const nodeIds = hasOwn(payload, "node_ids") ? uniqueStringList(payload.node_ids) : [];
        const missingNodeIds = nodeIds.filter((nodeId) => !nodeStore.has(nodeId));
        if (missingNodeIds.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: [`unknown node ids: ${missingNodeIds.join(", ")}`],
          });
          return;
        }

        const group = buildNodeGroupRecord(payload);
        nodeGroupStore.unshift(group);
        await persistNodeGroupStore();

        jsonResponse(reply, 201, {
          group,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    const nodeGroupMatch = url.pathname.match(/^\/api\/v1\/node-groups\/([^/]+)$/);
    if (nodeGroupMatch && request.method === "GET") {
      const groupId = safeDecodePathSegment(nodeGroupMatch[1]);

      if (!groupId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid node group id",
        });
        return;
      }

      const existingGroup = findNodeGroupById(groupId);

      if (!existingGroup) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "node group not found",
        });
        return;
      }

      jsonResponse(reply, 200, {
        group: existingGroup,
      });
      return;
    }

    if (nodeGroupMatch && request.method === "PATCH") {
      const groupId = safeDecodePathSegment(nodeGroupMatch[1]);

      if (!groupId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid node group id",
        });
        return;
      }

      try {
        const existingGroup = findNodeGroupById(groupId);

        if (!existingGroup) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "node group not found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const errors = validateNodeGroupUpdate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        if (hasOwn(payload, "node_ids")) {
          const missingNodeIds = uniqueStringList(payload.node_ids).filter((nodeId) => !nodeStore.has(nodeId));
          if (missingNodeIds.length > 0) {
            jsonResponse(reply, 400, {
              error: "validation_failed",
              details: [`unknown node ids: ${missingNodeIds.join(", ")}`],
            });
            return;
          }
        }

        const updatedGroup = buildNodeGroupRecord(payload, existingGroup);
        const index = nodeGroupStore.findIndex((item) => item.id === groupId);
        nodeGroupStore[index] = updatedGroup;
        await persistNodeGroupStore();

        // 信息性字段（不拒绝写入）：node_ids 缩容移除了节点、且本组仍被当前生效发布引用时，
        // 真实拓扑会在下次发布前悄然变化，把提示放进 warnings 交给调用方。
        const previousNodeIds = uniqueStringList(existingGroup.node_ids);
        const nextNodeIdSet = new Set(updatedGroup.node_ids);
        const removedNodeIds = previousNodeIds.filter((nodeId) => !nextNodeIdSet.has(nodeId));
        const warnings = [];
        if (removedNodeIds.length > 0) {
          for (const release of getEffectiveReleasesReferencingGroup(groupId)) {
            warnings.push(
              `node group is referenced by current effective release ${release.id}` +
                `${release.version ? ` (version ${release.version})` : ""}; removing ${removedNodeIds.length}` +
                " node(s) changes the live topology until the next release",
            );
          }
        }

        jsonResponse(reply, 200, {
          group: updatedGroup,
          warnings,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (nodeGroupMatch && request.method === "DELETE") {
      const groupId = safeDecodePathSegment(nodeGroupMatch[1]);

      if (!groupId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid node group id",
        });
        return;
      }

      const existingGroup = findNodeGroupById(groupId);

      if (!existingGroup) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "node group not found",
        });
        return;
      }

      const boundAccessUser = accessUserStore.find((accessUser) =>
        Array.isArray(accessUser.node_group_ids) && accessUser.node_group_ids.includes(groupId),
      );
      if (boundAccessUser) {
        jsonResponse(reply, 409, {
          error: "conflict",
          message: `node group is still bound by access user ${boundAccessUser.id}`,
        });
        return;
      }

      const boundSystemUser = systemUserStore.find((systemUser) =>
        Array.isArray(systemUser.node_group_ids) && systemUser.node_group_ids.includes(groupId),
      );
      if (boundSystemUser) {
        jsonResponse(reply, 409, {
          error: "conflict",
          message: `node group is still bound by system user ${boundSystemUser.id}`,
        });
        return;
      }

      const boundSystemTemplate = systemTemplateStore.find((template) =>
        Array.isArray(template.node_group_ids) && template.node_group_ids.includes(groupId),
      );
      if (boundSystemTemplate) {
        jsonResponse(reply, 409, {
          error: "conflict",
          message: `node group is still bound by system template ${boundSystemTemplate.id}`,
        });
        return;
      }

      const referencedRelease = configReleaseStore.find((release) =>
        Array.isArray(release.node_group_ids) && release.node_group_ids.includes(groupId),
      );
      if (referencedRelease) {
        jsonResponse(reply, 409, {
          error: "conflict",
          message: `node group is referenced by release ${referencedRelease.id}`,
        });
        return;
      }

      const referencedSystemUserRelease = systemUserReleaseStore.find((release) =>
        Array.isArray(release.node_group_ids) && release.node_group_ids.includes(groupId),
      );
      if (referencedSystemUserRelease) {
        jsonResponse(reply, 409, {
          error: "conflict",
          message: `node group is referenced by system user release ${referencedSystemUserRelease.id}`,
        });
        return;
      }

      const referencedSystemTemplateRelease = systemTemplateReleaseStore.find((release) =>
        Array.isArray(release.node_group_ids) && release.node_group_ids.includes(groupId),
      );
      if (referencedSystemTemplateRelease) {
        jsonResponse(reply, 409, {
          error: "conflict",
          message: `node group is referenced by system template release ${referencedSystemTemplateRelease.id}`,
        });
        return;
      }

      const nextGroups = nodeGroupStore.filter((item) => item.id !== groupId);
      nodeGroupStore.length = 0;
      nodeGroupStore.push(...nextGroups);
      await persistNodeGroupStore();

      jsonResponse(reply, 200, {
        ok: true,
        deleted_group_id: groupId,
      });
      return;
    }
  };
}
