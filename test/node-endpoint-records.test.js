import assert from "node:assert/strict";
import test from "node:test";

import { createNodeRecordBuilders } from "../src/domain/nodes/records.js";

function normalizeFacts(facts = {}, options = {}) {
  const existingFacts = options.existingFacts ?? {};
  return {
    hostname: facts.hostname ?? existingFacts.hostname ?? null,
    public_ipv4: facts.public_ipv4 ?? existingFacts.public_ipv4 ?? null,
    public_ipv6: facts.public_ipv6 ?? existingFacts.public_ipv6 ?? null,
    private_ipv4: facts.private_ipv4 ?? existingFacts.private_ipv4 ?? null,
    ssh_port: Number(facts.ssh_port ?? existingFacts.ssh_port ?? 22),
  };
}

function createBuilders() {
  let nextId = 1;
  return createNodeRecordBuilders({
    normalizeNodeFacts: normalizeFacts,
    createNodeId: () => `node-${nextId++}`,
    nowIso: () => "2026-08-21T00:00:00.000Z",
  });
}

test("manual node separates LXC management mapping from business and service endpoints", () => {
  const builders = createBuilders();

  const node = builders.buildManualNodeRecord({
    hostname: "br-lxc-1",
    public_ipv4: "203.0.113.10",
    private_ipv4: "10.0.3.5",
    ssh_port: 22,
    management: {
      ssh_host: "br1.example.test",
      ssh_port: 38022,
      ssh_internal_host: "10.0.3.5",
      ssh_internal_port: 22,
      ssh_user: "root",
      topology: "lxc",
    },
    networking: {
      entry_host: "br1.example.test",
      entry_port: 8443,
      internal_host: "10.0.3.5",
      internal_port: 443,
      topology: "nat",
    },
    endpoints: {
      service_listen: {
        host: "0.0.0.0",
        port: 443,
        protocol: "hysteria2",
      },
    },
  });

  assert.equal(node.facts.ssh_port, 22);
  assert.equal(node.management.ssh_port, 38022);
  assert.equal(node.endpoints.management.host, "br1.example.test");
  assert.equal(node.endpoints.management.port, 38022);
  assert.equal(node.endpoints.management.external_port, 38022);
  assert.equal(node.endpoints.management.internal_host, "10.0.3.5");
  assert.equal(node.endpoints.management.internal_port, 22);
  assert.equal(node.endpoints.management.topology, "lxc");

  assert.equal(node.endpoints.business_ingress.host, "br1.example.test");
  assert.equal(node.endpoints.business_ingress.port, 8443);
  assert.equal(node.endpoints.business_ingress.internal_port, 443);
  assert.equal(node.endpoints.business_ingress.topology, "nat");

  assert.equal(node.endpoints.service_listen.host, "0.0.0.0");
  assert.equal(node.endpoints.service_listen.port, 443);
  assert.equal(node.endpoints.service_listen.protocol, "hysteria2");
});

test("legacy SSH port is not serialized as service listen or business ingress port", () => {
  const builders = createBuilders();

  const node = builders.buildManualNodeRecord({
    hostname: "legacy-mapped",
    public_ipv4: "203.0.113.20",
    private_ipv4: "10.0.4.8",
    ssh_port: 38022,
  });

  assert.equal(node.management.ssh_port, 38022);
  assert.equal(node.endpoints.management.port, 38022);
  assert.equal(node.endpoints.business_ingress.port, null);
  assert.equal(node.endpoints.service_listen.port, null);
});

test("legacy migration creates endpoint records while preserving old management fields", () => {
  const builders = createBuilders();

  const migration = builders.migrateLegacyNodeManagementRecord({
    id: "node-old",
    ssh_host: "br1.example.test",
    ssh_port: 38022,
    facts: {
      hostname: "node-old",
      public_ipv4: "203.0.113.30",
      private_ipv4: "10.0.3.30",
      ssh_port: 22,
    },
    networking: {
      entry_host: "br1.example.test",
      entry_port: 8443,
      internal_host: "10.0.3.30",
      internal_port: 443,
    },
  });

  assert.equal(migration.changed, true);
  assert.equal(migration.node.management.ssh_host, "br1.example.test");
  assert.equal(migration.node.management.ssh_port, 38022);
  assert.equal(migration.node.management.ssh_internal_port, 22);
  assert.equal(migration.node.endpoints.management.external_port, 38022);
  assert.equal(migration.node.endpoints.management.internal_port, 22);
  assert.equal(migration.node.endpoints.business_ingress.external_port, 8443);
  assert.equal(migration.node.endpoints.business_ingress.internal_port, 443);
  assert.equal(migration.node.endpoints.service_listen.port, null);
});

test("asset update preserves explicit service listen while changing management mapping", () => {
  const builders = createBuilders();
  const existing = builders.buildManualNodeRecord({
    hostname: "node-update",
    public_ipv4: "203.0.113.40",
    private_ipv4: "10.0.5.40",
    ssh_port: 22,
    management: {
      ssh_host: "old.example.test",
      ssh_port: 22022,
      ssh_internal_port: 22,
    },
    endpoints: {
      service_listen: {
        port: 443,
      },
    },
  });

  const updated = builders.updateNodeAssetRecord(existing, {
    management: {
      ssh_host: "new.example.test",
      ssh_port: 38022,
      ssh_internal_port: 22,
    },
  });

  assert.equal(updated.management.ssh_host, "new.example.test");
  assert.equal(updated.management.ssh_port, 38022);
  assert.equal(updated.endpoints.management.external_host, "new.example.test");
  assert.equal(updated.endpoints.management.external_port, 38022);
  assert.equal(updated.endpoints.management.internal_port, 22);
  assert.equal(updated.endpoints.service_listen.port, 443);
});

test("asset update null legacy fields preserve explicit management business and service endpoints", () => {
  const builders = createBuilders();
  const existing = builders.buildManualNodeRecord({
    hostname: "node-explicit",
    public_ipv4: "203.0.113.50",
    private_ipv4: "10.0.6.50",
    ssh_port: 22,
    endpoints: {
      management: {
        host: "mgmt.example.test",
        port: 38022,
        internal_host: "10.0.6.50",
        internal_port: 22,
        topology: "lxc",
        ssh_user: "root",
      },
      business_ingress: {
        host: "biz.example.test",
        port: 8443,
        internal_host: "10.0.6.50",
        internal_port: 443,
        protocol: "hysteria2",
        topology: "nat",
      },
      service_listen: {
        host: "0.0.0.0",
        port: 443,
        protocol: "hysteria2",
      },
    },
  });

  const updated = builders.updateNodeAssetRecord(existing, {
    provider: "changed-provider",
    region: "US",
    ssh_host: null,
    entry_host: null,
    entry_port: null,
    internal_host: null,
    internal_port: null,
    listen_host: null,
    listen_port: null,
    service_listen_port: null,
    endpoints: {
      management: {
        host: null,
        port: null,
        internal_host: null,
        internal_port: null,
      },
      business_ingress: {
        host: null,
        port: null,
        internal_host: null,
        internal_port: null,
      },
      service_listen: {
        host: null,
        port: null,
      },
    },
  });

  assert.equal(updated.labels.provider, "changed-provider");
  assert.equal(updated.endpoints.management.host, "mgmt.example.test");
  assert.equal(updated.endpoints.management.port, 38022);
  assert.equal(updated.endpoints.management.internal_host, "10.0.6.50");
  assert.equal(updated.endpoints.management.internal_port, 22);
  assert.equal(updated.endpoints.management.topology, "lxc");
  assert.equal(updated.endpoints.management.ssh_user, "root");

  assert.equal(updated.endpoints.business_ingress.host, "biz.example.test");
  assert.equal(updated.endpoints.business_ingress.port, 8443);
  assert.equal(updated.endpoints.business_ingress.internal_host, "10.0.6.50");
  assert.equal(updated.endpoints.business_ingress.internal_port, 443);
  assert.equal(updated.endpoints.business_ingress.protocol, "hysteria2");
  assert.equal(updated.endpoints.business_ingress.topology, "nat");

  assert.equal(updated.endpoints.service_listen.host, "0.0.0.0");
  assert.equal(updated.endpoints.service_listen.port, 443);
  assert.equal(updated.endpoints.service_listen.protocol, "hysteria2");
});
