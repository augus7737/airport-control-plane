import assert from "node:assert/strict";
import test from "node:test";

import { buildAccessUserPayload } from "../public/js/pages/access-users-page.js";

function formData(fields) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      data.append(name, item);
    }
  }
  return data;
}

test("VLESS payload omits hidden password and VMess-only alter id", () => {
  const payload = buildAccessUserPayload(formData({
    name: "US VLESS",
    protocol: "vless",
    status: "active",
    uuid: "0f6c5a3e-7a1d-4c2b-9e5f-1b2c3d4e5f60",
    password: "",
    alter_id: "0",
    node_group_ids: ["group_us"],
  }));

  assert.deepEqual(payload.credential, {
    uuid: "0f6c5a3e-7a1d-4c2b-9e5f-1b2c3d4e5f60",
  });
  assert.deepEqual(payload.node_group_ids, ["group_us"]);
});

test("blank VLESS UUID is omitted so the server can generate it", () => {
  const payload = buildAccessUserPayload(formData({ name: "generated", protocol: "vless", uuid: "" }));
  assert.deepEqual(payload.credential, {});
});

test("Hysteria2 and VMess payloads keep only their protocol credentials", () => {
  const hysteria = buildAccessUserPayload(formData({
    name: "hy2",
    protocol: "hysteria2",
    uuid: "ignored",
    password: "secret-pass",
    alter_id: "7",
  }));
  assert.deepEqual(hysteria.credential, { password: "secret-pass" });

  const vmess = buildAccessUserPayload(formData({
    name: "vmess",
    protocol: "vmess",
    uuid: "0f6c5a3e-7a1d-4c2b-9e5f-1b2c3d4e5f60",
    password: "ignored",
    alter_id: "2",
  }));
  assert.deepEqual(vmess.credential, {
    uuid: "0f6c5a3e-7a1d-4c2b-9e5f-1b2c3d4e5f60",
    alter_id: 2,
  });
});
