// Farm screen view logic + 20-second refresh (ticket 35).
//
// DOM-, Tauri-, and network-free: every side effect is injected so the view
// model can be built and refreshed under `node --test` with fakes and the
// Svelte components stay thin. Spec (desktop-ui): "Farm screen: farm name +
// code with copy, latest upload, player list (name, last upload time,
// online-dot style indicator), primary actions Upload My Save and Download on
// rows." "A dropdown on the Farm screen switches the active farm." "20-second
// polling of invites and saves."
//
// The active-farm selection lives in uiState.ts; this module receives the id
// and reloads farm detail/members/saves, restarting the poll for the new farm.

import {
  createApiClient,
  type OnUnauthorized,
} from "./api.ts";
import { describeError } from "./errors.ts";
import { createPoll, type PollScheduler } from "./poll.ts";

/** Farm detail as returned by `GET /farms/:farmId` (`{ farm }`). */
export interface FarmDetail {
  id: string;
  code: string;
  name: string;
  owner_id?: string;
  created_at?: string;
}

/** Member row as returned by `GET /farms/:farmId/members` (`{ members }`). */
export interface Member {
  user_id: string;
  display_name: string;
  role: string;
  joined_at: string;
}

/** Save row as returned by `GET /farms/:farmId/saves` (`{ saves }`). */
export interface PlayerSave {
  user_id: string;
  display_name: string;
  save_name: string;
  file_size: number;
  sha256: string;
  uploaded_at: string;
  object_key: string;
}

/** The max-`uploaded_at` save across the farm, surfaced at the top. */
export interface LatestUpload {
  user_id: string;
  display_name: string;
  save_name: string;
  uploaded_at: string;
  file_size: number;
  sha256: string;
}

export interface PlayerRow {
  user_id: string;
  display_name: string;
  role: string;
  isOwner: boolean;
  lastUploadAt: string | null;
  save: PlayerSave | null;
  /**
   * The backend has no presence endpoint, so the "online dot" is derived from
   * upload recency: a player counts as active when their last upload is within
   * RECENT_UPLOAD_WINDOW_MS. Members with no save are always offline.
   * Ticket 36+ can swap this for a real signal; the dot is presentational only.
   */
  online: boolean;
}

export interface FarmView {
  farm: FarmDetail | null;
  latestUpload: LatestUpload | null;
  players: PlayerRow[];
  loading: boolean;
  error: string | null;
  actionError: string | null;
  actionMessage: string | null;
}

/** Upload recency window for the derived online dot (no presence endpoint). */
export const RECENT_UPLOAD_WINDOW_MS = 5 * 60 * 1000;

export interface FarmData {
  farm: FarmDetail;
  latestUpload: LatestUpload | null;
  players: PlayerRow[];
}

function toLatestUpload(save: PlayerSave): LatestUpload {
  return {
    user_id: save.user_id,
    display_name: save.display_name,
    save_name: save.save_name,
    uploaded_at: save.uploaded_at,
    file_size: save.file_size,
    sha256: save.sha256,
  };
}

function mostRecent(saves: PlayerSave[]): PlayerSave | null {
  let best: PlayerSave | null = null;
  for (const save of saves) {
    if (best === null) {
      best = save;
      continue;
    }
    const a = Date.parse(save.uploaded_at);
    const b = Date.parse(best.uploaded_at);
    // NaN comparisons are false: an unparseable timestamp never displaces a
    // parsed one, and the first save wins when every timestamp is unparseable.
    if (a > b) best = save;
  }
  return best;
}

/**
 * Pure view-model builder: join saves to members by `user_id` (last upload per
 * member, "never" when absent), compute the latest upload overall, and derive
 * the online dot from recency. Members order is preserved (backend sends
 * `joined_at ASC`).
 */
export function buildFarmView(
  farm: FarmDetail,
  members: Member[],
  saves: PlayerSave[],
  now: number = Date.now(),
): FarmData {
  const byUser = new Map<string, PlayerSave>();
  for (const save of saves) byUser.set(save.user_id, save);

  const players: PlayerRow[] = members.map((member) => {
    const save = byUser.get(member.user_id) ?? null;
    const uploadedAt = save ? Date.parse(save.uploaded_at) : Number.NaN;
    const online =
      save !== null && now - uploadedAt <= RECENT_UPLOAD_WINDOW_MS;
    return {
      user_id: member.user_id,
      display_name: member.display_name,
      role: member.role,
      isOwner: member.role === "owner",
      lastUploadAt: save?.uploaded_at ?? null,
      save,
      online,
    };
  });

  const latest = mostRecent(saves);
  return { farm, latestUpload: latest ? toLatestUpload(latest) : null, players };
}

/** Slim result the screen returns from upload/download so the UI can react. */
export interface ActionResult {
  ok: boolean;
  message?: string;
}

export interface FarmScreenDeps {
  fetchFarm(farmId: string): Promise<FarmDetail>;
  fetchMembers(farmId: string): Promise<Member[]>;
  fetchSaves(farmId: string): Promise<PlayerSave[]>;
  copyToClipboard(text: string): Promise<void>;
  /** Production wires this to runUpload (ticket 30). */
  runUpload(input: { farmId: string; savePath: string }): Promise<ActionResult>;
  /** Production wires this to runDownloadWithConflict (tickets 31/32). */
  runDownload(input: {
    farmId: string;
    playerId: string;
    save: PlayerSave;
  }): Promise<ActionResult>;
  now?(): number;
}

export interface FarmScreenOptions {
  intervalMs?: number;
  scheduler?: PollScheduler;
  immediate?: boolean;
  onError?(error: unknown): void;
}

export interface FarmScreen {
  /** Svelte store contract: `$farmScreen` stays in sync with the view model. */
  subscribe(run: (view: FarmView) => void): () => void;
  snapshot(): FarmView;
  /** Reload the given farm and restart the 20-second poll for it. */
  selectFarm(farmId: string): Promise<void>;
  refresh(): Promise<void>;
  copyCode(): Promise<boolean>;
  uploadMySave(savePath: string): Promise<ActionResult>;
  downloadSave(playerId: string, save: PlayerSave): Promise<ActionResult>;
  start(): void;
  stop(): void;
}

export function createFarmScreen(
  deps: FarmScreenDeps,
  {
    intervalMs,
    scheduler,
    immediate = false,
    onError,
  }: FarmScreenOptions = {},
): FarmScreen {
  const now = deps.now ?? Date.now;
  const state: FarmView = {
    farm: null,
    latestUpload: null,
    players: [],
    loading: false,
    error: null,
    actionError: null,
    actionMessage: null,
  };
  const listeners = new Set<(view: FarmView) => void>();
  let currentFarmId: string | null = null;

  function snapshot(): FarmView {
    return {
      ...state,
      farm: state.farm ? { ...state.farm } : null,
      latestUpload: state.latestUpload ? { ...state.latestUpload } : null,
      players: state.players.map((row) => ({ ...row })),
    };
  }

  function emit() {
    const view = snapshot();
    for (const run of listeners) run(view);
  }

  const poll = createPoll(() => refresh(), {
    intervalMs,
    scheduler,
    immediate,
    onError,
  });

  async function refresh(): Promise<void> {
    const farmId = currentFarmId;
    if (!farmId) return;
    state.loading = true;
    state.error = null;
    try {
      const [farm, members, saves] = await Promise.all([
        deps.fetchFarm(farmId),
        deps.fetchMembers(farmId),
        deps.fetchSaves(farmId),
      ]);
      // Ignore a response that arrived after the user switched farms.
      if (currentFarmId !== farmId) return;
      const data = buildFarmView(farm, members, saves, now());
      state.farm = data.farm;
      state.latestUpload = data.latestUpload;
      state.players = data.players;
    } catch (cause) {
      if (currentFarmId !== farmId) return;
      state.error = describeError(cause);
    } finally {
      if (currentFarmId === farmId) {
        state.loading = false;
        emit();
      }
    }
  }

  function setActionResult(result: ActionResult) {
    if (result.ok) {
      state.actionError = null;
      state.actionMessage = result.message ?? "Done.";
    } else {
      state.actionMessage = null;
      state.actionError = result.message ?? "The action failed.";
    }
    emit();
  }

  return {
    subscribe(run) {
      run(snapshot());
      listeners.add(run);
      return () => listeners.delete(run);
    },
    snapshot,
    async selectFarm(farmId) {
      // Switching farms reloads that farm's state and restarts the poll.
      poll.stop();
      currentFarmId = farmId;
      state.farm = null;
      state.latestUpload = null;
      state.players = [];
      state.error = null;
      state.actionError = null;
      state.actionMessage = null;
      emit();
      await refresh();
      poll.start();
    },
    refresh,
    async copyCode() {
      const code = state.farm?.code;
      if (!code) return false;
      await deps.copyToClipboard(code);
      state.actionError = null;
      state.actionMessage = `Copied farm code ${code}.`;
      emit();
      return true;
    },
    async uploadMySave(savePath) {
      if (!currentFarmId) return { ok: false, message: "No active farm." };
      const result = await deps.runUpload({ farmId: currentFarmId, savePath });
      setActionResult(result);
      return result;
    },
    async downloadSave(playerId, save) {
      if (!currentFarmId) return { ok: false, message: "No active farm." };
      const result = await deps.runDownload({
        farmId: currentFarmId,
        playerId,
        save,
      });
      setActionResult(result);
      return result;
    },
    start: () => poll.start(),
    stop: () => poll.stop(),
  };
}

// --- Production data access ------------------------------------------------
// All calls route through the shared API client (ticket 76): one place builds
// the bearer header, and failures surface as `ApiError` carrying the HTTP
// status and the server error string (`{ "error": "<code>" }`).

export interface FarmApi {
  fetchFarm(farmId: string): Promise<FarmDetail>;
  fetchMembers(farmId: string): Promise<Member[]>;
  fetchSaves(farmId: string): Promise<PlayerSave[]>;
}

export function httpFarmApi(
  baseUrl: string,
  getToken: () => Promise<string | null>,
  fetchImpl: typeof fetch = fetch,
  onUnauthorized?: OnUnauthorized,
): FarmApi {
  const client = createApiClient({ baseUrl, getToken, fetchImpl, onUnauthorized });

  async function get(path: string): Promise<Record<string, unknown>> {
    return (await client.get<Record<string, unknown>>(path)) ?? {};
  }

  return {
    async fetchFarm(farmId) {
      const body = await get(`/farms/${farmId}`);
      return body.farm as FarmDetail;
    },
    async fetchMembers(farmId) {
      const body = await get(`/farms/${farmId}/members`);
      return (body.members as Member[]) ?? [];
    },
    async fetchSaves(farmId) {
      const body = await get(`/farms/${farmId}/saves`);
      return (body.saves as PlayerSave[]) ?? [];
    },
  };
}
