/**
 * Cloud save storage contract (see specs/farm-crosssync-25/systems/cloud-save-sync.md).
 *
 * R2 key layout — the single definition; do not inline key strings elsewhere:
 *
 *   farms/{farm_id}/players/{user_id}/save
 *
 * One zip archive per player per farm, addressed by immutable IDs (never
 * display names). A re-upload overwrites the same key, so a player slot has at
 * most one object and there is no cloud history.
 */
export const saveObjectKey = (farmId: string, userId: string): string =>
  `farms/${farmId}/players/${userId}/save`;

/** Prefix covering every player save in a farm, for bulk deletion. */
export const farmSavesPrefix = (farmId: string): string =>
  `farms/${farmId}/players/`;

/**
 * The exact shape `saveObjectKey` produces, with `farmId` / `userId` restricted
 * to id characters (no dots, no slashes). Used to confine the development-only
 * `/r2-test` route to player-save keys so it cannot address arbitrary bucket
 * keys even when enabled. Traversal (`..`) is rejected explicitly on top of the
 * character restriction as defense in depth.
 */
export const PLAYER_SAVE_OBJECT_KEY_PATTERN =
  /^farms\/[A-Za-z0-9_-]+\/players\/[A-Za-z0-9_-]+\/save$/;

export const isPlayerSaveObjectKey = (key: string): boolean =>
  !key.includes("..") && PLAYER_SAVE_OBJECT_KEY_PATTERN.test(key);

/**
 * Whether an HTTP `Host` (optionally carrying a port, including bracketed IPv6
 * literals like `[::1]:8787`) points at loopback. The development-only R2
 * route requires this so a deployed Worker — whose request host is always the
 * public zone name — never serves it, even if its env vars are misconfigured.
 */
export const isLoopbackHost = (host: string): boolean => {
  const bracket = host.indexOf("]");
  const hostname = (
    bracket >= 0 ? host.slice(0, bracket + 1) : host.split(":")[0]
  ).toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
};

/**
 * Deletes every R2 object under a farm's player-save prefix, following list
 * pagination so a farm with many players is fully cleared. An R2 failure here
 * can leave orphaned objects behind; that is spec-acceptable (see
 * specs/farm-crosssync-25/systems/cloud-save-sync.md edge cases).
 */
export const deleteFarmSaves = async (
  bucket: R2Bucket,
  farmId: string,
): Promise<void> => {
  const prefix = farmSavesPrefix(farmId);
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length > 0) {
      await bucket.delete(page.objects.map((object) => object.key));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
};

/** Columns of a `player_saves` row (see migrations/0004_player_saves.sql). */
export const PLAYER_SAVES_FIELDS = [
  "farm_id",
  "user_id",
  "object_key",
  "file_size",
  "sha256",
  "save_name",
  "uploaded_at",
] as const;

export type PlayerSaveRow = {
  farm_id: string;
  user_id: string;
  object_key: string;
  file_size: number;
  sha256: string;
  save_name: string;
  uploaded_at: string;
};

/**
 * R2 S3 credentials, read from Worker secrets/vars. Presigning needs the S3
 * API (not the `BUCKET` binding), so uploads cannot be authorized without
 * them; when any are missing the caller falls back to a documented
 * placeholder (see README "Cloud save sync").
 */
export type R2S3Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export const r2S3Config = (env: {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
}): R2S3Config | null => {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } =
    env;
  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET
  ) {
    return null;
  }
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
  };
};

export type PresignedPut = {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
};

/**
 * Hard cap on a save archive's byte size, enforced by `upload-complete` against
 * the R2 object's actual size. The spec warns above ~200 MB but lets the
 * operation proceed (specs/farm-crosssync-25/systems/cloud-save-sync.md), so
 * the cap sits well above it. A deployment may lower/raise it via the
 * `MAX_SAVE_SIZE_BYTES` env var (a plain wrangler var/secret read at runtime);
 * unset or invalid values fall back to this documented default.
 */
export const DEFAULT_MAX_SAVE_SIZE_BYTES = 512 * 1024 * 1024;

export const maxSaveSizeBytes = (env: {
  MAX_SAVE_SIZE_BYTES?: string;
}): number => {
  const raw = env.MAX_SAVE_SIZE_BYTES;
  if (raw === undefined) return DEFAULT_MAX_SAVE_SIZE_BYTES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_SAVE_SIZE_BYTES;
};

export type PresignedGet = {
  url: string;
  method: "GET";
  headers: Record<string, string>;
  expiresAt: string;
};

const uriEncode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

const hmacSha256 = async (
  key: Uint8Array,
  message: string,
): Promise<Uint8Array> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message)),
  );
};

/**
 * AWS Signature Version 4 query-string presign shared by the R2 `PUT` (upload)
 * and `GET` (download) authorizations, scoped to region `auto`. The client
 * moves the archive straight to/from R2; the Worker only signs, never streams
 * bytes. Algorithm is verified against botocore's `S3SigV4QueryAuth` in the
 * unit test.
 *
 * The returned `expiresAt` is computed here; R2 enforces `X-Amz-Expires` when
 * the URL is used. Local R2 (the `BUCKET` binding) has no SigV4 layer, so the
 * expiry is not exercised in local dev.
 */
const presignR2 = async (
  method: "GET" | "PUT",
  config: R2S3Config,
  objectKey: string,
  expiresIn: number,
  now: Date,
): Promise<{ url: string; headers: Record<string, string>; expiresAt: string }> => {
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const path = `/${[config.bucket, ...objectKey.split("/")]
    .map(uriEncode)
    .join("/")}`;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;

  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((name) => `${uriEncode(name)}=${uriEncode(params[name])}`)
    .join("&");
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const canonicalHash = bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalRequest),
      ),
    ),
  );
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    canonicalHash,
  ].join("\n");

  const encoder = new TextEncoder();
  const kDate = await hmacSha256(
    encoder.encode(`AWS4${config.secretAccessKey}`),
    dateStamp,
  );
  const kRegion = await hmacSha256(kDate, "auto");
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = bytesToHex(await hmacSha256(kSigning, stringToSign));

  return {
    url: `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    headers: { host },
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
  };
};

/** Presigns a single R2 `PUT` (upload authorization). */
export const presignR2Put = async (
  config: R2S3Config,
  objectKey: string,
  expiresIn: number,
  now: Date,
): Promise<PresignedPut> => ({
  ...(await presignR2("PUT", config, objectKey, expiresIn, now)),
  method: "PUT",
});

/** Presigns a single R2 `GET` (download authorization). */
export const presignR2Get = async (
  config: R2S3Config,
  objectKey: string,
  expiresIn: number,
  now: Date,
): Promise<PresignedGet> => ({
  ...(await presignR2("GET", config, objectKey, expiresIn, now)),
  method: "GET",
});
