import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateSingBoxProfileTemplate } from "../src/domain/releases/sing-box.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const PROFILES_PATH = "/api/v1/proxy-profiles";
const profilePath = (id) => `${PROFILES_PATH}/${encodeURIComponent(id)}`;
const clonePath = (id) => `${profilePath(id)}/clone`;
// 只服务本次临时实例，用完随临时目录一起销毁
const probeCredentials = {
  username: "proxy-profiles-probe",
  password: randomBytes(16).toString("hex"),
};

// 能通过 validateSingBoxProfileTemplate 的最小 Reality 模板：只放节点本地路径与公钥素材，
// 不写任何真实私钥内容。
function validProfilePayload(name, overrides = {}) {
  return {
    name,
    protocol: "vless",
    transport: "tcp",
    security: "reality",
    listen_port: 8443,
    server_name: "www.example.com",
    template: {
      reality: {
        private_key_path: "/etc/airport/reality/private.key",
        short_ids: ["deadbeef"],
        handshake: {
          server: "www.example.com",
          server_port: 443,
        },
      },
    },
    ...overrides,
  };
}

// 种子数据形态：security=tls 但模板里没有证书路径，按新的写入口口径是不合格的，
// 但历史上已经落盘，必须保持可读可删。
function legacyProfileRecord(overrides = {}) {
  return {
    id: "profile_legacy_ws_tls",
    name: "Legacy VMess WS TLS",
    protocol: "vmess",
    listen_port: 443,
    transport: "ws",
    security: "tls",
    tls_enabled: true,
    reality_enabled: false,
    server_name: "cdn.example.com",
    flow: null,
    mux_enabled: false,
    tag: null,
    template: {},
    status: "active",
    note: "历史模板：缺 template.tls 证书路径",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function startProbeServer({ profiles = null } = {}) {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "airport-proxy-profiles-"));
  if (profiles) {
    await fs.promises.writeFile(
      path.join(dataDir, "proxy-profiles.json"),
      `${JSON.stringify({ items: profiles }, null, 2)}\n`,
    );
  }

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

  const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(probeCredentials),
  });
  assert.equal(loginResponse.status, 200, "probe login must succeed");
  const cookie = (loginResponse.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie, "probe login must return a session cookie");

  async function call(method, pathname, body) {
    const headers = { "content-type": "application/json", cookie };
    const init = { method, headers, redirect: "manual" };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(baseUrl + pathname, init);
    return { status: response.status, body: await response.json() };
  }

  return {
    baseUrl,
    call,
    async listProfiles() {
      const { body } = await call("GET", "/api/v1/proxy-profiles");
      return body.items ?? [];
    },
    async stop() {
      child.kill("SIGKILL");
      await fs.promises.rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("proxy-profile writes reject duplicate names case-insensitively", async () => {
  const server = await startProbeServer();

  try {
    const first = await server.call("POST", PROFILES_PATH, validProfilePayload("HK Reality 8443"));
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.profile.name, "HK Reality 8443");

    const second = await server.call("POST", PROFILES_PATH, {
      ...validProfilePayload("  hk REALITY 8443 "),
      listen_port: 8444,
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, "profile_name_conflict");
    assert.match(second.body.message, /HK Reality 8443/);
    assert.equal((await server.listProfiles()).length, 1, "rejected create must not persist");

    const other = await server.call("POST", PROFILES_PATH, {
      ...validProfilePayload("HK Reality 9443"),
      listen_port: 9443,
    });
    assert.equal(other.status, 201, JSON.stringify(other.body));

    const otherUrl = profilePath(other.body.profile.id);

    // PATCH 改名撞到别人：409
    const renameTaken = await server.call("PATCH", otherUrl, { name: "HK REALITY 8443" });
    assert.equal(renameTaken.status, 409);
    assert.equal(renameTaken.body.error, "profile_name_conflict");

    // PATCH 只改别的字段（不动 name）：不因自身名字误判重名
    const renameSelf = await server.call("PATCH", otherUrl, { name: "hk reality 8443 改名" });
    assert.equal(renameSelf.status, 200, JSON.stringify(renameSelf.body));

    // PATCH 完全不传 name：合并后的名字就是自己的，不能算重名
    const touchNote = await server.call("PATCH", otherUrl, { note: "只改备注" });
    assert.equal(touchNote.status, 200, JSON.stringify(touchNote.body));
    assert.equal(touchNote.body.profile.note, "只改备注");
  } finally {
    await server.stop();
  }
});

test("proxy-profile writes gate on sing-box template semantics", async () => {
  const server = await startProbeServer();

  try {
    const invalidCreate = await server.call("POST", PROFILES_PATH, {
      name: "Broken TLS",
      protocol: "vless",
      transport: "tcp",
      security: "tls",
      listen_port: 443,
      template: {},
    });
    assert.equal(invalidCreate.status, 400);
    assert.equal(invalidCreate.body.error, "validation_failed");
    assert.ok(
      invalidCreate.body.details.includes("TLS 模板需要 template.tls.certificate_path"),
      JSON.stringify(invalidCreate.body.details),
    );
    assert.equal((await server.listProfiles()).length, 0, "rejected create must not persist");

    const created = await server.call("POST", PROFILES_PATH, validProfilePayload(" gated-create"));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const createdUrl = profilePath(created.body.profile.id);

    // 合并后会破坏模板语义的 PATCH 同样在写入口拦下
    const invalidPatch = await server.call("PATCH", createdUrl, {
      security: "tls",
      template: { sing_box: {} },
    });
    assert.equal(invalidPatch.status, 400);
    assert.equal(invalidPatch.body.error, "validation_failed");
    assert.ok(
      invalidPatch.body.details.includes("TLS 模板需要 template.tls.key_path"),
      JSON.stringify(invalidPatch.body.details),
    );

    const unchanged = await server.call("GET", createdUrl);
    assert.equal(unchanged.body.profile.security, "reality", "rejected patch must not persist");

    // sing_box 包裹形态的合法模板可以通过
    const wrapped = await server.call("POST", PROFILES_PATH, {
      name: "Wrapped Reality",
      protocol: "vless",
      transport: "tcp",
      security: "reality",
      listen_port: 9443,
      server_name: "www.example.com",
      template: {
        sing_box: {
          reality: {
            private_key_path: "/etc/airport/reality/private.key",
            short_id: ["abcd1234"],
          },
        },
      },
    });
    assert.equal(wrapped.status, 201, JSON.stringify(wrapped.body));
  } finally {
    await server.stop();
  }
});

test("POST /api/v1/proxy-profiles/:id/clone copies a profile as a draft", async () => {
  const server = await startProbeServer();

  try {
    const created = await server.call("POST", PROFILES_PATH, validProfilePayload("FRA Source"));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const source = created.body.profile;

    const cloned = await server.call(
      "POST",
      clonePath(source.id),
      undefined,
    );
    assert.equal(cloned.status, 201, JSON.stringify(cloned.body));
    assert.equal(cloned.body.error, undefined);
    const clone = cloned.body.profile;
    assert.ok(clone.id, "clone must carry its own id");
    assert.notEqual(clone.id, source.id);
    assert.equal(clone.name, "FRA Source 副本");
    assert.equal(clone.status, "draft", "clone lands in the draft status, no new enum value");
    assert.ok(
      Number.isFinite(Date.parse(clone.created_at)) && Number.isFinite(Date.parse(clone.updated_at)),
      "the clone is a fresh record version with its own timestamps",
    );
    for (const field of [
      "protocol",
      "transport",
      "security",
      "listen_port",
      "server_name",
      "flow",
      "mux_enabled",
      "tls_enabled",
      "reality_enabled",
      "tag",
      "note",
    ]) {
      assert.deepEqual(clone[field], source[field], `${field} must be copied verbatim`);
    }
    assert.deepEqual(clone.template, source.template);
    clone.template.reality.short_ids = ["tampered"];
    assert.deepEqual(
      (await server.call("GET", profilePath(source.id))).body.profile
        .template.reality.short_ids,
      ["deadbeef"],
      "clone must deep-copy the template object",
    );

    // 再克隆一次：撞名就继续按规则找不冲突的名字
    const clonedAgain = await server.call(
      "POST",
      clonePath(source.id),
      undefined,
    );
    assert.equal(clonedAgain.status, 201, JSON.stringify(clonedAgain.body));
    assert.equal(clonedAgain.body.profile.name, "FRA Source 副本 2");
    assert.equal((await server.listProfiles()).length, 3);

    const missing = await server.call("POST", "/api/v1/proxy-profiles/missing-id/clone", undefined);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "not_found");
    assert.equal(missing.body.message, "profile not found");
  } finally {
    await server.stop();
  }
});

test("profiles stored before the template gate stay readable and deletable", async () => {
  const legacy = [
    legacyProfileRecord(),
    legacyProfileRecord({
      id: "profile_legacy_empty",
      name: "Legacy Hysteria2 8443",
      protocol: "hysteria2",
      transport: "udp",
      note: "历史模板：同样缺证书路径",
    }),
  ];
  const server = await startProbeServer({ profiles: legacy });

  try {
    const list = await server.call("GET", "/api/v1/proxy-profiles");
    assert.equal(list.status, 200);
    assert.deepEqual(
      (list.body.items ?? []).map((item) => item.id).sort(),
      ["profile_legacy_empty", "profile_legacy_ws_tls"],
      "existing records must stay readable",
    );

    const single = await server.call("GET", profilePath("profile_legacy_ws_tls"));
    assert.equal(single.status, 200);
    assert.deepEqual(single.body.profile.template, {});

    // 已经不合格的历史记录：PATCH / 克隆会被写入口拦下，但报错信息说明缺什么
    const blockedPatch = await server.call("PATCH", profilePath("profile_legacy_ws_tls"), {
      note: "只想改备注",
    });
    assert.equal(blockedPatch.status, 400);
    assert.equal(blockedPatch.body.error, "validation_failed");

    const blockedClone = await server.call("POST", `${profilePath("profile_legacy_ws_tls")}/clone`);
    assert.equal(blockedClone.status, 400);
    assert.equal(blockedClone.body.error, "validation_failed");

    // 补齐模板后即可保存，并立刻可克隆
    const fixed = await server.call("PATCH", profilePath("profile_legacy_ws_tls"), {
      template: {
        tls: {
          certificate_path: "/etc/ssl/airport/fullchain.pem",
          key_path: "/etc/ssl/airport/privkey.pem",
        },
        transport: { type: "ws", path: "/ws" },
      },
    });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));

    const cloned = await server.call("POST", `${profilePath("profile_legacy_ws_tls")}/clone`);
    assert.equal(cloned.status, 201, JSON.stringify(cloned.body));
    assert.equal(cloned.body.profile.name, "Legacy VMess WS TLS 副本");
    assert.equal(cloned.body.profile.status, "draft");

    // DELETE 完全不看模板校验
    const deleted = await server.call("DELETE", profilePath("profile_legacy_empty"));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(deleted.body.deleted_profile_id, "profile_legacy_empty");

    const remaining = await server.listProfiles();
    assert.equal(remaining.length, 2, "legacy record + its clone");
    assert.ok(
      remaining.some((item) => item.id === "profile_legacy_ws_tls"),
      "the fixed legacy record must still be there",
    );
    assert.ok(
      remaining.every((item) => validateSingBoxProfileTemplate(item).length === 0),
      "nothing persisted through the write entry points may stay invalid",
    );
  } finally {
    await server.stop();
  }
});
