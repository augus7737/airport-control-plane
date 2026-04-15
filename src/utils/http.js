export function jsonResponse(reply, statusCode, payload) {
  reply.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  reply.end(JSON.stringify(payload, null, 2));
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

    request.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        reject(new Error("request body too large"));
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid json"));
      }
    });

    request.on("error", reject);
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
