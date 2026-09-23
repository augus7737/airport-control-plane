import { jsonResponse, readJsonBody } from "../../utils/http.js";

export function createBootstrapTokensRoutes(ctx) {
  const {
    bootstrapTokenStore,
    buildBootstrapTokenRecord,
    persistBootstrapTokens,
    registerBootstrapToken,
    serializeBootstrapToken,
    validateBootstrapTokenCreate,
    validateBootstrapTokenUpdate,
  } = ctx;

  return async function handleBootstrapTokensRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/bootstrap-tokens") {
      const items = [...bootstrapTokenStore.values()].sort((a, b) =>
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
      );
      jsonResponse(reply, 200, {
        items: items.map(serializeBootstrapToken),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/bootstrap-tokens") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateBootstrapTokenCreate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const tokenRecord = buildBootstrapTokenRecord(payload);
        registerBootstrapToken(tokenRecord);
        await persistBootstrapTokens();

        jsonResponse(reply, 201, {
          token: serializeBootstrapToken(tokenRecord),
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    const bootstrapTokenMatch = url.pathname.match(/^\/api\/v1\/bootstrap-tokens\/([^/]+)$/);
    if (bootstrapTokenMatch && request.method === "PATCH") {
      try {
        const tokenId = decodeURIComponent(bootstrapTokenMatch[1]);
        const existingToken = bootstrapTokenStore.get(tokenId);

        if (!existingToken) {
          jsonResponse(reply, 404, {
            error: "not_found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const errors = validateBootstrapTokenUpdate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const updatedToken = buildBootstrapTokenRecord(payload, existingToken);
        registerBootstrapToken(updatedToken);
        await persistBootstrapTokens();

        jsonResponse(reply, 200, {
          token: serializeBootstrapToken(updatedToken),
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
