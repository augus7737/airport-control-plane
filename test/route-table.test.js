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
  ["DELETE", "/api/v1/nodes/missing-node", 404, "not_found"],
  ["DELETE", "/api/v1/nodes/manual", 404, "not_found"],
  ["POST", "/api/v1/nodes/manual", 400, "validation_failed"],
  ["POST", "/api/v1/nodes/register", 400, "validation_failed", "anon"],
  ["PATCH", "/api/v1/nodes/missing-node/assets", 404, "not_found"],
  ["POST", "/api/v1/nodes/missing-node/init", 404, "not_found"],
  ["POST", "/api/v1/nodes/missing-node/probe", 404, "not_found"],
  ["POST", "/api/v1/nodes/missing-node/diagnostics", 404, "not_found"],
  ["POST", "/api/v1/bootstrap-tokens", 201, null],
  ["PATCH", "/api/v1/bootstrap-tokens/missing", 404, "not_found"],
  ["GET", "/api/v1/access-users/missing/share", 404, "not_found"],
  ["POST", "/api/v1/access-users", 400, "validation_failed"],
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
  ["PATCH", "/api/v1/proxy-profiles/missing", 404, "not_found"],
  ["DELETE", "/api/v1/proxy-profiles/missing", 404, "not_found"],
  ["POST", "/api/v1/node-groups", 400, "validation_failed"],
  ["GET", "/api/v1/node-groups/missing", 404, "not_found"],
  ["PATCH", "/api/v1/node-groups/missing", 404, "not_found"],
  ["DELETE", "/api/v1/node-groups/missing", 404, "not_found"],
  ["POST", "/api/v1/providers", 400, "validation_failed"],
  ["PATCH", "/api/v1/providers/missing", 404, "not_found"],
  ["DELETE", "/api/v1/providers/missing", 404, "not_found"],
  ["POST", "/api/v1/config-releases", 400, "validation_failed"],
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
