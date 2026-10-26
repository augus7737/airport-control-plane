import test from "node:test";
import assert from "node:assert/strict";

import { createSharesDomain } from "../src/domain/shares/links.js";

const domain = createSharesDomain();
const target = {
  node_id: "node_us",
  label: "US: 33054\nunsafe",
  share_url:
    "vless://11111111-1111-4111-8111-111111111111@144.225.247.23:33054?encryption=none&type=tcp&security=none#US%3A%2033054%0Aunsafe",
};

test("Clash and Mihomo user agents receive YAML while generic clients keep URI links", () => {
  assert.equal(domain.resolveSubscriptionFormat(null, "Clash.Meta/1.19"), "clash");
  assert.equal(domain.resolveSubscriptionFormat(null, "mihomo/1.18"), "clash");
  assert.equal(domain.resolveSubscriptionFormat(null, "curl/8"), "links");
  assert.equal(domain.resolveSubscriptionFormat("clash", "curl/8"), "clash");
  assert.equal(domain.resolveSubscriptionFormat("links", "Clash.Meta/1.19"), "links");
});

test("Clash subscription is a YAML mapping with a usable VLESS proxy", () => {
  const yaml = domain.buildClashSubscriptionContent([target]);

  assert.match(yaml, /^mixed-port: 7890/m);
  assert.match(yaml, /^proxies:/m);
  assert.match(yaml, /type: "vless"/);
  assert.match(yaml, /server: "144\.225\.247\.23"/);
  assert.match(yaml, /port: 33054/);
  assert.match(yaml, /uuid: "11111111-1111-4111-8111-111111111111"/);
  assert.match(yaml, /network: "tcp"/);
  assert.match(yaml, /^proxy-groups:/m);
  assert.match(yaml, /^rules:/m);
  assert.doesNotMatch(yaml, /^vless:\/\//m);
  assert.match(yaml, /name: "US: 33054\\nunsafe"/, "remarks must stay inside a quoted scalar");
});

test("node-scoped Clash subscription excludes other nodes", () => {
  const yaml = domain.buildClashSubscriptionContent([
    target,
    { ...target, node_id: "node_other", share_url: target.share_url.replace("33054", "33055") },
  ], "node_us");

  assert.match(yaml, /port: 33054/);
  assert.doesNotMatch(yaml, /port: 33055/);
});
