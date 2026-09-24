// Production R2 upload transport (ticket 41; file-based transfer ticket 85).
//
// `runUpload` is transport-agnostic: it hands `putToR2` the packed archive path
// and the `upload-authorize` result. This adapter owns the target selection —
// the presigned R2 URL, or the Worker's dev-only `/r2-test/:key` route for the
// documented local-dev placeholder (`presigned: false`, no R2 S3 credentials;
// see backend README) — and maps storage failures to the flow's error copy.
//
// The bytes move through the injected `putArchive`, which streams the archive
// file to the target (production: the `putArchiveFile` Rust command reads it
// from disk in bounded buffers). The archive is never materialized in the
// webview, so peak memory does not scale with the save size.
//
// DOM-, Tauri-, and network-free: `putArchive` and `fetchImpl` are injected, so
// the adapter runs under `node --test` and the upload e2e script.

import type { UploadAuthorization } from "./upload.ts";

export interface PutToR2Input {
  archivePath: string;
  sizeBytes: number;
  authorization: UploadAuthorization;
}

export interface PutArchiveRequest {
  /** Target URL: the presigned R2 URL or the local-dev `/r2-test` route. */
  url: string;
  method: string;
  /** Authorization headers to sign the request; undefined for local dev. */
  headers: Record<string, string> | undefined;
  /** Absolute path of the packed archive to stream as the body. */
  archivePath: string;
}

export interface PutToR2Options {
  /** API base URL, used only for the local-dev `/r2-test` fallback. */
  baseUrl: string;
  /**
   * Streams the packed archive file to `request.url` and resolves the response
   * status. Non-2xx statuses resolve as data (this adapter owns the error
   * copy); transport failures reject.
   */
  putArchive(request: PutArchiveRequest): Promise<number>;
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
  putArchive,
}: PutToR2Options): (input: PutToR2Input) => Promise<void> {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ archivePath, authorization }) => {
    // Local dev: the placeholder URL/host header are not usable, so PUT to the
    // Worker's dev route. The object key contains slashes but the route takes a
    // single path segment, so encode the whole key (`/` -> `%2F`); the Worker
    // decodes it back before storing the R2 object.
    const localDev = isLocalDevAuthorization(authorization);
    const url = localDev
      ? `${root}/r2-test/${encodeURIComponent(authorization.objectKey)}`
      : authorization.url;

    const status = await putArchive({
      url,
      method: localDev ? "PUT" : authorization.method || "PUT",
      headers: localDev ? undefined : authorization.headers,
      archivePath,
    });
    if (status < 200 || status >= 300) {
      throw new Error(
        `Upload to storage failed (${status}). The save was not published.`,
      );
    }
  };
}
