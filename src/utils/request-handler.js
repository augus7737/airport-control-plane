import { jsonResponse } from "./http.js";

const defaultStructuredError = Object.freeze({
  error: "internal_server_error",
  message: "internal server error",
});

function logSafely(logger, level, ...args) {
  try {
    const log = logger?.[level] ?? logger?.error ?? console.error;
    log.apply(logger, args);
  } catch {
    // Logging must never become a second request failure.
  }
}

function normalizeHostHeader(hostHeader, defaultHost) {
  if (Array.isArray(hostHeader)) {
    return hostHeader.find((item) => typeof item === "string" && item.trim())?.trim() ?? defaultHost;
  }

  if (typeof hostHeader !== "string") {
    return defaultHost;
  }

  return hostHeader.trim() || defaultHost;
}

function requestCanReceiveError(reply) {
  return !reply.destroyed && !reply.headersSent && !reply.writableEnded;
}

function closePartialResponse(reply, logger, info) {
  if (reply.destroyed || reply.writableEnded || !reply.headersSent) {
    return;
  }

  try {
    reply.end();
  } catch (error) {
    logSafely(logger, "error", "[request] failed to end partial response", info, error);
  }
}

export function resolveRequestUrl(request, options = {}) {
  const logger = options.logger ?? console;
  const defaultHost = options.defaultHost ?? "localhost";
  const protocol = options.protocol ?? "http";
  const requestTarget = typeof request?.url === "string" && request.url.length > 0 ? request.url : "/";
  const host = normalizeHostHeader(request?.headers?.host, defaultHost);
  let baseUrl = `${protocol}://${host}`;

  try {
    new URL(baseUrl);
  } catch (error) {
    baseUrl = `${protocol}://${defaultHost}`;
    logSafely(logger, "warn", "[request] invalid Host header, using fallback host", {
      host,
      fallback_host: defaultHost,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return new URL(requestTarget, baseUrl);
}

export function createSafeRequestHandler(handler, options = {}) {
  const logger = options.logger ?? console;
  const responsePayload = options.responsePayload ?? defaultStructuredError;

  function handleUnhandledError(error, request, reply) {
    const info = {
      method: request?.method ?? null,
      url: request?.url ?? null,
      response_started: Boolean(reply?.headersSent || reply?.writableEnded),
    };
    logSafely(logger, "error", "[request] unhandled error", info, error);

    if (!requestCanReceiveError(reply)) {
      closePartialResponse(reply, logger, info);
      return;
    }

    try {
      jsonResponse(reply, 500, responsePayload);
    } catch (writeError) {
      logSafely(logger, "error", "[request] failed to write structured 500", info, writeError);
    }
  }

  return function safeRequestHandler(request, reply) {
    try {
      Promise.resolve(handler(request, reply)).catch((error) => {
        handleUnhandledError(error, request, reply);
      });
    } catch (error) {
      handleUnhandledError(error, request, reply);
    }
  };
}
