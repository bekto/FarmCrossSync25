// Production R2 download transport (ticket 42; streamed staging ticket 85).
//
// Counterpart to `createPutToR2` (ticket 41). `runDownload` is transport-
// agnostic: it hands `fetchArchive` the `download-authorize` result and expects
// the archive bytes on local disk. This adapter GETs the archive — straight
// from the presigned R2 URL in production, or from the Worker's dev-only
// `/r2-test/:key` route when local dev returns the documented placeholder
// (`presigned: false`) — and stages it through the injected archive fns.
//
// Staging is streamed: the response body is drained in bounded chunks (batched
// to `chunkBytes` per append) and each chunk is written straight to the temp
// file. The full archive is never a number array over IPC and never exists in
// webview memory — peak memory is one chunk regardless of archive size.
//
// DOM-, Tauri-, and network-free: the archive fns and `fetchImpl` are injected,
// so the adapter runs under `node --test` and the download e2e script.

import type { DownloadAuthorization } from "./download.ts";

/** Bytes buffered per staged append unless overridden. */
export const DEFAULT_CHUNK_BYTES = 256 * 1024;

export interface GetToDiskOptions {
  /** API base URL, used only for the local-dev `/r2-test` fallback. */
  baseUrl: string;
  /** Creates a fresh temp archive for streamed writes; resolves its path. */
  openArchive(): Promise<string>;
  /** Appends one chunk of fetched bytes to the staged archive (result ignored). */
  appendArchive(archivePath: string, chunk: Uint8Array): Promise<unknown>;
  /** Removes a staged (possibly partial) archive; failures here are ignored. */
  removeArchive(archivePath: string): Promise<void>;
  fetchImpl?: typeof fetch;
  /** Max bytes buffered per append. Defaults to {@link DEFAULT_CHUNK_BYTES}. */
  chunkBytes?: number;
}

/**
 * True when the Worker had no R2 S3 credentials and returned the placeholder
 * download authorization. The `presigned: false` marker is what selects the
 * local-dev `/r2-test` fallback; a real presigned authorization has
 * `presigned: true`.
 */
export function isLocalDevDownloadAuthorization(
  authorization: DownloadAuthorization,
): boolean {
  return authorization.presigned === false;
}

/**
 * Drain `body` into `append` in bounded chunks. Stream chunks are copied out
 * of the stream's buffers and batched up to `chunkBytes` per append, so live
 * memory is one chunk — never the archive.
 */
async function stageStream(
  body: ReadableStream<Uint8Array> | null,
  append: (chunk: Uint8Array) => Promise<unknown>,
  chunkBytes: number,
): Promise<void> {
  if (!body) return;
  const reader = body.getReader();
  let batch: Uint8Array[] = [];
  let batchBytes = 0;
  const flush = async () => {
    if (batchBytes === 0) return;
    const out = new Uint8Array(batchBytes);
    let offset = 0;
    for (const chunk of batch) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    batch = [];
    batchBytes = 0;
    await append(out);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.length === 0) continue;
    if (value.length >= chunkBytes) {
      await flush();
      await append(value.slice());
    } else {
      batch.push(value.slice());
      batchBytes += value.length;
      if (batchBytes >= chunkBytes) await flush();
    }
  }
  await flush();
}

/**
 * Build the `fetchArchive` dep for `runDownload`. The returned function fetches
 * the archive named by `authorization` and streams it to the staged temp file,
 * resolving its path. On a non-ok response it throws before anything is
 * written; on a mid-stream failure it removes the partial archive, so the
 * caller's original save is untouched and no temp file leaks.
 */
export function createGetToDisk({
  baseUrl,
  openArchive,
  appendArchive,
  removeArchive,
  fetchImpl = fetch,
  chunkBytes = DEFAULT_CHUNK_BYTES,
}: GetToDiskOptions): (
  authorization: DownloadAuthorization,
) => Promise<{ archivePath: string }> {
  const root = baseUrl.replace(/\/+$/, "");
  return async (authorization) => {
    // Local dev: the placeholder URL/host header are not usable, so GET from the
    // Worker's dev route. The object key contains slashes but the route takes a
    // single path segment, so encode the whole key (`/` -> `%2F`); the Worker
    // decodes it back before reading the R2 object.
    const localDev = isLocalDevDownloadAuthorization(authorization);
    const url = localDev
      ? `${root}/r2-test/${encodeURIComponent(authorization.objectKey)}`
      : authorization.url;

    const res = await fetchImpl(url, {
      method: localDev ? "GET" : authorization.method || "GET",
      headers: localDev ? undefined : authorization.headers,
    });
    if (!res.ok) {
      throw new Error(
        `Download from storage failed (${res.status}). The local save was not replaced.`,
      );
    }

    const archivePath = await openArchive();
    try {
      await stageStream(res.body, (chunk) => appendArchive(archivePath, chunk), chunkBytes);
      return { archivePath };
    } catch (cause) {
      await removeArchive(archivePath).catch(() => {
        // a partial archive is disposable; failed cleanup must not mask the cause
      });
      throw cause;
    }
  };
}
