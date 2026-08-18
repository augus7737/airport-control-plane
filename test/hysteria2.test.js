import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSingBoxConfig,
  validateSingBoxProfileTemplate,
} from "../src/domain/releases/sing-box.js";
import { createSharesDomain } from "../src/domain/shares/links.js";
import {
  validateAccessUserCreate,
  validateProxyProfileCreate,
} from "../src/http/validators.js";

const profile = {
  name: "HY2 test",
  protocol: "hysteria2",
  listen_port: 443,
  transport: "udp",
  security: "tls",
  server_name: "hy2.example.com",
  template: {
    tls: {
      certificate_path: "/etc/ssl/airport/fullchain.pem",
      key_path: "/etc/ssl/airport/privkey.pem",
      alpn: ["h3"],
    },
    hysteria2: {
      obfs: {
        type: "salamander",
        password: "obfs-secret",
      },
    },
  },
};

test("Hysteria2 profile validation requires TLS and accepts UDP", () => {
  assert.deepEqual(validateSingBoxProfileTemplate(profile), []);
  assert.match(
    validateSingBoxProfileTemplate({
      ...profile,
      security: "reality",
    })[0],
    /Hysteria2/,
  );
});

test("Hysteria2 renders a password-authenticated sing-box inbound", () => {
  const result = buildSingBoxConfig(
    { id: "release_test" },
    {
      profile,
      accessUsers: [
        {
          id: "user_1",
          name: "HY2 user",
          status: "active",
          credential: {
            password: "user-secret",
          },
        },
      ],
    },
  );

  const inbound = result.config.inbounds[0];
  assert.equal(inbound.type, "hysteria2");
  assert.deepEqual(inbound.users, [{ name: "HY2 user", password: "user-secret" }]);
  assert.deepEqual(inbound.obfs, {
    type: "salamander",
    password: "obfs-secret",
  });
  assert.equal(inbound.tls.certificate_path, "/etc/ssl/airport/fullchain.pem");
  assert.equal(result.metadata.transport, "udp");
});

test("validators accept Hysteria2 credentials and profiles", () => {
  assert.deepEqual(
    validateAccessUserCreate({
      name: "HY2 user",
      protocol: "hysteria2",
      credential: { password: "secret" },
    }),
    [],
  );
  assert.deepEqual(
    validateProxyProfileCreate({
      name: "HY2",
      protocol: "hysteria2",
      transport: "udp",
      security: "tls",
    }),
    [],
  );
});

test("Hysteria2 share builder emits hysteria2 URI", () => {
  const shares = createSharesDomain();
  const value = shares.buildHysteria2ShareUrl({
    endpoint_host: "203.0.113.10",
    endpoint_port: 443,
    rendered_user: { password: "user secret" },
    label: "BR / HY2 TLS UDP",
    profile: { server_name: "hy2.example.com" },
    inbound: {
      tls: {
        enabled: true,
        server_name: "hy2.example.com",
        alpn: ["h3"],
      },
      obfs: {
        type: "salamander",
        password: "obfs-secret",
      },
    },
  });

  assert.match(value, /^hysteria2:\/\/user%20secret@203\.0\.113\.10:443\?/);
  assert.match(value, /sni=hy2\.example\.com/);
  assert.match(value, /obfs=salamander/);
  assert.match(value, /obfs-password=obfs-secret/);
});
