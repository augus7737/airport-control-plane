import { validateOperationRequest } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";

export function createOperationsRoutes(ctx) {
  const {
    buildOperationRecord,
    nodeStore,
    operationStore,
    persistOperationStore,
    pushOperationRecord,
  } = ctx;

  return async function handleOperationsRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/operations") {
      jsonResponse(reply, 200, {
        items: [...operationStore].sort((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at))
        ),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/operations/execute") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateOperationRequest(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const missingNodes = payload.node_ids.filter((nodeId) => !nodeStore.has(nodeId));
        if (missingNodes.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: [`unknown node ids: ${missingNodes.join(", ")}`],
          });
          return;
        }

        const operation = await buildOperationRecord(payload);
        pushOperationRecord(operation);
        await persistOperationStore();

        jsonResponse(reply, 201, {
          operation,
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
