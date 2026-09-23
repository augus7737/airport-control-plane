// 任务日志摘要的唯一口径。
//
// 早先两处各自的 `slice(-8)` 在真机排障时刚好切掉最需要的证据：装包失败的原因常在开头
// （apt/apk 报错、下载超时），结尾则往往是服务重启与收尾噪声。这里保留头尾两段，
// 中间省略处插一行说明完整输出的取回通道（operations 单查接口）。
//
// 注意：省略标记必须落在中间。`getTaskSummary` 取数组最后一行当列表页摘要，
// 末尾放标记会让每条任务都显示"中间省略 N 行"。

export const TASK_LOG_HEAD_LINES = 12;
export const TASK_LOG_TAIL_LINES = 60;
export const TASK_LOG_LINE_MAX_CHARS = 400;

function clipLine(line) {
  const text = String(line ?? "");
  if (text.length <= TASK_LOG_LINE_MAX_CHARS) {
    return text;
  }
  return `${text.slice(0, TASK_LOG_LINE_MAX_CHARS)}…`;
}

export function buildTaskLogExcerpt(lines, { operationId = null } = {}) {
  const entries = (Array.isArray(lines) ? lines : [])
    .filter((line) => line !== null && line !== undefined && line !== "")
    .map(clipLine);

  if (entries.length <= TASK_LOG_HEAD_LINES + TASK_LOG_TAIL_LINES) {
    return entries;
  }

  const omitted = entries.length - TASK_LOG_HEAD_LINES - TASK_LOG_TAIL_LINES;
  const source = operationId ? `GET /api/v1/operations/${operationId}` : "对应操作的执行回显";
  return [
    ...entries.slice(0, TASK_LOG_HEAD_LINES),
    `… 中间省略 ${omitted} 行，完整输出见 ${source}`,
    ...entries.slice(-TASK_LOG_TAIL_LINES),
  ];
}
