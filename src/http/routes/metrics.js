import { jsonResponse, readJsonBody } from "../../utils/http.js";
import { normalizeNullableString } from "../../utils/network.js";

export function createMetricsRoutes(ctx) {
  const {
    collectMetrics,
    getMetricsSchedulerState,
    listMetricBuckets,
    listMetricSamples,
    metricSampleLimit = 40,
    metricsSampleStore,
    nodeStore,
  } = ctx;

  return async function handleMetricsRoutes({ request, reply, url }) {
    if (request.method === "POST" && url.pathname === "/api/v1/metrics/collect") {
      try {
        const payload = await readJsonBody(request).catch(() => ({}));
        const requested = Array.isArray(payload?.node_ids) ? payload.node_ids : [];
        const unknown = requested.filter((nodeId) => !nodeStore.has(nodeId));
        if (unknown.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: [`unknown node ids: ${unknown.join(", ")}`],
          });
          return;
        }

        const result = await collectMetrics(requested);
        jsonResponse(reply, 200, result);
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/metrics") {
      const nodeId = normalizeNullableString(url.searchParams.get("node_id"));
      const limit = Math.min(
        Math.max(Number.parseInt(url.searchParams.get("limit") ?? "", 10) || metricSampleLimit, 1),
        200,
      );
      const samples = listMetricSamples(nodeId, limit);
      // 采集失败同样要能看见，否则页面只会显示"没有数据"，和节点真的离线无法区分。
      const failures = metricsSampleStore
        .filter((sample) => sample.status !== "success" && (!nodeId || sample.node_id === nodeId))
        .slice(0, 10);

      jsonResponse(reply, 200, {
        buckets: listMetricBuckets(nodeId),
        samples,
        failures,
        scheduler: getMetricsSchedulerState(),
      });
      return;
    }
  };
}
