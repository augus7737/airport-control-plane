import { validatePlatformSingBoxDistributionUpdate, validatePlatformSingBoxMirrorRequest } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";

export function createPlatformRoutes(ctx) {
  const {
    buildPlatformContext,
    buildPublishDistribution,
    generateManagedPlatformSshKey,
    hasOwn,
    mirrorPlatformSingBoxArtifact,
    updatePlatformSingBoxDistribution,
  } = ctx;

  return async function handlePlatformRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/platform-context") {
      jsonResponse(reply, 200, await buildPlatformContext(url));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/platform/sing-box-distribution") {
      jsonResponse(reply, 200, {
        sing_box_distribution: (await buildPlatformContext(url)).sing_box_distribution,
      });
      return;
    }

    if (request.method === "PATCH" && url.pathname === "/api/v1/platform/sing-box-distribution") {
      try {
        const payload = await readJsonBody(request);
        const mappedPayload = {
          ...(hasOwn(payload, "enabled") ? { enabled: payload.enabled } : {}),
          ...(hasOwn(payload, "version")
            ? { version: payload.version }
            : hasOwn(payload, "default_version")
              ? { version: payload.default_version }
              : {}),
          ...(hasOwn(payload, "install_path") ? { install_path: payload.install_path } : {}),
          ...(hasOwn(payload, "variants") ? { variants: payload.variants } : {}),
        };
        const errors = validatePlatformSingBoxDistributionUpdate(mappedPayload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        await updatePlatformSingBoxDistribution(mappedPayload);
        jsonResponse(reply, 200, {
          message: "sing-box 分发配置已更新。",
          platform_context: await buildPlatformContext(url),
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (
      request.method === "POST" &&
      ["/api/v1/platform/sing-box-distribution/mirror", "/api/v1/platform/sing-box-distribution/sync"].includes(
        url.pathname,
      )
    ) {
      try {
        const payload = await readJsonBody(request);
        if (hasOwn(payload, "target")) {
          const errors = validatePlatformSingBoxMirrorRequest(payload);
          if (errors.length > 0) {
            jsonResponse(reply, 400, {
              error: "validation_failed",
              details: errors,
            });
            return;
          }
        }

        const distribution = buildPublishDistribution(null);
        const targets = hasOwn(payload, "target")
          ? [String(payload.target).trim()]
          : distribution.variants.map((variant) => variant.target);

        if (targets.length === 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: ["no enabled sing-box variants configured"],
          });
          return;
        }

        const results = [];
        for (const target of targets) {
          results.push(await mirrorPlatformSingBoxArtifact(target));
        }

        jsonResponse(reply, 201, {
          message: `已同步 ${results.length} 个 sing-box 镜像。`,
          results,
          platform_context: await buildPlatformContext(url),
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/platform/ssh-key/generate") {
      try {
        await generateManagedPlatformSshKey();
        jsonResponse(reply, 201, {
          message: "平台 SSH 密钥已生成，新的 bootstrap 将自动注入这把公钥。",
          platform_context: await buildPlatformContext(url),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        jsonResponse(reply, message.includes("已存在") ? 409 : 400, {
          error: "bad_request",
          message,
        });
      }
      return;
    }
  };
}
