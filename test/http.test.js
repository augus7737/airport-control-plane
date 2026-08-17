import { PassThrough } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";

import { jsonResponse, readJsonBody } from "../src/utils/http.js";

test("readJsonBody rejects oversized request bodies with statusCode 413", async () => {
  const request = new PassThrough();
  const bodyPromise = readJsonBody(request);

  request.end(Buffer.alloc(1024 * 1024 + 1, "a"));

  await assert.rejects(bodyPromise, (error) => {
    assert.equal(error.message, "request body too large");
    assert.equal(error.statusCode, 413);
    return true;
  });
});

test("jsonResponse maps request body limit errors to HTTP 413", () => {
  const reply = {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };

  jsonResponse(reply, 400, {
    error: "bad_request",
    message: "request body too large",
  });

  assert.equal(reply.statusCode, 413);
  assert.deepEqual(JSON.parse(reply.body), {
    error: "payload_too_large",
    message: "request body too large",
  });
});
