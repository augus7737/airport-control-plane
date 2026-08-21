import assert from "node:assert/strict";
import test from "node:test";

import { createPlatformSshDomain } from "../src/domain/platform/ssh.js";

const baseNode = {
  id: "node-1",
  labels: {
    provider: "test",
    region: "us",
  },
  management: {
    access_mode: "direct",
  },
  facts: {
    hostname: "node-1",
  },
};

function createDomain(options = {}) {
  const {
    baseEnv = {},
    envPlatformSshPrivateKeyPath = null,
    keyFileExists = false,
    route = {
      access_mode: "direct",
      target: {
        host: "203.0.113.10",
        port: 38022,
      },
      route_label: "public",
      ssh_user: "root",
      relay_strategy: null,
      strategy_candidates: [],
      relay_node: null,
      relay_target: null,
      proxy_target: null,
      problems: [],
    },
  } = options;

  return createPlatformSshDomain({
    cwdProvider: () => process.cwd(),
    defaultNodeSshUser: "root",
    demoShellBinary: "sh",
    envPlatformPublicKey: null,
    envPlatformSshPrivateKeyPath,
    baseEnv,
    managedPlatformSshDir: "/tmp/airport-ssh",
    managedPlatformSshPrivateKeyPath: "/tmp/airport-ssh/id_ed25519",
    managedPlatformSshPublicKeyPath: "/tmp/airport-ssh/id_ed25519.pub",
    mkdir: async () => {},
    normalizeNullableString: (value) => {
      const normalized = String(value ?? "").trim();
      return normalized || null;
    },
    readFile: async () => {
      throw new Error("not found");
    },
    resolveManagementRoute: () => route,
    shellSessionLabel: (node) => node?.facts?.hostname || node?.id || "unknown",
    spawn: () => {
      throw new Error("spawn should not be called by these safety checks");
    },
    sshConnectTimeoutSeconds: 5,
    stat: async () => {
      if (!keyFileExists) {
        throw new Error("not found");
      }

      return {
        isFile: () => true,
      };
    },
  });
}

test("execution transport is null when the platform SSH key is missing", async () => {
  const domain = createDomain();

  assert.equal(await domain.resolveExecutionTransport(baseNode), null);

  const context = await domain.resolveNodeSshTransport(baseNode);
  assert.equal(context.status, "blocked");
  assert.equal(context.reason_code, "platform_ssh_key_missing");
  assert.equal(context.transport, null);
});

test("web shell transport is null when the node target is missing", async () => {
  const domain = createDomain({
    envPlatformSshPrivateKeyPath: "/tmp/platform-key",
    keyFileExists: true,
    route: {
      access_mode: "direct",
      target: null,
      problems: ["public_ipv4_missing"],
      relay_node: null,
      relay_target: null,
      proxy_target: null,
      relay_strategy: null,
      strategy_candidates: [],
    },
  });

  assert.equal(await domain.resolveShellTransport(baseNode), null);

  const context = await domain.resolveNodeSshTransport(baseNode, {
    allowDemoFallback: true,
  });
  assert.equal(context.status, "blocked");
  assert.equal(context.reason_code, "probe_target_missing");
  assert.equal(context.transport, null);
});

test("local demo transport requires both explicit option and disabled-by-default env flag", async () => {
  const disabledDomain = createDomain({
    baseEnv: {
      AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT: "false",
    },
  });
  const disabled = await disabledDomain.resolveNodeSshTransport(baseNode, {
    allowDemoFallback: true,
  });
  assert.equal(disabled.status, "blocked");
  assert.equal(disabled.transport, null);

  const enabledDomain = createDomain({
    baseEnv: {
      AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT: "true",
    },
  });
  const enabled = await enabledDomain.resolveNodeSshTransport(baseNode, {
    allowDemoFallback: true,
  });
  assert.equal(enabled.status, "demo");
  assert.equal(enabled.transport.kind, "local-demo");
  assert.equal(enabled.transport.command, "sh");
});

test("direct SSH transport remains available when key and target are usable", async () => {
  const domain = createDomain({
    envPlatformSshPrivateKeyPath: "/tmp/platform-key",
    keyFileExists: true,
  });

  const context = await domain.resolveNodeSshTransport(baseNode);

  assert.equal(context.status, "ready");
  assert.equal(context.transport.kind, "ssh-direct");
  assert.equal(context.transport.command, "ssh");
  assert.deepEqual(context.target, {
    host: "203.0.113.10",
    port: 38022,
  });
  assert.ok(context.transport.args.includes("-i"));
  assert.ok(context.transport.args.includes("/tmp/platform-key"));
  assert.ok(context.transport.args.includes("-p"));
  assert.ok(context.transport.args.includes("38022"));
  assert.ok(context.transport.args.includes("root@203.0.113.10"));
});
