import { test } from "node:test";
import assert from "node:assert/strict";
import { createPutToR2, isLocalDevAuthorization } from "./uploadTransport.ts";
import type { PutArchiveRequest } from "./uploadTransport.ts";
import type { UploadAuthorization } from "./upload.ts";

function auth(overrides: Partial<UploadAuthorization> = {}): UploadAuthorization {
  return {
    objectKey: "farms/f1/players/u1/save",
    url: "https://r2.example/farms/f1/players/u1/save?sig=abc",
    method: "PUT",
    headers: { host: "acct.r2.cloudflarestorage.com" },
    expiresAt: "2026-09-22T10:00:00.000Z",
    ...overrides,
  };
}

function recorder(status = 200) {
  const calls: PutArchiveRequest[] = [];
  return {
    calls,
    putArchive: async (request: PutArchiveRequest) => {
      calls.push(request);
      return status;
    },
  };
}

test("presigned authorization streams the archive file to the signed URL with its headers", async () => {
  const { calls, putArchive } = recorder();
  const put = createPutToR2({ baseUrl: "http://localhost:8787", putArchive });

  const authorization = auth({ presigned: true });
  await put({
    archivePath: "/tmp/save.zip",
    sizeBytes: 1234,
    authorization,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    url: authorization.url,
    method: "PUT",
    headers: authorization.headers,
    archivePath: "/tmp/save.zip",
  });
});

test("placeholder authorization falls back to the Worker /r2-test route with an encoded key", async () => {
  const { calls, putArchive } = recorder();
  const put = createPutToR2({ baseUrl: "http://localhost:8787/", putArchive });

  await put({
    archivePath: "/tmp/save.zip",
    sizeBytes: 1234,
    authorization: auth({
      presigned: false,
      url: "https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_BUCKET>/farms/f1/players/u1/save",
    }),
  });

  assert.equal(
    calls[0].url,
    "http://localhost:8787/r2-test/farms%2Ff1%2Fplayers%2Fu1%2Fsave",
  );
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].headers, undefined, "placeholder host header is not sent");
  assert.equal(calls[0].archivePath, "/tmp/save.zip");
});

test("a non-ok storage status rejects and reports the status", async () => {
  const { putArchive } = recorder(500);
  const put = createPutToR2({ baseUrl: "http://localhost:8787", putArchive });

  await assert.rejects(
    put({
      archivePath: "/tmp/save.zip",
      sizeBytes: 1234,
      authorization: auth({ presigned: true }),
    }),
    /Upload to storage failed \(500\)/,
  );
});

test("isLocalDevAuthorization keys off the presigned marker", () => {
  assert.equal(isLocalDevAuthorization(auth({ presigned: false })), true);
  assert.equal(isLocalDevAuthorization(auth({ presigned: true })), false);
  assert.equal(isLocalDevAuthorization(auth()), false);
});
