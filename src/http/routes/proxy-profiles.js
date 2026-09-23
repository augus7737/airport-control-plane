import { validateSingBoxProfileTemplate } from "../../domain/releases/sing-box.js";
import { validateProxyProfileCreate, validateProxyProfileUpdate } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";

// 克隆出来的模板是「还没确认的副本」，语义上最贴近既有的 draft 枚举（状态枚举只有
// draft / active / disabled，不能新造值）；core-formatters 已把 draft 渲染成「草稿」。
const CLONE_NAME_SUFFIX = " 副本";
const CLONED_PROFILE_STATUS = "draft";
const MAX_CLONE_NAME_ATTEMPTS = 50;

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

  function profileNameKey(name) {
    return String(name ?? "").trim().toLowerCase();
  }

  // 与 providers 的重名口径一致：trim + 大小写不敏感，PATCH 传 excludeId 排除自身。
  function findProfileByName(name, { excludeId = null } = {}) {
    const key = profileNameKey(name);
    if (!key) {
      return null;
    }

    return (
      proxyProfileStore.find(
        (item) => item.id !== excludeId && profileNameKey(item.name) === key,
      ) ?? null
    );
  }

  // 把「等到发布执行才炸」的模板语义校验提前到写入口：入参已经是持久化形态的记录。
  function respondTemplateErrors(reply, profile) {
    const errors = validateSingBoxProfileTemplate(profile);
    if (errors.length === 0) {
      return false;
    }

    jsonResponse(reply, 400, {
      error: "validation_failed",
      details: errors,
    });
    return true;
  }

  function respondNameConflict(reply, duplicateProfile) {
    jsonResponse(reply, 409, {
      error: "profile_name_conflict",
      message: `profile name already exists: ${duplicateProfile.name}`,
    });
  }

  function copyTemplate(value) {
    if (value === null || typeof value !== "object") {
      return {};
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return {};
    }
  }

  // 副本名撞车就继续按「 副本 2」「 副本 3」递增，直到查重通过。
  function nextCloneName(sourceName) {
    const baseName = `${String(sourceName ?? "").trim() || "未命名模板"}${CLONE_NAME_SUFFIX}`;
    let candidate = baseName;

    for (
      let attempt = 2;
      findProfileByName(candidate) && attempt <= MAX_CLONE_NAME_ATTEMPTS;
      attempt += 1
    ) {
      candidate = `${baseName} ${attempt}`;
    }

    return candidate;
  }

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

        const duplicateProfile = findProfileByName(profile.name);
        if (duplicateProfile) {
          respondNameConflict(reply, duplicateProfile);
          return;
        }

        if (respondTemplateErrors(reply, profile)) {
          return;
        }

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

    const cloneProfileMatch = url.pathname.match(/^\/api\/v1\/proxy-profiles\/([^/]+)\/clone$/);
    if (cloneProfileMatch && request.method === "POST") {
      const profileId = safeDecodePathSegment(cloneProfileMatch[1]);

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

      // 克隆走同一条写入口口径：新名字查重、模板语义校验都过才落盘。
      const clonedProfile = buildProxyProfileRecord(
        {
          ...existingProfile,
          name: nextCloneName(existingProfile.name),
          status: CLONED_PROFILE_STATUS,
          template: copyTemplate(existingProfile.template),
        },
        null,
      );

      const duplicateProfile = findProfileByName(clonedProfile.name);
      if (duplicateProfile) {
        respondNameConflict(reply, duplicateProfile);
        return;
      }

      if (respondTemplateErrors(reply, clonedProfile)) {
        return;
      }

      proxyProfileStore.unshift(clonedProfile);
      await persistProxyProfileStore();

      jsonResponse(reply, 201, {
        profile: clonedProfile,
      });
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

        const duplicateProfile = findProfileByName(updatedProfile.name, {
          excludeId: profileId,
        });
        if (duplicateProfile) {
          respondNameConflict(reply, duplicateProfile);
          return;
        }

        if (respondTemplateErrors(reply, updatedProfile)) {
          return;
        }

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
