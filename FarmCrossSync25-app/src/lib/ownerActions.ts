// Owner-side farm controls (ticket 36): pending join requests and the
// owner-only "Make owner" / "Kick" row actions.
//
// DOM-, Tauri-, and network-free: every side effect is injected so the logic
// runs under `node --test` with fakes and the Svelte components stay thin.
// Spec (desktop-ui): "Owner-only row actions: 'Make owner' and kick." "Join
// Requests panel for the owner: Accept / Deny." "Confirmation dialogs before
// every destructive or replacing action (… kick, transfer ownership)."
//
// Current user resolution: the caller supplies the viewer's user id (production
// resolves it from the session token via `GET /me`; see httpOwnerApi). Ownership
// is derived from the member `role` for that user, falling back to the farm's
// `owner_id`. When ownership is false no owner-only dep is ever called.

import {
  createApiClient,
  type HttpMethod,
  type OnUnauthorized,
} from "./api.ts";

export interface Invite {
  id: string;
  farm_id?: string;
  user_id: string;
  status?: string;
  created_at: string;
  display_name: string;
}

export type ConfirmFn = (
  message: string,
  confirmLabel?: string,
) => boolean | Promise<boolean>;

export interface OwnerActionDeps {
  fetchInvites(farmId: string): Promise<Invite[]>;
  acceptInvite(inviteId: string): Promise<void>;
  denyInvite(inviteId: string): Promise<void>;
  transferOwner(farmId: string, userId: string): Promise<void>;
  kickMember(farmId: string, userId: string): Promise<void>;
  /** Production wires the confirmation dialog; injected so tests fake it. */
  confirm: ConfirmFn;
}

export interface OwnerActionsState {
  invites: Invite[];
  loadingInvites: boolean;
  error: string | null;
  busy: boolean;
}

export interface OwnerActions {
  /** Svelte store contract: `$owner` stays in sync with the state. */
  subscribe(run: (state: OwnerActionsState) => void): () => void;
  snapshot(): OwnerActionsState;
  /** Load pending requests; a no-op for non-owners. */
  loadInvites(farmId: string, isOwner: boolean): Promise<void>;
  accept(farmId: string, inviteId: string): Promise<void>;
  deny(farmId: string, inviteId: string): Promise<void>;
  /** Returns true only when confirmed and the transfer succeeded. */
  makeOwner(farmId: string, userId: string, displayName: string): Promise<boolean>;
  /** Returns true only when confirmed and the kick succeeded. */
  kick(farmId: string, userId: string, displayName: string): Promise<boolean>;
}

export function transferConfirmation(displayName: string): string {
  return `Make ${displayName} the farm owner? They will control joins, kicks, and ownership. You remain a member. Your local save is untouched.`;
}

export function kickConfirmation(displayName: string): string {
  return `Kick ${displayName} from the farm? Their cloud save in this farm will be deleted. Your local save is untouched.`;
}

/** Whether the viewer is the farm owner, per the member role / farm owner_id. */
export function viewerIsOwner(
  farm: { owner_id?: string } | null,
  members: Array<{ user_id: string; role: string }>,
  currentUserId: string | null,
): boolean {
  if (!currentUserId) return false;
  const self = members.find((member) => member.user_id === currentUserId);
  if (self) return self.role === "owner";
  return farm?.owner_id === currentUserId;
}

/**
 * Owner-only row actions only apply to other members: the owner cannot make
 * themselves owner or kick themselves (leaving is a separate member action).
 */
export function ownerRowActions(
  rowUserId: string,
  isOwner: boolean,
  currentUserId: string | null,
): { canMakeOwner: boolean; canKick: boolean } {
  const allowed = isOwner && currentUserId !== null && rowUserId !== currentUserId;
  return { canMakeOwner: allowed, canKick: allowed };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createOwnerActions(deps: OwnerActionDeps): OwnerActions {
  const state: OwnerActionsState = {
    invites: [],
    loadingInvites: false,
    error: null,
    busy: false,
  };
  const listeners = new Set<(state: OwnerActionsState) => void>();

  function snapshot(): OwnerActionsState {
    return { ...state, invites: state.invites.map((invite) => ({ ...invite })) };
  }

  function emit() {
    const view = snapshot();
    for (const run of listeners) run(view);
  }

  function fail(cause: unknown) {
    state.error = describe(cause);
    emit();
  }

  async function refreshInvites(farmId: string): Promise<void> {
    state.loadingInvites = true;
    state.error = null;
    emit();
    try {
      state.invites = await deps.fetchInvites(farmId);
    } catch (cause) {
      fail(cause);
    } finally {
      state.loadingInvites = false;
      emit();
    }
  }

  async function act(fn: () => Promise<void>): Promise<void> {
    state.busy = true;
    state.error = null;
    emit();
    try {
      await fn();
    } catch (cause) {
      fail(cause);
    } finally {
      state.busy = false;
      emit();
    }
  }

  return {
    subscribe(run) {
      run(snapshot());
      listeners.add(run);
      return () => listeners.delete(run);
    },
    snapshot,
    async loadInvites(farmId, isOwner) {
      if (!isOwner) {
        state.invites = [];
        state.loadingInvites = false;
        state.error = null;
        emit();
        return;
      }
      await refreshInvites(farmId);
    },
    async accept(farmId, inviteId) {
      await act(async () => {
        await deps.acceptInvite(inviteId);
        await refreshInvites(farmId);
      });
    },
    async deny(farmId, inviteId) {
      await act(async () => {
        await deps.denyInvite(inviteId);
        await refreshInvites(farmId);
      });
    },
    async makeOwner(farmId, userId, displayName) {
      const proceed = await deps.confirm(
        transferConfirmation(displayName),
        "Make owner",
      );
      if (!proceed) return false;
      await act(() => deps.transferOwner(farmId, userId));
      return state.error === null;
    },
    async kick(farmId, userId, displayName) {
      const proceed = await deps.confirm(kickConfirmation(displayName), "Kick");
      if (!proceed) return false;
      await act(() => deps.kickMember(farmId, userId));
      return state.error === null;
    },
  };
}

// --- Production data access ------------------------------------------------
// All calls route through the shared API client (ticket 76): one place builds
// the bearer header, and failures surface as `ApiError` carrying the HTTP
// status and the server error string (`{ "error": "<code>" }`).

export interface OwnerApi {
  fetchInvites(farmId: string): Promise<Invite[]>;
  acceptInvite(inviteId: string): Promise<void>;
  denyInvite(inviteId: string): Promise<void>;
  transferOwner(farmId: string, userId: string): Promise<void>;
  kickMember(farmId: string, userId: string): Promise<void>;
  /** Resolve the viewer's id from the session token via `GET /me`. */
  fetchCurrentUserId(): Promise<string | null>;
}

export function httpOwnerApi(
  baseUrl: string,
  getToken: () => Promise<string | null>,
  fetchImpl: typeof fetch = fetch,
  onUnauthorized?: OnUnauthorized,
): OwnerApi {
  const client = createApiClient({ baseUrl, getToken, fetchImpl, onUnauthorized });

  async function request(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    return (await client.request<Record<string, unknown>>(path, { method, body })) ?? {};
  }

  return {
    async fetchInvites(farmId) {
      const body = await request("GET", `/farms/${farmId}/invites`);
      return (body.invites as Invite[]) ?? [];
    },
    async acceptInvite(inviteId) {
      await request("POST", `/invites/${inviteId}/accept`);
    },
    async denyInvite(inviteId) {
      await request("POST", `/invites/${inviteId}/deny`);
    },
    async transferOwner(farmId, userId) {
      await request("POST", `/farms/${farmId}/transfer-owner`, { userId });
    },
    async kickMember(farmId, userId) {
      await request("DELETE", `/farms/${farmId}/members/${userId}`);
    },
    async fetchCurrentUserId() {
      const body = await request("GET", "/me");
      const user = body.user as { id?: string } | undefined;
      return user?.id ?? null;
    },
  };
}
