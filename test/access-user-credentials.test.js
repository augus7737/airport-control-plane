import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeAccessUserCredential,
  normalizeCredentialProtocol,
  validateAccessUserCredential,
} from "../src/domain/shares/credentials.js";

const VALID_UUID = "0f6c5a3e-7a1d-4c2b-9e5f-1b2c3d4e5f60";

test("vless accepts a well-formed uuid and rejects a missing one", () => {
  assert.deepEqual(validateAccessUserCredential({ protocol: "vless", credential: { uuid: VALID_UUID } }), []);

  assert.deepEqual(validateAccessUserCredential({ protocol: "vless" }), [
    "credential.uuid is required for vless users",
  ]);
  assert.deepEqual(validateAccessUserCredential({ protocol: "vless", credential: {} }), [
    "credential.uuid is required for vless users",
  ]);
  assert.deepEqual(validateAccessUserCredential({ protocol: "vless", credential: { uuid: null } }), [
    "credential.uuid is required for vless users",
  ]);
});

test("uuid format check accepts upper case and dash-free forms but rejects garbage", () => {
  assert.deepEqual(
    validateAccessUserCredential({ protocol: "vless", credential: { uuid: VALID_UUID.toUpperCase() } }),
    [],
    "upper-case hex must be accepted",
  );
  assert.deepEqual(
    validateAccessUserCredential({
      protocol: "vless",
      credential: { uuid: VALID_UUID.replaceAll("-", "") },
    }),
    [],
    "dash-free 32-hex form must be accepted",
  );
  assert.deepEqual(validateAccessUserCredential({ protocol: "vless", credential: { uuid: "not-a-uuid" } }), [
    "credential.uuid must be a valid UUID",
  ]);
  assert.deepEqual(
    validateAccessUserCredential({ protocol: "vless", credential: { uuid: "0f6c5a3e7a1d4c2b9e5f1b2c3d4e5f" } }),
    ["credential.uuid must be a valid UUID"],
    "short hex runs must be rejected",
  );
});

test("vmess requires a uuid and keeps alter_id semantics identical to validators.js", () => {
  assert.deepEqual(
    validateAccessUserCredential({ protocol: "vmess", credential: { uuid: VALID_UUID, alter_id: 0 } }),
    [],
  );
  assert.deepEqual(
    validateAccessUserCredential({ protocol: "vmess", credential: { uuid: VALID_UUID } }),
    [],
    "alter_id is optional and defaults to the stored/zero value",
  );
  assert.deepEqual(validateAccessUserCredential({ protocol: "vmess", credential: { uuid: VALID_UUID, alter_id: -1 } }), [
    "credential.alter_id must be a non-negative integer",
  ]);
  assert.deepEqual(
    validateAccessUserCredential({ protocol: "vmess", credential: { uuid: VALID_UUID, alter_id: 1.5 } }),
    ["credential.alter_id must be a non-negative integer"],
  );
  assert.deepEqual(
    validateAccessUserCredential({ protocol: "vmess", credential: { uuid: VALID_UUID, alter_id: null } }),
    [],
    "null alter_id falls back to existing semantics and must not be double reported",
  );
});

test("hysteria2 requires a password of at least 8 characters", () => {
  assert.deepEqual(
    validateAccessUserCredential({ protocol: "hysteria2", credential: { password: "fake-pass-123" } }),
    [],
  );
  assert.deepEqual(validateAccessUserCredential({ protocol: "hysteria2", credential: {} }), [
    "credential.password is required for hysteria2 users",
  ]);
  assert.deepEqual(validateAccessUserCredential({ protocol: "hysteria2", credential: { password: "s3cret" } }), [
    "credential.password must be at least 8 characters for hysteria2 users",
  ]);
  assert.deepEqual(
    validateAccessUserCredential({ protocol: "hysteria2", credential: { password: "  short  " } }),
    ["credential.password must be at least 8 characters for hysteria2 users"],
    "length check must apply to the trimmed value",
  );
});

test("unknown or missing protocol is treated as vless", () => {
  assert.equal(normalizeCredentialProtocol("VLESS "), "vless");
  assert.equal(normalizeCredentialProtocol("trojan"), "vless");
  assert.equal(normalizeCredentialProtocol(undefined), "vless");

  assert.deepEqual(validateAccessUserCredential({ protocol: "trojan", credential: {} }), [
    "credential.uuid is required for vless users",
  ]);
});

test("type-level complaints stay with validators.js and are not duplicated", () => {
  // credential 给了但不是对象：validators.js 已报 "credential must be an object"。
  assert.deepEqual(validateAccessUserCredential({ protocol: "vless", credential: "oops" }), []);
  assert.deepEqual(validateAccessUserCredential({ protocol: "vless", credential: ["x"] }), []);
  // 空串 / 非字符串 uuid：validators.js 已报 "must be a non-empty string"。
  assert.deepEqual(validateAccessUserCredential({ protocol: "vless", credential: { uuid: "" } }), []);
  assert.deepEqual(validateAccessUserCredential({ protocol: "vless", credential: { uuid: 42 } }), []);
  // 空串 / 非字符串 password 同理。
  assert.deepEqual(validateAccessUserCredential({ protocol: "hysteria2", credential: { password: "" } }), []);
  assert.deepEqual(validateAccessUserCredential({ protocol: "hysteria2", credential: { password: 7 } }), []);
});

test("mergeAccessUserCredential mirrors the record builder fallback semantics", () => {
  const base = { uuid: VALID_UUID };
  assert.deepEqual(mergeAccessUserCredential(base, { password: "fake-pass-123" }), {
    uuid: VALID_UUID,
    password: "fake-pass-123",
  });
  assert.deepEqual(
    mergeAccessUserCredential(base, { uuid: "  " }),
    base,
    "blank patch values must fall back to the stored credential",
  );
  assert.deepEqual(mergeAccessUserCredential({ password: "old-long-enough" }, { uuid: VALID_UUID }), {
    password: "old-long-enough",
    uuid: VALID_UUID,
  });
  assert.deepEqual(
    mergeAccessUserCredential({ uuid: VALID_UUID, alter_id: 1 }, { alter_id: 0 }),
    { uuid: VALID_UUID, alter_id: 0 },
  );
  assert.equal(mergeAccessUserCredential(base, "not-an-object"), "not-an-object");
  assert.equal(mergeAccessUserCredential(base, null), null);
  assert.deepEqual(mergeAccessUserCredential(null, { uuid: VALID_UUID }), { uuid: VALID_UUID });
});
