import test from "node:test";
import assert from "node:assert/strict";

import { createPlatformSingBoxDistributionDomain } from "../src/domain/platform/sing-box-distribution.js";

const domain = createPlatformSingBoxDistributionDomain({
  artifactsDir: "/tmp/airport-artifacts",
  distributionFile: "/tmp/airport-artifacts/platform-sing-box.json",
  mkdir: async () => {},
  nowIso: () => "2026-09-22T00:00:00.000Z",
  spawn: async () => ({ code: 0 }),
  stat: async () => {
    throw new Error("stat is unused in this test");
  },
  writeFile: async () => {},
});

test("sing-box upstream resolves to the GitHub release asset", () => {
  assert.equal(
    domain.buildUpstreamUrl("1.13.19", "linux-arm64"),
    "https://github.com/SagerNet/sing-box/releases/download/v1.13.19/sing-box-1.13.19-linux-arm64.tar.gz",
  );
});

test("a v-prefixed version collapses to the same release URL", () => {
  assert.equal(
    domain.buildUpstreamUrl("v1.13.19", "linux-amd64"),
    domain.buildUpstreamUrl("1.13.19", "linux-amd64"),
  );
});
