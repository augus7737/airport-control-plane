import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPlatformSingBoxDistributionDomain } from "../src/domain/platform/sing-box-distribution.js";

// 国内直连 GitHub Release 实测会挂在 ~30KB/s 上十多分钟；没有截止时间的 fetch 会把镜像同步
// 请求永久占住，而 curl 兜底路径早就带了 --max-time 300，两条路径必须同样有界。
test("mirror download passes a bounded abort signal to fetch", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "airport-mirror-test-"));
  let captured = null;
  const originalFetch = globalThis.fetch;
  const domain = createPlatformSingBoxDistributionDomain({
    artifactsDir: dir,
    distributionFile: path.join(dir, "platform-sing-box.json"),
    mkdir: fs.promises.mkdir,
    nowIso: () => "2026-09-22T00:00:00.000Z",
    spawn: () => {
      throw new Error("spawn should not be used in this test");
    },
    stat: async () => {
      throw new Error("stat is unused in this test");
    },
    writeFile: fs.promises.writeFile,
  });

  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  };

  try {
    await domain.mirrorArtifact("linux-arm64");
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.signal.aborted, false);
});
