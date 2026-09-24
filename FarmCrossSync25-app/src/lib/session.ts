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

  async function runCloudAction<T>(
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    if (await ensureToken()) {
      state = "registered";
      return action();
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
  };
}

// Production register dependency: POST ${baseUrl}/register. The API client is a
// later ticket; this is the minimum wiring the deferral gate needs.
export function httpRegister(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): RegisterFn {
  return async (installationId, displayName) => {
    const res = await fetchImpl(`${baseUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installationId, displayName }),
    });
    if (!res.ok) throw new Error(`register failed: ${res.status}`);
    const body = (await res.json()) as { token?: string };
    if (!body.token) throw new Error("register response missing token");
    return { token: body.token };
  };
}
