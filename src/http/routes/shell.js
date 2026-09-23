import { validateShellSessionCreate, validateShellSessionInput } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";

export function createShellRoutes(ctx) {
  const {
    closeShellSession,
    createShellSession,
    nodeStore,
    nowIso,
    safeDecodePathSegment,
    serializeShellSession,
    shellSessionStore,
  } = ctx;

  return async function handleShellRoutes({ request, reply, url }) {
    if (request.method === "POST" && url.pathname === "/api/v1/shell/sessions") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateShellSessionCreate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const node = nodeStore.get(payload.node_id);
        if (!node) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "node not found",
          });
          return;
        }

        const session = await createShellSession(node);
        jsonResponse(reply, 201, {
          session: serializeShellSession(session),
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    const shellSessionMatch = url.pathname.match(/^\/api\/v1\/shell\/sessions\/([^/]+)$/);
    if (shellSessionMatch && request.method === "GET") {
      const sessionId = safeDecodePathSegment(shellSessionMatch[1]);
      if (!sessionId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid shell session id",
        });
        return;
      }

      const session = shellSessionStore.get(sessionId);

      if (!session) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "shell session not found",
        });
        return;
      }

      jsonResponse(reply, 200, {
        session: serializeShellSession(session),
      });
      return;
    }

    if (shellSessionMatch && request.method === "DELETE") {
      const sessionId = safeDecodePathSegment(shellSessionMatch[1]);
      if (!sessionId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid shell session id",
        });
        return;
      }

      const session = shellSessionStore.get(sessionId);

      if (!session) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "shell session not found",
        });
        return;
      }

      closeShellSession(session);
      jsonResponse(reply, 200, {
        session: serializeShellSession(session),
      });
      return;
    }

    const shellInputMatch = url.pathname.match(/^\/api\/v1\/shell\/sessions\/([^/]+)\/input$/);
    if (shellInputMatch && request.method === "POST") {
      try {
        const sessionId = safeDecodePathSegment(shellInputMatch[1]);
        if (!sessionId) {
          jsonResponse(reply, 400, {
            error: "bad_request",
            message: "invalid shell session id",
          });
          return;
        }

        const session = shellSessionStore.get(sessionId);

        if (!session) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "shell session not found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const errors = validateShellSessionInput(payload);
        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        if (!session.process || session.status !== "open" || session.process.killed) {
          jsonResponse(reply, 409, {
            error: "session_not_writable",
            message: "shell session is not writable",
          });
          return;
        }

        session.process.stdin.write(payload.data);
        session.updated_at = nowIso();

        jsonResponse(reply, 200, {
          session: serializeShellSession(session),
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }
  };
}
