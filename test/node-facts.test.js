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
