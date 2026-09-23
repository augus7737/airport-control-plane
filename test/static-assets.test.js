import test from "node:test";
import assert from "node:assert/strict";

import {
  contentTypeForPath,
  servePublicAsset,
  serveStaticFile,
} from "../src/utils/static-assets.js";

function createReply() {
  const headers = new Map();
  return {
    statusCode: null,
    body: null,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    writeHead(statusCode, extra = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(extra)) {
        headers.set(name.toLowerCase(), value);
      }
    },
    end(body) {
      this.body = body;
    },
  };
}

const deps = {
  readFile: async (filePath) => `body-of:${filePath}`,
  textResponse: (reply, statusCode, contentType, body) => {
    reply.writeHead(statusCode, { "content-type": `${contentType}; charset=utf-8` });
    reply.end(body);
  },
};

test("static assets are served with no-cache so UI edits show up on reload", async () => {
  const reply = createReply();

  assert.equal(await serveStaticFile(reply, "/public/styles/app.css", "text/css", deps), true);
  assert.equal(reply.getHeader("cache-control"), "no-cache");
  assert.equal(reply.statusCode, 200);
  assert.equal(reply.body, "body-of:/public/styles/app.css");
});

test("static asset serving still reports missing files as not served", async () => {
  const reply = createReply();
  const missingDeps = {
    ...deps,
    readFile: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  };

  assert.equal(await serveStaticFile(reply, "/public/nope.html", "text/html", missingDeps), false);
});

test("public asset paths resolve through page aliases and stay inside publicDir", async () => {
  const publicDir = "/srv/app/public";
  const stat = async () => ({ isFile: () => true });

  assert.equal(
    await servePublicAsset(createReply(), "/nodes", {
      publicDir,
      stat,
      readFile: async (filePath) => filePath,
      textResponse: (reply, statusCode, contentType, body) => reply.end(body),
    }),
    true,
  );

  const escaped = await servePublicAsset(createReply(), "/../../etc/passwd", {
    publicDir,
    stat,
    ...deps,
  });
  assert.equal(escaped, false);
});

test("content types cover the shipped asset extensions", () => {
  assert.equal(contentTypeForPath("/p/index.html"), "text/html");
  assert.equal(contentTypeForPath("/p/styles/app.css"), "text/css");
  assert.equal(contentTypeForPath("/p/js/app.js"), "application/javascript");
  assert.equal(contentTypeForPath("/p/data.json"), "application/json");
  assert.equal(contentTypeForPath("/p/robots.txt"), "text/plain");
});
