import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  buildQuicVersionNegotiationProbePayload,
  createUdpProbe,
} from "../src/domain/probes/udp.js";
import {
  evaluateProfilePublishCapabilities,
  resolveProfileProbeRequirement,
  resolveRelayUdpSupport,
} from "../src/domain/probes/capabilities.js";

class FakeUdpSocket extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.close_calls = 0;
    this.connect_calls = [];
    this.send_calls = [];
    this.unref_calls = 0;
  }

  connect(port, host, callback) {
    this.connect_calls.push({ port, host });
    if (this.options.connect_error) {
      throw this.options.connect_error;
    }
    callback?.();
  }

  send(...args) {
    this.send_calls.push(args);
    const callback = typeof args.at(-1) === "function" ? args.at(-1) : null;
    callback?.(this.options.send_error ?? null);
    if (!this.options.send_error && this.options.response !== undefined) {
      queueMicrotask(() => {
        this.emit("message", Buffer.from(this.options.response));
      });
    }
  }

  close() {
    this.close_calls += 1;
  }

  unref() {
    this.unref_calls += 1;
  }
}

function createManualTimers() {
  const timers = [];
  return {
    timers,
    setTimeoutFn(callback, ms) {
      const timer = {
        callback,
        ms,
        cleared: false,
        unref_called: false,
        unref() {
          this.unref_called = true;
        },
      };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
  };
}

test("UDP/QUIC probe succeeds on response and releases socket resources", async () => {
  const socket = new FakeUdpSocket({ response: "quic-version-negotiation" });
  const timers = createManualTimers();
  const ticks = [1000, 1037];
  const domain = createUdpProbe({
    createSocket: () => socket,
    now: () => ticks.shift() ?? 1037,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  const result = await domain.runUdpProbe(
    {
      host: "127.0.0.1",
      port: 443,
      family: "ipv4",
    },
    {
      probeType: "udp_quic",
      timeoutMs: 2500,
    },
  );

  assert.equal(result.attempted, true);
  assert.equal(result.success, true);
  assert.equal(result.latency_ms, 37);
  assert.equal(result.reason_code, "udp_response_received");
  assert.equal(result.target_host, "127.0.0.1");
  assert.equal(result.target_port, 443);
  assert.equal(result.target_family, "ipv4");
  assert.equal(result.bytes_sent, buildQuicVersionNegotiationProbePayload().byteLength);
  assert.equal(result.bytes_received, Buffer.byteLength("quic-version-negotiation"));
  assert.deepEqual(socket.connect_calls, [{ port: 443, host: "127.0.0.1" }]);
  assert.equal(socket.close_calls, 1);
  assert.equal(socket.listenerCount("message"), 0);
  assert.equal(socket.listenerCount("error"), 0);
  assert.equal(timers.timers[0].cleared, true);
  assert.equal(timers.timers[0].unref_called, true);
});

test("UDP probe timeout is explicit and closes the socket once", async () => {
  const socket = new FakeUdpSocket();
  const timers = createManualTimers();
  const domain = createUdpProbe({
    createSocket: () => socket,
    now: () => 2000,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  const pending = domain.runUdpProbe(
    {
      host: "203.0.113.20",
      port: 8443,
    },
    {
      probeType: "udp",
      timeoutMs: 10,
    },
  );

  assert.equal(timers.timers.length, 1);
  timers.timers[0].callback();
  const result = await pending;

  assert.equal(result.success, false);
  assert.equal(result.timed_out, true);
  assert.equal(result.error_message, "udp_timeout");
  assert.equal(result.reason_code, "udp_timeout");
  assert.equal(socket.close_calls, 1);
  assert.equal(socket.listenerCount("message"), 0);
  assert.equal(socket.listenerCount("error"), 0);
});

test("UDP probe send errors are normalized and still release resources", async () => {
  const socket = new FakeUdpSocket({ send_error: new Error("write failed") });
  const timers = createManualTimers();
  const domain = createUdpProbe({
    createSocket: () => socket,
    now: () => 3000,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  const result = await domain.runUdpProbe(
    {
      host: "127.0.0.1",
      port: 443,
    },
    {
      probeType: "udp_quic",
      timeoutMs: 1000,
    },
  );

  assert.equal(result.success, false);
  assert.equal(result.timed_out, false);
  assert.equal(result.error_message, "udp_send_failed");
  assert.equal(result.reason_code, "udp_send_failed");
  assert.equal(socket.close_calls, 1);
  assert.equal(timers.timers[0].cleared, true);
});

test("Hysteria2 profiles require UDP/QUIC probing", () => {
  assert.deepEqual(
    resolveProfileProbeRequirement({
      protocol: "hysteria2",
      network_protocol: "quic",
    }),
    {
      protocol: "hysteria2",
      network_protocol: "quic",
      requires_udp: true,
      requires_quic: true,
      required_probe_types: ["udp_quic"],
    },
  );

  assert.deepEqual(
    resolveProfileProbeRequirement({
      protocol: "vless",
      network_protocol: "tcp",
    }).required_probe_types,
    ["tcp_connect"],
  );
});

test("QUIC negotiation probes meet the minimum UDP datagram size", () => {
  assert.equal(buildQuicVersionNegotiationProbePayload().byteLength, 1200);
});

test("TCP-only SSH relay blocks UDP/QUIC publish capability", () => {
  const result = evaluateProfilePublishCapabilities({
    profile: {
      protocol: "hysteria2",
      network_protocol: "udp",
    },
    managementRoute: {
      access_mode: "relay",
      transport: {
        kind: "ssh-relay-tcp-forward",
        relay_capabilities: {
          allow_tcp_forwarding: true,
          has_nc: true,
        },
      },
    },
  });

  assert.equal(result.publishable, false);
  assert.equal(result.requires_udp, true);
  assert.equal(result.relay.supports_udp, false);
  assert.equal(result.relay.reason_code, "relay_udp_not_supported");
  assert.equal(result.publish_issues.length, 1);
  assert.equal(result.publish_issues[0].code, "relay_udp_not_supported");
  assert.equal(result.publish_issues[0].severity, "blocking");
  assert.match(result.publish_issues[0].message, /UDP\/QUIC/);
});

test("UDP-capable relay declarations allow Hysteria2 publish capability", () => {
  assert.equal(
    resolveRelayUdpSupport({
      access_mode: "relay",
      transport_kind: "wireguard-tun",
    }).supports_udp,
    true,
  );

  const result = evaluateProfilePublishCapabilities({
    profile: {
      protocol: "hysteria2",
      transport: "udp",
    },
    route: {
      access_mode: "relay",
      transport_kind: "ssh-relay-tcp-forward",
      relay_capabilities: {
        supports_udp: true,
      },
    },
  });

  assert.equal(result.publishable, true);
  assert.deepEqual(result.publish_issues, []);
});
