import assert from "node:assert/strict";
import test from "node:test";

import {
  TASK_LOG_HEAD_LINES,
  TASK_LOG_LINE_MAX_CHARS,
  TASK_LOG_TAIL_LINES,
  buildTaskLogExcerpt,
} from "../src/domain/tasks/log-excerpt.js";

function lines(count, prefix = "line") {
  return Array.from({ length: count }, (_, index) => `${prefix}_${index + 1}`);
}

test("未超预算的日志原样保留", () => {
  const input = lines(TASK_LOG_HEAD_LINES + TASK_LOG_TAIL_LINES);
  assert.deepEqual(buildTaskLogExcerpt(input), input);
  assert.deepEqual(buildTaskLogExcerpt([]), []);
  assert.deepEqual(buildTaskLogExcerpt(null), []);
});

test("超长日志保留头尾两段，中间省略标记落在中间", () => {
  const input = lines(200, "apt");
  const excerpt = buildTaskLogExcerpt(input, { operationId: "op_1" });

  assert.equal(excerpt.length, TASK_LOG_HEAD_LINES + 1 + TASK_LOG_TAIL_LINES);
  assert.deepEqual(excerpt.slice(0, TASK_LOG_HEAD_LINES), input.slice(0, TASK_LOG_HEAD_LINES));
  assert.deepEqual(excerpt.slice(-TASK_LOG_TAIL_LINES), input.slice(-TASK_LOG_TAIL_LINES));
  // 列表页摘要取的是最后一行，末尾必须是真实日志
  assert.equal(excerpt[excerpt.length - 1], "apt_200");
  assert.equal(excerpt[TASK_LOG_HEAD_LINES], `… 中间省略 ${200 - TASK_LOG_HEAD_LINES - TASK_LOG_TAIL_LINES} 行，完整输出见 GET /api/v1/operations/op_1`);
});

test("无 operationId 时省略标记给出可读兜底", () => {
  const excerpt = buildTaskLogExcerpt(lines(500));
  assert.match(excerpt[TASK_LOG_HEAD_LINES], /完整输出见 对应操作的执行回显/);
});

test("单行限长，避免一行几 KB 的回显灌满 tasks.json", () => {
  const excerpt = buildTaskLogExcerpt(["x".repeat(5000), ...lines(200)]);
  assert.equal(excerpt[0].length, TASK_LOG_LINE_MAX_CHARS + 1);
  assert.ok(excerpt[0].endsWith("…"));
});

test("空行与 null 条目不进摘要", () => {
  assert.deepEqual(buildTaskLogExcerpt(["a", "", null, undefined, "  ", "b"]), ["a", "  ", "b"]);
});
