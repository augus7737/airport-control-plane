import { validateProviderCreate, validateProviderUpdate } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";

export function createProvidersRoutes(ctx) {
  const {
    buildProviderRecord,
    findProviderById,
    findProviderByName,
    hasOwn,
    persistProviderStore,
    providerStore,
    sortByUpdatedAt,
  } = ctx;

  return async function handleProvidersRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/providers") {
      jsonResponse(reply, 200, {
        items: sortByUpdatedAt(providerStore),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/providers") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateProviderCreate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const duplicateProvider = findProviderByName(payload.name);
        if (duplicateProvider) {
          jsonResponse(reply, 409, {
            error: "conflict",
            message: `provider name already exists: ${duplicateProvider.name}`,
          });
          return;
        }

        const provider = buildProviderRecord(payload);
        providerStore.unshift(provider);
        await persistProviderStore();

        jsonResponse(reply, 201, {
          provider,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    const providerMatch = url.pathname.match(/^\/api\/v1\/providers\/([^/]+)$/);
    if (providerMatch && request.method === "GET") {
      const providerId = decodeURIComponent(providerMatch[1]);
      const existingProvider = findProviderById(providerId);

      if (!existingProvider) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "provider not found",
        });
        return;
      }

      jsonResponse(reply, 200, {
        provider: existingProvider,
      });
      return;
    }

    if (providerMatch && request.method === "PATCH") {
      try {
        const providerId = decodeURIComponent(providerMatch[1]);
        const existingProvider = findProviderById(providerId);

        if (!existingProvider) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "provider not found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const errors = validateProviderUpdate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        if (hasOwn(payload, "name")) {
          const duplicateProvider = findProviderByName(payload.name, {
            excludeId: providerId,
          });
          if (duplicateProvider) {
            jsonResponse(reply, 409, {
              error: "conflict",
              message: `provider name already exists: ${duplicateProvider.name}`,
            });
            return;
          }
        }

        const updatedProvider = buildProviderRecord(payload, existingProvider);
        const index = providerStore.findIndex((item) => item.id === providerId);
        providerStore[index] = updatedProvider;
        await persistProviderStore();

        jsonResponse(reply, 200, {
          provider: updatedProvider,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (providerMatch && request.method === "DELETE") {
      const providerId = decodeURIComponent(providerMatch[1]);
      const existingProvider = findProviderById(providerId);

      if (!existingProvider) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "provider not found",
        });
        return;
      }

      const nextProviders = providerStore.filter((item) => item.id !== providerId);
      providerStore.length = 0;
      providerStore.push(...nextProviders);
      await persistProviderStore();

      jsonResponse(reply, 200, {
        ok: true,
        deleted_provider_id: providerId,
      });
      return;
    }
  };
}
