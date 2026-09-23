import { jsonResponse } from "../../utils/http.js";

export function createCostsRoutes(ctx) {
  const {
    buildLiveCostViews,
  } = ctx;

  return async function handleCostsRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/costs/summary") {
      const costViews = buildLiveCostViews();
      jsonResponse(reply, 200, {
        summary: costViews.summary,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/costs/nodes") {
      const costViews = buildLiveCostViews();
      jsonResponse(reply, 200, {
        items: costViews.nodes,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/costs/providers") {
      const costViews = buildLiveCostViews();
      jsonResponse(reply, 200, {
        items: costViews.providers,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/costs/releases") {
      const costViews = buildLiveCostViews();
      jsonResponse(reply, 200, {
        items: costViews.releases,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/costs/access-users") {
      const costViews = buildLiveCostViews();
      jsonResponse(reply, 200, {
        items: costViews.access_users,
      });
      return;
    }
  };
}
