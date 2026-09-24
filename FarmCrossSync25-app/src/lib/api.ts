// The single API client (ticket 40).
//
// DOM-, Tauri-, and network-free: the base URL, token source, fetch, and the
// unauthorized hook are all injected, so the client runs under `node --test`
// with fakes. It is the one place that builds the `Authorization: Bearer`
// header. Protected calls attach the session token via `getToken` (production
// wires `identity.getSessionToken`); public calls (`POST /register`) set
// `auth: false` and omit it.
//
// 401s are never swallowed: the client throws `UnauthorizedError` and invokes
// the injected `onUnauthorized` hook so the session layer can clear the stale
// token and prompt re-registration / retry.

import {
  configuredApiBaseUrl,
  resolveApiBaseUrl,
  type AppEnv,
} from "./config.ts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  /** Default true. Set false for public calls that must not carry a token. */
  auth?: boolean;
  signal?: AbortSignal;
}

/** Structured failure carrying the HTTP status and server error code/message. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const UNAUTHORIZED_MESSAGE =
  "Your session has expired. Register again to continue.";

/**
 * A 401: the token is missing or invalid. Callers catch this to surface a
 * re-register / retry path instead of failing silently.
 */
export class UnauthorizedError extends ApiError {
  constructor(message = UNAUTHORIZED_MESSAGE, code: string | null = "unauthorized") {
    super(401, message, code);
    this.name = "UnauthorizedError";
  }
}

export interface ApiClient {
  readonly baseUrl: string;
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
}

export interface ApiClientOptions {
  /** Explicit base URL. Takes precedence over `env`. */
  baseUrl?: string;
  /** Environment to resolve the base URL from. Default: `configuredAppEnv()`. */
  env?: AppEnv;
  /** Token source for protected calls. Omit to make every call unauthenticated. */
  getToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** Invoked before a 401 is thrown, so the session layer can recover. */
  onUnauthorized?: (error: UnauthorizedError) => void | Promise<void>;
}

interface ErrorBody {
  code: string | null;
  message: string;
}

async function parseError(res: Response): Promise<ErrorBody> {
  const fallback = `Request failed (${res.status})`;
  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    return { code: null, message: fallback };
  }
  if (raw && typeof raw === "object") {
    const body = raw as Record<string, unknown>;
    const error = body.error;
    if (typeof error === "string") return { code: error, message: error };
    if (error && typeof error === "object") {
      const nested = error as Record<string, unknown>;
      return {
        code: typeof nested.code === "string" ? nested.code : null,
        message: typeof nested.message === "string" ? nested.message : fallback,
      };
    }
    if (typeof body.message === "string") {
      return { code: null, message: body.message };
    }
  }
  return { code: null, message: fallback };
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

export function createApiClient({
  baseUrl,
  env,
  getToken,
  fetchImpl = fetch,
  onUnauthorized,
}: ApiClientOptions = {}): ApiClient {
  const resolvedBase = (
    baseUrl ?? (env ? resolveApiBaseUrl(env) : configuredApiBaseUrl())
  ).replace(/\/+$/, "");

  async function request<T>(
    path: string,
    { method = "GET", body, auth = true, signal }: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth && getToken) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetchImpl(`${resolvedBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const { code, message } = await parseError(res);
      if (res.status === 401) {
        const error = new UnauthorizedError(message, code);
        await onUnauthorized?.(error);
        throw error;
      }
      throw new ApiError(res.status, message, code);
    }

    return (await parseBody(res)) as T;
  }

  return {
    baseUrl: resolvedBase,
    request,
    get: <T>(path: string, options?: RequestOptions) =>
      request<T>(path, { ...options, method: "GET" }),
    post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>(path, { ...options, method: "POST", body }),
  };
}
