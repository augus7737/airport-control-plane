import { createServer } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";

import {
  createSafeRequestHandler,
  resolveRequestUrl,
} from "../src/utils/request-handler.js";

function createLogger() {
  const entries = [];
  return {
    entries,
    error(...args) {
      entries.push({ level: "error", args });
    },
    warn(...args) {
      entries.push({ level: "warn", args });
    },
  };
}

async function withServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    return await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("request boundary converts synchronous errors to structured 500", async () => {
  const logger = createLogger();
  const handler = createSafeRequestHandler(
    () => {
      throw new Error("sync failure");
    },
    { logger },
  );

  await withServer(handler, async (baseUrl) => {
    const result = await fetchJson(`${baseUrl}/sync`);

    assert.equal(result.status, 500);
    assert.deepEqual(result.body, {
      error: "internal_server_error",
      message: "internal server error",
    });
  });

  assert.equal(logger.entries.filter((entry) => entry.level === "error").length, 1);
});

test("request boundary converts async errors without unhandled rejections", async () => {
  const logger = createLogger();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);

  try {
    const handler = createSafeRequestHandler(
      async () => {
        throw new Error("async failure");
      },
      { logger },
    );

    await withServer(handler, async (baseUrl) => {
      const result = await fetchJson(`${baseUrl}/async`);

      assert.equal(result.status, 500);
      assert.deepEqual(result.body, {
        error: "internal_server_error",
        message: "internal server error",
      });
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(unhandled, []);
    assert.equal(logger.entries.filter((entry) => entry.level === "error").length, 1);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("request boundary only logs when response has already ended", async () => {
  const logger = createLogger();
  const handler = createSafeRequestHandler(
    async (_request, reply) => {
      reply.writeHead(204);
      reply.end();
      throw new Error("late failure");
    },
    { logger },
  );

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/already-ended`);

    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  });

  assert.equal(logger.entries.filter((entry) => entry.level === "error").length, 1);
});

test("request boundary ends partial responses so clients do not hang", async () => {
  const logger = createLogger();
  const handler = createSafeRequestHandler(
    async (_request, reply) => {
      reply.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
      });
      throw new Error("partial failure");
    },
    { logger },
  );

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/partial`);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
  });

  assert.equal(logger.entries.filter((entry) => entry.level === "error").length, 1);
});

test("request URL resolver tolerates missing and malformed Host headers", () => {
  const missingHostLogger = createLogger();
  const missingHostUrl = resolveRequestUrl(
    {
      url: "/healthz?ok=1",
      headers: {},
    },
    { logger: missingHostLogger },
  );

  assert.equal(missingHostUrl.href, "http://localhost/healthz?ok=1");
  assert.deepEqual(missingHostLogger.entries, []);

  const malformedHostLogger = createLogger();
  const malformedHostUrl = resolveRequestUrl(
    {
      url: "/login",
      headers: {
        host: "[invalid",
      },
    },
    { logger: malformedHostLogger },
  );

  assert.equal(malformedHostUrl.href, "http://localhost/login");
  assert.equal(malformedHostLogger.entries.filter((entry) => entry.level === "warn").length, 1);
});
