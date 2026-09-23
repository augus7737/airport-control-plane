import { jsonResponse } from "../../utils/http.js";
import { normalizeNullableString } from "../../utils/network.js";

export function createDiagnosticsRoutes(ctx) {
  const {
    listDiagnostics,
  } = ctx;

  return async function handleDiagnosticsRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/diagnostics") {
      const nodeId = normalizeNullableString(url.searchParams.get("node_id"));
      jsonResponse(reply, 200, {
        items: listDiagnostics(nodeId),
      });
      return;
    }
  };
}
