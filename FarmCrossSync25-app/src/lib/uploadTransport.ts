// Production R2 upload transport (ticket 41).
//
// `runUpload` is transport-agnostic: it hands `putToR2` the packed archive path
// and the `upload-authorize` result. This adapter is the real transport — it
// reads the archive bytes and PUTs them straight to the presigned R2 URL, so
// save bytes never pass through the Worker.
//
// Local dev has no R2 S3 credentials, so the Worker returns a documented
// placeholder authorization (`presigned: false`). This adapter recognises that
// marker and PUTs to the Worker's dev-only `/r2-test/:key` route instead; that
// route is gated by `ENABLE_R2_TEST=true` (see backend README). Without it, a
// local upload cannot complete.
//
// DOM-, Tauri-, and network-free: `readFile` and `fetchImpl` are injected, so
// the adapter runs under `node --test` and the upload e2e script.

import type { UploadAuthorization } from "./upload.ts";

export interface PutToR2Input {
  archivePath: string;
  sizeBytes: number;
  authorization: UploadAuthorization;
}

export interface PutToR2Options {
  /** API base URL, used only for the local-dev `/r2-test` fallback. */
  baseUrl: string;
  /** Reads the packed archive's bytes from disk (Tauri / node). */
  readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  fetchImpl?: typeof fetch;
}

/**
 * True when the Worker had no R2 S3 credentials and returned the placeholder
 * authorization. The `presigned: false` marker is what selects the local-dev
 * `/r2-test` fallback; a real presigned authorization has `presigned: true`.
 */
export function isLocalDevAuthorization(
  authorization: UploadAuthorization,
): boolean {
  return authorization.presigned === false;
}

export function createPutToR2({
  baseUrl,
  readFile,
  fetchImpl = fetch,
}: PutToR2Options): (input: PutToR2Input) => Promise<void> {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ archivePath, authorization }) => {
    const body = await readFile(archivePath);

    // Local dev: the placeholder URL/host header are not usable, so PUT to the
    // Worker's dev route. The object key contains slashes but the route takes a
    // single path segment, so encode the whole key (`/` -> `%2F`); the Worker
    // decodes it back before storing the R2 object.
    const localDev = isLocalDevAuthorization(authorization);
    const url = localDev
      ? `${root}/r2-test/${encodeURIComponent(authorization.objectKey)}`
      : authorization.url;

    const res = await fetchImpl(url, {
      method: localDev ? "PUT" : authorization.method || "PUT",
      headers: localDev ? undefined : authorization.headers,
      body,
    });
    if (!res.ok) {
      throw new Error(
        `Upload to storage failed (${res.status}). The save was not published.`,
      );
    }
  };
}
