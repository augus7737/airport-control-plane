import assert from "node:assert/strict";
import test from "node:test";

import {
  validateAssetUpdate,
  validateManualNode,
} from "../src/http/validators.js";

test("manual node validator accepts endpoint model fields", () => {
  const errors = validateManualNode({
    hostname: "lxc-node",
    ssh_port: 22,
    management: {
      ssh_host: "br1.example.test",
      ssh_port: 38022,
      ssh_internal_host: "10.0.3.5",
      ssh_internal_port: 22,
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
      management: {
        external_host: "br1.example.test",
        external_port: 38022,
        internal_host: "10.0.3.5",
        internal_port: 22,
        topology: "lxc",
      },
      business_ingress: {
        host: "br1.example.test",
        port: 8443,
        internal_host: "10.0.3.5",
        internal_port: 443,
        topology: "nat",
      },
      service_listen: {
        host: "0.0.0.0",
        port: 443,
        protocol: "hysteria2",
      },
    },
  });

  assert.deepEqual(errors, []);
});

test("asset update validator rejects invalid endpoint ports", () => {
  const errors = validateAssetUpdate({
    endpoints: {
      management: {
        external_port: 70000,
      },
      service_listen: {
        port: 0,
      },
    },
  });

  assert.deepEqual(errors, [
    "endpoints.management.external_port must be an integer between 1 and 65535",
    "endpoints.service_listen.port must be an integer between 1 and 65535",
  ]);
});

