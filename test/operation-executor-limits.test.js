import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createOperationsExecutorDomain } from "../src/domain/operations/executor.js";

function createChild(onEnd) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.write = () => {};
  child.stdin.end = () => onEnd(child);
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

function createDomain(options = {}) {
  const nodes = new Map(
    (options.nodes ?? []).map((node) => [node.id, node]),
  );
  let nowMs = Date.parse("2026-01-01T00:00:00.000Z");

  return createOperationsExecutorDomain({
    cwdProvider: () => process.cwd(),
    formatTimeLabel: (value) => value,
    getNodeById: (nodeId) => nodes.get(nodeId),
    nowIso: () => {
      const value = new Date(nowMs).toISOString();
      nowMs += 10;
      return value;
    },
    operationExecutionTimeoutMs: options.operationExecutionTimeoutMs ?? 1000,
    operationOutputLimitBytes: options.operationOutputLimitBytes,
    operationTargetConcurrency: options.operationTargetConcurrency,
    randomUUID: () => "test",
    resolveExecutionTransport: async () => ({
      kind: "local-demo",
      command: "sh",
      env: {},
      label: "测试执行器",
      note: "本地测试",
    }),
    spawn: options.spawn,
  });
}

test("operation target stores bounded combined stdout and stderr output", async () => {
  const node = {
    id: "node-a",
    facts: { hostname: "node-a" },
    labels: { provider: "test", region: "lab" },
  };
  const domain = createDomain({
    nodes: [node],
    operationOutputLimitBytes: 8,
    spawn: () => createChild((child) => {
      child.stdout.emit("data", Buffer.from("abcdef"));
      child.stderr.emit("data", Buffer.from("ghijkl"));
      child.emit("close", 0, null);
    }),
  });

  const operation = await domain.buildOperationRecord({
    mode: "command",
    command: "printf lots",
    node_ids: [node.id],
  });
  const target = operation.targets[0];

  assert.equal(target.status, "success");
  assert.equal(target.output_truncated, true);
  assert.equal(target.output_limit_bytes, 8);
  assert.match(target.output_text, /abcdefgh/);
  assert.doesNotMatch(target.output_text, /ijkl/);
  assert.match(target.output_text, /输出已截断/);
});

test("operation targets run with configurable bounded concurrency", async () => {
  const nodes = Array.from({ length: 5 }, (_, index) => ({
    id: `node-${index}`,
    facts: { hostname: `node-${index}` },
    labels: {},
  }));
  let active = 0;
  let maxActive = 0;
  const domain = createDomain({
    nodes,
    operationTargetConcurrency: 2,
    spawn: () => createChild((child) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        child.stdout.emit("data", Buffer.from("ok\n"));
        active -= 1;
        child.emit("close", 0, null);
      }, 20);
    }),
  });

  const operation = await domain.buildOperationRecord({
    mode: "command",
    command: "true",
    node_ids: nodes.map((node) => node.id),
  });

  assert.equal(operation.summary.total, 5);
  assert.equal(operation.summary.success, 5);
  assert.equal(maxActive, 2);
});

test("operation target concurrency defaults to three", async () => {
  const nodes = Array.from({ length: 4 }, (_, index) => ({
    id: `default-node-${index}`,
    facts: { hostname: `default-node-${index}` },
    labels: {},
  }));
  let active = 0;
  let maxActive = 0;
  const domain = createDomain({
    nodes,
    spawn: () => createChild((child) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        active -= 1;
        child.emit("close", 0, null);
      }, 20);
    }),
  });

  await domain.buildOperationRecord({
    mode: "command",
    command: "true",
    node_ids: nodes.map((node) => node.id),
  });

  assert.equal(maxActive, 3);
});
