import { validateAccessUserCreate, validateAccessUserUpdate } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";
import { normalizeNullableString } from "../../utils/network.js";

export function createAccessUsersRoutes(ctx) {
  const {
    accessUserStore,
    buildAccessUserRecord,
    buildAccessUserShareResponse,
    configReleaseStore,
    findAccessUserById,
    findNodeGroupById,
    hasOwn,
    missingIds,
    nodeStore,
    operationStore,
    persistAccessUserStore,
    proxyProfileStore,
    resolveRequestOrigin,
    rotateAccessUserShareToken,
    safeDecodePathSegment,
    serializeAccessUser,
    sortByUpdatedAt,
    uniqueStringList,
    validateAccessUserProfileLink,
  } = ctx;

  return async function handleAccessUsersRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/access-users") {
      jsonResponse(reply, 200, {
        items: sortByUpdatedAt(accessUserStore).map(serializeAccessUser),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/access-users") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateAccessUserCreate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const profileId = hasOwn(payload, "profile_id") ? normalizeNullableString(payload.profile_id) : null;
        const groupIds = hasOwn(payload, "node_group_ids") ? uniqueStringList(payload.node_group_ids) : [];
        const protocol = normalizeNullableString(payload.protocol)?.toLowerCase() ?? "vless";
        const details = [];

        validateAccessUserProfileLink({ protocol, profileId, details });

        const missingGroupIds = missingIds(groupIds, findNodeGroupById);
        if (missingGroupIds.length > 0) {
          details.push(`unknown node group ids: ${missingGroupIds.join(", ")}`);
        }

        if (details.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details,
          });
          return;
        }

        const accessUser = buildAccessUserRecord(payload);
        accessUserStore.unshift(accessUser);
        await persistAccessUserStore();

        jsonResponse(reply, 201, {
          access_user: serializeAccessUser(accessUser),
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    const accessUserShareMatch = url.pathname.match(/^\/api\/v1\/access-users\/([^/]+)\/share$/);
    if (accessUserShareMatch && request.method === "GET") {
      const accessUserId = safeDecodePathSegment(accessUserShareMatch[1]);
      if (!accessUserId) {
        jsonResponse(reply, 400, {
          error: "invalid_request",
          message: "invalid access user id",
        });
        return;
      }
      const existingAccessUser = findAccessUserById(accessUserId);

      if (!existingAccessUser) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "access user not found",
        });
        return;
      }

      const response = await buildAccessUserShareResponse({
        accessUser: existingAccessUser,
        nodes: [...nodeStore.values()],
        operations: operationStore,
        profiles: proxyProfileStore,
        releases: configReleaseStore,
        requestOrigin: resolveRequestOrigin(url),
      });

      jsonResponse(reply, 200, {
        ...response,
        access_user: serializeAccessUser(response.access_user),
      });
      return;
    }

    const accessUserShareTokenMatch = url.pathname.match(
      /^\/api\/v1\/access-users\/([^/]+)\/share-token\/regenerate$/,
    );
    if (accessUserShareTokenMatch && request.method === "POST") {
      const accessUserId = safeDecodePathSegment(accessUserShareTokenMatch[1]);
      if (!accessUserId) {
        jsonResponse(reply, 400, {
          error: "invalid_request",
          message: "invalid access user id",
        });
        return;
      }
      const existingAccessUser = findAccessUserById(accessUserId);

      if (!existingAccessUser) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "access user not found",
        });
        return;
      }

      const rotatedAccessUser = rotateAccessUserShareToken(existingAccessUser);
      const index = accessUserStore.findIndex((item) => item.id === accessUserId);
      accessUserStore[index] = rotatedAccessUser;
      await persistAccessUserStore();

      jsonResponse(reply, 200, {
        ok: true,
        access_user: serializeAccessUser(rotatedAccessUser),
      });
      return;
    }

    const accessUserMatch = url.pathname.match(/^\/api\/v1\/access-users\/([^/]+)$/);
    if (accessUserMatch && request.method === "PATCH") {
      try {
        const accessUserId = decodeURIComponent(accessUserMatch[1]);
        const existingAccessUser = findAccessUserById(accessUserId);

        if (!existingAccessUser) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "access user not found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const errors = validateAccessUserUpdate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const details = [];
        if (hasOwn(payload, "profile_id")) {
          const profileId = normalizeNullableString(payload.profile_id);
          const protocol =
            normalizeNullableString(payload.protocol ?? existingAccessUser.protocol)?.toLowerCase() ??
            "vless";
          validateAccessUserProfileLink({ protocol, profileId, details });
        } else if (hasOwn(payload, "protocol")) {
          validateAccessUserProfileLink({
            protocol: normalizeNullableString(payload.protocol)?.toLowerCase() ?? "vless",
            profileId: existingAccessUser.profile_id,
            details,
          });
        }

        if (hasOwn(payload, "node_group_ids")) {
          const missingGroupIds = missingIds(uniqueStringList(payload.node_group_ids), findNodeGroupById);
          if (missingGroupIds.length > 0) {
            details.push(`unknown node group ids: ${missingGroupIds.join(", ")}`);
          }
        }

        if (details.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details,
          });
          return;
        }

        const updatedAccessUser = buildAccessUserRecord(payload, existingAccessUser);
        const index = accessUserStore.findIndex((item) => item.id === accessUserId);
        accessUserStore[index] = updatedAccessUser;
        await persistAccessUserStore();

        jsonResponse(reply, 200, {
          access_user: serializeAccessUser(updatedAccessUser),
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (accessUserMatch && request.method === "DELETE") {
      const accessUserId = decodeURIComponent(accessUserMatch[1]);
      const existingAccessUser = findAccessUserById(accessUserId);

      if (!existingAccessUser) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "access user not found",
        });
        return;
      }

      const referencedRelease = configReleaseStore.find((release) =>
        Array.isArray(release.access_user_ids) && release.access_user_ids.includes(accessUserId),
      );
      if (referencedRelease) {
        jsonResponse(reply, 409, {
          error: "conflict",
          message: `access user is referenced by release ${referencedRelease.id}`,
        });
        return;
      }

      const nextAccessUsers = accessUserStore.filter((item) => item.id !== accessUserId);
      accessUserStore.length = 0;
      accessUserStore.push(...nextAccessUsers);
      await persistAccessUserStore();

      jsonResponse(reply, 200, {
        ok: true,
        deleted_access_user_id: accessUserId,
      });
      return;
    }
  };
}
