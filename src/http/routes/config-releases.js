import { validateConfigReleaseCreate } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";
import { projectConfigReleaseForDetail } from "../../domain/releases/detail.js";

export function createConfigReleasesRoutes(ctx) {
  const {
    buildPlatformContext,
    configReleaseStore,
    executeConfigRelease,
    safeDecodePathSegment,
    sortByUpdatedAt,
  } = ctx;

  return async function handleConfigReleasesRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/config-releases") {
      jsonResponse(reply, 200, {
        items: sortByUpdatedAt(configReleaseStore),
      });
      return;
    }

    const detailMatch = url.pathname.match(/^\/api\/v1\/config-releases\/([^/]+)$/);
    if (request.method === "GET" && detailMatch) {
      const releaseId = safeDecodePathSegment(detailMatch[1]);
      if (!releaseId) {
        jsonResponse(reply, 400, { error: "bad_request", message: "invalid release id" });
        return;
      }

      const release = configReleaseStore.find((item) => item.id === releaseId) ?? null;
      if (!release) {
        jsonResponse(reply, 404, { error: "not_found", message: "config release not found" });
        return;
      }

      jsonResponse(reply, 200, projectConfigReleaseForDetail(release));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/config-releases") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateConfigReleaseCreate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const platformContext = await buildPlatformContext(url);
        const result = await executeConfigRelease(payload, {
          platformBaseUrl: platformContext.bootstrap_base_url,
        });
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

    const rollbackMatch = url.pathname.match(/^\/api\/v1\/config-releases\/([^/]+)\/rollback$/);
    if (request.method === "POST" && rollbackMatch) {
      const releaseId = safeDecodePathSegment(rollbackMatch[1]);
      if (!releaseId) {
        jsonResponse(reply, 400, { error: "bad_request", message: "invalid release id" });
        return;
      }

      const sourceRelease = configReleaseStore.find((item) => item.id === releaseId) ?? null;
      if (!sourceRelease) {
        jsonResponse(reply, 404, { error: "not_found", message: "config release not found" });
        return;
      }

      if (sourceRelease.status !== "success") {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: `只有成功的发布可以作为回滚目标，当前状态：${sourceRelease.status}`,
        });
        return;
      }

      const effectiveRelease =
        configReleaseStore.find(
          (item) => item.profile_id === sourceRelease.profile_id && item.status === "success",
        ) ?? null;
      if (effectiveRelease?.id === sourceRelease.id) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "该发布已是当前生效版本，无需回滚。",
        });
        return;
      }

      try {
        let body = {};
        if (Number.parseInt(request.headers["content-length"] ?? "0", 10) > 0) {
          const parsed = await readJsonBody(request);
          if (parsed && typeof parsed === "object") {
            body = parsed;
          }
        }
        const text = (value) => (typeof value === "string" ? value.trim() : "");
        const platformContext = await buildPlatformContext(url);
        const result = await executeConfigRelease(
          {
            type: "rollback_proxy_config",
            title:
              text(body.title) ||
              `回滚到 ${sourceRelease.version ?? sourceRelease.id}`,
            operator: text(body.operator) || "console",
            note:
              text(body.note) ||
              `回滚目标：${sourceRelease.version ?? sourceRelease.id}（${sourceRelease.title ?? "未命名发布"}）`,
            profile_id: sourceRelease.profile_id,
            access_user_ids: sourceRelease.access_user_ids ?? [],
            node_group_ids: [],
            node_ids: sourceRelease.node_ids ?? [],
          },
          {
            platformBaseUrl: platformContext.bootstrap_base_url,
            rollbackSourceRelease: sourceRelease,
          },
        );
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
