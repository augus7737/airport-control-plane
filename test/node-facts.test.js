import test from "node:test";
import assert from "node:assert/strict";
import { isIP } from "node:net";

import { createNodeFactsDomain } from "../src/domain/nodes/facts.js";
import {
  isPublicIpv4,
  isPublicIpv6,
  normalizeIpLiteral,
  normalizeNullableString,
} from "../src/utils/network.js";

const factsDomain = createNodeFactsDomain({
  normalizeNullableString,
  normalizeIpLiteral,
  isIP,
  isPublicIpv4,
  isPublicIpv6,
});

test("normalizeNodeFacts preserves OS identity fields for template selection", () => {
  const facts = factsDomain.normalizeNodeFacts({
    hostname: "node-1",
    os_name: "Rocky Linux",
    os_id: "Rocky",
    os_family: "RHEL Fedora",
    os_version: "9.4",
    ssh_port: 22,
  });

  assert.equal(facts.os_name, "Rocky Linux");
  assert.equal(facts.os_id, "rocky");
  assert.equal(facts.os_family, "rhel fedora");
  assert.equal(facts.os_version, "9.4");
});

function createRegistryDomain(nodes) {
  return createNodeFactsDomain({
    normalizeNullableString,
    normalizeIpLiteral,
    isIP,
    isPublicIpv4,
    isPublicIpv6,
    store: new Map(nodes.map((node) => [node.id, node])),
    index: new Map(),
  });
}

test("registration adopts a manual node when hostname and public address both match", () => {
  const manualNode = {
    id: "node-manual",
    source: "manual",
    fingerprint: null,
    facts: { hostname: "us-n1", public_ipv4: "64.112.41.173" },
  };
  const domain = createRegistryDomain([manualNode]);

  const matched = domain.findExistingBootstrapNode({
    fingerprint: "sha256:new-fingerprint",
    facts: { hostname: "US-N1", public_ipv4: "64.112.41.173", os_id: "debian" },
  });

  assert.equal(matched, manualNode);
});

test("registration does not adopt a manual node on hostname or address alone", () => {
  const domain = createRegistryDomain([
    {
      id: "node-other-address",
      source: "manual",
      facts: { hostname: "us-n1", public_ipv4: "203.0.113.9" },
    },
    {
      id: "node-other-hostname",
      source: "manual",
      facts: { hostname: "us-n2", public_ipv4: "64.112.41.173" },
    },
  ]);

  const matched = domain.findExistingBootstrapNode({
    fingerprint: "sha256:new-fingerprint",
    facts: { hostname: "us-n1", public_ipv4: "64.112.41.173" },
  });

  assert.equal(matched, null);
});

test("registration prefers a bootstrap node over an equally matching manual node", () => {
  const bootstrapNode = {
    id: "node-bootstrap",
    source: "bootstrap",
    facts: { hostname: "us-n1", public_ipv4: "64.112.41.173" },
  };
  const domain = createRegistryDomain([
    {
      id: "node-manual",
      source: "manual",
      facts: { hostname: "us-n1", public_ipv4: "64.112.41.173" },
    },
    bootstrapNode,
  ]);

  const matched = domain.findExistingBootstrapNode({
    fingerprint: "sha256:new-fingerprint",
    facts: { hostname: "us-n1", public_ipv4: "64.112.41.173" },
  });

  assert.equal(matched, bootstrapNode);
});

test("registration does not adopt ambiguous manual matches", () => {
  const domain = createRegistryDomain([
    {
      id: "node-manual-a",
      source: "manual",
      facts: { hostname: "us-n1", public_ipv4: "64.112.41.173" },
    },
    {
      id: "node-manual-b",
      source: "manual",
      facts: { hostname: "us-n1", public_ipv4: "64.112.41.173" },
    },
  ]);

  const matched = domain.findExistingBootstrapNode({
    fingerprint: "sha256:new-fingerprint",
    facts: { hostname: "us-n1", public_ipv4: "64.112.41.173" },
  });

  assert.equal(matched, null);
});
