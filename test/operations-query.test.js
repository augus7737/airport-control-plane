import assert from "node:assert/strict";
import test from "node:test";

import {
  filterOperationsByNode,
  findOperationById,
  operationTargetsNode,
  sortOperationsByCreatedDesc,
} from "../src/domain/operations/query.js";

function operation(id, createdAt, nodeIds) {
  return {
    id,
    created_at: createdAt,
    status: "success",
    targets: nodeIds.map((node_id) => ({ node_id, hostname: node_id, status: "success" })),
  };
}

const opOldest = operation("op_1", "2026-01-01T00:00:00.000Z", ["node_a"]);
const opMiddle = operation("op_2", "2026-01-02T00:00:00.000Z", ["node_a", "node_b"]);
const opNewest = operation("op_3", "2026-01-03T00:00:00.000Z", ["node_b"]);

test("sortOperationsByCreatedDesc keeps the list ordering contract", () => {
  const store = [opMiddle, opOldest, opNewest];
  assert.deepEqual(sortOperationsByCreatedDesc(store).map((item) => item.id), [
    "op_3",
    "op_2",
    "op_1",
  ]);
  // 纯函数：不改写入参、不共享数组引用（路由拿它直接回 JSON）
  assert.deepEqual(store.map((item) => item.id), ["op_2", "op_1", "op_3"]);
  assert.notEqual(sortOperationsByCreatedDesc(store), store);
  assert.deepEqual(sortOperationsByCreatedDesc(null), []);
});

test("filterOperationsByNode returns whole records without pruning targets", () => {
  const store = [opNewest, opMiddle, opOldest];

  assert.deepEqual(
    filterOperationsByNode(store, "node_a").map((item) => item.id),
    ["op_2", "op_1"],
  );
  assert.deepEqual(
    filterOperationsByNode(store, "node_b").map((item) => item.id),
    ["op_3", "op_2"],
  );
  // 关键语义：命中记录整条返回，其他节点的 target 仍在台账视图里
  const filtered = filterOperationsByNode(store, "node_a");
  assert.deepEqual(filtered[0].targets.map((target) => target.node_id), ["node_a", "node_b"]);
});

test("filterOperationsByNode is a no-op without a usable node id", () => {
  const store = [opNewest, opMiddle];

  for (const nodeId of [null, undefined, "", "   "]) {
    assert.deepEqual(
      filterOperationsByNode(store, nodeId).map((item) => item.id),
      ["op_3", "op_2"],
    );
  }
  assert.deepEqual(filterOperationsByNode(null, "node_a"), []);
});

test("filterOperationsByNode tolerates malformed records", () => {
  const store = [
    { id: "op_no_targets", created_at: "2026-01-04T00:00:00.000Z" },
    { id: "op_empty_targets", created_at: "2026-01-04T00:00:00.000Z", targets: [] },
    { id: "op_broken_target", created_at: "2026-01-04T00:00:00.000Z", targets: [null] },
    operation("op_ok", "2026-01-04T00:00:00.000Z", ["node_a"]),
  ];

  assert.deepEqual(filterOperationsByNode(store, "node_a").map((item) => item.id), ["op_ok"]);
  assert.equal(operationTargetsNode(opOldest, null), false);
  assert.equal(operationTargetsNode(opOldest, "node_a"), true);
  assert.equal(operationTargetsNode(opOldest, " node_a "), true, "node ids are trimmed");
});

test("findOperationById reads the ledger record as-is", () => {
  const store = [opNewest, opMiddle];

  assert.equal(findOperationById(store, "op_2"), opMiddle);
  assert.equal(findOperationById(store, "missing"), null);
  assert.equal(findOperationById(store, ""), null);
  assert.equal(findOperationById(null, "op_2"), null);
});
