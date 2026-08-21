import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { atomicWriteJson, readJsonWithBackup } from "../src/infrastructure/json-file-store.js";

test("atomicWriteJson writes valid JSON and creates a backup on later writes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "airport-json-store-"));
  try {
    const filePath = path.join(dir, "nodes.json");

    await atomicWriteJson(filePath, { items: [{ id: "node_a" }] });
    await atomicWriteJson(filePath, { items: [{ id: "node_b" }] });

    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), {
      items: [{ id: "node_b" }],
    });
    assert.deepEqual(JSON.parse(await readFile(`${filePath}.bak`, "utf8")), {
      items: [{ id: "node_a" }],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readJsonWithBackup restores from backup when the primary file is corrupt", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "airport-json-store-"));
  try {
    const filePath = path.join(dir, "tasks.json");
    const backupPayload = { items: [{ id: "task_a", status: "success" }] };

    await writeFile(filePath, "{not-json", "utf8");
    await writeFile(`${filePath}.bak`, JSON.stringify(backupPayload), "utf8");

    assert.deepEqual(await readJsonWithBackup(filePath), backupPayload);
    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), backupPayload);
    assert.deepEqual(JSON.parse(await readFile(`${filePath}.bak`, "utf8")), backupPayload);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
