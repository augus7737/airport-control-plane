import { jsonResponse, readJsonBody } from "../../utils/http.js";

export function createTasksRoutes(ctx) {
  const {
    bootstrapAutoProbeState,
    bootstrapTokenError,
    ensureBootstrapAutoProbe,
    executeBootstrapInitTask,
    exhaustedTokenBelongsToNode,
    findBootstrapTokenByValue,
    isBootstrapTokenExhaustedError,
    nodeStore,
    operationStore,
    reconcileTaskStoreFromOperations,
    sortTasks,
    taskStore,
  } = ctx;

  return async function handleTasksRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/tasks") {
      await reconcileTaskStoreFromOperations();
      jsonResponse(reply, 200, {
        items: sortTasks(taskStore),
      });
      return;
    }

    const taskBootstrapCompleteMatch = url.pathname.match(
      /^\/api\/v1\/tasks\/([^/]+)\/bootstrap-complete$/,
    );
    if (taskBootstrapCompleteMatch && request.method === "POST") {
      try {
        const taskId = decodeURIComponent(taskBootstrapCompleteMatch[1]);
        const task = taskStore.find((item) => item.id === taskId);

        if (!task) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "task not found",
          });
          return;
        }

        if (task.type !== "init_alpine") {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: ["task is not bootstrap-initializable"],
          });
          return;
        }

        const node = nodeStore.get(task.node_id);
        if (!node) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "node not found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const tokenValue =
          typeof payload.bootstrap_token === "string"
            ? payload.bootstrap_token.trim()
            : String(payload.bootstrap_token ?? "");
        const bootstrapToken = findBootstrapTokenByValue(tokenValue);
        const tokenErrorInfo = bootstrapTokenError(bootstrapToken);

        if (tokenErrorInfo && !(
          isBootstrapTokenExhaustedError(tokenErrorInfo) &&
          exhaustedTokenBelongsToNode(bootstrapToken, node)
        )) {
          jsonResponse(reply, 403, {
            error: tokenErrorInfo.code,
            message: tokenErrorInfo.message,
          });
          return;
        }

        if (node.bootstrap_token_id && bootstrapToken?.id !== node.bootstrap_token_id) {
          jsonResponse(reply, 403, {
            error: "bootstrap_token_mismatch",
            message: "bootstrap token 与当前节点不匹配",
          });
          return;
        }

        await reconcileTaskStoreFromOperations();
        const freshTask = taskStore.find((item) => item.id === taskId) || task;
        const freshNode = nodeStore.get(freshTask.node_id) || node;

        if (freshTask.status === "running") {
          const probeState = bootstrapAutoProbeState(freshNode, freshTask.id);
          jsonResponse(reply, 200, {
            task: freshTask,
            node: freshNode,
            operation: freshTask.operation_id
              ? operationStore.find((item) => item.id === freshTask.operation_id) || null
              : null,
            probe_task: probeState.task,
            probe: probeState.probe,
            probe_summary: probeState.summary,
            transport: probeState.transport,
            capability: probeState.capability,
          });
          return;
        }

        const existingOperation = freshTask.operation_id
          ? operationStore.find((item) => item.id === freshTask.operation_id) || null
          : null;
        const result =
          freshTask.status === "success"
            ? {
                task: freshTask,
                node: freshNode,
                operation: existingOperation,
              }
            : await executeBootstrapInitTask(freshTask, payload);
        const initTaskStatus = String(result.task?.status || freshTask.status || "new").toLowerCase();
        const canAutoProbe = initTaskStatus === "success" && result.skipped !== true;
        const existingProbeState = bootstrapAutoProbeState(
          result.node ?? freshNode,
          (result.task ?? freshTask).id,
        );
        const probeState = canAutoProbe
          ? await ensureBootstrapAutoProbe(result.node ?? freshNode, result.task ?? freshTask, {
              note: "节点已完成 bootstrap 回报，控制面开始执行首轮自动探测。",
            })
          : {
              ...existingProbeState,
              summary:
                existingProbeState.summary ??
                (result.skipped
                  ? "初始化尚未真正执行完成，本次未触发自动首探。"
                  : "初始化未成功，本次未触发自动首探。"),
            };
        const responseNode = probeState.node ?? result.node ?? nodeStore.get(freshNode.id) ?? freshNode;

        jsonResponse(reply, 200, {
          task: result.task,
          node: responseNode,
          operation: result.operation,
          probe_task: probeState.task,
          probe: probeState.probe,
          probe_summary: probeState.summary,
          transport: probeState.transport,
          capability: probeState.capability,
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
