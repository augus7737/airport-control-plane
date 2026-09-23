import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const credentials = {
  username: "config-release-detail-probe",
  password: randomBytes(16).toString("hex"),
};

// 明细接口的 200 命中需要「有存量发布记录」。发布记录只能由 executeConfigRelease 真下发产生，
// 那是禁区（不碰节点）。这里用「测试直接写 store 文件」的安全 seed：把一条 release 记录写进
// 临时 AIRPORT_DATA_DIR/config-releases.json，服务启动时 loadConfigReleaseStore 原样读回，
// 全程不起节点、不触发发布、不下发脚本。
function seedRelease() {
  const bigConfig = JSON.stringify({
    log: { level: "info" },
    inbounds: Array.from({ length: 40 }, (_, index) => ({
      type: "vless",
      tag: `in-${index}`,
      listen: "0.0.0.0",
      listen_port: 443,
    })),
    outbounds: [{ type: "direct", tag: "direct" }],
  });

  return {
    id: "release_detail_probe_1",
    type: "publish_proxy_config",
    title: "明细探测发布",
    status: "success",
    operator: "console",
    access_user_ids: ["user_a", "user_b"],
    profile_id: "profile_probe",
    node_group_ids: ["group_probe"],
    node_ids: ["node_a", "node_b"],
    deployment_node_ids: ["node_a", "node_b"],
    entry_node_ids: [],
    operation_id: "operation_probe_1",
    task_ids: ["task_a", "task_b"],
    version: "rel-probe",
    routes: [],
    deployments: ["node_a", "node_b"].map((nodeId, index) => ({
      node_id: nodeId,
      node_name: `落地机 ${index + 1}`,
      route_roles: ["landing"],
      landing_route_labels: [`r-${nodeId}`],
      entry_route_labels: [],
      artifacts: {
        sing_box: {
          engine: "sing-box",
          config_digest: `digest_${nodeId}`,
          config_path: `/etc/sing-box/config-${nodeId}.json`,
          rendered_config: bigConfig,
          manifest: { deployment: { node_id: nodeId }, huge: "x".repeat(4096) },
        },
      },
      status: "success",
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:01:00.000Z",
      note: null,
      verification: { status: "success", failures: [] },
    })),
    summary: {
      total_nodes: 2,
      success_nodes: 2,
      failed_nodes: 0,
      engine: "sing-box",
      action_type: "publish",
      config_digest_after: "plan_digest_probe",
    },
    note: null,
    created_at: "2026-01-01T00:00:00.000Z",
    started_at: "2026-01-01T00:00:00.000Z",
    finished_at: "2026-01-01T00:01:00.000Z",
    updated_at: "2026-01-01T00:01:00.000Z",
  };
}

async function startServer(release) {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "airport-release-detail-"));
  await fs.promises.writeFile(
    path.join(dataDir, "config-releases.json"),
    JSON.stringify({ items: [release] }, null, 2),
    "utf8",
  );

  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AIRPORT_DATA_DIR: dataDir,
      PORT: "0",
      AUTO_PROBE_ENABLED: "false",
      CONTROL_PLANE_AUTH_USERNAME: credentials.username,
      CONTROL_PLANE_AUTH_PASSWORD: credentials.password,
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
    body: JSON.stringify(credentials),
  });
  assert.equal(response.status, 200, "probe login must succeed");
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie, "probe login must return a session cookie");
  return cookie;
}

test("GET /api/v1/config-releases/:id returns a list-shaped, bounded detail", async () => {
  const release = seedRelease();
  const server = await startServer(release);

  try {
    const cookie = await loginSession(server.baseUrl);
    const headers = { "content-type": "application/json", cookie };

    // 先取列表项，作为「同构」的基准
    const list = await fetch(`${server.baseUrl}/api/v1/config-releases`, { headers });
    assert.equal(list.status, 200);
    const { items } = await list.json();
    assert.equal(items.length, 1, "seeded release must be loaded from the store file");
    const listItem = items.find((item) => item.id === release.id);
    assert.ok(listItem, "seeded release must appear in the list");

    const found = await fetch(
      `${server.baseUrl}/api/v1/config-releases/${encodeURIComponent(release.id)}`,
      { headers },
    );
    assert.equal(found.status, 200);
    const body = await found.json();
    assert.equal(body.error, undefined);

    const detailRelease = body.release;
    assert.ok(detailRelease, "response must carry the release record");

    // 顶层字段与列表项同构：键集合完全一致，前端可复用同一份渲染。
    assert.deepEqual(
      Object.keys(detailRelease).sort(),
      Object.keys(listItem).sort(),
      "detail release must keep the list item field set",
    );
    for (const key of Object.keys(detailRelease)) {
      if (key === "deployments") {
        continue;
      }
      assert.deepEqual(detailRelease[key], listItem[key], `top-level field ${key} must match`);
    }

    // 逐节点数量与身份保留（明细要能看逐节点状态）。
    assert.equal(detailRelease.deployments.length, release.deployments.length);
    assert.deepEqual(
      detailRelease.deployments.map((deployment) => deployment.node_id),
      release.deployments.map((deployment) => deployment.node_id),
    );

    // 有界：节点侧产物不再携带 rendered_config 全文与 manifest 大块。
    for (const deployment of detailRelease.deployments) {
      const artifact = deployment.artifacts.sing_box;
      assert.ok(artifact, "sing_box artifact must remain present");
      assert.equal(
        "rendered_config" in artifact,
        false,
        "full rendered_config must not leak into the detail response",
      );
      assert.equal(artifact.manifest_omitted, true);
      assert.equal(artifact.config_digest, `digest_${deployment.node_id}`);
      assert.ok(artifact.rendered_config_bytes > 0);
      assert.equal(artifact.rendered_config_truncated, true);
      assert.ok(artifact.rendered_config_preview.length <= 600);
    }

    // 明细块：逐节点摘要 + 指向既有通道的全文引用。
    const detail = body.detail;
    assert.equal(detail.bounded, true);
    assert.equal(detail.release_id, release.id);
    assert.equal(detail.deployment_count, release.deployments.length);
    assert.equal(detail.per_node.length, release.deployments.length);
    assert.equal(detail.full_artifact_reference.operations_endpoint, "/api/v1/operations/operation_probe_1");
    assert.ok(detail.rendered_config_total_bytes > 600 * release.deployments.length);
  } finally {
    await server.stop();
  }
});

test("GET /api/v1/config-releases/:id maps unknown id and bad encoding", async () => {
  const server = await startServer(seedRelease());

  try {
    const cookie = await loginSession(server.baseUrl);
    const headers = { "content-type": "application/json", cookie };

    const missing = await fetch(`${server.baseUrl}/api/v1/config-releases/missing-release`, {
      headers,
    });
    assert.equal(missing.status, 404);
    const missingBody = await missing.json();
    assert.equal(missingBody.error, "not_found");
    // 带 message：与 rollback 单资源 404 口径一致，而不是全局兜底
    assert.equal(missingBody.message, "config release not found");

    // 非法百分号编码不得抛 URIError 变 500
    const badEncoding = await fetch(`${server.baseUrl}/api/v1/config-releases/%`, { headers });
    assert.equal(badEncoding.status, 400);
    const badEncodingBody = await badEncoding.json();
    assert.equal(badEncodingBody.error, "bad_request");
    assert.equal(badEncodingBody.message, "invalid release id");
  } finally {
    await server.stop();
  }
});
