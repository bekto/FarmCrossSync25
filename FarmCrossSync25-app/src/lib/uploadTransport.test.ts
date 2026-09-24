import { test } from "node:test";
import assert from "node:assert/strict";
import { createPutToR2, isLocalDevAuthorization } from "./uploadTransport.ts";
import type { UploadAuthorization } from "./upload.ts";

const BYTES = new Uint8Array([1, 2, 3, 4]);

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

type Call = { url: string; init: RequestInit | undefined };

function recorder(status = 200) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? undefined });
    return new Response(null, { status });
  };
  return { calls, fetchImpl };
}

test("presigned authorization PUTs the archive bytes to the signed URL with its headers", async () => {
  const { calls, fetchImpl } = recorder();
  const put = createPutToR2({
    baseUrl: "http://localhost:8787",
    readFile: async () => BYTES,
    fetchImpl,
  });

  const authorization = auth({ presigned: true });
  await put({
    archivePath: "/tmp/save.zip",
    sizeBytes: BYTES.length,
    authorization,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, authorization.url);
  assert.equal(calls[0].init?.method, "PUT");
  assert.deepEqual(calls[0].init?.headers, authorization.headers);
  assert.equal(calls[0].init?.body, BYTES);
});

test("placeholder authorization falls back to the Worker /r2-test route with an encoded key", async () => {
  const { calls, fetchImpl } = recorder();
  const put = createPutToR2({
    baseUrl: "http://localhost:8787/",
    readFile: async () => BYTES,
    fetchImpl,
  });

  await put({
    archivePath: "/tmp/save.zip",
    sizeBytes: BYTES.length,
    authorization: auth({
      presigned: false,
      url: "https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_BUCKET>/farms/f1/players/u1/save",
    }),
  });

  assert.equal(
    calls[0].url,
    "http://localhost:8787/r2-test/farms%2Ff1%2Fplayers%2Fu1%2Fsave",
  );
  assert.equal(calls[0].init?.method, "PUT");
  assert.equal(calls[0].init?.headers, undefined, "placeholder host header is not sent");
  assert.equal(calls[0].init?.body, BYTES);
});

test("a non-ok storage response rejects and reports the status", async () => {
  const { fetchImpl } = recorder(500);
  const put = createPutToR2({
    baseUrl: "http://localhost:8787",
    readFile: async () => BYTES,
    fetchImpl,
  });

  await assert.rejects(
    put({
      archivePath: "/tmp/save.zip",
      sizeBytes: BYTES.length,
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
