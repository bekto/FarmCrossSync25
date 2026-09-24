<script lang="ts">
  import { EMPTY_STATES, friendlyErrorMessage } from "$lib/errors";
  import type { SettingsScreen } from "$lib/settings";
  import type { SlotCard } from "$lib/slots";
  import Icon from "./Icon.svelte";

  interface Props {
    screen: SettingsScreen;
    /** Active farm id; Settings loads its detail (id + code). */
    farmId: string;
    /** Called after the farm's slot changes so the shell rebinds the store. */
    onSlotsChanged?: () => void;
    /** Opens the slot picker dialog (join mode); null on cancel. */
    chooseSlot: (cards: SlotCard[]) => Promise<SlotCard | null>;
    /** Loads the join-mode slot cards for the current FS25 folder. */
    loadSlotCards: () => Promise<SlotCard[]>;
    /** Called after a successful leave so the shell can navigate away. */
    onLeft?: () => void;
  }

  let { screen, farmId, onSlotsChanged, chooseSlot, loadSlotCards, onLeft }: Props =
    $props();

  let nameDraft = $state("");
  let busy = $state(false);
  let cards = $state<SlotCard[]>([]);

  // `$screen` auto-subscribes; keep the editable draft in sync with the store.
  $effect(() => {
    nameDraft = $screen.displayName;
  });

  $effect(() => {
    if (farmId) void screen.load(farmId);
  });

  // Load the slot cards whenever the FS25 folder changes: they supply the map
  // shown next to the slot number and the cards the Change dialog renders.
  $effect(() => {
    void $screen.fs25Root;
    void (async () => {
      try {
        cards = await loadSlotCards();
      } catch {
        cards = [];
      }
    })();
  });

  const slotCard = $derived(
    $screen.slot == null
      ? null
      : (cards.find((card) => card.slot === $screen.slot) ?? null),
  );

  const slotLabel = $derived(
    $screen.slot == null
      ? "No slot"
      : `Slot ${$screen.slot}${slotCard ? ` · ${slotCard.subtitle.split(" · ")[0]}` : ""}`,
  );

  async function saveName(event?: SubmitEvent) {
    event?.preventDefault();
    if (!nameDraft.trim() || nameDraft.trim() === $screen.displayName) return;
    busy = true;
    await screen.saveDisplayName(nameDraft);
    busy = false;
  }

  async function changeFs25Root() {
    busy = true;
    await screen.changeFs25Root();
    busy = false;
  }

  async function changeSlot() {
    busy = true;
    try {
      const chosen = await chooseSlot(await loadSlotCards());
      if (!chosen) return;
      await screen.changeSlot(farmId, chosen.slot);
      onSlotsChanged?.();
    } finally {
      busy = false;
    }
  }

  async function changeBackupLocation() {
    busy = true;
    await screen.changeBackupLocation();
    busy = false;
  }

  async function leave() {
    busy = true;
    const left = await screen.leave(farmId);
    busy = false;
    if (left && onLeft) onLeft();
  }

  async function signOut() {
    busy = true;
    await screen.signOut();
    busy = false;
  }
</script>

<section class="settings">
  <header class="page-head">
    <h1>Settings</h1>
    {#if $screen.loading}<span class="muted">Loading…</span>{/if}
  </header>

  {#if $screen.error}
    <p class="banner error" role="alert">
      <Icon name="alert" />{friendlyErrorMessage($screen.error)}
    </p>
  {/if}
  {#if $screen.message}
    <p class="banner ok" role="status"><Icon name="check" />{$screen.message}</p>
  {/if}

  <section class="group">
    <h2 class="eyebrow">Profile</h2>
    <div class="card rows">
      <form class="row" onsubmit={saveName}>
        <div class="label">
          <h3>Player name</h3>
          <p class="muted">What your friends see next to your uploads.</p>
        </div>
        <div class="control inline">
          <input
            bind:value={nameDraft}
            placeholder="Display name"
            aria-label="Display name"
            maxlength="64"
            disabled={busy}
          />
          <button
            type="submit"
            disabled={busy || !nameDraft.trim() || nameDraft.trim() === $screen.displayName}
          >
            Save name
          </button>
        </div>
      </form>
    </div>
  </section>

  <section class="group">
    <h2 class="eyebrow">Save &amp; backups</h2>
    <div class="card rows">
      <div class="row">
        <div class="label">
          <h3>FS25 folder</h3>
          <p class="value" class:muted={!$screen.fs25Root} title={$screen.fs25Root ?? undefined}>
            {$screen.fs25Root ?? "No FS25 folder selected yet."}
          </p>
        </div>
        <div class="control">
          <button onclick={changeFs25Root} disabled={busy}>
            <Icon name="folder" size={15} />Change FS25 folder
          </button>
        </div>
      </div>
      <div class="row">
        <div class="label">
          <h3>Save slot for this farm</h3>
          <p class="value" class:muted={$screen.slot == null}>{slotLabel}</p>
        </div>
        <div class="control">
          <button onclick={changeSlot} disabled={busy || !$screen.fs25Root}>
            <Icon name="save" size={15} />Change
          </button>
        </div>
      </div>
      <div class="row">
        <div class="label">
          <h3>Backup location</h3>
          <p class="value" class:muted={!$screen.backupLocation} title={$screen.backupLocation ?? undefined}>
            {$screen.backupLocation ?? "Default (app data folder)"}
          </p>
        </div>
        <div class="control">
          <button onclick={changeBackupLocation} disabled={busy}>
            <Icon name="folder" size={15} />Change backup location
          </button>
        </div>
      </div>
    </div>
  </section>

  <section class="group">
    <h2 class="eyebrow">Farm</h2>
    <div class="card rows">
      {#if $screen.farm}
        <div class="row">
          <div class="label">
            <h3>{$screen.farm.name}</h3>
            <dl class="meta">
              <dt>Farm code</dt>
              <dd><code class="code">{$screen.farm.code}</code></dd>
              <dt>Farm ID</dt>
              <dd><code class="id">{$screen.farm.id}</code></dd>
            </dl>
          </div>
        </div>
      {:else}
        <div class="row"><p class="muted">{EMPTY_STATES.noFarm}</p></div>
      {/if}
    </div>
  </section>

  <section class="group">
    <h2 class="eyebrow danger-title">Danger zone</h2>
    <div class="card rows danger-zone">
      <div class="row">
        <div class="label">
          <h3>Leave Farm</h3>
          <p class="muted">
            Leaves this farm and deletes your cloud save in it. Your local save is
            untouched.
          </p>
        </div>
        <div class="control">
          <button class="danger" onclick={leave} disabled={busy}>
            <Icon name="logout" size={15} />Leave Farm
          </button>
        </div>
      </div>
      <div class="row">
        <div class="label">
          <h3>Sign out</h3>
          <p class="muted">
            Ends this device's cloud session. Your local saves and settings stay
            on this device.
          </p>
        </div>
        <div class="control">
          <button onclick={signOut} disabled={busy}>
            <Icon name="logout" size={15} />Sign out
          </button>
        </div>
      </div>
    </div>
  </section>
</section>

<style>
  .settings {
    max-width: 48rem;
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
  }
  .page-head {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }
  .page-head h1 {
    margin: 0;
    font-size: 1.6rem;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .group > h2 {
    padding-left: 0.2rem;
  }
  .danger-title {
    color: var(--danger);
  }
  .rows {
    overflow: hidden;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
    margin: 0;
    padding: 1rem 1.2rem;
  }
  .row + .row {
    border-top: 1px solid var(--border);
  }
  .label {
    flex: 1 1 16rem;
    min-width: 0;
  }
  .label h3 {
    margin: 0 0 0.2rem;
    font-size: 0.98rem;
  }
  .label p {
    margin: 0;
    font-size: 0.9em;
  }
  .label .value {
    font-family: var(--mono);
    font-size: 0.82em;
    color: var(--text-soft);
    word-break: break-all;
  }
  .control {
    display: flex;
    gap: 0.5rem;
    flex: none;
  }
  .control.inline input {
    width: 14rem;
  }
  .meta {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.3rem 1rem;
    margin: 0.5rem 0 0;
    font-size: 0.9em;
  }
  .meta dt {
    color: var(--muted);
  }
  .meta dd {
    margin: 0;
    word-break: break-all;
  }
  .code {
    font-weight: 700;
    letter-spacing: 0.1em;
    color: var(--accent);
  }
  .id {
    font-size: 0.85em;
    color: var(--text-soft);
  }
  .danger-zone {
    border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
  }
</style>
