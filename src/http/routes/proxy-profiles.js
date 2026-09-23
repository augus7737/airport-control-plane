import { validateProxyProfileCreate, validateProxyProfileUpdate } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";

export function createProxyProfilesRoutes(ctx) {
  const {
    accessUserStore,
    buildProxyProfileRecord,
    configReleaseStore,
    findProxyProfileById,
    persistProxyProfileStore,
    proxyProfileStore,
    safeDecodePathSegment,
    sortByUpdatedAt,
  } = ctx;

  return async function handleProxyProfilesRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/proxy-profiles") {
      jsonResponse(reply, 200, {
        items: sortByUpdatedAt(proxyProfileStore),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/proxy-profiles") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateProxyProfileCreate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const profile = buildProxyProfileRecord(payload);
        proxyProfileStore.unshift(profile);
        await persistProxyProfileStore();

        jsonResponse(reply, 201, {
          profile,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    const proxyProfileMatch = url.pathname.match(/^\/api\/v1\/proxy-profiles\/([^/]+)$/);
    if (proxyProfileMatch && request.method === "GET") {
      const profileId = safeDecodePathSegment(proxyProfileMatch[1]);

      if (!profileId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid profile id",
        });
        return;
      }

      const existingProfile = findProxyProfileById(profileId);

      if (!existingProfile) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "profile not found",
        });
        return;
      }

      jsonResponse(reply, 200, {
        profile: existingProfile,
      });
      return;
    }

    if (proxyProfileMatch && request.method === "PATCH") {
      try {
        const profileId = decodeURIComponent(proxyProfileMatch[1]);
        const existingProfile = findProxyProfileById(profileId);

        if (!existingProfile) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "profile not found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const errors = validateProxyProfileUpdate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const updatedProfile = buildProxyProfileRecord(payload, existingProfile);
        const index = proxyProfileStore.findIndex((item) => item.id === profileId);
        proxyProfileStore[index] = updatedProfile;
        await persistProxyProfileStore();

        jsonResponse(reply, 200, {
          profile: updatedProfile,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (proxyProfileMatch && request.method === "DELETE") {
      const profileId = decodeURIComponent(proxyProfileMatch[1]);
      const existingProfile = findProxyProfileById(profileId);

      if (!existingProfile) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "profile not found",
        });
        return;
      }

      const boundAccessUser = accessUserStore.find((accessUser) => accessUser.profile_id === profileId);
      if (boundAccessUser) {
        jsonResponse(reply, 409, {
          error: "conflict",
          message: `profile is still bound by access user ${boundAccessUser.id}`,
        });
        return;
      }

      const referencedRelease = configReleaseStore.find((release) => release.profile_id === profileId);
      if (referencedRelease) {
        jsonResponse(reply, 409, {
          error: "conflict",
          message: `profile is referenced by release ${referencedRelease.id}`,
        });
        return;
      }

      const nextProfiles = proxyProfileStore.filter((item) => item.id !== profileId);
      proxyProfileStore.length = 0;
      proxyProfileStore.push(...nextProfiles);
      await persistProxyProfileStore();

      jsonResponse(reply, 200, {
        ok: true,
        deleted_profile_id: profileId,
      });
      return;
    }
  };
}
