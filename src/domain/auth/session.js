import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const DEFAULT_COOKIE_NAME = "airport_operator_session";
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const FALLBACK_USERNAME = "admin";
const EXPIRED_COOKIE_DATE = "Thu, 01 Jan 1970 00:00:00 GMT";

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseBoolean(value) {
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

function parseCookies(headerValue) {
  const cookies = {};
  if (typeof headerValue !== "string" || headerValue.length === 0) {
    return cookies;
  }

  for (const part of headerValue.split(";")) {
    const [rawName, ...rawValue] = part.split("=");
    const name = rawName?.trim();
    if (!name) {
      continue;
    }

    cookies[name] = decodeURIComponent(rawValue.join("=").trim());
  }

  return cookies;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ""), "utf8");
  const rightBuffer = Buffer.from(String(right ?? ""), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function appendSetCookie(reply, cookieValue) {
  const existing = reply.getHeader("Set-Cookie");
  if (existing == null) {
    reply.setHeader("Set-Cookie", cookieValue);
    return;
  }

  if (Array.isArray(existing)) {
    reply.setHeader("Set-Cookie", [...existing, cookieValue]);
    return;
  }

  reply.setHeader("Set-Cookie", [existing, cookieValue]);
}

function sanitizeNextPath(nextPath) {
  if (typeof nextPath !== "string") {
    return "/";
  }

  const trimmed = nextPath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }

  return trimmed;
}

export function createOperatorSessionAuth(options = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;
  const now = options.now ?? (() => Date.now());

  const configuredUsername =
    normalizeString(env.CONTROL_PLANE_AUTH_USERNAME) ??
    normalizeString(env.OPERATOR_USERNAME) ??
    normalizeString(env.CONTROL_PLANE_USERNAME) ??
    FALLBACK_USERNAME;

  let configuredPassword =
    normalizeString(env.CONTROL_PLANE_AUTH_PASSWORD) ??
    normalizeString(env.OPERATOR_PASSWORD) ??
    normalizeString(env.CONTROL_PLANE_PASSWORD) ??
    null;

  let usesFallbackCredentials = false;
  if (!configuredPassword) {
    configuredPassword = randomBytes(18).toString("base64url");
    usesFallbackCredentials = true;
    logger.warn(
      `[auth] 未配置控制面登录凭据，已启用临时账号。username=${configuredUsername} password=${configuredPassword}`,
    );
  }

  const cookieName = normalizeString(env.CONTROL_PLANE_SESSION_COOKIE_NAME) ?? DEFAULT_COOKIE_NAME;
  const sessionTtlMs = Math.max(
    60 * 1000,
    Number.parseInt(env.CONTROL_PLANE_SESSION_TTL_MS ?? `${DEFAULT_SESSION_TTL_MS}`, 10) ||
      DEFAULT_SESSION_TTL_MS,
  );
  const forcedSecureCookie = parseBoolean(env.CONTROL_PLANE_SESSION_SECURE);
  const sessionStore = new Map();

  const cleanupIntervalMs = Math.min(sessionTtlMs, 30 * 60 * 1000);
  const cleanupTimer = setInterval(() => {
    const currentTime = now();
    for (const [sessionId, session] of sessionStore.entries()) {
      if (session.expires_at_ms <= currentTime) {
        sessionStore.delete(sessionId);
      }
    }
  }, cleanupIntervalMs);
  cleanupTimer.unref?.();

  function shouldUseSecureCookie(request) {
    if (forcedSecureCookie != null) {
      return forcedSecureCookie;
    }

    const forwardedProto = request.headers["x-forwarded-proto"];
    if (typeof forwardedProto === "string") {
      return forwardedProto.split(",")[0].trim().toLowerCase() === "https";
    }

    return false;
  }

  function sessionCookie(sessionId, request) {
    const parts = [
      `${cookieName}=${encodeURIComponent(sessionId)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
    ];

    if (shouldUseSecureCookie(request)) {
      parts.push("Secure");
    }

    return parts.join("; ");
  }

  function clearCookie(request) {
    const parts = [
      `${cookieName}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
      `Expires=${EXPIRED_COOKIE_DATE}`,
    ];

    if (shouldUseSecureCookie(request)) {
      parts.push("Secure");
    }

    return parts.join("; ");
  }

  function serializeSession(session) {
    if (!session) {
      return null;
    }

    return {
      id: session.id,
      username: session.username,
      created_at: session.created_at,
      last_seen_at: session.last_seen_at,
      expires_at: new Date(session.expires_at_ms).toISOString(),
    };
  }

  function currentSession(request, { refresh = true } = {}) {
    const cookies = parseCookies(request.headers.cookie);
    const sessionId = cookies[cookieName];
    if (!sessionId) {
      return null;
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      return null;
    }

    const currentTime = now();
    if (session.expires_at_ms <= currentTime) {
      sessionStore.delete(sessionId);
      return null;
    }

    if (refresh) {
      session.last_seen_at = new Date(currentTime).toISOString();
      session.expires_at_ms = currentTime + sessionTtlMs;
    }

    return serializeSession(session);
  }

  function createSession(username) {
    const currentTime = now();
    const session = {
      id: randomUUID(),
      username,
      created_at: new Date(currentTime).toISOString(),
      last_seen_at: new Date(currentTime).toISOString(),
      expires_at_ms: currentTime + sessionTtlMs,
    };
    sessionStore.set(session.id, session);
    return serializeSession(session);
  }

  function login({ username, password, request, reply }) {
    const normalizedUsername = normalizeString(username) ?? "";
    const normalizedPassword = String(password ?? "");
    if (!safeEqual(normalizedUsername, configuredUsername) || !safeEqual(normalizedPassword, configuredPassword)) {
      return {
        ok: false,
        error: "invalid_credentials",
        message: "用户名或密码错误。",
      };
    }

    const session = createSession(configuredUsername);
    appendSetCookie(reply, sessionCookie(session.id, request));

    return {
      ok: true,
      session,
    };
  }

  function logout({ request, reply }) {
    const cookies = parseCookies(request.headers.cookie);
    const sessionId = cookies[cookieName];
    if (sessionId) {
      sessionStore.delete(sessionId);
    }

    appendSetCookie(reply, clearCookie(request));
  }

  function renderLoginPage({ nextPath = "/", errorMessage = "" } = {}) {
    const safeNextPath = htmlEscape(sanitizeNextPath(nextPath));
    const safeErrorMessage = htmlEscape(errorMessage);

    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>登录控制台</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f6fb;
        --panel: rgba(255, 255, 255, 0.94);
        --panel-border: rgba(148, 163, 184, 0.22);
        --text: #0f172a;
        --muted: #64748b;
        --accent: #0f766e;
        --accent-strong: #115e59;
        --danger: #b91c1c;
        --shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        font-family: "PingFang SC", "Noto Sans SC", "Helvetica Neue", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(15, 118, 110, 0.18), transparent 32%),
          radial-gradient(circle at bottom right, rgba(59, 130, 246, 0.12), transparent 28%),
          var(--bg);
      }
      .login-shell {
        width: min(100%, 420px);
        background: var(--panel);
        border: 1px solid var(--panel-border);
        border-radius: 22px;
        box-shadow: var(--shadow);
        padding: 28px;
        backdrop-filter: blur(18px);
      }
      .eyebrow {
        margin: 0 0 10px;
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-size: 28px;
      }
      .subtitle {
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.7;
      }
      form {
        display: grid;
        gap: 14px;
        margin-top: 24px;
      }
      label {
        display: grid;
        gap: 8px;
        font-size: 13px;
        color: var(--muted);
      }
      input {
        width: 100%;
        border: 1px solid rgba(148, 163, 184, 0.32);
        border-radius: 14px;
        padding: 12px 14px;
        font-size: 14px;
        color: var(--text);
        background: rgba(255, 255, 255, 0.95);
      }
      input:focus {
        outline: none;
        border-color: rgba(15, 118, 110, 0.6);
        box-shadow: 0 0 0 4px rgba(15, 118, 110, 0.12);
      }
      button {
        border: none;
        border-radius: 14px;
        padding: 12px 14px;
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        cursor: pointer;
      }
      button:disabled {
        cursor: wait;
        opacity: 0.7;
      }
      .message {
        min-height: 20px;
        font-size: 13px;
        color: var(--danger);
      }
      .hint {
        margin-top: 18px;
        font-size: 12px;
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main class="login-shell">
      <p class="eyebrow">Airport Control Plane</p>
      <h1>登录控制台</h1>
      <p class="subtitle">控制面页面与运营接口现已启用会话鉴权。登录后会写入本地会话 Cookie。</p>
      <form id="login-form">
        <input type="hidden" name="next" value="${safeNextPath}" />
        <label>
          用户名
          <input name="username" autocomplete="username" placeholder="请输入用户名" required />
        </label>
        <label>
          密码
          <input type="password" name="password" autocomplete="current-password" placeholder="请输入密码" required />
        </label>
        <div class="message" id="login-message">${safeErrorMessage}</div>
        <button type="submit" id="login-submit">进入控制台</button>
      </form>
      <p class="hint">建议尽快通过环境变量配置正式账号密码，不要长期使用临时凭据。</p>
    </main>
    <script>
      const form = document.getElementById("login-form");
      const message = document.getElementById("login-message");
      const submit = document.getElementById("login-submit");

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        message.textContent = "";

        const formData = new FormData(form);
        const payload = {
          username: String(formData.get("username") || ""),
          password: String(formData.get("password") || ""),
          next: String(formData.get("next") || "/"),
        };

        try {
          const response = await fetch("/api/v1/auth/login", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          const result = await response.json().catch(() => ({}));

          if (!response.ok) {
            message.textContent = result.message || "登录失败，请稍后重试。";
            submit.disabled = false;
            return;
          }

          window.location.href = result.next_url || "/";
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : "登录失败，请稍后重试。";
          submit.disabled = false;
        }
      });
    </script>
  </body>
</html>`;
  }

  return {
    configuredUsername,
    cookieName,
    usesFallbackCredentials,
    sanitizeNextPath,
    currentSession,
    login,
    logout,
    renderLoginPage,
  };
}
