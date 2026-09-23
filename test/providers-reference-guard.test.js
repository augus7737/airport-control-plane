// providers 引用保护 + providers/node-groups 路径段解码窄口的专项用例。
// route-table 矩阵的空 store 场景覆盖不到 409 与 warnings 分支，这里补上。
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const probeCredentials = {
  username: "providers-guard-probe",
  password: randomBytes(16).toString("hex"),
};

async function startProbeServer() {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "airport-providers-guard-"));
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AIRPORT_DATA_DIR: dataDir,
      PORT: "0",
      AUTO_PROBE_ENABLED: "false",
      CONTROL_PLANE_AUTH_USERNAME: probeCredentials.username,
      CONTROL_PLANE_AUTH_PASSWORD: probeCredentials.password,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderrChunks = [];
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  const baseUrl = await new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => {
      reject(new Error(`server did not start: ${stderrChunks.join("")}`));
    }, 20000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/listening on http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early with code ${code}: ${stderrChunks.join("")}`));
    });
  });

  return {
    baseUrl,
    async stop() {
      child.kill("SIGKILL");
      await fs.promises.rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function loginSession(baseUrl) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(probeCredentials),
  });
  assert.equal(response.status, 200, "probe login must succeed");

  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie, "probe login must return a session cookie");
  return cookie;
}

async function createProvider(headers, baseUrl, name) {
  const response = await fetch(`${baseUrl}/api/v1/providers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name }),
  });
  assert.equal(response.status, 201);
  const { provider } = await response.json();
  assert.ok(provider?.id, "created provider must have an id");
  return provider;
}

async function createManualNode(headers, baseUrl, hostname, providerId) {
  const response = await fetch(`${baseUrl}/api/v1/nodes/manual`, {
    method: "POST",
    headers,
    body: JSON.stringify({ hostname, provider_id: providerId }),
  });
  assert.equal(response.status, 201, `manual node ${hostname} must be created`);
  const { node } = await response.json();
  assert.equal(node.provider_id, providerId, "node must persist provider_id");
  return node;
}

test("DELETE /api/v1/providers/:id refuses deletion while nodes still reference the provider", async () => {
  const server = await startProbeServer();

  try {
    const cookie = await loginSession(server.baseUrl);
    const headers = { "content-type": "application/json", cookie };
    const suffix = Date.now();

    const provider = await createProvider(headers, server.baseUrl, `guard-bound-${suffix}`);
    const node = await createManualNode(
      headers,
      server.baseUrl,
      `guard-bound-node-${suffix}`,
      provider.id,
    );

    const blocked = await fetch(
      `${server.baseUrl}/api/v1/providers/${encodeURIComponent(provider.id)}`,
      { method: "DELETE", headers },
    );
    assert.equal(blocked.status, 409);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.error, "provider_in_use");
    assert.match(blockedBody.message, /1 bound node/, "message must carry the reference count");
    assert.deepEqual(blockedBody.details.node_ids, [node.id]);
    assert.equal(blockedBody.details.truncated, false);

    // 引用保护不能误伤：解绑（这里直接删节点）后删除要成功
    const nodeDeleted = await fetch(
      `${server.baseUrl}/api/v1/nodes/${encodeURIComponent(node.id)}`,
      { method: "DELETE", headers },
    );
    assert.equal(nodeDeleted.status, 200);

    const allowed = await fetch(
      `${server.baseUrl}/api/v1/providers/${encodeURIComponent(provider.id)}`,
      { method: "DELETE", headers },
    );
    assert.equal(allowed.status, 200);
    const allowedBody = await allowed.json();
    assert.equal(allowedBody.ok, true);
    assert.equal(allowedBody.deleted_provider_id, provider.id);
  } finally {
    await server.stop();
  }
});

test("provider delete guard caps node_ids at 10 with truncated flag", async () => {
  const server = await startProbeServer();

  try {
    const cookie = await loginSession(server.baseUrl);
    const headers = { "content-type": "application/json", cookie };
    const suffix = Date.now();

    const provider = await createProvider(headers, server.baseUrl, `guard-many-${suffix}`);
    for (let index = 0; index < 11; index += 1) {
      await createManualNode(
        headers,
        server.baseUrl,
        `guard-many-node-${suffix}-${index}`,
        provider.id,
      );
    }

    const blocked = await fetch(
      `${server.baseUrl}/api/v1/providers/${encodeURIComponent(provider.id)}`,
      { method: "DELETE", headers },
    );
    assert.equal(blocked.status, 409);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.error, "provider_in_use");
    assert.equal(blockedBody.details.node_ids.length, 10, "node_ids must be capped at 10");
    assert.equal(new Set(blockedBody.details.node_ids).size, 10, "node_ids must be distinct");
    assert.equal(blockedBody.details.truncated, true);
  } finally {
    await server.stop();
  }
});

test("providers and node-groups single-resource PATCH/DELETE reject malformed path segments", async () => {
  const server = await startProbeServer();

  try {
    const cookie = await loginSession(server.baseUrl);
    const headers = { "content-type": "application/json", cookie };

    const cases = [
      ["PATCH", "/api/v1/providers/%", "invalid provider id"],
      ["DELETE", "/api/v1/providers/%", "invalid provider id"],
      ["PATCH", "/api/v1/node-groups/%", "invalid node group id"],
      ["DELETE", "/api/v1/node-groups/%", "invalid node group id"],
    ];

    for (const [method, pathname, expectedMessage] of cases) {
      const response = await fetch(server.baseUrl + pathname, { method, headers, body: "{}" });
      assert.equal(response.status, 400, `${method} ${pathname} must be rejected`);
      const body = await response.json();
      assert.equal(body.error, "bad_request");
      assert.equal(body.message, expectedMessage, `${method} ${pathname} message mismatch`);
    }
  } finally {
    await server.stop();
  }
});

test("PATCH /api/v1/node-groups/:id answers with an informational warnings field", async () => {
  const server = await startProbeServer();

  try {
    const cookie = await loginSession(server.baseUrl);
    const headers = { "content-type": "application/json", cookie };
    const suffix = Date.now();

    const nodeA = await createManualNode(headers, server.baseUrl, `guard-group-a-${suffix}`, null);
    const nodeB = await createManualNode(headers, server.baseUrl, `guard-group-b-${suffix}`, null);

    const created = await fetch(`${server.baseUrl}/api/v1/node-groups`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: `guard-group-${suffix}`, node_ids: [nodeA.id, nodeB.id] }),
    });
    assert.equal(created.status, 201);
    const { group } = await created.json();

    // 无生效发布引用时缩容：照常写入，warnings 为空数组（信息性字段，不拒绝）。
    const shrunk = await fetch(
      `${server.baseUrl}/api/v1/node-groups/${encodeURIComponent(group.id)}`,
      { method: "PATCH", headers, body: JSON.stringify({ node_ids: [nodeA.id] }) },
    );
    assert.equal(shrunk.status, 200);
    const shrunkBody = await shrunk.json();
    assert.equal(shrunkBody.error, undefined);
    assert.deepEqual(shrunkBody.group.node_ids, [nodeA.id]);
    assert.ok(Array.isArray(shrunkBody.warnings), "warnings must always be an array");
    assert.deepEqual(shrunkBody.warnings, [], "no effective release => no warnings");

    // 非缩容更新也不产生 warnings。
    const renamed = await fetch(
      `${server.baseUrl}/api/v1/node-groups/${encodeURIComponent(group.id)}`,
      { method: "PATCH", headers, body: JSON.stringify({ name: `guard-group-renamed-${suffix}` }) },
    );
    assert.equal(renamed.status, 200);
    const renamedBody = await renamed.json();
    assert.deepEqual(renamedBody.warnings, []);
    assert.equal(renamedBody.group.name, `guard-group-renamed-${suffix}`);
  } finally {
    await server.stop();
  }
});
