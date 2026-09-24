import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGetToDisk,
  DEFAULT_CHUNK_BYTES,
  isLocalDevDownloadAuthorization,
} from "./downloadTransport.ts";
import type { GetToDiskOptions } from "./downloadTransport.ts";
import type { DownloadAuthorization } from "./download.ts";

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

interface StagingCalls {
  opened: number;
  appended: Uint8Array[];
  removed: string[];
  staged: () => Uint8Array;
}

function staging(): Pick<GetToDiskOptions, "openArchive" | "appendArchive" | "removeArchive"> & {
  calls: StagingCalls;
} {
  const calls: StagingCalls = {
    opened: 0,
    appended: [],
    removed: [],
    staged: () => {
      const total = calls.appended.reduce((n, chunk) => n + chunk.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of calls.appended) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    },
  };
  return {
    calls,
    openArchive: async () => {
      calls.opened += 1;
      return "/tmp/download.zip";
    },
    appendArchive: async (_path, chunk) => {
      calls.appended.push(chunk);
    },
    removeArchive: async (path) => {
      calls.removed.push(path);
    },
  };
}

/** A body yielding `totalBytes` in `chunkBytes` pieces without materializing. */
function syntheticBody(totalBytes: number, chunkBytes: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const n = Math.min(chunkBytes, totalBytes - sent);
      sent += n;
      controller.enqueue(new Uint8Array(n).fill(sent % 251));
    },
  });
}

const BYTES = new Uint8Array([9, 8, 7, 6]);

function recorder(bytes: Uint8Array, status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? undefined });
    return new Response(bytes, { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("presigned GET fetches the signed URL and stages the bytes", async () => {
  const { calls, fetchImpl } = recorder(BYTES);
  const stage = staging();
  const get = createGetToDisk({ baseUrl: "http://localhost:8787", ...stage, fetchImpl });

  const authorization = auth({ presigned: true });
  const result = await get(authorization);

  assert.deepEqual(result, { archivePath: "/tmp/download.zip" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, authorization.url);
  assert.equal(calls[0].init?.method, "GET");
  assert.deepEqual(calls[0].init?.headers, authorization.headers);
  assert.deepEqual(stage.calls.staged(), BYTES);
  assert.deepEqual(stage.calls.removed, [], "a complete archive is not removed");
});

test("staging streams in bounded chunks and never buffers the archive", async () => {
  const CHUNK = 4096;
  const TOTAL = 256 * 1024;
  const fetchImpl = (async () =>
    new Response(syntheticBody(TOTAL, 1024))) as unknown as typeof fetch;
  const stage = staging();
  const get = createGetToDisk({
    baseUrl: "http://localhost:8787",
    ...stage,
    fetchImpl,
    chunkBytes: CHUNK,
  });

  await get(auth({ presigned: true }));

  assert.equal(stage.calls.staged().length, TOTAL, "every byte staged exactly once");
  for (const chunk of stage.calls.appended) {
    assert.ok(chunk.length <= CHUNK, `append exceeded the chunk bound: ${chunk.length}`);
  }
});

test("a large transfer keeps process memory bounded by the chunk size", async () => {
  const TOTAL = 64 * 1024 * 1024;
  const fetchImpl = (async () =>
    new Response(syntheticBody(TOTAL, 256 * 1024))) as unknown as typeof fetch;
  let stagedBytes = 0;
  const get = createGetToDisk({
    baseUrl: "http://localhost:8787",
    openArchive: async () => "/tmp/large.zip",
    // The production append writes straight to disk; counting keeps this test
    // about the transport's memory, not the disk.
    appendArchive: async (_path, chunk) => {
      stagedBytes += chunk.length;
    },
    removeArchive: async () => {},
    fetchImpl,
  });

  const before = process.memoryUsage().heapUsed;
  await get(auth({ presigned: true }));
  const growth = process.memoryUsage().heapUsed - before;

  assert.equal(stagedBytes, TOTAL, "the whole archive streamed through");
  assert.ok(
    growth < TOTAL / 2,
    `heap grew ${growth} bytes staging ${TOTAL} bytes — the archive is being buffered`,
  );
});

test("placeholder authorization falls back to the Worker /r2-test route with an encoded key", async () => {
  const { calls, fetchImpl } = recorder(BYTES);
  const stage = staging();
  const get = createGetToDisk({ baseUrl: "http://localhost:8787/", ...stage, fetchImpl });

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
  const stage = staging();
  const get = createGetToDisk({ baseUrl: "http://localhost:8787", ...stage, fetchImpl });

  await assert.rejects(
    get(auth({ presigned: true })),
    /Download from storage failed \(404\)/,
  );
  assert.equal(stage.calls.opened, 0, "nothing is written when the fetch fails");
  assert.deepEqual(stage.calls.removed, []);
});

test("a mid-stream failure removes the partial archive and rethrows", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(16));
    },
    pull(controller) {
      controller.error(new Error("connection reset"));
    },
  });
  const fetchImpl = (async () => new Response(body)) as unknown as typeof fetch;
  const stage = staging();
  const get = createGetToDisk({ baseUrl: "http://localhost:8787", ...stage, fetchImpl });

  await assert.rejects(get(auth({ presigned: true })), /connection reset/);
  assert.deepEqual(stage.calls.removed, ["/tmp/download.zip"], "partial archive removed");
});

test("isLocalDevDownloadAuthorization keys off the presigned marker", () => {
  assert.equal(isLocalDevDownloadAuthorization(auth({ presigned: false })), true);
  assert.equal(isLocalDevDownloadAuthorization(auth({ presigned: true })), false);
  assert.equal(isLocalDevDownloadAuthorization(auth()), false);
});

test("the default chunk bound is far below any save archive", () => {
  assert.equal(DEFAULT_CHUNK_BYTES, 256 * 1024);
});
