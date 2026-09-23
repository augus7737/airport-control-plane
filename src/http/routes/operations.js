import {
  filterOperationsByNode,
  findOperationById,
  sortOperationsByCreatedDesc,
} from "../../domain/operations/query.js";
import { validateOperationRequest } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";
import { normalizeNullableString } from "../../utils/network.js";

export function createOperationsRoutes(ctx) {
  const {
    buildOperationRecord,
    nodeStore,
    operationStore,
    persistOperationStore,
    pushOperationRecord,
    safeDecodePathSegment,
  } = ctx;

  return async function handleOperationsRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/operations") {
      // ?node_id= 只筛记录、不裁剪 targets：整条操作在其他节点上的结果仍然在返回体里。
      const nodeId = normalizeNullableString(url.searchParams.get("node_id"));
      const items = filterOperationsByNode(sortOperationsByCreatedDesc(operationStore), nodeId);
      jsonResponse(reply, 200, {
        items,
        ...(nodeId ? { filtered_by_node_id: nodeId } : {}),
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

    // 判定顺序照 nodes 模块的做法：字面量动作路由（POST /execute）先于通用 `(:id)` 分支判定，
    // 且 `(:id)` 只吃 GET，方法维度已经隔开两条路由，`POST /execute` 不可能被 `:id` 抢走。
    // 反向的 GET /api/v1/operations/execute 会落进 `(:id)` 并由本模块回 404 not_found
    // （与 GET /api/v1/nodes/manual 的既有口径一致），不落全局兜底。
    const operationMatch = url.pathname.match(/^\/api\/v1\/operations\/([^/]+)$/);
    if (operationMatch && request.method === "GET") {
      const operationId = safeDecodePathSegment(operationMatch[1]);

      if (!operationId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid operation id",
        });
        return;
      }

      const existingOperation = findOperationById(operationStore, operationId);

      if (!existingOperation) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "operation not found",
        });
        return;
      }

      jsonResponse(reply, 200, {
        operation: existingOperation,
      });
      return;
    }
  };
}
