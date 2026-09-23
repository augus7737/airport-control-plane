import { jsonResponse } from "../../utils/http.js";
import { normalizeNullableString } from "../../utils/network.js";

export function createProbesRoutes(ctx) {
  const {
    listNodeProbes,
    probeStore,
    sortProbes,
  } = ctx;

  return async function handleProbesRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/probes") {
      const nodeId = normalizeNullableString(url.searchParams.get("node_id"));
      const items = nodeId ? listNodeProbes(nodeId) : sortProbes(probeStore);
      jsonResponse(reply, 200, {
        items,
      });
      return;
    }
  };
}
