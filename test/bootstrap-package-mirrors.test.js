import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAlpineRepositoryPreparation,
  isMainlandChinaRegion,
} from "../src/domain/bootstrap/package-mirrors.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const testToken = "regionmirrorintegration";

async function startEnrollmentServer() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "airport-region-mirror-"));
  await fs.writeFile(
    path.join(dataDir, "bootstrap-tokens.json"),
    `${JSON.stringify({
      items: [{ id: "token_region_mirror", token: testToken, status: "active" }],
    })}\n`,
  );

  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AIRPORT_DATA_DIR: dataDir,
      PORT: "0",
      AUTO_PROBE_ENABLED: "false",
      AIRPORT_METRICS_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderrChunks = [];
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  const baseUrl = await new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(
      () => reject(new Error(`server did not start: ${Buffer.concat(stderrChunks).toString()}`)),
      20_000,
    );
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
      reject(new Error(`server exited early with code ${code}`));
    });
  });

  return {
    baseUrl,
    async stop() {
      child.kill("SIGKILL");
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}

async function fetchEnrollmentScript(baseUrl, region) {
  const query = new URLSearchParams({
    token: testToken,
    ssh_port: "28182",
    ssh_user: "root",
    hostname: "region-test",
    public_ipv4: "192.0.2.10",
    provider: "test-provider",
    role: "edge",
    access_mode: "direct",
    entry_region: "中国大陆",
    relay_node_id: "node_relay",
    relay_label: "relay-label",
    relay_region: "香港",
    route_note: "keep-options",
  });
  if (region !== undefined) {
    query.set("region", region);
  }
  const response = await fetch(`${baseUrl}/bootstrap/enroll.sh?${query}`);
  assert.equal(response.status, 200);
  return response.text();
}

test("mainland China region labels select the Aliyun Alpine mirror", () => {
  for (const region of ["中国大陆", "CN", "中国大陆 · CN", "cn-north-1"]) {
    assert.equal(isMainlandChinaRegion(region), true, region);
    const preparation = buildAlpineRepositoryPreparation(region);
    assert.match(preparation, /repositories\.airport\.bak/);
    assert.match(preparation, /mirrors\.aliyun\.com\/alpine/);
    assert.ok(
      preparation.indexOf("repositories.airport.bak") < preparation.indexOf("sed -i"),
      `${region} must back up repositories before changing them`,
    );
  }
});

test("overseas, special-region, missing, and unknown labels preserve existing Alpine repositories", () => {
  for (const region of ["美国 · US", "US", "JP", "EU", "香港 · HK", "台湾", "火星基地", "", null]) {
    assert.equal(isMainlandChinaRegion(region), false, String(region));
    assert.equal(buildAlpineRepositoryPreparation(region), "", String(region));
  }
});

test("generated enrollment scripts apply mirrors by region and retain every node option", async () => {
  const server = await startEnrollmentServer();
  try {
    for (const region of ["美国 · US", "US", undefined]) {
      const script = await fetchEnrollmentScript(server.baseUrl, region);
      assert.doesNotMatch(script, /mirrors\.aliyun\.com/);
      assert.doesNotMatch(script, /repositories\.airport\.bak/);
    }

    const chinaScript = await fetchEnrollmentScript(server.baseUrl, "中国大陆 · CN");
    assert.match(chinaScript, /repositories\.airport\.bak/);
    assert.match(chinaScript, /mirrors\.aliyun\.com\/alpine/);

    for (const expectedArgument of [
      "--ssh-port '28182'",
      "--ssh-user 'root'",
      "--hostname 'region-test'",
      "--public-ipv4 '192.0.2.10'",
      "--provider 'test-provider'",
      "--region '中国大陆 · CN'",
      "--role 'edge'",
      "--access-mode 'direct'",
      "--entry-region '中国大陆'",
      "--relay-node-id 'node_relay'",
      "--relay-label 'relay-label'",
      "--relay-region '香港'",
      "--route-note 'keep-options'",
    ]) {
      assert.ok(chinaScript.includes(expectedArgument), expectedArgument);
    }
  } finally {
    await server.stop();
  }
});
