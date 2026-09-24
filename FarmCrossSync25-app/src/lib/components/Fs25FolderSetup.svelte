<script lang="ts">
  import { detectFs25Roots, listSlots } from "$lib/fs25";
  import { pickFolder } from "$lib/folderPicker";
  import { createFs25Root, type Fs25RootView } from "$lib/fs25Root";
  import { setFs25Root } from "$lib/identity";
  import { buildSlotCards } from "$lib/slots";
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";
  import SlotPicker from "./SlotPicker.svelte";

  interface Props {
    onDone: (root: string) => void;
    /** Injected so the picker can be faked; production uses the Tauri dialog. */
    pick?: () => Promise<string | null>;
  }

  let { onDone, pick = pickFolder }: Props = $props();

  let view = $state<Fs25RootView>({
    candidates: [],
    root: null,
    slots: [],
    busy: false,
    error: null,
  });

  const controller = createFs25Root({
    detectFs25Roots,
    listSlots,
    pickFolder: () => pick(),
    setFs25Root,
  });

  onMount(async () => {
    await controller.detect();
    view = controller.snapshot();
  });

  async function selectFolder() {
    await controller.selectFolder();
    view = controller.snapshot();
  }

  async function confirm() {
    const root = view.root;
    if (!root) return;
    const ok = await controller.confirm();
    view = controller.snapshot();
    if (ok) onDone(root);
  }

  // Preview only: no bindings, no farm, so every slot follows the join matrix.
  const cards = $derived(
    buildSlotCards({
      slots: view.slots,
      bindings: [],
      farmId: null,
      farmNames: {},
      mode: "join",
    }),
  );

  const ready = $derived(!view.busy && view.root !== null && view.slots.length > 0);
</script>

<section class="onboarding">
  <header class="intro">
    <span class="hero-icon"><Icon name="sprout" size={26} /></span>
    <p class="step">Step 1 of 2</p>
    <h1>FS25 Save Folder</h1>
    <p class="muted">Pick the folder that holds your savegame1, savegame2, … folders.</p>
  </header>

  <div class="methods">
    <button class="card method" onclick={selectFolder} disabled={view.busy}>
      <span class="method-icon alt"><Icon name="folder" size={20} /></span>
      <span class="method-text">
        <strong>Select Folder</strong>
        <span class="muted">Pick the FS25 folder yourself</span>
      </span>
    </button>
  </div>

  {#if view.busy}
    <p class="muted status">Scanning…</p>
  {/if}
  {#if view.error}
    <p class="banner error" role="alert"><Icon name="alert" />{view.error}</p>
  {/if}
  {#if view.root}
    <p class="muted status">FS25 folder: <code>{view.root}</code></p>
  {/if}

  {#if view.slots.length > 0}
    <div class="slots">
      <p class="eyebrow">Slots in this folder</p>
      <SlotPicker cards={cards} selected={null} onSelect={() => {}} readonly />
    </div>
  {/if}

  <div class="actions">
    <button class="primary lg" onclick={confirm} disabled={!ready}>Continue</button>
  </div>
</section>

<style>
  .onboarding {
    max-width: 38rem;
    margin: 1.5rem auto 0;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }
  .intro {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .intro h1 {
    margin: 0.35rem 0 0.4rem;
    font-size: 1.85rem;
  }
  .intro p {
    margin: 0;
  }
  .hero-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.5rem;
    height: 3.5rem;
    margin-bottom: 1rem;
    border-radius: 16px;
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 8px 28px var(--accent-glow);
  }
  .step {
    color: var(--accent);
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .methods {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
  .method {
    justify-content: flex-start;
    gap: 0.85rem;
    padding: 1rem;
    text-align: left;
    white-space: normal;
  }
  .method:hover:not(:disabled) {
    background: var(--surface-2);
    border-color: var(--accent);
  }
  .method-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 11px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .method-icon.alt {
    background: var(--info-soft);
    color: var(--info);
  }
  .method-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    font-weight: 400;
  }
  .method-text strong {
    font-weight: 600;
  }
  .method-text .muted {
    font-size: 0.85em;
  }
  .status {
    margin: 0;
    text-align: center;
    word-break: break-all;
  }
  .slots {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .actions {
    display: flex;
    justify-content: center;
  }
</style>
