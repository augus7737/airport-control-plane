import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
// 只服务本次临时实例，用完随临时目录一起销毁
const probeCredentials = {
  username: "route-table-probe",
  password: randomBytes(16).toString("hex"),
};

// 鉴权门在路由之前，未登录时所有 /api/v1/* 都是 401，探测不到路由是否丢失；
// 因此除标注 anon 的用例外，全部带会话 Cookie 打，用 404/200/400 区分路由解析结果。
const routes = [
  ["GET", "/healthz", 200, null, "anon"],
  ["GET", "/bootstrap.sh", 200, null, "anon"],
  ["GET", "/bootstrap/enroll.sh", 403, null, "anon"],
  ["GET", "/sub/does-not-exist", 404, "not_found", "anon"],
  ["GET", "/login", 302, null, "anon"],
  ["GET", "/", 302, null, "anon"],
  ["GET", "/nodes.html", 302, null, "anon"],
  ["POST", "/api/v1/auth/login", 401, "invalid_credentials", "anon"],
  ["GET", "/api/v1/auth/session", 200, null],
  ["GET", "/api/v1/nodes", 200, null],
  ["GET", "/api/v1/tasks", 200, null],
  ["GET", "/api/v1/probes", 200, null],
  ["GET", "/api/v1/diagnostics", 200, null],
  ["GET", "/api/v1/bootstrap-tokens", 200, null],
  ["GET", "/api/v1/access-users", 200, null],
  ["GET", "/api/v1/system-templates", 200, null],
  ["GET", "/api/v1/system-template-releases", 200, null],
  ["GET", "/api/v1/system-users", 200, null],
  ["GET", "/api/v1/system-user-releases", 200, null],
  ["GET", "/api/v1/proxy-profiles", 200, null],
  ["GET", "/api/v1/node-groups", 200, null],
  ["GET", "/api/v1/providers", 200, null],
  ["GET", "/api/v1/config-releases", 200, null],
  ["GET", "/api/v1/operations", 200, null],
  ["GET", "/api/v1/costs/summary", 200, null],
  ["GET", "/api/v1/costs/nodes", 200, null],
  ["GET", "/api/v1/costs/providers", 200, null],
  ["GET", "/api/v1/costs/releases", 200, null],
  ["GET", "/api/v1/costs/access-users", 200, null],
  ["GET", "/api/v1/platform-context", 200, null],
  ["GET", "/api/v1/platform/sing-box-distribution", 200, null],
  ["PATCH", "/api/v1/platform/sing-box-distribution", 200, null],
  ["POST", "/api/v1/platform/ssh-key/generate", 201, null],
  ["GET", "/api/v1/nodes/missing", 404, "not_found"],
  ["GET", "/api/v1/nodes/%", 400, "bad_request"],
  ["DELETE", "/api/v1/nodes/missing-node", 404, "not_found"],
  ["DELETE", "/api/v1/nodes/manual", 404, "not_found"],
  ["POST", "/api/v1/nodes/manual", 400, "validation_failed"],
  ["POST", "/api/v1/nodes/register", 400, "validation_failed", "anon"],
  ["PATCH", "/api/v1/nodes/missing-node/assets", 404, "not_found"],
  ["PATCH", "/api/v1/nodes/missing-node/labels", 404, "not_found"],
  ["PATCH", "/api/v1/nodes/%/labels", 400, "bad_request"],
  ["POST", "/api/v1/nodes/missing-node/init", 404, "not_found"],
  ["POST", "/api/v1/nodes/missing-node/probe", 404, "not_found"],
  ["POST", "/api/v1/nodes/missing-node/diagnostics", 404, "not_found"],
  ["POST", "/api/v1/bootstrap-tokens", 201, null],
  ["PATCH", "/api/v1/bootstrap-tokens/missing", 404, "not_found"],
  ["GET", "/api/v1/access-users/missing/share", 404, "not_found"],
  ["POST", "/api/v1/access-users", 400, "validation_failed"],
  ["GET", "/api/v1/access-users/missing", 404, "not_found"],
  ["GET", "/api/v1/access-users/%", 400, "invalid_request"],
  ["PATCH", "/api/v1/access-users/missing", 404, "not_found"],
  ["DELETE", "/api/v1/access-users/missing", 404, "not_found"],
  ["POST", "/api/v1/system-templates", 400, "validation_failed"],
  ["PATCH", "/api/v1/system-templates/missing", 404, "not_found"],
  ["DELETE", "/api/v1/system-templates/missing", 404, "not_found"],
  ["POST", "/api/v1/system-templates/apply", 400, "validation_failed"],
  ["POST", "/api/v1/system-users", 400, "validation_failed"],
  ["PATCH", "/api/v1/system-users/missing", 404, "not_found"],
  ["DELETE", "/api/v1/system-users/missing", 404, "not_found"],
  ["POST", "/api/v1/system-users/apply", 400, "validation_failed"],
  ["POST", "/api/v1/proxy-profiles", 400, "validation_failed"],
  ["GET", "/api/v1/proxy-profiles/missing", 404, "not_found"],
  ["GET", "/api/v1/proxy-profiles/%", 400, "bad_request"],
  ["PATCH", "/api/v1/proxy-profiles/missing", 404, "not_found"],
  ["PATCH", "/api/v1/proxy-profiles/%", 400, "bad_request"],
  ["DELETE", "/api/v1/proxy-profiles/missing", 404, "not_found"],
  ["DELETE", "/api/v1/proxy-profiles/%", 400, "bad_request"],
  ["POST", "/api/v1/proxy-profiles/missing/clone", 404, "not_found"],
  ["POST", "/api/v1/proxy-profiles/%/clone", 400, "bad_request"],
  ["POST", "/api/v1/node-groups", 400, "validation_failed"],
  ["GET", "/api/v1/node-groups/missing", 404, "not_found"],
  ["GET", "/api/v1/node-groups/%", 400, "bad_request"],
  ["PATCH", "/api/v1/node-groups/missing", 404, "not_found"],
  ["DELETE", "/api/v1/node-groups/missing", 404, "not_found"],
  ["POST", "/api/v1/providers", 400, "validation_failed"],
  ["GET", "/api/v1/providers/missing", 404, "not_found"],
  ["GET", "/api/v1/providers/%", 400, "bad_request"],
  ["GET", "/api/v1/providers/missing/nested", 404, "not_found"],
  ["PATCH", "/api/v1/providers/missing", 404, "not_found"],
  ["DELETE", "/api/v1/providers/missing", 404, "not_found"],
  ["POST", "/api/v1/config-releases", 400, "validation_failed"],
  ["POST", "/api/v1/config-releases/missing-release/rollback", 404, "not_found"],
  ["POST", "/api/v1/config-releases/%/rollback", 400, "bad_request"],
  ["POST", "/api/v1/operations/execute", 400, "validation_failed"],
  ["POST", "/api/v1/tasks/missing/bootstrap-complete", 404, "not_found"],
  ["GET", "/api/v1/shell/sessions/missing", 404, "not_found"],
  ["DELETE", "/api/v1/shell/sessions/missing", 404, "not_found"],
  ["POST", "/api/v1/shell/sessions/missing/input", 404, "not_found"],
  ["GET", "/api/v1/nope", 404, "not_found"],
  ["GET", "/api/v1/nodes/missing/nope", 404, "not_found"],
  ["PUT", "/api/v1/nodes", 404, "not_found"],
  ["DELETE", "/api/v1/tasks", 404, "not_found"],
  ["PATCH", "/api/v1/tasks/missing", 404, "not_found"],
  ["GET", "/api/v1", 404, "not_found"],
];

async function startProbeServer() {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "airport-route-table-"));
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
  assert.equal(response.status, 200, "probe login must succeed to detect routing");

  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie, "probe login must return a session cookie");
  return cookie;
}

test("every registered route resolves to the same status and error code", async () => {
  const server = await startProbeServer();

  try {
    const cookie = await loginSession(server.baseUrl);
    const mismatches = [];

    for (const [method, pathname, expectedStatus, expectedError, authMode] of routes) {
      const headers = { "content-type": "application/json" };
      if (authMode !== "anon") {
        headers.cookie = cookie;
      }
      const init = { method, headers, redirect: "manual" };
      if (method !== "GET" && method !== "HEAD") {
        init.body = "{}";
      }

      const response = await fetch(server.baseUrl + pathname, init);
      const status = response.status;
      const body = await response.text();

      let error = null;
      try {
        error = JSON.parse(body).error ?? null;
      } catch {
        error = null;
      }

      if (status !== expectedStatus || error !== expectedError) {
        mismatches.push(
          `${method} ${pathname}: got ${status} ${error ?? "-"}, ` +
            `expected ${expectedStatus} ${expectedError ?? "-"}`,
        );
      }
    }

    assert.deepEqual(mismatches, []);
  } finally {
    await server.stop();
  }
});

// 矩阵里的 404 行无法区分“providers 路由自己回 404”和“落到全局兜底 404”，
// 且探测实例的 provider store 是空的、矩阵本身没有建数据的通道，
// 所以单资源读的 200/404 语义用这条独立用例覆盖（复用同一套临时实例与登录辅助函数）。
test("GET /api/v1/providers/:id reads a single provider record", async () => {
  const server = await startProbeServer();

  try {
    const cookie = await loginSession(server.baseUrl);
    const headers = { "content-type": "application/json", cookie };

    const created = await fetch(`${server.baseUrl}/api/v1/providers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: `route-table-provider-${Date.now()}` }),
    });
    assert.equal(created.status, 201);
    const { provider: createdProvider } = await created.json();
    assert.ok(createdProvider?.id, "created provider must have an id");

    const found = await fetch(
      `${server.baseUrl}/api/v1/providers/${encodeURIComponent(createdProvider.id)}`,
      { headers },
    );
    assert.equal(found.status, 200);
    const foundBody = await found.json();
    assert.equal(foundBody.error, undefined);
    assert.deepEqual(foundBody.provider, createdProvider);

    const missing = await fetch(`${server.baseUrl}/api/v1/providers/missing-id`, {
      headers,
    });
    assert.equal(missing.status, 404);
    const missingBody = await missing.json();
    assert.equal(missingBody.error, "not_found");
    // 与 PATCH/DELETE 的单资源 404 口径一致，而不是全局兜底（兜底无 message）
    assert.equal(missingBody.message, "provider not found");
  } finally {
    await server.stop();
  }
});

// 同上：nodes 的单资源读没有矩阵 200 行可依赖，这里用 POST /api/v1/nodes/manual
// 造一条记录（该路由只跑 validateManualNode + buildManualNodeRecord，纯 store 写入，
// 不依赖真节点、不起 shell、需要会话鉴权但不碰 bootstrap token）。
test("GET /api/v1/nodes/:id reads a single node record", async () => {
  const server = await startProbeServer();

  try {
    const cookie = await loginSession(server.baseUrl);
    const headers = { "content-type": "application/json", cookie };

    const created = await fetch(`${server.baseUrl}/api/v1/nodes/manual`, {
      method: "POST",
      headers,
      body: JSON.stringify({ hostname: `route-table-node-${Date.now()}` }),
    });
    assert.equal(created.status, 201);
    const { node: createdNode } = await created.json();
    assert.ok(createdNode?.id, "created node must have an id");

    const found = await fetch(
      `${server.baseUrl}/api/v1/nodes/${encodeURIComponent(createdNode.id)}`,
      { headers },
    );
    assert.equal(found.status, 200);
    const foundBody = await found.json();
    assert.equal(foundBody.error, undefined);
    // nodes 列表口径就是 nodeStore 原始记录（无 serializer），单资源读同样直出
    assert.deepEqual(foundBody.node, createdNode);

    const missing = await fetch(`${server.baseUrl}/api/v1/nodes/missing-id`, {
      headers,
    });
    assert.equal(missing.status, 404);
    const missingBody = await missing.json();
    assert.equal(missingBody.error, "not_found");
    // 与 DELETE 的单资源 404 口径一致，而不是全局兜底（兜底无 message）
    assert.equal(missingBody.message, "node not found");

    // 字面量 id 也被 (:id) 匹配：GET /nodes/manual 由本模块回 404（带 message），
    // 不落全局兜底；POST 侧两个 manual-only 分支因方法不同不受影响
    const manualLiteral = await fetch(`${server.baseUrl}/api/v1/nodes/manual`, {
      headers,
    });
    assert.equal(manualLiteral.status, 404);
    const manualLiteralBody = await manualLiteral.json();
    assert.equal(manualLiteralBody.error, "not_found");
    assert.equal(manualLiteralBody.message, "node not found");

    const invalidId = await fetch(`${server.baseUrl}/api/v1/nodes/%`, {
      headers,
    });
    assert.equal(invalidId.status, 400);
    const invalidIdBody = await invalidId.json();
    assert.equal(invalidIdBody.error, "bad_request");
    assert.equal(invalidIdBody.message, "invalid node id");
  } finally {
    await server.stop();
  }
});

// 自定义 labels 只能走窄口 PATCH：合并写入、null 或空串删除，其余字段不受影响。
test("PATCH /api/v1/nodes/:id/labels merges and removes custom labels only", async () => {
  const server = await startProbeServer();

  try {
    const cookie = await loginSession(server.baseUrl);
    const headers = { "content-type": "application/json", cookie };

    const created = await fetch(`${server.baseUrl}/api/v1/nodes/manual`, {
      method: "POST",
      headers,
      body: JSON.stringify({ hostname: `route-table-labels-${Date.now()}` }),
    });
    assert.equal(created.status, 201);
    const { node: createdNode } = await created.json();
    const nodeUrl = `${server.baseUrl}/api/v1/nodes/${encodeURIComponent(createdNode.id)}/labels`;

    const merged = await fetch(nodeUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ labels: { batch: "round-2", role: "  egress  " } }),
    });
    assert.equal(merged.status, 200);
    const mergedBody = await merged.json();
    assert.equal(mergedBody.error, undefined);
    assert.equal(mergedBody.node.labels.batch, "round-2");
    assert.equal(mergedBody.node.labels.role, "egress", "values must be trimmed");
    assert.equal(mergedBody.node.hostname, createdNode.hostname, "only labels may change");
    assert.deepEqual(
      Object.keys(mergedBody.node).sort(),
      Object.keys(createdNode).sort(),
      "the update must not add or drop fields",
    );

    const regionLabel = await fetch(nodeUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ labels: { region: "  东京  " } }),
    });
    assert.equal(regionLabel.status, 200);
    const regionLabelBody = await regionLabel.json();
    assert.equal(regionLabelBody.node.labels.batch, "round-2", "writes must merge, not replace");
    assert.equal(
      regionLabelBody.node.labels.region,
      // 地域字典的既有口径：东京归一到国家「日本」，窄口不能绕开归一
      "日本",
    );

    const removed = await fetch(nodeUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ labels: { batch: null, role: "" } }),
    });
    assert.equal(removed.status, 200);
    const removedBody = await removed.json();
    assert.equal("batch" in removedBody.node.labels, false);
    assert.equal("role" in removedBody.node.labels, false);

    const invalidPayloads = [
      [{}, "labels must be an object"],
      [{ labels: [] }, "labels must be an object"],
      [{ labels: { batch: 3 } }, "labels.batch must be a string or null"],
      [{ labels: { "": "x" } }, "labels key must be a non-empty string"],
    ];

    for (const [body, expectedDetail] of invalidPayloads) {
      const invalid = await fetch(nodeUrl, { method: "PATCH", headers, body: JSON.stringify(body) });
      assert.equal(invalid.status, 400, `${JSON.stringify(body)} must be rejected`);
      const invalidBody = await invalid.json();
      assert.equal(invalidBody.error, "validation_failed");
      assert.ok(
        invalidBody.details.includes(expectedDetail),
        `expected "${expectedDetail}" in ${JSON.stringify(invalidBody.details)}`,
      );
    }

    const unchanged = await fetch(
      `${server.baseUrl}/api/v1/nodes/${encodeURIComponent(createdNode.id)}`,
      { headers },
    );
    const unchangedBody = await unchanged.json();
    assert.equal(unchangedBody.node.labels.batch, undefined, "rejected writes must not persist");
  } finally {
    await server.stop();
  }
});
