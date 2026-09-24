// Farm setup (create / join) view logic.
//
// DOM-, Tauri-, and network-free: listing, creating, and joining farms are all
// injected so the controller runs under `node --test` with fakes and the Svelte
// component stays thin. Spec (farms-and-membership): "Create Farm: name + bound
// local save. The creator becomes owner and receives a short farm code." "Join
// Farm: enter a farm code -> Request to Join -> pending until the owner acts."
//
// The active-farm selection lives in uiState.ts; this module only reports the
// farm list and the newly created farm, and the shell makes it active.

import { describeError } from "./errors.ts";

/** A farm as returned by `GET /farms` (list) and `POST /farms` (create). */
export interface FarmSummary {
  id: string;
  name: string;
  code?: string;
  role?: string;
}

export interface FarmSetupApi {
  listFarms(): Promise<FarmSummary[]>;
  createFarm(name: string): Promise<FarmSummary>;
  /** Resolves the farm id through `/farms/lookup`, then requests to join. */
  joinFarm(code: string): Promise<{ farmId: string }>;
}

export interface FarmSetupView {
  creating: boolean;
  joining: boolean;
  error: string | null;
  message: string | null;
}

export interface FarmSetupDeps {
  api: FarmSetupApi;
  /** Replace the shell's farm list (drives the active-farm dropdown). */
  setFarms(farms: FarmSummary[]): void;
  /** Make a farm active; the shell loads it and starts polling. */
  setActiveFarm(id: string): void;
  /** Bind the chosen save slot to a farm (ticket 62). */
  bindSlot(farmId: string, slot: number): Promise<void>;
}

export interface FarmSetup {
  /** Svelte store contract: `$farmSetup` stays in sync with the view model. */
  subscribe(run: (view: FarmSetupView) => void): () => void;
  snapshot(): FarmSetupView;
  /** List the caller's farms; makes the first active when none is selected. */
  load(activeFarmId: string | null): Promise<void>;
  /** Create a farm with the chosen save slot and make it active. */
  create(name: string, slot: number): Promise<boolean>;
  /** Request to join by code and bind the chosen slot (pending owner accept). */
  join(code: string, slot: number): Promise<boolean>;
}

export function createFarmSetup(deps: FarmSetupDeps): FarmSetup {
  const state: FarmSetupView = {
    creating: false,
    joining: false,
    error: null,
    message: null,
  };
  const listeners = new Set<(view: FarmSetupView) => void>();

  function snapshot(): FarmSetupView {
    return { ...state };
  }

  function emit() {
    const view = snapshot();
    for (const run of listeners) run(view);
  }

  function fail(cause: unknown) {
    state.error = describeError(cause);
    emit();
  }

  return {
    subscribe(run) {
      run(snapshot());
      listeners.add(run);
      return () => listeners.delete(run);
    },
    snapshot,
    async load(activeFarmId) {
      try {
        const farms = await deps.api.listFarms();
        deps.setFarms(farms);
        if (!activeFarmId && farms.length > 0) deps.setActiveFarm(farms[0].id);
      } catch (cause) {
        fail(cause);
      }
    },
    async create(name, slot) {
      const trimmed = name.trim();
      if (!trimmed) {
        state.error = "Farm name must not be empty.";
        emit();
        return false;
      }
      if (!slot) {
        state.error = "Pick the save slot to start this farm with.";
        emit();
        return false;
      }
      state.creating = true;
      state.error = null;
      state.message = null;
      emit();
      try {
        const farm = await deps.api.createFarm(trimmed);
        const farms = await deps.api.listFarms().catch(() => [] as FarmSummary[]);
        deps.setFarms(farms.some((f) => f.id === farm.id) ? farms : [...farms, farm]);
        let bindError: unknown = null;
        try {
          await deps.bindSlot(farm.id, slot);
        } catch (cause) {
          bindError = cause;
        }
        deps.setActiveFarm(farm.id);
        if (bindError !== null) {
          // Surface the real cause (e.g. a slot owned by another farm) so the
          // user knows why the link failed (ticket 80).
          state.error = `Farm created, but the slot could not be linked (${describeError(bindError)}). Choose it on the Farm screen.`;
        }
        state.message = farm.code
          ? `Created ${farm.name} — farm code ${farm.code}.`
          : `Created ${farm.name}.`;
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      } finally {
        state.creating = false;
        emit();
      }
    },
    async join(code, slot) {
      const trimmed = code.trim();
      if (!trimmed) {
        state.error = "Enter the farm code you were given.";
        emit();
        return false;
      }
      if (!slot) {
        state.error = "Pick the save slot to link to this farm.";
        emit();
        return false;
      }
      state.joining = true;
      state.error = null;
      state.message = null;
      emit();
      try {
        const { farmId } = await deps.api.joinFarm(trimmed);
        let bindError: unknown = null;
        try {
          await deps.bindSlot(farmId, slot);
        } catch (cause) {
          bindError = cause;
        }
        state.message = bindError !== null
          ? `Request sent. The slot could not be linked (${describeError(bindError)}). Choose your slot on the Farm screen once accepted.`
          : "Request sent. The farm owner must accept it before the farm appears.";
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      } finally {
        state.joining = false;
        emit();
      }
    },
  };
}

// --- Production data access ------------------------------------------------
// Direct fetch with the session token, matching `httpFarmApi`/`httpOwnerApi`;
// injected at the shell so tests use fakes.

export function httpFarmSetupApi(
  baseUrl: string,
  getToken: () => Promise<string | null>,
  fetchImpl: typeof fetch = fetch,
): FarmSetupApi {
  async function req<T>(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<T> {
    const token = await getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`request failed: ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async listFarms() {
      const body = await req<{ farms: FarmSummary[] }>("/farms", "GET");
      return body.farms ?? [];
    },
    async createFarm(name) {
      const body = await req<{ farm: FarmSummary }>("/farms", "POST", { name });
      return body.farm;
    },
    async joinFarm(code) {
      // Join takes the farm id in the path; resolve it from the code first.
      const lookup = await req<{ farm: { id: string } }>(
        `/farms/lookup?code=${encodeURIComponent(code)}`,
        "GET",
      );
      const farmId = lookup.farm.id;
      await req(`/farms/${farmId}/join`, "POST", { code });
      return { farmId };
    },
  };
}
