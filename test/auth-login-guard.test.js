import test from "node:test";
import assert from "node:assert/strict";

import { createLoginGuard } from "../src/domain/auth/login-guard.js";
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

function createGuard(options = {}) {
  let currentTime = Date.parse("2026-09-23T08:00:00.000Z");
  const guard = createLoginGuard({
    env: {},
    now: () => currentTime,
    windowMs: 5 * 60 * 1000,
    maxFailures: 3,
    lockoutMs: 5 * 60 * 1000,
    ...options,
  });

  return {
    guard,
    advance: (ms) => {
      currentTime += ms;
    },
  };
}

test("login guard locks a key once the window failure budget is spent", () => {
  const { guard } = createGuard();

  assert.equal(guard.evaluate(["u:admin"]).blocked, false);
  guard.recordFailure(["u:admin"]);
  guard.recordFailure(["u:admin"]);
  assert.equal(guard.evaluate(["u:admin"]).blocked, false);

  const verdict = guard.recordFailure(["u:admin"]);
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.remaining_seconds, 300);
});

test("login guard lets attempts through again once the lockout expires", () => {
  const { guard, advance } = createGuard();

  for (let index = 0; index < 3; index += 1) {
    guard.recordFailure(["u:admin"]);
  }

  assert.equal(guard.evaluate(["u:admin"]).blocked, true);
  advance(5 * 60 * 1000 + 1);
  assert.equal(guard.evaluate(["u:admin"]).blocked, false);
});

test("login guard forgets failures that fall outside the sliding window", () => {
  const { guard, advance } = createGuard();

  guard.recordFailure(["u:admin"]);
  guard.recordFailure(["u:admin"]);
  assert.equal(guard.evaluate(["u:admin"]).failures, 2);

  advance(4 * 60 * 1000);
  assert.equal(guard.evaluate(["u:admin"]).failures, 2);

  advance(2 * 60 * 1000);
  assert.equal(guard.evaluate(["u:admin"]).failures, 0);
  assert.equal(guard.evaluate(["u:admin"]).blocked, false);
});

test("login guard clears counters on success", () => {
  const { guard } = createGuard();

  guard.recordFailure(["u:admin", "ip:203.0.113.9"]);
  guard.recordFailure(["u:admin", "ip:203.0.113.9"]);
  guard.recordSuccess(["u:admin", "ip:203.0.113.9"]);

  assert.equal(guard.evaluate(["u:admin"]).failures, 0);
  assert.equal(guard.evaluate(["ip:203.0.113.9"]).failures, 0);
});

test("login guard can be disabled", () => {
  const { guard } = createGuard({ enabled: false });

  for (let index = 0; index < 10; index += 1) {
    guard.recordFailure(["u:admin"]);
  }

  assert.equal(guard.evaluate(["u:admin"]).blocked, false);
});

test("login guard keeps its key set bounded", () => {
  const { guard } = createGuard({ maxFailures: 1_000_000 });

  for (let index = 0; index < 2500; index += 1) {
    guard.recordFailure([`u:user-${index}`]);
  }

  assert.ok(guard.trackedKeyCount() <= 2000);
});

function createAuth(options = {}) {
  let currentTime = Date.parse("2026-09-23T08:00:00.000Z");
  const auth = createOperatorSessionAuth({
    env: {
      CONTROL_PLANE_AUTH_USERNAME: "admin",
      CONTROL_PLANE_AUTH_PASSWORD: "secret",
      CONTROL_PLANE_SESSION_TTL_MS: "600000",
      CONTROL_PLANE_SESSION_REFRESH_PERSIST_INTERVAL_MS: "0",
      CONTROL_PLANE_LOGIN_MAX_FAILURES: "3",
    },
    logger: { warn() {} },
    now: () => currentTime,
    ...options,
  });

  return {
    auth,
    advance: (ms) => {
      currentTime += ms;
    },
  };
}

function attemptLogin(auth, password) {
  return auth.login({
    username: "admin",
    password,
    request: { headers: {}, socket: { remoteAddress: "203.0.113.9" } },
    reply: createReply(),
  });
}

test("operator auth blocks an attacker who keeps guessing the password", () => {
  const { auth } = createAuth();

  for (let index = 0; index < 2; index += 1) {
    const result = attemptLogin(auth, "wrong");
    assert.equal(result.error, "invalid_credentials");
  }

  const locked = attemptLogin(auth, "wrong");
  assert.equal(locked.ok, false);
  assert.equal(locked.error, "too_many_attempts");
  assert.equal(locked.retry_after_seconds, 300);
  assert.match(locked.message, /秒后重试/);

  // Even the correct password is refused while the bucket is locked.
  assert.equal(attemptLogin(auth, "secret").error, "too_many_attempts");
});

test("operator auth clears the failure counter after a successful login", () => {
  const { auth } = createAuth();

  attemptLogin(auth, "wrong");
  attemptLogin(auth, "wrong");
  assert.equal(attemptLogin(auth, "secret").ok, true);

  for (let index = 0; index < 2; index += 1) {
    assert.equal(attemptLogin(auth, "wrong").error, "invalid_credentials");
  }
});
