// Deferred-registration gate for cloud actions.
//
// Local tools (scan / validate / backup / replace in fs25.ts and token storage
// in identity.ts) never import this module and never touch the network. The
// installation is only registered on the first cloud action (create farm, join
// farm, upload, download); runCloudAction holds that action, drives the
// display-name prompt, then resumes the action in the same app session.
//
// All dependencies are injected so the state machine is DOM-, Tauri-, and
// network-free and can run under `node --test`.

import {
  createApiClient,
  UnauthorizedError,
  type OnUnauthorized,
} from "./api.ts";

export type SessionState =
  | "unregistered"
  | "awaitingName"
  | "registering"
  | "registered"
  | "error";

export const NEED_INTERNET_MESSAGE =
  "Unable to connect to cloud. Your local save has not been changed.";

export type RegisterFn = (
  installationId: string,
  displayName: string,
) => Promise<{ token: string }>;

export interface SessionDeps {
  getToken(): Promise<string | null>;
  storeToken(token: string): Promise<void>;
  getInstallationId(): Promise<string>;
  register: RegisterFn;
  onRequireDisplayName(): void;
  onError?(error: Error): void;
}

export interface Session {
  readonly state: SessionState;
  readonly error: Error | null;
  readonly isRegistered: boolean;
  runCloudAction<T>(action: () => Promise<T>): Promise<T | undefined>;
  submitDisplayName(name: string): Promise<boolean>;
  /**
   * 401 recovery: drop the cached token and return to the registration prompt.
   * The deferred cloud action (if any) stays queued and resumes after a
   * successful re-registration. Production also clears the stored token via
   * `clear_session_token` before calling this (ticket 76).
   */
  handleUnauthorized(): void;
}

export function createSession(deps: SessionDeps): Session {
  let state: SessionState = "unregistered";
  let error: Error | null = null;
  let token: string | null | undefined;
  let pending: (() => Promise<unknown>) | null = null;

  async function ensureToken(): Promise<string | null> {
    if (token === undefined) token = await deps.getToken();
    return token;
  }

  function handleUnauthorized(): void {
    // Null (not undefined) on purpose: the token is known-rejected, so it must
    // never be re-served from the cache even if the store clear failed.
    token = null;
    error = null;
    state = "awaitingName";
    deps.onRequireDisplayName();
  }

  async function runCloudAction<T>(
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    if (await ensureToken()) {
      state = "registered";
      try {
        return await action();
      } catch (cause) {
        if (!(cause instanceof UnauthorizedError)) throw cause;
        // The token expired or was revoked mid-action: re-queue the action so
        // it resumes after re-registration, and return to the prompt. The
        // onUnauthorized hook has already cleared the stored token.
        pending = action as () => Promise<unknown>;
        handleUnauthorized();
        return undefined;
      }
    }
    pending = action as () => Promise<unknown>;
    error = null;
    state = "awaitingName";
    deps.onRequireDisplayName();
    return undefined;
  }

  async function submitDisplayName(name: string): Promise<boolean> {
    if (state === "registering" || state === "registered") return false;
    const trimmed = name.trim();
    if (!trimmed) return false;

    state = "registering";
    error = null;
    try {
      const installationId = await deps.getInstallationId();
      const { token: newToken } = await deps.register(installationId, trimmed);
      await deps.storeToken(newToken);
      token = newToken;
      state = "registered";
      if (pending) {
        const action = pending;
        pending = null;
        await action();
      }
      return true;
    } catch (cause) {
      // Offline / register failure: stay unregistered, surface the error, and
      // keep the pending action queued so a retry resumes it. Local work untouched.
      state = "error";
      error = new Error(NEED_INTERNET_MESSAGE, { cause });
      deps.onError?.(error);
      return false;
    }
  }

  return {
    get state() {
      return state;
    },
    get error() {
      return error;
    },
    get isRegistered() {
      return state === "registered";
    },
    runCloudAction,
    submitDisplayName,
    handleUnauthorized,
  };
}

// Production register dependency: POST ${baseUrl}/register through the shared
// API client (ticket 76). It is a public call (`auth: false`, no token) and
// surfaces `ApiError` with the HTTP status and the server error string like
// every other production service; a 401 invokes the injected recovery hook.
export function httpRegister(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  onUnauthorized?: OnUnauthorized,
): RegisterFn {
  const client = createApiClient({ baseUrl, fetchImpl, onUnauthorized });
  return async (installationId, displayName) => {
    const body = await client.post<{ token?: string }>(
      "/register",
      { installationId, displayName },
      { auth: false },
    );
    if (!body?.token) throw new Error("register response missing token");
    return { token: body.token };
  };
}
