<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import DisplayNamePrompt from "$lib/components/DisplayNamePrompt.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import ConflictDialog from "$lib/components/ConflictDialog.svelte";
  import DownloadProgress from "$lib/components/DownloadProgress.svelte";
  import FarmScreen from "$lib/components/FarmScreen.svelte";
  import FarmSetup from "$lib/components/FarmSetup.svelte";
  import Fs25FolderSetup from "$lib/components/Fs25FolderSetup.svelte";
  import SettingsScreen from "$lib/components/SettingsScreen.svelte";
  import SlotPickerDialog from "$lib/components/SlotPickerDialog.svelte";
  import Toasts from "$lib/components/Toasts.svelte";
  import UploadProgress from "$lib/components/UploadProgress.svelte";
  import { createApiClient } from "$lib/api";
  import { API_BASE_URL } from "$lib/config";
  import { runDownloadWithConflict, type ConflictChoice } from "$lib/conflict";
  import {
    describeError,
    EMPTY_STATES,
    friendlyErrorMessage,
    pushToast,
    showError,
  } from "$lib/errors";
  import type {
    DownloadAuthorization,
    DownloadDeps,
    DownloadPhase,
  } from "$lib/download";
  import { runDownload } from "$lib/download";
  import { createGetToDisk } from "$lib/downloadTransport";
  import {
    cleanupPack,
    cleanupUnpack,
    computeHash,
    installSaveToSlot,
    listSlotBindings,
    listSlots,
    onPackProgress,
    packSave,
    readMetadata,
    readSyncState,
    setFarmSlot,
    unpackSave,
    validateSave,
    writeSyncState,
    writeTempArchive,
  } from "$lib/fs25";
  import { pickFolder } from "$lib/folderPicker";
  import {
    createFarmScreen,
    httpFarmApi,
  } from "$lib/farmScreen";
  import { createFarmSetup, httpFarmSetupApi } from "$lib/farmSetup";
  import {
    getBackupLocation,
    getFs25Root,
    getIdentity,
    getSessionToken,
    setBackupLocation,
    setDisplayName,
    setFs25Root,
    storeSessionToken,
  } from "$lib/identity";
  import { createSettings } from "$lib/settings";
  import type { SlotCard } from "$lib/slots";
  import { buildSlotCards, downloadGate, overwriteMessage } from "$lib/slots";
  import {
    createOwnerActions,
    httpOwnerApi,
  } from "$lib/ownerActions";
  import { createSession, httpRegister, type SessionState } from "$lib/session";
  import {
    activeFarmId,
    boundSave,
    clearBoundSave,
    destination,
    emptySlot,
    farms,
    fs25Root,
    refreshBoundSave,
    selectFarm,
    setDestination,
    setFarms,
    setFs25RootStore,
  } from "$lib/uiState";
  import {
    runUpload,
    SIZE_WARNING_MESSAGE,
    type UploadAuthorization,
    type UploadDeps,
    type UploadPhase,
  } from "$lib/upload";
  import { createPutToR2 } from "$lib/uploadTransport";

  // The FS25 folder is loaded once at startup so the onboarding step only shows
  // on first run; until it resolves we render nothing to avoid a flash.
  let rootLoaded = $state(false);
  onMount(async () => {
    try {
      const root = await getFs25Root();
      if (root) setFs25RootStore(root);
    } catch {
      // Fall through to onboarding if the persisted root cannot be read.
    } finally {
      rootLoaded = true;
    }
  });

  // Ticket 17 deferral gate: the first cloud action registers the installation
  // and drives the display-name prompt, then resumes the action.
  let status = $state<SessionState>("unregistered");
  let promptOpen = $state(false);
  let nameError = $state<string | null>(null);

  const session = createSession({
    getToken: getSessionToken,
    storeToken: storeSessionToken,
    getInstallationId: async () => (await getIdentity()).installationId,
    register: httpRegister(API_BASE_URL),
    onRequireDisplayName: () => {
      status = session.state;
      promptOpen = true;
    },
    onError: (e) => {
      status = session.state;
      nameError = e.message;
      showError("no-internet");
    },
  });

  async function submitName(name: string) {
    const ok = await session.submitDisplayName(name);
    status = session.state;
    promptOpen = !ok;
    nameError = ok ? null : session.error?.message ?? null;
  }

  // --- Cloud wiring for the farm screen -----------------------------------
  // Upload uses the shared API client (ticket 40) for authorize/complete and
  // the R2 transport adapter (ticket 41) for the direct-to-storage PUT. Download
  // (ticket 42) uses the same client to authorize, then `createGetToDisk` to
  // stage the archive. Save bytes never pass through the Worker.

  const api = createApiClient({
    baseUrl: API_BASE_URL,
    getToken: getSessionToken,
  });

  // The packed archive is a temp file; read it through Tauri's asset protocol
  // (enabled in tauri.conf.json with a `$TEMP/**` scope) so the transport stays
  // a plain `fetch` PUT.
  async function readArchive(path: string): Promise<Uint8Array<ArrayBuffer>> {
    const res = await fetch(convertFileSrc(path));
    if (!res.ok) {
      throw new Error(`Could not read the packed archive (${res.status}).`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  const putToR2 = createPutToR2({
    baseUrl: API_BASE_URL,
    readFile: readArchive,
  });

  // Downloaded archive bytes are staged to a temp file through the scoped
  // `write_temp_archive` Rust command (the frontend has no filesystem plugin);
  // `unpackSave` then extracts that file.
  const getToDisk = createGetToDisk({
    baseUrl: API_BASE_URL,
    stageArchive: writeTempArchive,
  });

  const uploadDeps = (): UploadDeps => ({
    validateSave,
    readMetadata,
    packSave,
    onPackProgress,
    computeHash,
    uploadAuthorize: async ({ farmId }) => {
      // Backend wraps the authorization in `{ authorization }`.
      const body = await api.post<{ authorization: UploadAuthorization }>(
        "/saves/upload-authorize",
        { farmId },
      );
      return body.authorization;
    },
    putToR2,
    uploadComplete: async ({ farmId, objectKey, fileSize, sha256, saveName }) => {
      // Backend wraps the row in `{ save }`; map its `uploadedAt` for sync state.
      const body = await api.post<{ save: { uploadedAt: string } }>(
        "/saves/upload-complete",
        { farmId, objectKey, fileSize, sha256, saveName },
      );
      return { uploadedAt: body.save.uploadedAt };
    },
    readSyncState,
    writeSyncState,
    cleanupPack,
  });

  const downloadDeps = (): DownloadDeps => ({
    readMetadata,
    computeHash,
    downloadAuthorize: async ({ farmId, playerId }) => {
      // Backend wraps the authorization in `{ authorization }`.
      const body = await api.post<{ authorization: DownloadAuthorization }>(
        `/saves/${playerId}/download-authorize`,
        { farmId },
      );
      return body.authorization;
    },
    fetchArchive: (authorization) => getToDisk(authorization),
    unpackSave,
    // The Rust replacement creates the one backup under the configured dir
    // (passed via `input.backupDir`); there is no TS-side backup (ticket 87).
    installSaveToSlot,
    setFarmSlot,
    readSyncState,
    writeSyncState,
    cleanupPack,
    cleanupUnpack,
  });

  // --- Progress + conflict surfaces (ticket 38) ---------------------------
  // Upload/download callbacks drive these so the UI can render the two upload
  // phases, the download phases, and a completion timestamp. The conflict dialog
  // routes its three choices through a promise, mirroring the confirm pattern.
  let uploadPhase = $state<UploadPhase | null>(null);
  let uploadPercent = $state(0);
  let uploadedAt = $state<string | null>(null);

  let downloadPhase = $state<DownloadPhase | null>(null);
  let downloadPercent = $state(0);
  let downloadedAt = $state<string | null>(null);

  let conflictRequest = $state<{
    message: string;
    resolve: (choice: ConflictChoice) => void;
  } | null>(null);

  function chooseConflict(message: string): Promise<ConflictChoice> {
    return new Promise((resolve) => {
      conflictRequest = { message, resolve };
    });
  }

  function resolveConflictChoice(choice: ConflictChoice) {
    conflictRequest?.resolve(choice);
    conflictRequest = null;
  }

  // Slot picker for downloads (ticket 65). Opened through a promise like
  // `confirm` and `chooseConflict`; resolves the chosen card or null on cancel.
  let slotRequest = $state<{
    title: string;
    cards: SlotCard[];
    resolve: (card: SlotCard | null) => void;
  } | null>(null);

  function chooseSlot(title: string, cards: SlotCard[]): Promise<SlotCard | null> {
    return new Promise((resolve) => {
      slotRequest = { title, cards, resolve };
    });
  }

  function resolveSlot(card: SlotCard | null) {
    slotRequest?.resolve(card);
    slotRequest = null;
  }

  // Join-mode slot cards for the Settings slot row and its Change dialog. Built
  // fresh from the current FS25 folder so the dialog disables other farms' slots.
  async function loadSlotCards(): Promise<SlotCard[]> {
    const root = $fs25Root;
    if (!root) return [];
    const [slots, bindings] = await Promise.all([
      listSlots(root),
      listSlotBindings(),
    ]);
    return buildSlotCards({
      slots,
      bindings,
      farmId: $activeFarmId,
      farmNames: Object.fromEntries($farms.map((f) => [f.id, f.name])),
      mode: "join",
    });
  }

  const farmScreen = createFarmScreen({
    ...httpFarmApi(API_BASE_URL, getSessionToken),
    copyToClipboard: (text) => navigator.clipboard.writeText(text),
    runUpload: async ({ farmId, savePath }) => {
      uploadPhase = null;
      uploadPercent = 0;
      uploadedAt = null;
      const result = await session.runCloudAction(async () => {
        const upload = await runUpload({ farmId, savePath }, uploadDeps(), {
          onPhase: (phase) => {
            uploadPhase = phase;
            uploadPercent = 0;
          },
          onProgress: (progress) => {
            uploadPhase = progress.phase;
            uploadPercent = progress.percent;
          },
          onWarning: (message) => pushToast(message),
          confirmSizeWarning: (sizeBytes) =>
            confirm(SIZE_WARNING_MESSAGE(sizeBytes), "Continue"),
        });
        uploadPhase = null;
        if (upload.ok) {
          uploadedAt = upload.uploadedAt;
          return { ok: true };
        }
        const message = friendlyErrorMessage(upload.message);
        pushToast(message);
        return { ok: false, message };
      });
      // undefined => the display-name prompt is open and the action is queued.
      return result ?? { ok: true };
    },
    runDownload: async ({ farmId, playerId, save }) => {
      downloadPhase = null;
      downloadPercent = 0;
      downloadedAt = null;
      const result = await session.runCloudAction(async () => {
        const root = $fs25Root;
        if (!root) {
          const message = "Choose your FS25 folder first.";
          pushToast(message);
          return { ok: false, message };
        }

        // Slot picker in download mode, preselected on this farm's own slot.
        const [slots, bindings] = await Promise.all([
          listSlots(root),
          listSlotBindings(),
        ]);
        const cards = buildSlotCards({
          slots,
          bindings,
          farmId,
          farmNames: Object.fromEntries($farms.map((f) => [f.id, f.name])),
          mode: "download",
        });
        const card = await chooseSlot(
          `Choose a slot for ${save.display_name}'s save`,
          cards,
        );
        if (!card) return { ok: false, message: "Download cancelled." };

        const input = {
          farmId,
          playerId,
          fs25Root: root,
          slot: card.slot,
          slotPath: card.path,
          // Used-vs-empty comes from the actual folder existence (SlotInfo.used),
          // never from the binding/status: a bound-but-empty slot installs into
          // the empty slot path (ticket 74).
          slotUsed: card.used,
          expectedSha256: save.sha256,
          apiBaseUrl: API_BASE_URL,
          // The replacement's single backup goes to the configured location.
          backupDir: await getBackupLocation(),
        };
        const callbacks = {
          onPhase: (phase: DownloadPhase) => {
            downloadPhase = phase;
            downloadPercent = 0;
          },
          onProgress: (progress: { phase: DownloadPhase; percent: number }) => {
            downloadPhase = progress.phase;
            downloadPercent = progress.percent;
          },
          confirm: (message: string) => confirm(message, "Download & Replace"),
        };

        let download;
        const gate = downloadGate(card);
        if (gate === "overwrite") {
          // Another farm's-free Used slot: overwrite confirmation replaces the
          // normal download confirm, then install.
          const ok = await confirm(
            overwriteMessage(card),
            `Overwrite Slot ${card.slot}`,
          );
          if (!ok) return { ok: false, message: "Download cancelled." };
          download = await runDownload(input, downloadDeps(), {
            onPhase: callbacks.onPhase,
            onProgress: callbacks.onProgress,
          });
        } else if (gate === "conflict") {
          // The farm's own bound slot: run the existing conflict check first.
          const metadata = await readMetadata(card.path);
          const state = await readSyncState(farmId);
          download = await runDownloadWithConflict(
            input,
            downloadDeps(),
            callbacks,
            {
              localHash: metadata.contentHash,
              lastSyncedHash: state?.lastSyncedHash ?? null,
              choose: chooseConflict,
            },
          );
        } else {
          // Empty slot: the normal download confirm is the only gate.
          download = await runDownload(input, downloadDeps(), callbacks);
        }

        downloadPhase = null;
        if (download.ok) {
          downloadedAt = download.syncedAt;
          // The save is installed on both outcomes; re-derive the bound save so
          // the sidebar reflects it even when only the bookkeeping failed.
          await refreshBoundSave();
          // A partial result (ticket 75) carries accurate copy: the save WAS
          // installed, only the sync state could not be recorded.
          return download.outcome === "partial"
            ? { ok: true, message: download.message }
            : { ok: true };
        }
        const message = friendlyErrorMessage(download.message);
        pushToast(message);
        return { ok: false, message };
      });
      return result ?? { ok: true };
    },
  });

  // --- Owner actions + join requests (ticket 36) --------------------------
  // The viewer id is resolved from the session token via `GET /me`; ownership is
  // then derived from the member role. Confirmations route through a promise the
  // ConfirmDialog resolves, keeping the owner-action logic DOM-free/testable.
  let currentUserId = $state<string | null>(null);
  let confirmRequest = $state<{
    message: string;
    confirmLabel?: string;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  function confirm(message: string, confirmLabel?: string): Promise<boolean> {
    return new Promise((resolve) => {
      confirmRequest = { message, confirmLabel, resolve };
    });
  }

  function resolveConfirm(confirmed: boolean) {
    confirmRequest?.resolve(confirmed);
    confirmRequest = null;
  }

  const ownerApi = httpOwnerApi(API_BASE_URL, getSessionToken);
  const ownerActions = createOwnerActions({ ...ownerApi, confirm });

  // --- Settings (ticket 37) ------------------------------------------------
  // Leave reuses the members endpoint with the viewer's own id (self-leave);
  // the backend cascades when the last member leaves. Backup location persists
  // in the identity store via get/set_backup_location.
  const settingsScreen = createSettings({
    getIdentity,
    setDisplayName,
    getSyncState: readSyncState,
    getFs25Root,
    setFs25Root: async (path) => {
      await setFs25Root(path);
      // Keep the shell's root store in sync so the pill and slot cards reload.
      setFs25RootStore(path);
    },
    listSlots,
    setFarmSlot,
    pickFolder,
    getBackupLocation,
    setBackupLocation,
    fetchFarm: (farmId) => httpFarmApi(API_BASE_URL, getSessionToken).fetchFarm(farmId),
    leaveFarm: async (farmId) => {
      const api = httpOwnerApi(API_BASE_URL, getSessionToken);
      const userId = await api.fetchCurrentUserId();
      if (!userId) throw new Error("Could not resolve the signed-in player.");
      await api.kickMember(farmId, userId);
    },
    confirm,
  });

  // --- Farm setup (create / join) -----------------------------------------
  // Farms are listed from `GET /farms`. Create/join run through the session
  // gate so the first cloud action registers the installation (ticket 17),
  // then the farm becomes active and the Farm screen loads it.
  const farmSetup = createFarmSetup({
    api: httpFarmSetupApi(API_BASE_URL, getSessionToken),
    setFarms: (list) => setFarms(list),
    setActiveFarm: (id) => selectFarm(id),
    bindSlot: async (id, slot) => {
      await setFarmSlot(id, $fs25Root ?? "", slot);
      await refreshBoundSave();
    },
  });

  // Slot cards for the setup screen. Create mode only allows Used slots to
  // start a farm (ticket 62); join mode allows Empty or Used slots (ticket 63).
  let slotCards = $state<SlotCard[]>([]);
  let joinSlotCards = $state<SlotCard[]>([]);

  $effect(() => {
    const root = $fs25Root;
    if (!root) {
      slotCards = [];
      joinSlotCards = [];
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [slots, bindings] = await Promise.all([
          listSlots(root),
          listSlotBindings(),
        ]);
        if (cancelled) return;
        const base = {
          slots,
          bindings,
          farmId: $activeFarmId,
          farmNames: Object.fromEntries($farms.map((f) => [f.id, f.name])),
        };
        slotCards = buildSlotCards({ ...base, mode: "create" });
        joinSlotCards = buildSlotCards({ ...base, mode: "join" });
      } catch {
        if (!cancelled) {
          slotCards = [];
          joinSlotCards = [];
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  // Ticket 61: a farm with no slot (joined before this feature, or a reinstall)
  // asks the user to pick one on the Farm screen. Join mode allows Empty or Used.
  let farmSlotCards = $state<SlotCard[] | null>(null);

  $effect(() => {
    const root = $fs25Root;
    const farmId = $activeFarmId;
    if (!root || !farmId) {
      farmSlotCards = null;
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const state = await readSyncState(farmId);
        if (cancelled) return;
        if (state?.slot != null) {
          farmSlotCards = null;
          return;
        }
        const [slots, bindings] = await Promise.all([
          listSlots(root),
          listSlotBindings(),
        ]);
        if (cancelled) return;
        farmSlotCards = buildSlotCards({
          slots,
          bindings,
          farmId,
          farmNames: Object.fromEntries($farms.map((f) => [f.id, f.name])),
          mode: "join",
        });
      } catch {
        if (!cancelled) farmSlotCards = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  async function chooseFarmSlot(card: SlotCard) {
    const farmId = $activeFarmId;
    const root = $fs25Root;
    if (!farmId || !root) return;
    try {
      await setFarmSlot(farmId, root, card.slot);
      farmSlotCards = null;
      await refreshBoundSave();
    } catch (error) {
      pushToast(friendlyErrorMessage(describeError(error)));
    }
  }

  async function createFarm(name: string, slot: number) {
    await session.runCloudAction(() => farmSetup.create(name, slot));
  }

  async function joinFarm(code: string, slot: number) {
    await session.runCloudAction(() => farmSetup.join(code, slot));
  }

  $effect(() => {
    if (!$fs25Root || currentUserId !== null) return;
    void ownerApi
      .fetchCurrentUserId()
      .then((id) => {
        if (id) currentUserId = id;
      })
      .catch(() => {});
  });

  // Once signed in, load the caller's farms so the dropdown and Farm screen work.
  $effect(() => {
    if (!$fs25Root || currentUserId === null) return;
    void farmSetup.load(null);
  });

  // The bound save is per-farm: re-derive it from the active farm's sync-state
  // slot and the slots under the current FS25 folder whenever either changes.
  $effect(() => {
    void $activeFarmId;
    void $fs25Root;
    void refreshBoundSave();
  });
</script>

<div class="shell">
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"><Icon name="sprout" size={18} /></span>
      <span class="brand-text">
        <span class="brand-name">FarmCrossSync</span>
        <span class="brand-sub">for Farming Simulator 25</span>
      </span>
    </div>
    <nav aria-label="Main">
      <button
        class="nav-item"
        class:active={$destination === "farm"}
        aria-current={$destination === "farm" ? "page" : undefined}
        onclick={() => setDestination("farm")}
      >
        <Icon name="farm" />
        Farm
      </button>
      <button
        class="nav-item"
        class:active={$destination === "settings"}
        aria-current={$destination === "settings" ? "page" : undefined}
        onclick={() => setDestination("settings")}
      >
        <Icon name="settings" />
        Settings
      </button>
    </nav>

    <div class="sidebar-foot">
      <div class="save-pill" title={$boundSave?.path ?? undefined}>
        {#if $boundSave}
          <span class="save-dot" class:warn={$boundSave.warning} aria-hidden="true"></span>
          <span class="save-text">
            <span class="save-title">
              Slot {$boundSave.slot}{$boundSave.mapName ? ` · ${$boundSave.mapName}` : ""}
            </span>
          </span>
        {:else if $emptySlot !== null}
          <span class="save-text">
            <span class="save-title">Slot {$emptySlot} · empty</span>
          </span>
        {:else}
          <span class="save-text">
            <span class="save-title">No slot linked</span>
          </span>
        {/if}
      </div>
      <p class="promise">
        <Icon name="shield" size={14} />
        Backups are made before every replace.
      </p>
    </div>
  </aside>

  <main class="content">
    <div class="page">
      {#if $destination === "farm"}
        {#if !rootLoaded}
          <!-- Loading the persisted FS25 folder: render nothing to avoid a flash. -->
        {:else if !$fs25Root}
          <Fs25FolderSetup onDone={(root) => setFs25RootStore(root)} />
        {:else if $activeFarmId}
          <FarmScreen
            screen={farmScreen}
            savePath={$boundSave?.path ?? null}
            owner={ownerActions}
            {currentUserId}
            slotCards={farmSlotCards}
            onChooseSlot={chooseFarmSlot}
          />
        {:else}
          <FarmSetup
            screen={farmSetup}
            {slotCards}
            {joinSlotCards}
            onCreate={createFarm}
            onJoin={joinFarm}
          />
        {/if}
      {:else if $activeFarmId}
        <SettingsScreen
          screen={settingsScreen}
          farmId={$activeFarmId}
          onSlotsChanged={() => void refreshBoundSave()}
          chooseSlot={(cards) =>
            chooseSlot("Choose a slot for this farm", cards)}
          {loadSlotCards}
          onLeft={() => {
            clearBoundSave();
            setDestination("farm");
          }}
        />
      {:else}
        <section class="empty-settings">
          <h1>Settings</h1>
          <div class="card empty-card">
            <Icon name="farm" size={22} />
            <p>{EMPTY_STATES.noFarm}</p>
            <button class="primary" onclick={() => setDestination("farm")}>Go to Farm</button>
          </div>
        </section>
      {/if}
    </div>
  </main>
</div>

{#if $destination === "farm" && $activeFarmId}
  <div class="dock" aria-live="polite">
    <UploadProgress phase={uploadPhase} percent={uploadPercent} uploadedAt={uploadedAt} />
    <DownloadProgress phase={downloadPhase} percent={downloadPercent} syncedAt={downloadedAt} />
  </div>
{/if}

{#if promptOpen}
  <DisplayNamePrompt
    onSubmit={submitName}
    error={nameError}
    busy={status === "registering"}
  />
{/if}

{#if confirmRequest}
  <ConfirmDialog
    message={confirmRequest.message}
    confirmLabel={confirmRequest.confirmLabel}
    onResolve={resolveConfirm}
  />
{/if}

{#if conflictRequest}
  <ConflictDialog
    message={conflictRequest.message}
    onChoose={resolveConflictChoice}
  />
{/if}

{#if slotRequest}
  <SlotPickerDialog
    title={slotRequest.title}
    cards={slotRequest.cards}
    onResolve={resolveSlot}
  />
{/if}

<Toasts />

<style>
  .shell {
    display: grid;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    height: 100vh;
  }
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.1rem 0.85rem;
    background: var(--surface);
    border-right: 1px solid var(--border);
    min-height: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.1rem 0.35rem;
    min-width: 0;
  }
  .brand-mark {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 10px;
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 4px 14px var(--accent-soft);
  }
  .brand-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .brand-name {
    font-weight: 700;
    font-size: 1.02em;
    letter-spacing: -0.01em;
  }
  .brand-sub {
    color: var(--muted);
    font-size: 0.75em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .nav-item {
    justify-content: flex-start;
    gap: 0.7rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
    background: transparent;
    border: 1px solid transparent;
    color: var(--muted);
  }
  .nav-item:hover:not(:disabled) {
    background: var(--surface-2);
    border-color: transparent;
    color: var(--text);
  }
  .nav-item.active {
    position: relative;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .nav-item.active::before {
    content: "";
    position: absolute;
    left: -0.85rem;
    top: 0.5rem;
    bottom: 0.5rem;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
  }
  .sidebar-foot {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .save-pill {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.7rem;
    border-radius: var(--radius);
    background: var(--surface-2);
    border: 1px solid var(--border);
    min-width: 0;
  }
  .save-dot {
    flex: none;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .save-dot.warn {
    background: var(--warn);
    box-shadow: 0 0 0 3px var(--warn-soft);
  }
  .save-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .save-title {
    font-weight: 600;
    font-size: 0.9em;
  }
  .promise {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    padding: 0 0.35rem;
    color: var(--muted);
    font-size: 0.78em;
  }
  .content {
    min-height: 0;
    min-width: 0;
    overflow: auto;
  }
  .page {
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.75rem 2rem 7rem;
  }
  .dock {
    position: fixed;
    left: calc(var(--sidebar-w) + 2rem);
    right: 2rem;
    bottom: 1rem;
    z-index: 800;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    pointer-events: none;
  }
  .dock > :global(*) {
    pointer-events: auto;
  }
  .empty-settings h1 {
    margin: 0 0 1.25rem;
    font-size: 1.6rem;
  }
  .empty-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2.5rem 1.5rem;
    text-align: center;
    color: var(--muted);
  }
  .empty-card p {
    margin: 0;
  }
</style>
