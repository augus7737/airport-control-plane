import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPlatformSingBoxDistributionDomain } from "../src/domain/platform/sing-box-distribution.js";

const SUPPORTED_TARGETS = ["linux-amd64", "linux-arm64"];

function makeDomain(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "airport-singbox-domain-"));
  let ticks = 0;
  const domain = createPlatformSingBoxDistributionDomain({
    artifactsDir: path.join(dir, "artifacts", "sing-box"),
    distributionFile: path.join(dir, "platform-sing-box.json"),
    mkdir: fs.promises.mkdir,
    nowIso: () => `2026-09-23T00:00:${String(ticks++).padStart(2, "0").slice(-2)}.000Z`,
    spawn: () => {
      throw new Error("curl fallback must not run in this test");
    },
    stat: fs.promises.stat,
    writeFile: fs.promises.writeFile,
    ...overrides,
  });

  return {
    dir,
    domain,
    artifactsDir: path.join(dir, "artifacts", "sing-box"),
    distributionFile: path.join(dir, "platform-sing-box.json"),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function inside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

async function withFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };

  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

function respondWith(buffer) {
  return async () => ({
    ok: true,
    arrayBuffer: async () => Uint8Array.from(buffer).buffer,
  });
}

test("distribution loads a default record and persists it", async () => {
  const fixture = makeDomain();
  try {
    const loaded = await fixture.domain.loadDistribution();
    assert.equal(loaded.version, "1.13.19");
    assert.equal(loaded.enabled, true);
    assert.equal(loaded.install_path, "/usr/local/bin/sing-box");
    assert.deepEqual(Object.keys(loaded.variants).sort(), [...SUPPORTED_TARGETS].sort());
    assert.ok(fs.existsSync(fixture.distributionFile), "首启必须落一份配置");
    assert.equal(fixture.domain.getDistribution().created_at, loaded.created_at);
  } finally {
    fixture.cleanup();
  }
});

// 未知 target 必须在发起下载之前被拒（这条守卫同时是矩阵行 `{"target":"unsupported-target"}`
// 不会打外网的依据）；镜像目录由 loadDistribution 落配置时创建，所以只断言没有开新版本目录。
test("unsupported targets are refused before any download or write", async () => {
  const fixture = makeDomain();
  try {
    await fixture.domain.loadDistribution();

    await assert.rejects(
      withFetch(
        async () => {
          throw new Error("fetch must not run for an unsupported target");
        },
        () => fixture.domain.mirrorArtifact("linux-ppc64"),
      ),
      /unsupported sing-box target: linux-ppc64/,
    );

    assert.equal(fs.existsSync(path.join(fixture.artifactsDir, "1.13.19")), false, "拒绝时不得开目标目录");
    assert.equal(fixture.domain.getDistribution().variants["linux-amd64"].mirror_available, false);
  } finally {
    fixture.cleanup();
  }
});

test("mirror target path never leaves the artifacts dir", async () => {
  const fixture = makeDomain();
  try {
    await fixture.domain.loadDistribution();

    // artifactFilePath 用的是 path.join，本身不吸收 `..`：target 轴由 mirrorArtifact 的
    // SUPPORTED_TARGETS 白名单锁死，version 轴必须由调用点锁（本模块 mirror 路由的
    // isSafeArtifactVersion + server.js 下载路由的 resolve+前缀判断）。这里断言的是
    // 「调用点放行的合法取值」这一整族输入仍然锁在目录内。
    for (const version of ["1.13.19", "1.13.19-alpha+build.9", "1.14.0", "2.0"]) {
      for (const target of SUPPORTED_TARGETS) {
        const filePath = fixture.domain.artifactFilePath(version, target);
        assert.ok(inside(fixture.artifactsDir, filePath), `${version}/${target} must stay inside`);
        assert.equal(path.basename(filePath), `sing-box-${version}-${target}.tar.gz`);
        // 只允许 <artifacts>/<version>/<target>/<file> 四段，多一段都算越界
        assert.equal(path.relative(fixture.artifactsDir, filePath).split(path.sep).length, 3);
      }
    }

    // v 前缀是 UI 常见输入，必须与不带 v 的形态解析到同一条路径
    assert.equal(
      fixture.domain.artifactFilePath("v1.13.19", "linux-amd64"),
      fixture.domain.artifactFilePath("1.13.19", "linux-amd64"),
    );
  } finally {
    fixture.cleanup();
  }
});

test("mirrorArtifact writes inside the artifacts dir and records the digest", async () => {
  const fixture = makeDomain();
  try {
    await fixture.domain.loadDistribution();
    const payload = Buffer.from("sing-box-fixture-bytes");

    const { result, calls } = await withFetch(respondWith(payload), () =>
      fixture.domain.mirrorArtifact("linux-arm64"),
    );

    assert.equal(calls.length, 1);
    assert.equal(result.target, "linux-arm64");
    assert.equal(result.sha256, createHash("sha256").update(payload).digest("hex"));
    assert.equal(result.size_bytes, payload.byteLength);
    assert.equal(result.version, "1.13.19");
    assert.equal(result.file_name, "sing-box-1.13.19-linux-arm64.tar.gz");
    assert.ok(inside(fixture.artifactsDir, result.file_path));
    assert.ok(fs.existsSync(result.file_path), "制品必须落在解析后的目标路径上");

    const variant = fixture.domain.getDistribution().variants["linux-arm64"];
    assert.equal(variant.mirror_available, true);
    assert.equal(variant.mirror_sha256, result.sha256);
    assert.equal(variant.mirror_size_bytes, payload.byteLength);

    const serialized = fixture.domain.serializeDistribution("http://127.0.0.1:8091");
    const arm = serialized.variants.find((item) => item.target === "linux-arm64");
    assert.equal(arm.source_mode, "platform-mirror");
    assert.equal(
      arm.mirrored_url,
      "http://127.0.0.1:8091/api/v1/artifacts/sing-box/1.13.19/linux-arm64",
    );
    assert.equal(arm.effective_url, arm.mirrored_url);
    assert.equal(arm.effective_sha256, result.sha256);

    const amd = serialized.variants.find((item) => item.target === "linux-amd64");
    assert.equal(amd.source_mode, "upstream");
    assert.equal(amd.mirrored_url, null);
    assert.match(amd.effective_url, /^https:\/\/github\.com\/SagerNet\/sing-box\/releases\/download\/v1\.13\.19\//);
  } finally {
    fixture.cleanup();
  }
});

// fetch 失败后 domain 会退回 curl 子进程；这里用假子进程把两条失败路径都钉住：
// 既不能真的起 curl（用例不打外网），也不能留下半截镜像状态。
test("download failures propagate through the curl fallback without persisting a mirror", async () => {
  const attempted = [];
  const fixture = makeDomain({
    spawn: (command, args) => {
      attempted.push({ command, args });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setImmediate(() => child.emit("error", new Error("curl unavailable in test")));
      return child;
    },
  });
  try {
    await fixture.domain.loadDistribution();
    const before = JSON.stringify(fixture.domain.getDistribution());

    await assert.rejects(
      withFetch(
        async () => {
          throw new Error("upstream unreachable");
        },
        () => fixture.domain.mirrorArtifact("linux-amd64"),
      ),
      /curl unavailable in test/,
    );

    assert.equal(attempted.length, 1, "fetch 失败后只兜底一次");
    assert.equal(attempted[0].command, "curl");
    assert.ok(attempted[0].args.includes("--max-time"), "兜底 curl 必须有截止时间");
    assert.ok(attempted[0].args.includes("--connect-timeout"), "兜底 curl 必须有连接超时");

    assert.equal(JSON.stringify(fixture.domain.getDistribution()), before);
    assert.equal(fs.existsSync(path.join(fixture.artifactsDir, "1.13.19")), false, "失败不得建目录");
  } finally {
    fixture.cleanup();
  }
});

test("a missing mirrored artifact falls back to upstream on load", async () => {
  const fixture = makeDomain();
  try {
    await fixture.domain.loadDistribution();
    await fixture.domain.updateDistribution({
      variants: {
        "linux-amd64": {
          mirror_available: true,
          mirror_sha256: "a".repeat(64),
          mirror_size_bytes: 10,
          mirror_downloaded_at: "2026-09-22T00:00:00.000Z",
        },
      },
    });

    const reloaded = await fixture.domain.loadDistribution();
    const variant = reloaded.variants["linux-amd64"];
    assert.equal(variant.mirror_available, false);
    assert.equal(variant.mirror_sha256, null);
    assert.equal(variant.mirror_size_bytes, null);
    assert.equal(variant.mirror_downloaded_at, null);
    assert.match(variant.note, /镜像文件缺失/);
  } finally {
    fixture.cleanup();
  }
});

test("version switch resets every variant to the new release", async () => {
  const fixture = makeDomain();
  try {
    await fixture.domain.loadDistribution();
    await fixture.domain.updateDistribution({
      variants: {
        "linux-amd64": {
          upstream_url: "https://mirror.example.invalid/custom.tar.gz",
          upstream_sha256: "b".repeat(64),
          note: "自定义上游",
        },
      },
    });

    const next = await fixture.domain.updateDistribution({ version: "v1.14.0" });
    assert.equal(next.version, "1.14.0", "v 前缀归一后入库");

    for (const target of SUPPORTED_TARGETS) {
      const variant = next.variants[target];
      assert.equal(variant.upstream_url, fixture.domain.buildUpstreamUrl("1.14.0", target));
      assert.equal(variant.upstream_sha256, null, "换版本必须丢掉旧版本的定制上游与校验值");
      assert.equal(variant.mirror_available, false);
      assert.equal(variant.note, null);
      assert.ok(inside(fixture.artifactsDir, fixture.domain.artifactFilePath(next.version, target)));
    }
  } finally {
    fixture.cleanup();
  }
});

test("changing the upstream invalidates the recorded mirror", async () => {
  const fixture = makeDomain();
  try {
    await fixture.domain.loadDistribution();
    const mirrored = await fixture.domain.updateDistribution({
      variants: {
        "linux-amd64": {
          mirror_available: true,
          mirror_sha256: "c".repeat(64),
          mirror_size_bytes: 42,
          mirror_downloaded_at: "2026-09-22T00:00:00.000Z",
        },
      },
    });
    assert.equal(mirrored.variants["linux-amd64"].mirror_available, true);
    assert.equal(mirrored.variants["linux-amd64"].mirror_size_bytes, 42);

    const reupstreamed = await fixture.domain.updateDistribution({
      variants: { "linux-amd64": { upstream_url: "https://mirror.example.invalid/other.tar.gz" } },
    });
    const variant = reupstreamed.variants["linux-amd64"];
    assert.equal(variant.upstream_url, "https://mirror.example.invalid/other.tar.gz");
    assert.equal(variant.mirror_available, false, "上游一变，镜像可信度即失效");
    assert.equal(variant.mirror_sha256, null);
    assert.equal(variant.mirror_size_bytes, null);
    assert.equal(variant.mirror_downloaded_at, null);

    const disabled = await fixture.domain.updateDistribution({
      variants: {
        "linux-amd64": {
          mirror_available: false,
          mirror_sha256: "d".repeat(64),
          mirror_size_bytes: 7,
        },
      },
    });
    assert.equal(disabled.variants["linux-amd64"].mirror_sha256, null, "镜像不可用时不得残留校验值");
    assert.equal(disabled.variants["linux-amd64"].mirror_size_bytes, null);
  } finally {
    fixture.cleanup();
  }
});

test("distribution update keeps untouched fields and normalizes blanks", async () => {
  const fixture = makeDomain();
  try {
    const first = await fixture.domain.loadDistribution();
    const next = await fixture.domain.updateDistribution({
      enabled: false,
      install_path: "   ",
      upstream_sha256_ignored: "unknown key",
      variants: { "linux-amd64": { enabled: false }, "windows-386": { enabled: true } },
    });

    assert.equal(next.enabled, false);
    assert.equal(next.install_path, "/usr/local/bin/sing-box", "空白路径回退默认值而不是写空串");
    assert.equal(next.version, first.version, "未提交版本时保持原版本");
    assert.equal(next.created_at, first.created_at, "created_at 不随更新漂移");
    assert.notEqual(next.updated_at, first.updated_at);
    assert.deepEqual(Object.keys(next.variants).sort(), [...SUPPORTED_TARGETS].sort());
    assert.equal(next.variants["linux-amd64"].enabled, false);
    assert.equal(next.variants["linux-arm64"].enabled, true, "未提及的 target 不受影响");
    assert.equal(
      next.variants["linux-arm64"].upstream_url,
      first.variants["linux-arm64"].upstream_url,
    );
  } finally {
    fixture.cleanup();
  }
});

test("non-object payloads fall back to a normalized re-write", async () => {
  const fixture = makeDomain();
  try {
    await fixture.domain.loadDistribution();
    for (const payload of [null, undefined, [], "1.14.0", 42]) {
      const next = await fixture.domain.updateDistribution(payload);
      assert.equal(next.version, "1.13.19");
      assert.deepEqual(Object.keys(next.variants).sort(), [...SUPPORTED_TARGETS].sort());
    }
  } finally {
    fixture.cleanup();
  }
});

test("publish distribution only exposes enabled variants with a usable url", async () => {
  const fixture = makeDomain();
  try {
    await fixture.domain.loadDistribution();
    const full = fixture.domain.buildPublishDistribution("http://127.0.0.1:8091");
    assert.deepEqual(
      full.variants.map((variant) => variant.target),
      [...SUPPORTED_TARGETS],
    );

    await fixture.domain.updateDistribution({
      variants: { "linux-amd64": { enabled: false }, "linux-arm64": { enabled: false } },
    });
    assert.deepEqual(fixture.domain.buildPublishDistribution(null).variants, []);

    await fixture.domain.updateDistribution({ variants: { "linux-amd64": { enabled: true } } });
    const partial = fixture.domain.buildPublishDistribution(null);
    assert.deepEqual(partial.variants.map((variant) => variant.target), ["linux-amd64"]);
    assert.equal(partial.enabled, true);
    assert.equal(partial.install_path, "/usr/local/bin/sing-box");
  } finally {
    fixture.cleanup();
  }
});

test("public artifact path percent-encodes both segments", () => {
  const fixture = makeDomain();
  try {
    assert.equal(
      fixture.domain.artifactPublicPath("1.13.19", "linux-amd64"),
      "/api/v1/artifacts/sing-box/1.13.19/linux-amd64",
    );
    const tricky = fixture.domain.artifactPublicPath("1.2 3/4", "linux amd64");
    assert.equal(tricky.includes(" "), false);
    assert.equal(tricky.includes("/4"), false, "版本里的斜杠必须被编码进单段");
  } finally {
    fixture.cleanup();
  }
});
