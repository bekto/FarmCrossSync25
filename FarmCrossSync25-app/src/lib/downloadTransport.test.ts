import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGetToDisk,
  isLocalDevDownloadAuthorization,
} from "./downloadTransport.ts";
import type { DownloadAuthorization } from "./download.ts";

const BYTES = new Uint8Array([9, 8, 7, 6]);

function auth(
  overrides: Partial<DownloadAuthorization> = {},
): DownloadAuthorization {
  return {
    objectKey: "farms/f1/players/u1/save",
    url: "https://r2.example/farms/f1/players/u1/save?sig=abc",
    method: "GET",
    headers: { host: "acct.r2.cloudflarestorage.com" },
    expiresAt: "2026-09-22T10:00:00.000Z",
    ...overrides,
  };
}

type Call = { url: string; init: RequestInit | undefined };

function recorder(bytes = BYTES, status = 200) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? undefined });
    return new Response(bytes, { status });
  };
  return { calls, fetchImpl };
}

test("presigned GET fetches the signed URL with its headers and stages the bytes", async () => {
  const { calls, fetchImpl } = recorder();
  const staged: Uint8Array[] = [];
  const get = createGetToDisk({
    baseUrl: "http://localhost:8787",
    stageArchive: async (bytes) => {
      staged.push(bytes);
      return "/tmp/download.zip";
    },
    fetchImpl,
  });

  const authorization = auth({ presigned: true });
  const result = await get(authorization);

  assert.deepEqual(result, { archivePath: "/tmp/download.zip" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, authorization.url);
  assert.equal(calls[0].init?.method, "GET");
  assert.deepEqual(calls[0].init?.headers, authorization.headers);
  assert.deepEqual(staged, [BYTES]);
});

test("placeholder authorization falls back to the Worker /r2-test route with an encoded key", async () => {
  const { calls, fetchImpl } = recorder();
  const get = createGetToDisk({
    baseUrl: "http://localhost:8787/",
    stageArchive: async () => "/tmp/download.zip",
    fetchImpl,
  });

  await get(
    auth({
      presigned: false,
      url: "https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_BUCKET>/farms/f1/players/u1/save",
    }),
  );

  assert.equal(
    calls[0].url,
    "http://localhost:8787/r2-test/farms%2Ff1%2Fplayers%2Fu1%2Fsave",
  );
  assert.equal(calls[0].init?.method, "GET");
  assert.equal(
    calls[0].init?.headers,
    undefined,
    "placeholder host header is not sent",
  );
});

test("a non-ok storage response rejects before staging and reports the status", async () => {
  const { fetchImpl } = recorder(BYTES, 404);
  let staged = false;
  const get = createGetToDisk({
    baseUrl: "http://localhost:8787",
    stageArchive: async () => {
      staged = true;
      return "/tmp/download.zip";
    },
    fetchImpl,
  });

  await assert.rejects(
    get(auth({ presigned: true })),
    /Download from storage failed \(404\)/,
  );
  assert.equal(staged, false, "nothing is written when the fetch fails");
});

test("isLocalDevDownloadAuthorization keys off the presigned marker", () => {
  assert.equal(isLocalDevDownloadAuthorization(auth({ presigned: false })), true);
  assert.equal(isLocalDevDownloadAuthorization(auth({ presigned: true })), false);
  assert.equal(isLocalDevDownloadAuthorization(auth()), false);
});
