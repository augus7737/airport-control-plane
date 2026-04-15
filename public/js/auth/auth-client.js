const LOGIN_PAGE_PATH = "/login.html";
const SESSION_ENDPOINT = "/api/v1/auth/session";
const LOGIN_ENDPOINT = "/api/v1/auth/login";
const LOGOUT_ENDPOINT = "/api/v1/auth/logout";
const SESSION_CACHE_TTL_MS = 15_000;

let cachedSession = null;
let cachedSessionAt = 0;
let sessionRequest = null;

function now() {
  return Date.now();
}

function clearSessionCache() {
  cachedSession = null;
  cachedSessionAt = 0;
  sessionRequest = null;
}

function normalizeWindow(windowRef) {
  return windowRef && windowRef.location ? windowRef : window;
}

function currentPath(windowRef = window) {
  const safeWindow = normalizeWindow(windowRef);
  const { pathname = "/", search = "", hash = "" } = safeWindow.location || {};
  return `${pathname}${search}${hash}`;
}

export function isLoginPage(windowRef = window) {
  return normalizeWindow(windowRef).location?.pathname === LOGIN_PAGE_PATH;
}

export function normalizeNextPath(value, windowRef = window) {
  const safeWindow = normalizeWindow(windowRef);
  if (!value) {
    return "/";
  }

  try {
    const url = new URL(String(value), safeWindow.location.origin);
    if (url.origin !== safeWindow.location.origin) {
      return "/";
    }
    const nextPath = `${url.pathname}${url.search}${url.hash}` || "/";
    if (!nextPath.startsWith("/") || nextPath.startsWith(LOGIN_PAGE_PATH)) {
      return "/";
    }
    return nextPath;
  } catch {
    return "/";
  }
}

export function getNextPath(windowRef = window) {
  const safeWindow = normalizeWindow(windowRef);
  const params = new URLSearchParams(safeWindow.location.search || "");
  return normalizeNextPath(params.get("next"), safeWindow);
}

export function buildLoginUrl(nextPath, windowRef = window) {
  const safeWindow = normalizeWindow(windowRef);
  const url = new URL(LOGIN_PAGE_PATH, safeWindow.location.origin);
  const normalizedNextPath = normalizeNextPath(nextPath || currentPath(safeWindow), safeWindow);
  if (normalizedNextPath && normalizedNextPath !== "/") {
    url.searchParams.set("next", normalizedNextPath);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function redirectToLogin({ nextPath, windowRef = window, replace = false } = {}) {
  const safeWindow = normalizeWindow(windowRef);
  if (isLoginPage(safeWindow)) {
    return;
  }

  const target = buildLoginUrl(nextPath || currentPath(safeWindow), safeWindow);
  if (replace) {
    safeWindow.location.replace(target);
    return;
  }
  safeWindow.location.assign(target);
}

function pickOperator(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload.operator || payload.user || payload.admin || payload.session?.operator || null;
}

function inferAuthenticated(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  if (typeof payload.authenticated === "boolean") {
    return payload.authenticated;
  }
  if (typeof payload.logged_in === "boolean") {
    return payload.logged_in;
  }
  return Boolean(payload.session || payload.operator || payload.user || payload.admin);
}

function buildSessionState({
  authenticated = false,
  enabled = true,
  reason = "unknown",
  operator = null,
  payload = {},
  status = 200,
  message = "",
} = {}) {
  return {
    authenticated,
    enabled,
    reason,
    operator,
    payload,
    status,
    message,
  };
}

export function getOperatorDisplayName(session) {
  const operator = session?.operator;
  if (!operator || typeof operator !== "object") {
    return session?.authenticated ? "管理员会话" : "未登录";
  }

  return (
    operator.display_name ||
    operator.nickname ||
    operator.name ||
    operator.username ||
    operator.email ||
    "管理员会话"
  );
}

export function isUnauthorizedError(error) {
  return error?.code === "UNAUTHORIZED" || error?.status === 401 || error?.status === 403;
}

function createUnauthorizedError(response, payload) {
  const error = new Error(
    payload?.details?.join("，") || payload?.message || payload?.error || "登录已失效，请重新登录。",
  );
  error.code = "UNAUTHORIZED";
  error.status = response.status;
  error.payload = payload;
  return error;
}

async function parseJson(response) {
  return response.json().catch(() => ({}));
}

async function requestSession(windowRef = window) {
  const response = await fetch(SESSION_ENDPOINT, {
    headers: {
      accept: "application/json",
    },
    credentials: "same-origin",
  });

  if (response.status === 404) {
    return buildSessionState({
      authenticated: false,
      enabled: false,
      reason: "unavailable",
      status: 404,
      message: "控制面尚未启用登录接口。",
    });
  }

  if (response.status === 401 || response.status === 403) {
    return buildSessionState({
      authenticated: false,
      enabled: true,
      reason: "unauthorized",
      status: response.status,
      message: "当前会话未登录或已过期。",
    });
  }

  const payload = await parseJson(response);
  if (!response.ok) {
    return buildSessionState({
      authenticated: false,
      enabled: true,
      reason: "error",
      payload,
      status: response.status,
      message: payload?.message || payload?.error || `HTTP ${response.status}`,
    });
  }

  return buildSessionState({
    authenticated: inferAuthenticated(payload),
    enabled: true,
    reason: inferAuthenticated(payload) ? "authenticated" : "unauthorized",
    operator: pickOperator(payload),
    payload,
    status: response.status,
    message: payload?.message || "",
  });
}

export async function getOperatorSession({ force = false, windowRef = window } = {}) {
  if (!force && cachedSession && now() - cachedSessionAt < SESSION_CACHE_TTL_MS) {
    return cachedSession;
  }

  if (!force && sessionRequest) {
    return sessionRequest;
  }

  sessionRequest = requestSession(windowRef)
    .catch((error) =>
      buildSessionState({
        authenticated: false,
        enabled: false,
        reason: "network_error",
        status: 0,
        message: error?.message || "会话检测失败",
      }),
    )
    .then((session) => {
      cachedSession = session;
      cachedSessionAt = now();
      sessionRequest = null;
      return session;
    });

  return sessionRequest;
}

export async function requireOperatorSession({ windowRef = window } = {}) {
  const session = await getOperatorSession({ force: true, windowRef });
  if (session.reason === "unauthorized") {
    redirectToLogin({ windowRef, replace: true });
    return null;
  }
  return session;
}

export async function fetchWithAuth(input, init = {}, options = {}) {
  const { redirectOnUnauthorized = true, windowRef = window } = options;
  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
  });

  if (response.status === 401 || response.status === 403) {
    clearSessionCache();
    const payload = await parseJson(response.clone());
    const error = createUnauthorizedError(response, payload);
    if (redirectOnUnauthorized) {
      redirectToLogin({ windowRef });
    }
    throw error;
  }

  return response;
}

export async function loginOperator(credentials) {
  const response = await fetch(LOGIN_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    credentials: "same-origin",
    body: JSON.stringify(credentials),
  });
  const payload = await parseJson(response);

  if (!response.ok) {
    const error = new Error(
      payload?.details?.join("，") || payload?.message || payload?.error || "登录失败，请重试。",
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  clearSessionCache();
  return payload;
}

export async function logoutOperator() {
  const response = await fetch(LOGOUT_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
    },
    credentials: "same-origin",
  });
  const payload = await parseJson(response);
  clearSessionCache();
  return payload;
}
