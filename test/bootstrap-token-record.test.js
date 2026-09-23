import test from "node:test";
import assert from "node:assert/strict";

import { createBootstrapTokenDomain } from "../src/domain/bootstrap/tokens.js";

function createDomain({ uuids } = {}) {
  let uuidCounter = 0;
  const queue = Array.isArray(uuids) ? [...uuids] : null;
  const domain = createBootstrapTokenDomain({
    store: new Map(),
    index: new Map(),
    bootstrapTokensFile: "/tmp/unused-bootstrap-tokens.json",
    ensureDataDir: async () => {},
    randomUUID: () =>
      queue
        ? queue.shift()
        : `11111111-1111-4111-8111-${String(++uuidCounter).padStart(12, "0")}`,
    nowIso: () => "2026-09-23T00:00:00.000Z",
    nowMs: () => Date.parse("2026-09-23T00:00:00.000Z"),
  });

  return domain;
}

test("POST-side record ignores client supplied id and audit fields", () => {
  const domain = createDomain();

  const record = domain.buildBootstrapTokenRecord({
    id: "token_existing",
    label: "接管令牌",
    created_at: "2020-01-01T00:00:00.000Z",
    uses: 99,
    last_used_at: "2020-01-02T00:00:00.000Z",
    last_used_node_id: "node_forged",
  });

  assert.notEqual(record.id, "token_existing");
  assert.match(record.id, /^token_/);
  assert.equal(record.created_at, "2026-09-23T00:00:00.000Z");
  assert.equal(record.uses, 0);
  assert.equal(record.last_used_at, null);
  assert.equal(record.last_used_node_id, null);
  assert.equal(record.label, "接管令牌");
});

test("client supplied token value is still honoured on create", () => {
  const domain = createDomain();

  const record = domain.buildBootstrapTokenRecord({ token: "custombootstraptokenvalue" });

  assert.equal(record.token, "custombootstraptokenvalue");
});

test("generated token values skip collisions with the existing index", () => {
  const domain = createDomain({
    uuids: [
      "aaaa1111bbbb2222cccc3333dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "bbbb1111bbbb2222cccc3333eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    ],
  });
  domain.registerBootstrapToken({ id: "token_seed", token: "aaaa1111bbbb2222cccc3333", status: "active" });

  const record = domain.buildBootstrapTokenRecord({ label: "one" });

  assert.equal(record.token, "bbbb1111bbbb2222cccc3333");
});

test("PATCH record cannot forge usage history but keeps editable fields", () => {
  const domain = createDomain();
  const existing = {
    id: "token_existing",
    token: "existingtokenvalue",
    label: "旧标签",
    status: "active",
    created_at: "2026-09-01T00:00:00.000Z",
    expires_at: null,
    max_uses: 5,
    uses: 0,
    last_used_at: null,
    last_used_node_id: null,
    note: null,
  };

  const updated = domain.buildBootstrapTokenRecord(
    {
      label: "新标签",
      status: "disabled",
      expires_at: "2026-10-01T00:00:00Z",
      max_uses: 2,
      note: "巡检用",
      id: "token_hijack",
      token: "hijacked",
      uses: 42,
      last_used_at: "2026-09-20T00:00:00.000Z",
      last_used_node_id: "node_forged",
      created_at: "2020-01-01T00:00:00.000Z",
    },
    existing,
  );

  assert.equal(updated.id, "token_existing");
  assert.equal(updated.token, "existingtokenvalue");
  assert.equal(updated.created_at, "2026-09-01T00:00:00.000Z");
  assert.equal(updated.uses, 0);
  assert.equal(updated.last_used_at, null);
  assert.equal(updated.last_used_node_id, null);
  assert.equal(updated.label, "新标签");
  assert.equal(updated.status, "disabled");
  assert.equal(updated.expires_at, "2026-10-01T00:00:00.000Z");
  assert.equal(updated.max_uses, 2);
  assert.equal(updated.note, "巡检用");
});

test("PATCH record keeps recorded usage once the token has been used", () => {
  const domain = createDomain();
  const existing = {
    id: "token_existing",
    token: "existingtokenvalue",
    label: "旧标签",
    status: "exhausted",
    created_at: "2026-09-01T00:00:00.000Z",
    expires_at: null,
    max_uses: 2,
    uses: 2,
    last_used_at: "2026-09-02T00:00:00.000Z",
    last_used_node_id: "node_real",
    note: null,
  };

  const updated = domain.buildBootstrapTokenRecord({ label: "改名" }, existing);

  assert.equal(updated.uses, 2);
  assert.equal(updated.last_used_at, "2026-09-02T00:00:00.000Z");
  assert.equal(updated.last_used_node_id, "node_real");
});
