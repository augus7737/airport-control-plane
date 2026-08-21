import test from "node:test";
import assert from "node:assert/strict";

import { createManagementRouteDomain } from "../src/domain/routes/management.js";

function createDomain(nodes = [], options = {}) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return createManagementRouteDomain({
    defaultNodeSshUser: "root",
    getNodeById: (nodeId) => nodeMap.get(nodeId) ?? null,
    getPreferredLanIpv4: () => options.preferredLanIpv4 ?? null,
    samePrivateIpv4Subnet: options.samePrivateIpv4Subnet ?? (() => false),
  });
}

function buildLxcNode(overrides = {}) {
  return {
    id: "node_lxc_1",
    name: "LXC node",
    facts: {
      public_ipv4: "203.0.113.70",
      private_ipv4: "10.88.0.12",
      ssh_port: 38022,
    },
    management: {
      access_mode: "direct",
      ssh_port: 38022,
    },
    endpoints: {
      management: {
        external_host: "198.51.100.70",
        external_port: 38022,
        internal_host: "10.88.0.12",
        internal_port: 22,
        topology: "lxc",
      },
    },
    ...overrides,
  };
}

test("LXC direct management route uses external mapped SSH port", () => {
  const node = buildLxcNode();
  const domain = createDomain([node]);

  const route = domain.resolveManagementRoute(node);

  assert.equal(route.access_mode, "direct");
  assert.equal(route.target.host, "198.51.100.70");
  assert.equal(route.target.port, 38022);
  assert.equal(route.target.family, "ipv4");
  assert.equal(route.target.source, "endpoints.management.external");
  assert.deepEqual(route.problems, []);
});

test("relay management route uses target internal host and SSH port 22 when private network is reachable", () => {
  const relayNode = {
    id: "node_relay_1",
    name: "Relay node",
    facts: {
      public_ipv4: "203.0.113.80",
      private_ipv4: "10.88.0.2",
      ssh_port: 22,
    },
    management: {
      access_mode: "direct",
      ssh_port: 22,
    },
    endpoints: {
      management: {
        external_host: "203.0.113.80",
        external_port: 22,
        internal_host: "10.88.0.2",
        internal_port: 22,
      },
    },
  };
  const landingNode = buildLxcNode({
    management: {
      access_mode: "relay",
      relay_node_id: "node_relay_1",
      relay_strategy: "auto",
      ssh_port: 38022,
    },
  });
  const domain = createDomain([relayNode, landingNode], {
    samePrivateIpv4Subnet: () => true,
  });

  const route = domain.resolveManagementRoute(landingNode);

  assert.equal(route.access_mode, "relay");
  assert.equal(route.relay_node.id, "node_relay_1");
  assert.equal(route.target.host, "10.88.0.12");
  assert.equal(route.target.port, 22);
  assert.equal(route.target.family, "ipv4");
  assert.equal(route.target.source, "endpoints.management.internal");
  assert.deepEqual(route.problems, []);
});
