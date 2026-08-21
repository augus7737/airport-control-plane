import dgram from "node:dgram";

const DEFAULT_UDP_PROBE_TIMEOUT_MS = 4000;
const DEFAULT_UDP_PROBE_PAYLOAD = Buffer.from("airport-udp-probe", "utf8");

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function normalizeFamily(value, host) {
  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized === "ipv6" || normalized === "udp6" || normalized === "6") {
    return "ipv6";
  }
  if (normalized === "ipv4" || normalized === "udp4" || normalized === "4") {
    return "ipv4";
  }

  return String(host || "").includes(":") ? "ipv6" : "ipv4";
}

function socketTypeForFamily(family) {
  return family === "ipv6" ? "udp6" : "udp4";
}

function normalizeTimeoutMs(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0
    ? Math.max(1, Math.floor(timeout))
    : DEFAULT_UDP_PROBE_TIMEOUT_MS;
}

function normalizeUdpProbeError(error, fallback = "udp_error") {
  const raw = String(error?.code || error?.message || error || fallback)
    .trim()
    .toLowerCase();

  if (!raw) {
    return fallback;
  }

  if (raw === "econnrefused" || raw.includes("connection refused")) {
    return "udp_connection_refused";
  }
  if (raw === "ehostunreach" || raw.includes("host unreachable")) {
    return "udp_host_unreachable";
  }
  if (raw === "enetunreach" || raw.includes("network unreachable")) {
    return "udp_network_unreachable";
  }
  if (raw === "eacces" || raw.includes("permission denied")) {
    return "udp_permission_denied";
  }
  if (raw === "timeout" || raw === "udp_timeout" || raw.includes("timed out")) {
    return "udp_timeout";
  }

  return fallback === "udp_send_failed" ? "udp_send_failed" : raw;
}

function normalizePayload(payload) {
  if (Buffer.isBuffer(payload)) {
    return payload.length > 0 ? payload : DEFAULT_UDP_PROBE_PAYLOAD;
  }
  if (payload instanceof Uint8Array) {
    return payload.byteLength > 0 ? Buffer.from(payload) : DEFAULT_UDP_PROBE_PAYLOAD;
  }
  if (typeof payload === "string") {
    return payload.length > 0 ? Buffer.from(payload, "utf8") : DEFAULT_UDP_PROBE_PAYLOAD;
  }

  return DEFAULT_UDP_PROBE_PAYLOAD;
}

export function buildQuicVersionNegotiationProbePayload() {
  const header = Buffer.from([
    0xc0,
    0x0a,
    0x0a,
    0x0a,
    0x0a,
    0x08,
    0x61,
    0x69,
    0x72,
    0x70,
    0x72,
    0x6f,
    0x62,
    0x65,
    0x08,
    0x63,
    0x6f,
    0x6e,
    0x74,
    0x72,
    0x6f,
    0x6c,
    0x31,
    0x00,
    0x01,
    0x00,
  ]);
  const payload = Buffer.alloc(1200);
  header.copy(payload);
  return payload;
}

export function createUdpProbe(dependencies = {}) {
  const {
    createSocket = (type) => dgram.createSocket(type),
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = dependencies;

  function runUdpProbe(target, options = {}) {
    const host = normalizeString(target?.host);
    const port = normalizePort(target?.port);
    const family = normalizeFamily(target?.family, host);
    const timeoutMs = normalizeTimeoutMs(options.timeoutMs ?? options.timeout_ms);
    const probeType = normalizeString(options.probeType ?? options.probe_type) ?? "udp";
    const expectResponse = options.expectResponse !== false;

    if (!host || !port) {
      return Promise.resolve({
        attempted: false,
        success: false,
        latency_ms: null,
        timed_out: false,
        error_message: "udp_target_invalid",
        reason_code: "udp_target_invalid",
        probe_type: probeType,
        transport: "udp",
        target_host: host,
        target_port: port,
        target_family: family,
        bytes_sent: 0,
        bytes_received: 0,
      });
    }

    return new Promise((resolve) => {
      const startedAt = now();
      const payload = normalizePayload(
        options.payload ?? (probeType === "udp_quic" ? buildQuicVersionNegotiationProbePayload() : null),
      );
      const socket = options.socket ?? createSocket(socketTypeForFamily(family));
      let settled = false;
      let timer = null;
      let bytesSent = 0;
      let bytesReceived = 0;
      let closeCalled = false;

      const closeSocket = () => {
        if (closeCalled) {
          return;
        }
        closeCalled = true;
        try {
          socket.close?.();
        } catch {
          // Some fake or not-yet-bound sockets can throw on close; the probe is already settled.
        }
      };

      const cleanup = () => {
        if (timer) {
          clearTimeoutFn(timer);
          timer = null;
        }
        socket.removeListener?.("message", onMessage);
        socket.removeListener?.("error", onError);
      };

      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        closeSocket();
        resolve({
          attempted: true,
          success: Boolean(result.success),
          latency_ms: result.latency_ms ?? null,
          timed_out: Boolean(result.timed_out),
          error_message: result.error_message ?? null,
          reason_code: result.reason_code ?? result.error_message ?? null,
          probe_type: probeType,
          transport: "udp",
          target_host: host,
          target_port: port,
          target_family: family,
          bytes_sent: bytesSent,
          bytes_received: bytesReceived,
        });
      };

      function onMessage(message) {
        bytesReceived = Buffer.isBuffer(message) || message instanceof Uint8Array
          ? message.byteLength
          : Buffer.byteLength(String(message ?? ""));
        finish({
          success: true,
          latency_ms: Math.max(0, now() - startedAt),
          timed_out: false,
          error_message: null,
          reason_code: "udp_response_received",
        });
      }

      function onError(error) {
        finish({
          success: false,
          latency_ms: null,
          timed_out: false,
          error_message: normalizeUdpProbeError(error),
          reason_code: normalizeUdpProbeError(error),
        });
      }

      const markSent = () => {
        bytesSent = payload.byteLength;
        if (!expectResponse) {
          finish({
            success: true,
            latency_ms: Math.max(0, now() - startedAt),
            timed_out: false,
            error_message: null,
            reason_code: "udp_packet_sent",
          });
        }
      };

      const sendPayload = () => {
        try {
          const callback = (error) => {
            if (error) {
              finish({
                success: false,
                latency_ms: null,
                timed_out: false,
                error_message: normalizeUdpProbeError(error, "udp_send_failed"),
                reason_code: normalizeUdpProbeError(error, "udp_send_failed"),
              });
              return;
            }
            markSent();
          };

          if (options.connect === false || typeof socket.connect !== "function") {
            socket.send(payload, port, host, callback);
          } else {
            socket.send(payload, callback);
          }
        } catch (error) {
          finish({
            success: false,
            latency_ms: null,
            timed_out: false,
            error_message: normalizeUdpProbeError(error, "udp_send_failed"),
            reason_code: normalizeUdpProbeError(error, "udp_send_failed"),
          });
        }
      };

      socket.once?.("message", onMessage);
      socket.once?.("error", onError);
      socket.unref?.();

      timer = setTimeoutFn(() => {
        finish({
          success: false,
          latency_ms: null,
          timed_out: true,
          error_message: "udp_timeout",
          reason_code: "udp_timeout",
        });
      }, timeoutMs);
      timer.unref?.();

      try {
        if (options.connect === false || typeof socket.connect !== "function") {
          sendPayload();
          return;
        }

        socket.connect(port, host, sendPayload);
      } catch (error) {
        finish({
          success: false,
          latency_ms: null,
          timed_out: false,
          error_message: normalizeUdpProbeError(error),
          reason_code: normalizeUdpProbeError(error),
        });
      }
    });
  }

  return {
    runUdpProbe,
  };
}

export const udpProbe = createUdpProbe();
export const runUdpProbe = udpProbe.runUdpProbe;
