export function jsonResponse(reply, statusCode, payload) {
  const effectiveStatusCode =
    statusCode === 400 && payload?.message === "request body too large" ? 413 : statusCode;
  const effectivePayload =
    effectiveStatusCode === 413
      ? {
          error: "payload_too_large",
          message: payload.message,
        }
      : payload;

  reply.writeHead(effectiveStatusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  reply.end(JSON.stringify(effectivePayload, null, 2));
}

export function textResponse(reply, statusCode, contentType, body) {
  reply.writeHead(statusCode, {
    "content-type": `${contentType}; charset=utf-8`,
  });
  reply.end(body);
}

export function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;

    function fail(error) {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    }

    function succeed(payload) {
      if (settled) {
        return;
      }
      settled = true;
      resolve(payload);
    }

    request.on("data", (chunk) => {
      if (settled) {
        return;
      }

      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        const error = new Error("request body too large");
        error.statusCode = 413;
        fail(error);
      }
    });

    request.on("end", () => {
      if (settled) {
        return;
      }

      if (!body) {
        succeed({});
        return;
      }

      try {
        succeed(JSON.parse(body));
      } catch {
        fail(new Error("invalid json"));
      }
    });

    request.on("error", (error) => {
      if (settled && error?.code === "ECONNRESET") {
        return;
      }
      fail(error);
    });
  });
}

export function extractRemoteAddress(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }

  const remote = request.socket.remoteAddress ?? null;
  if (!remote) {
    return null;
  }

  return remote.startsWith("::ffff:") ? remote.slice(7) : remote;
}
