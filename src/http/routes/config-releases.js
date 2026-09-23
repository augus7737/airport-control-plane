import { validateConfigReleaseCreate } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";

export function createConfigReleasesRoutes(ctx) {
  const {
    buildPlatformContext,
    configReleaseStore,
    executeConfigRelease,
    sortByUpdatedAt,
  } = ctx;

  return async function handleConfigReleasesRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/config-releases") {
      jsonResponse(reply, 200, {
        items: sortByUpdatedAt(configReleaseStore),
      });
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
  };
}
