import test from "node:test";
import assert from "node:assert/strict";

import { createTrafficRouteDomain } from "../src/domain/routes/traffic.js";

const { resolveTrafficRoute } = createTrafficRouteDomain({
  samePrivateIpv4Subnet: () => true,
});

const profile = {
  id: "profile_vless_reality",
  protocol: "vless",
  listen_port: 443,
  transport: "tcp",
};

test("direct traffic routes infer international egress and expose stable route health input", () => {
  const node = {
    id: "node_us_1",
    name: "US node",
    region: "US",
    facts: {
      public_ipv4: "203.0.113.10",
    },
    networking: {
      access_mode: "direct",
      entry_region: "中国大陆",
    },
  };

  const route = resolveTrafficRoute(node, [node], profile);

  assert.equal(route.publishable, true);
  assert.equal(route.route_direction, "international_egress");
  assert.equal(route.route_direction_source, "inferred");
  assert.equal(route.entry_port, 443);
  assert.equal(route.route_identity.route_direction, "international_egress");
  assert.equal(route.route_identity.entry_node_id, "node_us_1");
  assert.equal(route.health_input.route_id, route.route_id);
  assert.deepEqual(route.health_input.entry_target, {
    host: "203.0.113.10",
    port: 443,
    family: "ipv4",
    source: "public_ipv4",
    network_protocol: "tcp",
  });
});

test("relay traffic routes default to regional transit when not crossing mainland China", () => {
  const entryNode = {
    id: "node_hkg_1",
    name: "Hong Kong relay",
    region: "HKG",
    facts: {
      public_ipv4: "203.0.113.20",
      private_ipv4: "10.0.0.2",
    },
  };
  const landingNode = {
    id: "node_jp_1",
    name: "Japan landing",
    region: "JP",
    facts: {
      public_ipv4: "203.0.113.30",
      private_ipv4: "10.0.0.3",
    },
    networking: {
      access_mode: "relay",
      entry_region: "香港",
      relay_node_id: "node_hkg_1",
      entry_port: 8443,
    },
  };

  const route = resolveTrafficRoute(landingNode, [entryNode, landingNode], profile);

  assert.equal(route.publishable, true);
  assert.equal(route.route_direction, "regional_transit");
  assert.equal(route.route_direction_source, "inferred");
  assert.equal(route.access_mode, "relay");
  assert.equal(route.entry_port, 8443);
  assert.equal(route.route_identity.relay_node_id, "node_hkg_1");
  assert.equal(route.route_identity.relay_upstream_host, "10.0.0.3");
  assert.equal(route.health_input.relay_upstream_target.host, "10.0.0.3");
});

test("NAT mapped direct routes use public entry port and normalize explicit return direction", () => {
  const node = {
    id: "node_cn_lxc",
    name: "CN LXC",
    region: "CN",
    facts: {
      public_ipv4: "203.0.113.40",
    },
    networking: {
      access_mode: "direct",
      entry_region: "BRA",
      entry_port: "56316",
      nat_mode: "port_mapping",
      route_direction: "Return-To-China",
    },
  };

  const route = resolveTrafficRoute(node, [node], profile);

  assert.equal(route.publishable, true);
  assert.equal(route.route_direction, "return_to_china");
  assert.equal(route.route_direction_source, "explicit");
  assert.equal(route.requested_route_direction, "Return-To-China");
  assert.equal(route.entry_port, 56316);
  assert.equal(route.nat_mode, "port_mapping");
  assert.equal(route.route_identity.entry_port, 56316);
  assert.equal(route.health_input.entry_target.port, 56316);
});

test("traffic routes prefer business ingress external endpoint over node public facts", () => {
  const node = {
    id: "node_lxc_business",
    name: "LXC business ingress",
    region: "US",
    facts: {
      public_ipv4: "203.0.113.60",
    },
    networking: {
      access_mode: "direct",
      entry_region: "中国大陆",
      entry_port: 443,
    },
    endpoints: {
      business_ingress: {
        external_host: "198.51.100.61",
        external_port: 56316,
        internal_host: "10.88.0.12",
        internal_port: 443,
        family: "ipv4",
        topology: "lxc",
      },
    },
  };

  const route = resolveTrafficRoute(node, [node], profile);

  assert.equal(route.publishable, true);
  assert.equal(route.entry_endpoint.host, "198.51.100.61");
  assert.equal(route.entry_port, 56316);
  assert.equal(route.route_identity.entry_host, "198.51.100.61");
  assert.equal(route.route_identity.entry_port, 56316);
  assert.deepEqual(route.health_input.entry_target, {
    host: "198.51.100.61",
    port: 56316,
    family: "ipv4",
    source: "endpoints.business_ingress.external",
    network_protocol: "tcp",
  });
});

test("invalid route directions fail validation without removing inferred identity fields", () => {
  const node = {
    id: "node_invalid_direction",
    name: "Invalid direction",
    region: "US",
    facts: {
      public_ipv4: "203.0.113.50",
    },
    networking: {
      access_mode: "direct",
      entry_region: "中国大陆",
      route_direction: "moon-path",
    },
  };

  const route = resolveTrafficRoute(node, [node], profile);

  assert.equal(route.publishable, false);
  assert.equal(route.route_direction, "international_egress");
  assert.equal(route.route_direction_source, "inferred");
  assert.equal(route.requested_route_direction, "moon-path");
  assert.deepEqual(route.problems, ["route_direction_invalid"]);
  assert.equal(route.route_identity.route_direction, "international_egress");
  assert.equal(route.health_input.route_direction, "international_egress");
});
