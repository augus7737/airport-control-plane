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
    sortByUpdatedAt,
    systemTemplateReleaseStore,
    systemTemplateStore,
    systemUserReleaseStore,
    systemUserStore,
    uniqueStringList,
  } = ctx;

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
    if (nodeGroupMatch && request.method === "PATCH") {
      try {
        const groupId = decodeURIComponent(nodeGroupMatch[1]);
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

        jsonResponse(reply, 200, {
          group: updatedGroup,
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
      const groupId = decodeURIComponent(nodeGroupMatch[1]);
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
