<script lang="ts">
  import type { FarmScreen, PlayerRow } from "$lib/farmScreen";
  import { EMPTY_STATES, friendlyErrorMessage } from "$lib/errors";
  import { formatBytes, initials, relativeTime } from "$lib/format";
  import {
    ownerRowActions,
    viewerIsOwner,
    type OwnerActions,
  } from "$lib/ownerActions";
  import type { SlotCard } from "$lib/slots";
  import { activeFarmId, farms, selectFarm as setActiveFarm } from "$lib/uiState";
  import Icon from "./Icon.svelte";
  import JoinRequestsPanel from "./JoinRequestsPanel.svelte";
  import MemberRow from "./MemberRow.svelte";
  import SlotPicker from "./SlotPicker.svelte";

  interface Props {
    screen: FarmScreen;
    /** Bound FS25 save path; the target of Upload and Download. */
    savePath?: string | null;
    /** Owner-side actions; absent/null disables all owner-only UI. */
    owner?: OwnerActions | null;
    /** Viewer id resolved from the session token (GET /me). */
    currentUserId?: string | null;
    /**
     * Join-mode cards for a farm with no slot yet; null once a slot is bound.
     * Set by the shell from `buildSlotCards` (ticket 61).
     */
    slotCards?: SlotCard[] | null;
    /** Persist the chosen slot; the shell calls `setFarmSlot` then refreshes. */
    onChooseSlot?: (card: SlotCard) => void;
  }

  let {
    screen,
    savePath = null,
    owner = null,
    currentUserId = null,
    slotCards = null,
    onChooseSlot = () => {},
  }: Props = $props();

  const isOwner = $derived(
    viewerIsOwner($screen.farm, $screen.players, currentUserId),
  );

  // Snapshot of the owner store, or null when no owner controller is wired.
  const ownerState = $derived(owner ? $owner : null);

  // Dashboard stat tiles: player count, players with a cloud save, last sync.
  const savesCount = $derived(
    $screen.players.filter((row) => row.save !== null).length,
  );
  const lastSyncLabel = $derived(
    $screen.latestUpload
      ? relativeTime($screen.latestUpload.uploaded_at)
      : "never",
  );

  // `$screen` auto-subscribes: the module owns refresh + 20 s polling.
  $effect(() => {
    const farmId = $activeFarmId;
    if (farmId) void screen.selectFarm(farmId);
    return () => screen.stop();
  });

  // Load pending requests for the owner; a non-owner clears them without a call.
  $effect(() => {
    const farmId = $screen.farm?.id;
    if (!owner || !farmId) return;
    void owner.loadInvites(farmId, isOwner);
  });

  const MAX_PLAYERS = 16;
  let copied = $state(false);

  async function copyCode() {
    copied = await screen.copyCode();
    setTimeout(() => (copied = false), 1600);
  }

  async function upload() {
    if (!savePath) return;
    await screen.uploadMySave(savePath);
  }

  async function download(row: PlayerRow) {
    if (!row.save) return;
    await screen.downloadSave(row.user_id, row.save);
  }
</script>

<section class="farm-screen">
  <header class="card hero">
    <div class="hero-main">
      <p class="eyebrow">Active farm</p>
      <h1>{$screen.farm?.name ?? ($screen.loading ? "Loading…" : "Farm")}</h1>
      {#if $screen.farm}
        <div class="hero-meta">
          <button
            class="code-chip"
            onclick={copyCode}
            title="Copy farm code"
            aria-label="Copy farm code {$screen.farm.code}"
          >
            <span class="code-label">Code</span>
            <code>{$screen.farm.code}</code>
            <span class="code-icon" class:copied>
              <Icon name={copied ? "check" : "copy"} size={14} />
            </span>
          </button>
          <span class="meta-item">
            <Icon name="users" size={15} />
            {$screen.players.length}/{MAX_PLAYERS} players
          </span>
          <span class="meta-item">
            <Icon name="save" size={15} />
            {savesCount} {savesCount === 1 ? "save" : "saves"}
          </span>
          <span class="meta-item">
            <Icon name="clock" size={15} />
            Last sync {lastSyncLabel}
          </span>
        </div>
      {/if}
    </div>
    {#if $farms.length > 1}
      <label class="farm-select">
        <span class="eyebrow">Switch farm</span>
        <select
          value={$activeFarmId ?? ""}
          onchange={(e) => setActiveFarm(e.currentTarget.value)}
        >
          {#each $farms as farm (farm.id)}
            <option value={farm.id}>{farm.name}</option>
          {/each}
        </select>
      </label>
    {/if}
  </header>

  {#if $screen.error}
    <p class="banner error" role="alert">
      <Icon name="alert" />{friendlyErrorMessage($screen.error)}
    </p>
  {/if}
  {#if $screen.actionError}
    <p class="banner error" role="alert">
      <Icon name="alert" />{friendlyErrorMessage($screen.actionError)}
    </p>
  {/if}
  {#if $screen.actionMessage}
    <p class="banner ok" role="status">
      <Icon name="check" />{$screen.actionMessage}
    </p>
  {/if}

  {#if $screen.farm}
    {#if !savePath && slotCards && slotCards.length > 0}
      <section class="card choose-slot">
        <h2>Choose a save slot for this farm</h2>
        <p class="muted">
          Pick the FS25 slot this farm uses. Choose an empty slot if you will
          download a friend's save first.
        </p>
        <SlotPicker cards={slotCards} selected={null} onSelect={onChooseSlot} />
      </section>
    {/if}

    <div class="sync-row">
      <section class="card sync-card">
        <div class="sync-icon"><Icon name="upload" size={20} /></div>
        <div class="sync-body">
          <h2>Share your progress</h2>
          {#if savePath}
            <p class="muted">Played a session? Upload so your friends get the latest farm.</p>
            <p class="path" title={savePath}>{savePath}</p>
          {:else if slotCards && slotCards.length > 0}
            <p class="muted">Pick a slot to enable uploads.</p>
          {:else}
            <p class="muted">Download a save into this slot first.</p>
          {/if}
        </div>
        <button class="primary lg" onclick={upload} disabled={!savePath}>
          <Icon name="upload" />
          Upload My Save
        </button>
      </section>

      <section class="card latest-card">
        <p class="eyebrow">Latest upload</p>
        {#if $screen.latestUpload}
          <div class="latest">
            <span class="avatar lg" aria-hidden="true">
              {initials($screen.latestUpload.display_name)}
            </span>
            <div class="latest-info">
              <p class="latest-name">{$screen.latestUpload.display_name}</p>
              <p class="muted">{$screen.latestUpload.save_name}</p>
              <p class="muted small">
                <time datetime={$screen.latestUpload.uploaded_at}>
                  {relativeTime($screen.latestUpload.uploaded_at)}
                </time>
                · {formatBytes($screen.latestUpload.file_size)}
              </p>
            </div>
          </div>
        {:else}
          <p class="muted empty-latest">{EMPTY_STATES.noSaves}</p>
        {/if}
      </section>
    </div>

    {#if isOwner && owner && ownerState && $screen.farm}
      <JoinRequestsPanel
        invites={ownerState.invites}
        loading={ownerState.loadingInvites}
        error={ownerState.error}
        busy={ownerState.busy}
        onAccept={(id) => owner.accept($screen.farm!.id, id)}
        onDeny={(id) => owner.deny($screen.farm!.id, id)}
      />
    {/if}

    <section class="card players">
      <header class="players-head">
        <h2>Players</h2>
        <span class="muted small">Download a friend's save before you play.</span>
      </header>
      <ul>
        {#each $screen.players as row (row.user_id)}
          {@const manage = ownerRowActions(row.user_id, isOwner, currentUserId)}
          <MemberRow
            {row}
            isYou={row.user_id === currentUserId}
            canDownload
            onDownload={download}
            canMakeOwner={owner !== null && manage.canMakeOwner}
            canKick={owner !== null && manage.canKick}
            onMakeOwner={(target) =>
              owner?.makeOwner($screen.farm!.id, target.user_id, target.display_name)}
            onKick={(target) =>
              owner?.kick($screen.farm!.id, target.user_id, target.display_name)}
          />
        {/each}
      </ul>
    </section>
  {:else if $screen.loading}
    <div class="card skeleton" aria-hidden="true"></div>
  {:else if !$screen.error}
    <p class="muted">{EMPTY_STATES.noFarm}</p>
  {/if}
</section>

<style>
  .farm-screen {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .hero {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.4rem 1.5rem;
    background: var(--hero-glow), var(--surface);
  }
  .hero-main {
    min-width: 0;
  }
  .hero h1 {
    margin: 0.3rem 0 0.8rem;
    font-size: 1.85rem;
    overflow-wrap: anywhere;
  }
  .hero-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.1rem;
  }
  .meta-item {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-soft);
    font-size: 0.92em;
  }
  .meta-item :global(.icon) {
    color: var(--muted);
  }
  .code-chip {
    gap: 0.55rem;
    padding: 0.35rem 0.45rem 0.35rem 0.7rem;
    background: var(--bg);
    border-color: var(--border-strong);
    border-radius: 999px;
  }
  .code-label {
    color: var(--muted);
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .code-chip code {
    color: var(--text);
    font-size: 1.05em;
    font-weight: 700;
    letter-spacing: 0.1em;
  }
  .code-icon {
    display: inline-flex;
    padding: 0.25rem;
    border-radius: 50%;
    background: var(--surface-3);
    color: var(--muted);
  }
  .code-chip:hover:not(:disabled) .code-icon,
  .code-icon.copied {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .farm-select {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 12rem;
  }
  .choose-slot {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1.2rem 1.4rem;
  }
  .choose-slot h2 {
    margin: 0;
    font-size: 1.15rem;
  }
  .choose-slot p {
    margin: 0;
  }
  .sync-row {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 1rem;
  }
  .sync-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: 1fr auto;
    gap: 0.9rem 1rem;
    padding: 1.2rem;
  }
  .sync-card > .primary {
    grid-column: 1 / -1;
    justify-self: start;
  }
  .sync-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .sync-body {
    min-width: 0;
  }
  .sync-body h2 {
    margin: 0 0 0.25rem;
    font-size: 1.1rem;
  }
  .sync-body p {
    margin: 0;
  }
  .path {
    margin-top: 0.45rem !important;
    color: var(--muted);
    font-size: 0.8em;
    font-family: var(--mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .latest-card {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1.2rem;
  }
  .latest {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .latest-info {
    min-width: 0;
  }
  .latest-info p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .latest-name {
    font-weight: 600;
    font-size: 1.02em;
  }
  .empty-latest {
    margin: 0;
  }
  .avatar.lg {
    width: 2.9rem;
    height: 2.9rem;
    font-size: 0.95em;
  }
  .small {
    font-size: 0.85em;
  }
  .players {
    overflow: hidden;
  }
  .players-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.75rem;
    padding: 1rem 1.2rem 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .players-head h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  .players ul {
    list-style: none;
    margin: 0;
    padding: 0.35rem;
  }
  .skeleton {
    height: 12rem;
    background: linear-gradient(90deg, var(--surface), var(--surface-2), var(--surface));
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
  @media (max-width: 62rem) {
    .sync-row {
      grid-template-columns: 1fr;
    }
  }
</style>
