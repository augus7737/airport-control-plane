import { validateSystemUserApply, validateSystemUserCreate, validateSystemUserUpdate } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";

export function createSystemUsersRoutes(ctx) {
  const {
    buildSystemUserRecord,
    collectSystemUserConflictMessages,
    executeSystemUserApply,
    findNodeGroupById,
    findSystemUserById,
    hasOwn,
    missingIds,
    persistSystemUserStore,
    safeDecodePathSegment,
    sortByUpdatedAt,
    systemUserReleaseStore,
    systemUserStore,
    uniqueStringList,
  } = ctx;

  return async function handleSystemUsersRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/system-users") {
      jsonResponse(reply, 200, {
        items: sortByUpdatedAt(systemUserStore),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/system-users") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateSystemUserCreate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const groupIds = hasOwn(payload, "node_group_ids") ? uniqueStringList(payload.node_group_ids) : [];
        const missingGroupIds = missingIds(groupIds, findNodeGroupById);
        if (missingGroupIds.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: [`unknown node group ids: ${missingGroupIds.join(", ")}`],
          });
          return;
        }

        const systemUser = buildSystemUserRecord(payload);
        const conflictMessages = collectSystemUserConflictMessages(systemUser);
        if (conflictMessages.length > 0) {
          jsonResponse(reply, 409, {
            error: "conflict",
            details: conflictMessages,
            message: conflictMessages[0],
          });
          return;
        }

        systemUserStore.unshift(systemUser);
        await persistSystemUserStore();

        jsonResponse(reply, 201, {
          system_user: systemUser,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    const systemUserMatch = url.pathname.match(/^\/api\/v1\/system-users\/([^/]+)$/);
    if (systemUserMatch && request.method === "GET") {
      const systemUserId = safeDecodePathSegment(systemUserMatch[1]);

      if (!systemUserId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid system user id",
        });
        return;
      }

      const existingSystemUser = findSystemUserById(systemUserId);

      if (!existingSystemUser) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "system user not found",
        });
        return;
      }

      jsonResponse(reply, 200, {
        user: existingSystemUser,
      });
      return;
    }

    if (systemUserMatch && request.method === "PATCH") {
      try {
        const systemUserId = safeDecodePathSegment(systemUserMatch[1]);

        if (!systemUserId) {
          jsonResponse(reply, 400, {
            error: "bad_request",
            message: "invalid system user id",
          });
          return;
        }

        const existingSystemUser = findSystemUserById(systemUserId);

        if (!existingSystemUser) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "system user not found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const errors = validateSystemUserUpdate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        if (hasOwn(payload, "node_group_ids")) {
          const missingGroupIds = missingIds(uniqueStringList(payload.node_group_ids), findNodeGroupById);
          if (missingGroupIds.length > 0) {
            jsonResponse(reply, 400, {
              error: "validation_failed",
              details: [`unknown node group ids: ${missingGroupIds.join(", ")}`],
            });
            return;
          }
        }

        const updatedSystemUser = buildSystemUserRecord(payload, existingSystemUser);
        const conflictMessages = collectSystemUserConflictMessages(updatedSystemUser, {
          excludeId: existingSystemUser.id,
        });
        if (conflictMessages.length > 0) {
          jsonResponse(reply, 409, {
            error: "conflict",
            details: conflictMessages,
            message: conflictMessages[0],
          });
          return;
        }

        const index = systemUserStore.findIndex((item) => item.id === systemUserId);
        systemUserStore[index] = updatedSystemUser;
        await persistSystemUserStore();

        jsonResponse(reply, 200, {
          system_user: updatedSystemUser,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (systemUserMatch && request.method === "DELETE") {
      const systemUserId = safeDecodePathSegment(systemUserMatch[1]);

      if (!systemUserId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid system user id",
        });
        return;
      }

      const existingSystemUser = findSystemUserById(systemUserId);

      if (!existingSystemUser) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "system user not found",
        });
        return;
      }

      const referencedRelease = systemUserReleaseStore.find((release) =>
        Array.isArray(release.system_user_ids) && release.system_user_ids.includes(systemUserId),
      );
      if (referencedRelease) {
        jsonResponse(reply, 409, {
          error: "conflict",
          message: `system user is referenced by release ${referencedRelease.id}`,
        });
        return;
      }

      const nextSystemUsers = systemUserStore.filter((item) => item.id !== systemUserId);
      systemUserStore.length = 0;
      systemUserStore.push(...nextSystemUsers);
      await persistSystemUserStore();

      jsonResponse(reply, 200, {
        ok: true,
        deleted_system_user_id: systemUserId,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/system-user-releases") {
      jsonResponse(reply, 200, {
        items: sortByUpdatedAt(systemUserReleaseStore),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/system-users/apply") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateSystemUserApply(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const result = await executeSystemUserApply(payload);
        jsonResponse(reply, 201, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        jsonResponse(reply, 400, {
          error: "bad_request",
          message,
          ...(Array.isArray(error?.details) ? { details: error.details } : {}),
        });
      }
      return;
    }
  };
}
