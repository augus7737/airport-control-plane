import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createStorePersistenceInfrastructure } from "../src/infrastructure/store-persistence.js";

const NOW = "2026-09-23T00:00:00.000Z";

async function setup(items) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "airport-op-reclaim-"));
  const operationsFile = path.join(dataDir, "operations.json");
  if (items !== undefined) {
    await fs.writeFile(operationsFile, JSON.stringify({ items }), "utf8");
  }

  const operationStore = [];
  const persistence = createStorePersistenceInfrastructure({
    dataDir,
    mkdir: fs.mkdir,
    nowIso: () => NOW,
    operationStore,
    operationsFile,
    readFile: fs.readFile,
  });

  return { dataDir, operationStore, operationsFile, persistence };
}

test("loadOperationStore 回收崩溃残留的 running 操作与未结束的目标", async () => {
  const { dataDir, operationStore, operationsFile, persistence } = await setup([
    {
      id: "op_running",
      status: "running",
      started_at: "2026-09-22T10:00:00.000Z",
      node_ids: ["node_a", "node_b", "node_c"],
      summary: { total: 3, success: 0, failed: 0 },
      targets: [
        { node_id: "node_a", status: "success" },
        { node_id: "node_b", status: "pending" },
        { node_id: "node_c", status: "running" },
      ],
    },
    { id: "op_done", status: "partial", targets: [{ node_id: "node_d", status: "failed" }] },
  ]);

  try {
    await persistence.loadOperationStore();

    assert.equal(operationStore.length, 2);
    const running = operationStore.find((item) => item.id === "op_running");
    // 混合结果收口为 partial，不再停在"执行中"
    assert.equal(running.status, "partial");
    assert.equal(running.finished_at, NOW);
    assert.equal(running.updated_at, NOW);
    assert.match(running.note, /异常中断回收/);
    assert.deepEqual(running.summary, { total: 3, success: 1, failed: 2 });
    assert.deepEqual(
      running.targets.map((target) => `${target.node_id}:${target.status}`),
      ["node_a:success", "node_b:failed", "node_c:failed"],
    );
    // 已成功的目标不被改写
    assert.equal(running.targets[0].finished_at, undefined);
    // 原本就结束的记录一字不动
    assert.deepEqual(operationStore.find((item) => item.id === "op_done"), {
      id: "op_done",
      status: "partial",
      targets: [{ node_id: "node_d", status: "failed" }],
    });

    // 收口结果必须落盘，否则下次启动还要再收一遍
    const persisted = JSON.parse(await fs.readFile(operationsFile, "utf8"));
    assert.equal(persisted.items.find((item) => item.id === "op_running").status, "partial");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("loadOperationStore 对全部目标已完成/全部失败/无目标三种崩溃点给出确定状态", async () => {
  const { dataDir, operationStore, persistence } = await setup([
    { id: "op_all_success", status: "running", targets: [{ node_id: "a", status: "success" }] },
    { id: "op_all_failed", status: "running", targets: [{ node_id: "b", status: "pending" }] },
    { id: "op_no_target", status: "queued", targets: [] },
    { id: "op_no_targets_field", status: "running" },
  ]);

  try {
    await persistence.loadOperationStore();

    assert.deepEqual(
      operationStore.map((item) => `${item.id}:${item.status}`),
      [
        "op_all_success:success",
        "op_all_failed:failed",
        "op_no_target:failed",
        "op_no_targets_field:failed",
      ],
    );
    assert.deepEqual(operationStore[0].summary, { total: 1, success: 1, failed: 0 });
    assert.deepEqual(operationStore[3].summary, { total: 0, success: 0, failed: 0 });
    // 目标里已写入的中断原因可复核
    assert.match(operationStore[1].targets[0].error_message, /异常中断回收/);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("loadOperationStore 保留已有 note/error_message，不覆盖真实失败原因", async () => {
  const { dataDir, operationStore, persistence } = await setup([
    {
      id: "op_x",
      status: "running",
      note: "批量脚本执行",
      targets: [{ node_id: "a", status: "running", error_message: "SSH 连接超时" }],
    },
  ]);

  try {
    await persistence.loadOperationStore();

    assert.equal(operationStore[0].note, "批量脚本执行");
    assert.equal(operationStore[0].targets[0].error_message, "SSH 连接超时");
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("loadOperationStore 在文件缺失时不写入、不抛错", async () => {
  const { dataDir, operationStore, operationsFile, persistence } = await setup(undefined);

  try {
    await persistence.loadOperationStore();
    assert.deepEqual(operationStore, []);
    await assert.rejects(() => fs.access(operationsFile));
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
