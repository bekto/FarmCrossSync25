// Production R2 download transport (ticket 42).
//
// Counterpart to `createPutToR2` (ticket 41). `runDownload` is transport-
// agnostic: it hands `fetchArchive` the `download-authorize` result and expects
// the archive bytes on local disk. This adapter GETs the archive — straight
// from the presigned R2 URL in production, or from the Worker's dev-only
// `/r2-test/:key` route when local dev returns the documented placeholder
// (`presigned: false`) — and persists it through the injected `stageArchive`,
// which owns the temp-file write (a scoped Rust command in production).
//
// DOM-, Tauri-, and network-free: `stageArchive` and `fetchImpl` are injected,
// so the adapter runs under `node --test` and the download e2e script.

import type { DownloadAuthorization } from "./download.ts";

export interface GetToDiskOptions {
  /** API base URL, used only for the local-dev `/r2-test` fallback. */
  baseUrl: string;
  /** Persists fetched archive bytes and returns the temp archive path. */
  stageArchive(bytes: Uint8Array): Promise<string>;
  fetchImpl?: typeof fetch;
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
 * Build the `fetchArchive` dep for `runDownload`. The returned function fetches
 * the archive named by `authorization` and resolves its local temp path. On a
 * non-ok response it throws before anything is written, so the caller's
 * original save is untouched.
 */
export function createGetToDisk({
  baseUrl,
  stageArchive,
  fetchImpl = fetch,
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

    const bytes = new Uint8Array(await res.arrayBuffer());
    return { archivePath: await stageArchive(bytes) };
  };
}
