import test from "node:test";
import assert from "node:assert/strict";

import { createOperatorSessionAuth } from "../src/domain/auth/session.js";

function createReply() {
  const headers = new Map();
  return {
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
  };
}

function createAuth(options = {}) {
  return createOperatorSessionAuth({
    env: {
      CONTROL_PLANE_AUTH_USERNAME: "admin",
      CONTROL_PLANE_AUTH_PASSWORD: "secret",
      CONTROL_PLANE_SESSION_TTL_MS: "600000",
      CONTROL_PLANE_SESSION_REFRESH_PERSIST_INTERVAL_MS: "0",
    },
    logger: { warn() {} },
    ...options,
  });
}

function cookieHeaderFromReply(reply) {
  return String(reply.getHeader("Set-Cookie")).split(";")[0];
}

test("operator sessions can be restored from a persisted session store", () => {
  let currentTime = Date.parse("2026-08-18T08:00:00.000Z");
  let persistedPayload = null;
  const now = () => currentTime;
  const auth = createAuth({
    now,
    onSessionStoreChanged: (payload) => {
      persistedPayload = payload;
    },
  });
  const reply = createReply();

  const result = auth.login({
    username: "admin",
    password: "secret",
    request: { headers: {} },
    reply,
  });
  assert.equal(result.ok, true);
  assert.equal(persistedPayload.items.length, 1);

  currentTime += 60_000;
  const restoredAuth = createAuth({ now });
  assert.equal(restoredAuth.loadSessionStore(persistedPayload.items), false);

  const restoredSession = restoredAuth.currentSession(
    { headers: { cookie: cookieHeaderFromReply(reply) } },
    { refresh: false },
  );
  assert.equal(restoredSession.username, "admin");
});

test("expired persisted operator sessions are discarded on load", () => {
  const currentTime = Date.parse("2026-08-18T08:00:00.000Z");
  const auth = createAuth({ now: () => currentTime });

  const mutated = auth.loadSessionStore([
    {
      id: "expired-session",
      username: "admin",
      created_at: "2026-08-18T07:00:00.000Z",
      last_seen_at: "2026-08-18T07:10:00.000Z",
      expires_at_ms: currentTime - 1,
    },
  ]);

  assert.equal(mutated, true);
  assert.deepEqual(auth.serializeSessionStore(), { items: [] });
});

test("malformed percent-encoded operator cookies do not crash session lookup", () => {
  const auth = createAuth();
  const loginReply = createReply();

  const result = auth.login({
    username: "admin",
    password: "secret",
    request: { headers: {} },
    reply: loginReply,
  });
  assert.equal(result.ok, true);

  assert.doesNotThrow(() => {
    const session = auth.currentSession(
      {
        headers: {
          cookie: `broken=%; ${cookieHeaderFromReply(loginReply)}`,
        },
      },
      { refresh: false },
    );
    assert.equal(session.username, "admin");
  });

  assert.doesNotThrow(() => {
    const session = auth.currentSession(
      {
        headers: {
          cookie: `${auth.cookieName}=%`,
        },
      },
      { refresh: false },
    );
    assert.equal(session, null);
  });
});

test("refreshing an operator session also renews the browser cookie when reply is provided", () => {
  let currentTime = Date.parse("2026-08-18T08:00:00.000Z");
  let persistedPayload = null;
  const now = () => currentTime;
  const auth = createAuth({
    now,
    onSessionStoreChanged: (payload) => {
      persistedPayload = payload;
    },
  });
  const loginReply = createReply();

  const result = auth.login({
    username: "admin",
    password: "secret",
    request: { headers: { "x-forwarded-proto": "https" } },
    reply: loginReply,
  });
  assert.equal(result.ok, true);
  const cookieHeader = cookieHeaderFromReply(loginReply);
  const originalExpiresAtMs = persistedPayload.items[0].expires_at_ms;

  currentTime += 120_000;
  const refreshReply = createReply();
  const refreshedSession = auth.currentSession(
    {
      headers: {
        cookie: cookieHeader,
        "x-forwarded-proto": "https",
      },
    },
    { reply: refreshReply },
  );

  assert.equal(refreshedSession.username, "admin");
  assert.equal(persistedPayload.items[0].expires_at_ms, currentTime + 600_000);
  assert.notEqual(persistedPayload.items[0].expires_at_ms, originalExpiresAtMs);
  assert.match(String(refreshReply.getHeader("Set-Cookie")), new RegExp(`^${auth.cookieName}=`));
  assert.match(String(refreshReply.getHeader("Set-Cookie")), /Max-Age=600/);
  assert.match(String(refreshReply.getHeader("Set-Cookie")), /Secure/);

  const noRefreshReply = createReply();
  const unrefreshedSession = auth.currentSession(
    {
      headers: {
        cookie: cookieHeader,
      },
    },
    { refresh: false, reply: noRefreshReply },
  );

  assert.equal(unrefreshedSession.username, "admin");
  assert.equal(noRefreshReply.getHeader("Set-Cookie"), undefined);
});
