const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 10;
const DEFAULT_LOCKOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_TRACKED_KEYS = 2000;

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseBooleanEnv(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

export function createLoginGuard(options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => Date.now());
  const windowMs = normalizePositiveInt(
    options.windowMs ?? env.CONTROL_PLANE_LOGIN_WINDOW_MS,
    DEFAULT_WINDOW_MS,
  );
  const maxFailures = normalizePositiveInt(
    options.maxFailures ?? env.CONTROL_PLANE_LOGIN_MAX_FAILURES,
    DEFAULT_MAX_FAILURES,
  );
  const lockoutMs = normalizePositiveInt(
    options.lockoutMs ?? env.CONTROL_PLANE_LOGIN_LOCKOUT_MS,
    DEFAULT_LOCKOUT_MS,
  );
  const enabled =
    options.enabled ?? parseBooleanEnv(env.CONTROL_PLANE_LOGIN_GUARD) ?? true;

  // key -> { failures: number[], lockedUntil: number | null }
  const buckets = new Map();

  function bucketFor(key) {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { failures: [], lockedUntil: null };
      buckets.set(key, bucket);
    }

    return bucket;
  }

  function sweep(currentTime) {
    for (const [key, bucket] of buckets) {
      bucket.failures = bucket.failures.filter((at) => currentTime - at < windowMs);
      if (bucket.lockedUntil != null && bucket.lockedUntil <= currentTime) {
        bucket.lockedUntil = null;
      }

      if (bucket.failures.length === 0 && bucket.lockedUntil == null) {
        buckets.delete(key);
      }
    }

    if (buckets.size <= DEFAULT_MAX_TRACKED_KEYS) {
      return;
    }

    // Insertion order approximates age; drop the oldest keys so memory stays bounded.
    for (const key of buckets.keys()) {
      if (buckets.size <= DEFAULT_MAX_TRACKED_KEYS) {
        break;
      }

      buckets.delete(key);
    }
  }

  function lockoutRemainingMs(keys, currentTime) {
    let remaining = 0;
    for (const key of keys) {
      const lockedUntil = buckets.get(key)?.lockedUntil;
      if (lockedUntil != null && lockedUntil > currentTime) {
        remaining = Math.max(remaining, lockedUntil - currentTime);
      }
    }

    return remaining;
  }

  function evaluate(keys) {
    if (!enabled) {
      return { blocked: false, remaining_seconds: 0, failures: 0 };
    }

    const currentTime = now();
    sweep(currentTime);

    const remaining = lockoutRemainingMs(keys, currentTime);
    if (remaining > 0) {
      return {
        blocked: true,
        remaining_seconds: Math.ceil(remaining / 1000),
        failures: maxFailures,
      };
    }

    let failures = 0;
    for (const key of keys) {
      failures = Math.max(failures, buckets.get(key)?.failures.length ?? 0);
    }

    return { blocked: false, remaining_seconds: 0, failures };
  }

  function recordFailure(keys) {
    if (!enabled) {
      return evaluate(keys);
    }

    const currentTime = now();
    sweep(currentTime);

    for (const key of keys) {
      const bucket = bucketFor(key);
      bucket.failures = bucket.failures.filter((at) => currentTime - at < windowMs);
      bucket.failures.push(currentTime);
      if (bucket.failures.length >= maxFailures) {
        bucket.lockedUntil = currentTime + lockoutMs;
      }
    }

    return evaluate(keys);
  }

  function recordSuccess(keys) {
    for (const key of keys) {
      buckets.delete(key);
    }
  }

  return {
    enabled,
    windowMs,
    maxFailures,
    lockoutMs,
    evaluate,
    recordFailure,
    recordSuccess,
    trackedKeyCount: () => buckets.size,
  };
}
