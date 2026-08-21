import test from "node:test";
import assert from "node:assert/strict";

import { createTaskLifecycleDomain } from "../src/domain/tasks/lifecycle.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function createHarness(overrides = {}) {
  let tick = 0;
  const nowIso = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick += 1)).toISOString();
  const taskStore = [];
  const operationStore = [];
  const probeStore = [];
  const nodeStore = new Map();
  const persistCounts = {
    tasks: 0,
    operations: 0,
    nodes: 0,
  };

  const node = {
    id: "node_1",
    status: "new",
    source: "bootstrap",
    facts: {
      public_ipv4: "203.0.113.10",
    },
  };
  nodeStore.set(node.id, node);

  const task = {
    id: "task_init_1",
    node_id: node.id,
    type: "init_alpine",
    title: "初始化",
    status: "new",
    template: "alpine-base",
    trigger: "bootstrap_register",
    payload: {
      template: "alpine-base",
      reason: "bootstrap_register",
    },
    attempt: 0,
    scheduled_at: nowIso(),
    created_at: nowIso(),
    updated_at: nowIso(),
    started_at: null,
    finished_at: null,
    operation_id: null,
    note: null,
    log_excerpt: [],
  };
  taskStore.push(task);

  function upsertTaskRecord(record) {
    const index = taskStore.findIndex((item) => item.id === record.id);
    record.updated_at = nowIso();
    if (index >= 0) {
      taskStore[index] = record;
    } else {
      taskStore.unshift(record);
    }
    return record;
  }

  const dependencies = {
    bootstrapProbeTaskForInitTask: () => null,
    buildOperationRecord: async ({ node_ids }) => ({
      id: `operation_${operationStore.length + 1}`,
      status: "success",
      started_at: nowIso(),
      finished_at: nowIso(),
      targets: node_ids.map((nodeId) => ({
        node_id: nodeId,
        status: "success",
        output: ["ok"],
      })),
    }),
    buildTaskRecord: () => null,
    defaultInitTemplateForNode: () => "alpine-base",
    ensureNodeInitTask: () => null,
    executeProbeTask: async () => ({ task: null }),
    getNodeById: (nodeId) => nodeStore.get(nodeId) || null,
    getSshProbeTimeoutMs: () => 1000,
    hasUsablePlatformSshKey: async () => true,
    latestNodeTask: (nodeId, type) =>
      taskStore.find((item) => item.node_id === nodeId && (!type || item.type === type)) || null,
    latestNodeTaskByTrigger: () => null,
    listNodes: () => [...nodeStore.values()],
    nowIso,
    operationStore,
    persistNodeStore: async () => {
      persistCounts.nodes += 1;
    },
    persistOperationStore: async () => {
      persistCounts.operations += 1;
    },
    persistTaskStore: async () => {
      persistCounts.tasks += 1;
    },
    probeStore,
    pushOperationRecord: (operation) => {
      operationStore.unshift(operation);
      return operation;
    },
    resolveInitTemplate: () => ({
      name: "alpine-base",
      title: "初始化",
      script_name: "init.sh",
      script_body: "echo ok",
    }),
    resolveProbeTarget: () => ({ host: "203.0.113.10", port: 22, mode: "direct" }),
    setNodeRecord: (record) => {
      nodeStore.set(record.id, record);
      return record;
    },
    shellSessionLabel: () => "node_1",
    taskStore,
    upsertTaskRecord,
    ...overrides,
  };

  return {
    domain: createTaskLifecycleDomain(dependencies),
    node,
    nodeStore,
    operationStore,
    persistCounts,
    task,
    taskStore,
    upsertTaskRecord,
  };
}

test("executeBootstrapInitTask claims before async checks and concurrent calls are idempotent", async () => {
  const keyCheck = deferred();
  let keyCheckCalls = 0;
  const harness = createHarness({
    hasUsablePlatformSshKey: async () => {
      keyCheckCalls += 1;
      await keyCheck.promise;
      return false;
    },
  });

  const first = harness.domain.executeBootstrapInitTask(harness.task, {
    installed_ssh_key: true,
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(keyCheckCalls, 1);
  assert.equal(harness.taskStore[0].status, "running");
  assert.equal(typeof harness.taskStore[0].payload.init_execution_claim?.owner, "string");

  const second = await harness.domain.executeBootstrapInitTask(harness.taskStore[0], {
    installed_ssh_key: true,
  });
  assert.equal(second.idempotent, true);
  assert.equal(second.task.status, "running");

  keyCheck.resolve();
  const firstResult = await first;

  assert.equal(firstResult.skipped, true);
  assert.equal(firstResult.task.status, "new");
  assert.equal(firstResult.task.payload.init_execution_claim, undefined);
  assert.equal(harness.operationStore.length, 0);
});

test("concurrent bootstrap completion executes the init operation once", async () => {
  const operationGate = deferred();
  const operationStarted = deferred();
  let operationCalls = 0;
  const harness = createHarness({
    buildOperationRecord: async ({ node_ids }) => {
      operationCalls += 1;
      operationStarted.resolve();
      await operationGate.promise;
      return {
        id: "operation_once",
        status: "success",
        started_at: "2026-01-01T00:00:10.000Z",
        finished_at: "2026-01-01T00:00:11.000Z",
        targets: node_ids.map((nodeId) => ({
          node_id: nodeId,
          status: "success",
          output: ["initialized"],
        })),
      };
    },
  });

  const first = harness.domain.executeBootstrapInitTask(harness.task, {
    installed_ssh_key: true,
  });
  await operationStarted.promise;

  const second = await harness.domain.executeBootstrapInitTask(harness.taskStore[0], {
    installed_ssh_key: true,
  });
  assert.equal(second.idempotent, true);
  assert.equal(second.task.status, "running");
  assert.equal(operationCalls, 1);

  operationGate.resolve();
  const firstResult = await first;

  assert.equal(firstResult.task.status, "success");
  assert.equal(firstResult.task.operation_id, "operation_once");
  assert.equal(firstResult.task.payload.init_execution_claim, undefined);
  assert.equal(harness.operationStore.length, 1);

  const third = await harness.domain.executeBootstrapInitTask(harness.taskStore[0], {
    installed_ssh_key: true,
  });
  assert.equal(third.idempotent, true);
  assert.equal(third.task.status, "success");
  assert.equal(operationCalls, 1);
});

test("stale claim owner cannot write terminal task state", async () => {
  const harness = createHarness({
    buildOperationRecord: async () => {
      harness.taskStore[0].payload = {
        ...harness.taskStore[0].payload,
        init_execution_claim: {
          owner: "other-owner",
          claimed_at: "2026-01-01T00:00:20.000Z",
        },
      };
      return {
        id: "operation_stale",
        status: "success",
        started_at: "2026-01-01T00:00:21.000Z",
        finished_at: "2026-01-01T00:00:22.000Z",
        targets: [
          {
            node_id: "node_1",
            status: "success",
            output: ["should not be committed"],
          },
        ],
      };
    },
  });

  const result = await harness.domain.executeBootstrapInitTask(harness.task, {
    installed_ssh_key: true,
  });

  assert.equal(result.idempotent, true);
  assert.equal(harness.taskStore[0].status, "running");
  assert.equal(harness.taskStore[0].operation_id, null);
  assert.equal(harness.taskStore[0].payload.init_execution_claim.owner, "other-owner");
  assert.equal(harness.operationStore.length, 0);
  assert.equal(harness.nodeStore.get("node_1").status, "new");
});

test("startup reconciliation still finishes running init tasks from completed operations", async () => {
  const harness = createHarness();
  const task = harness.taskStore[0];
  task.status = "running";
  task.started_at = "2026-01-01T00:00:05.000Z";
  task.operation_id = "operation_recovered";
  task.payload = {
    ...task.payload,
    init_execution_claim: {
      owner: "old-owner",
      claimed_at: "2026-01-01T00:00:05.000Z",
    },
  };
  harness.operationStore.push({
    id: "operation_recovered",
    status: "success",
    started_at: "2026-01-01T00:00:06.000Z",
    finished_at: "2026-01-01T00:00:07.000Z",
    targets: [
      {
        node_id: "node_1",
        status: "success",
        output: ["recovered"],
      },
    ],
  });

  const result = await harness.domain.reconcileInitTaskFromOperation(task);

  assert.equal(result.task_changed, true);
  assert.equal(result.node_changed, true);
  assert.equal(task.status, "success");
  assert.equal(task.payload.init_execution_claim, undefined);
  assert.equal(harness.nodeStore.get("node_1").status, "active");
});
