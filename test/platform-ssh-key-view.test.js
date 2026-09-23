import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { buildPlatformSshKeyView, createPlatformRoutes } from "../src/http/routes/platform.js";

// 复查口的全部价值在于「少说话」：状态、算法、指纹、时间、文件名/目录名。
// 因此这里的断言重点是私钥材料（内容、绝对路径）与公钥本体不得出现，而不是字段多少。
const EXPECTED_VIEW_KEYS = [
  "algorithm",
  "bootstrap_ready",
  "can_generate",
  "created_at",
  "fingerprint",
  "key_type",
  "managed",
  "note",
  "private_key_dir_name",
  "private_key_file_name",
  "public_key_available",
  "reason_code",
  "source",
  "status",
  "updated_at",
  "usable",
];

// 与 ssh.js 里 ssh-keygen 产出的真实结构同构：wire format = 长度前缀类型串 + 长度前缀密钥体。
function buildSshPublicKey(keyType, keyBody) {
  const write = (buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(buffer.length, 0);
    return [length, buffer];
  };
  const blob = Buffer.concat([...write(Buffer.from(keyType, "utf8")), ...write(keyBody)]);
  return { blob, line: `${keyType} ${blob.toString("base64")} airport-control-plane` };
}

// 指纹是对整段 wire format（含类型串）取 SHA256，即 `ssh-keygen -lf` 的口径；
// 这里用独立的长度前缀写入 + 独立哈希实现，避免和被测代码共用同一段解析逻辑。
function fingerprintOf(blob) {
  return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
}

const FIXTURE_KEY = buildSshPublicKey("ssh-ed25519", Buffer.from("0123456789abcdefghij", "utf8"));
const PUBLIC_KEY_LINE = FIXTURE_KEY.line;
const FIXTURE_FINGERPRINT = fingerprintOf(FIXTURE_KEY.blob);

function managedKeyState(overrides = {}) {
  return {
    ok: true,
    source: "managed",
    private_key_path: "/var/lib/airport/data/platform-ssh/id_ed25519",
    public_key: PUBLIC_KEY_LINE,
    bootstrap_ready: true,
    reason_code: null,
    note: null,
    ...overrides,
  };
}

function makeReply() {
  return {
    statusCode: null,
    payload: null,
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(body) {
      this.payload = JSON.parse(body);
    },
  };
}

function jsonRequest(body) {
  return Readable.from([JSON.stringify(body)]);
}

function platformTestContext(overrides = {}) {
  return {
    buildPlatformContext: async () => ({}),
    buildPublishDistribution: () => ({ version: "1.13.19", variants: [] }),
    generateManagedPlatformSshKey: async () => ({}),
    hasOwn: (object, key) => Object.prototype.hasOwnProperty.call(object, key),
    mirrorPlatformSingBoxArtifact: async () => {
      throw new Error("mirror must not run in this test");
    },
    platformSshKeyState: async () => managedKeyState(),
    updatePlatformSingBoxDistribution: async () => ({}),
    ...overrides,
  };
}

async function call(handle, { method, pathname, body }) {
  const reply = makeReply();
  const request = body === undefined ? Readable.from([]) : jsonRequest(body);
  // server.js 传下来的就是原生 IncomingMessage，method 挂在请求对象上
  request.method = method;
  await handle({
    request,
    reply,
    url: new URL(`http://127.0.0.1:8091${pathname}`),
  });
  return { status: reply.statusCode, payload: reply.payload };
}

test("ssh key view exposes only state-class fields", () => {
  const view = buildPlatformSshKeyView(managedKeyState(), {
    created_at: "2026-09-23T00:00:00.000Z",
    updated_at: "2026-09-23T00:00:00.000Z",
  });

  assert.deepEqual(Object.keys(view).sort(), EXPECTED_VIEW_KEYS);
  assert.equal(view.status, "ready");
  assert.equal(view.usable, true);
  assert.equal(view.managed, true, "source managed 才是控制面自管");
  assert.equal(view.can_generate, true);
  assert.equal(view.algorithm, "ed25519");
  assert.equal(view.key_type, "ssh-ed25519");
  assert.equal(view.fingerprint, FIXTURE_FINGERPRINT);
  assert.equal(view.private_key_file_name, "id_ed25519");
  assert.equal(view.private_key_dir_name, "platform-ssh");
});

test("ssh key view carries no private key material and no absolute paths", () => {
  const secretish = [
    "-----BEGIN",
    "PRIVATE KEY",
    "/var/lib/airport",
    "data/platform-ssh",
    // 公钥本体同样不外发：它的唯一来源保持是 platform-context
    PUBLIC_KEY_LINE,
    PUBLIC_KEY_LINE.split(" ")[1],
  ];

  for (const state of [
    managedKeyState(),
    managedKeyState({ ok: false, reason_code: "platform_ssh_key_invalid", note: "私钥文件不可用" }),
    managedKeyState({ source: "env", private_key_path: "/opt/secrets/id_rsa" }),
    {
      ok: false,
      source: "missing",
      private_key_path: null,
      public_key: null,
      bootstrap_ready: false,
      reason_code: "platform_ssh_key_missing",
      note: null,
    },
  ]) {
    const serialized = JSON.stringify(buildPlatformSshKeyView(state, {}));
    for (const needle of secretish) {
      assert.equal(serialized.includes(needle), false, `must not leak: ${needle}`);
    }
  }
});

test("ssh key view normalizes every state the domain can report", () => {
  const missing = buildPlatformSshKeyView(null, null);
  assert.equal(missing.status, "missing");
  assert.equal(missing.usable, false);
  assert.equal(missing.managed, false);
  assert.equal(missing.source, "missing");
  assert.equal(missing.fingerprint, null);
  assert.equal(missing.private_key_file_name, null);
  assert.equal(missing.created_at, null);

  // 私钥在、公钥缺：platform-context 口径里的 partial，bootstrap 不可用但没有报错
  const partial = buildPlatformSshKeyView(
    managedKeyState({
      public_key: null,
      bootstrap_ready: false,
      reason_code: "platform_ssh_public_key_missing",
      note: "缺少配套公钥",
    }),
    {},
  );
  assert.equal(partial.status, "partial");
  assert.equal(partial.usable, true);
  assert.equal(partial.public_key_available, false);
  assert.equal(partial.algorithm, null);
  assert.equal(partial.reason_code, "platform_ssh_public_key_missing");

  const invalid = buildPlatformSshKeyView(
    managedKeyState({ ok: false, reason_code: "platform_ssh_key_invalid" }),
    {},
  );
  assert.equal(invalid.status, "invalid");

  // env 托管的密钥不由页面生成，也不标记为控制面自管
  const external = buildPlatformSshKeyView(
    managedKeyState({ source: "env", public_key: PUBLIC_KEY_LINE.replace("ssh-ed25519", "ssh-rsa") }),
    {},
  );
  assert.equal(external.managed, false);
  assert.equal(external.can_generate, false, "env 来源时 generate 必然失败");
  assert.equal(external.fingerprint, null, "类型串与 wire format 不一致时不给指纹");
});

test("ssh key view rejects malformed public keys instead of guessing", () => {
  const cases = [
    "",
    "   ",
    "ssh-ed25519",
    "not-a-public-key-line body",
    "ssh-ed25519 !!!!not base64!!!!",
    // 长度前缀越界：不能因为畸形输入抛错
    `ssh-ed25519 ${Buffer.concat([Buffer.from([0, 0, 255, 255]), Buffer.from("xx")]).toString("base64")}`,
  ];

  for (const publicKey of cases) {
    const view = buildPlatformSshKeyView(managedKeyState({ public_key: publicKey }), {});
    assert.equal(view.fingerprint, null, `${publicKey} must not produce a fingerprint`);
    assert.equal(view.algorithm, null);
    assert.equal(view.public_key_available, Boolean(publicKey.trim()));
  }
});

test("GET /api/v1/platform/ssh-key answers 200 with the redacted view", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "airport-ssh-key-view-"));
  const privateKeyPath = path.join(dir, "id_ed25519");
  fs.writeFileSync(path.join(dir, "id_ed25519.pub"), `${PUBLIC_KEY_LINE}\n`, "utf8");

  const handle = createPlatformRoutes(
    platformTestContext({
      platformSshKeyState: async () => managedKeyState({ private_key_path: privateKeyPath }),
    }),
  );

  try {
    const response = await call(handle, { method: "GET", pathname: "/api/v1/platform/ssh-key" });
    assert.equal(response.status, 200);
    const key = response.payload.platform_ssh_key;
    assert.deepEqual(Object.keys(key).sort(), EXPECTED_VIEW_KEYS);
    assert.equal(key.fingerprint, FIXTURE_FINGERPRINT);
    assert.equal(key.private_key_dir_name, path.basename(dir), "只给目录名，不给绝对路径");
    assert.match(key.created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(key.updated_at, /^\d{4}-\d{2}-\d{2}T/);
    // birthtime/mtime 在同一时刻写入的文件上可以差几毫秒，只断言量级，不钉死相等
    assert.ok(Math.abs(Date.parse(key.updated_at) - Date.parse(key.created_at)) < 60000);
    assert.equal(JSON.stringify(response.payload).includes(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/v1/platform/ssh-key reports missing keys without failing", async () => {
  const handle = createPlatformRoutes(
    platformTestContext({
      platformSshKeyState: async () => ({
        ok: false,
        source: "missing",
        private_key_path: null,
        public_key: null,
        bootstrap_ready: false,
        reason_code: "platform_ssh_key_missing",
        note: null,
      }),
    }),
  );

  const response = await call(handle, { method: "GET", pathname: "/api/v1/platform/ssh-key" });
  assert.equal(response.status, 200);
  assert.equal(response.payload.platform_ssh_key.status, "missing");
  assert.equal(response.payload.platform_ssh_key.usable, false);
  assert.equal(response.payload.platform_ssh_key.created_at, null);
});

test("GET /api/v1/platform/ssh-key drops timestamps when the public key file is gone", async () => {
  const handle = createPlatformRoutes(
    platformTestContext({
      platformSshKeyState: async () =>
        managedKeyState({
          public_key: null,
          bootstrap_ready: false,
          reason_code: "platform_ssh_public_key_missing",
          private_key_path: path.join(os.tmpdir(), "airport-no-such-key-dir", "id_ed25519"),
        }),
    }),
  );

  const response = await call(handle, { method: "GET", pathname: "/api/v1/platform/ssh-key" });
  assert.equal(response.status, 200);
  assert.equal(response.payload.platform_ssh_key.created_at, null);
  assert.equal(response.payload.platform_ssh_key.updated_at, null);
  assert.equal(response.payload.platform_ssh_key.status, "partial");
});

test("POST /api/v1/platform/ssh-key/generate distinguishes conflict from bad request", async () => {
  const existing = createPlatformRoutes(
    platformTestContext({
      generateManagedPlatformSshKey: async () => {
        throw new Error("平台托管 SSH 密钥已存在，无需重复生成。");
      },
    }),
  );
  const existingResponse = await call(existing, {
    method: "POST",
    pathname: "/api/v1/platform/ssh-key/generate",
    body: {},
  });
  assert.equal(existingResponse.status, 409);
  assert.equal(existingResponse.payload.error, "conflict");

  const envManaged = createPlatformRoutes(
    platformTestContext({
      generateManagedPlatformSshKey: async () => {
        throw new Error("当前已通过环境变量托管平台 SSH 私钥，页面内不可生成新密钥。");
      },
    }),
  );
  const envResponse = await call(envManaged, {
    method: "POST",
    pathname: "/api/v1/platform/ssh-key/generate",
    body: {},
  });
  assert.equal(envResponse.status, 400);
  assert.equal(envResponse.payload.error, "bad_request");
});

test("mirror refuses an artifact version that would escape the artifacts dir", async () => {
  let mirrored = 0;
  const handle = createPlatformRoutes(
    platformTestContext({
      buildPublishDistribution: () => ({
        version: "../../../../tmp/airport-evil",
        variants: [{ target: "linux-amd64", enabled: true, effective_url: "https://example.invalid/x" }],
      }),
      mirrorPlatformSingBoxArtifact: async () => {
        mirrored += 1;
        return { target: "linux-amd64" };
      },
    }),
  );

  const response = await call(handle, {
    method: "POST",
    pathname: "/api/v1/platform/sing-box-distribution/mirror",
    body: { target: "linux-amd64" },
  });
  assert.equal(response.status, 400);
  assert.equal(response.payload.error, "validation_failed");
  assert.equal(mirrored, 0, "越界路径必须在下载之前就被挡下");
});

test("mirror keeps normal versions and refuses empty or unknown targets", async () => {
  const seen = [];
  const handle = createPlatformRoutes(
    platformTestContext({
      buildPublishDistribution: () => ({
        version: "1.13.19",
        variants: [{ target: "linux-amd64", enabled: true, effective_url: "https://example.invalid/x" }],
      }),
      mirrorPlatformSingBoxArtifact: async (target) => {
        // 与 domain 的 SUPPORTED_TARGETS 守卫同构：未知 target 在 fetch 之前就抛错（见
        // platform-sing-box-distribution.test.js 的「throws before touching the filesystem」用例）。
        if (!["linux-amd64", "linux-arm64"].includes(target)) {
          throw new Error(`unsupported sing-box target: ${target}`);
        }
        seen.push(target);
        return { target, version: "1.13.19" };
      },
    }),
  );

  const ok = await call(handle, {
    method: "POST",
    pathname: "/api/v1/platform/sing-box-distribution/sync",
    body: { target: "linux-amd64" },
  });
  assert.equal(ok.status, 201);
  assert.deepEqual(seen, ["linux-amd64"], "常规版本不能被守卫误挡");

  const blank = await call(handle, {
    method: "POST",
    pathname: "/api/v1/platform/sing-box-distribution/mirror",
    body: { target: "" },
  });
  assert.equal(blank.status, 400);
  assert.equal(blank.payload.error, "validation_failed");
  assert.deepEqual(blank.payload.details, ["target is required"]);
  assert.deepEqual(seen, ["linux-amd64"], "校验失败不能触发下载");

  const unsupported = await call(handle, {
    method: "POST",
    pathname: "/api/v1/platform/sing-box-distribution/mirror",
    body: { target: "linux-ppc64" },
  });
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.payload.error, "bad_request");
  assert.deepEqual(seen, ["linux-amd64"], "未知 target 由 domain 在下载前拒绝");
});
