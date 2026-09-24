<script lang="ts">
  import { EMPTY_STATES, friendlyErrorMessage } from "$lib/errors";
  import type { FarmSetup } from "$lib/farmSetup";
  import type { SlotCard } from "$lib/slots";
  import Icon from "./Icon.svelte";
  import SlotPicker from "./SlotPicker.svelte";

  interface Props {
    screen: FarmSetup;
    /** Create-mode cards from `buildSlotCards`. */
    slotCards: SlotCard[];
    /** Join-mode cards from `buildSlotCards`; empty and used slots are pickable. */
    joinSlotCards: SlotCard[];
    /** Shell handlers run through the session gate (deferred registration). */
    onCreate: (name: string, slot: number) => void | Promise<void>;
    onJoin: (code: string, slot: number) => void | Promise<void>;
  }

  let { screen, slotCards, joinSlotCards, onCreate, onJoin }: Props = $props();

  let nameDraft = $state("");
  let codeDraft = $state("");
  let selectedSlot = $state<number | null>(null);
  let joinSelectedSlot = $state<number | null>(null);

  function submitCreate(event: SubmitEvent) {
    event.preventDefault();
    if (nameDraft.trim() && selectedSlot !== null) {
      void onCreate(nameDraft, selectedSlot);
    }
  }

  function submitJoin(event: SubmitEvent) {
    event.preventDefault();
    if (codeDraft.trim() && joinSelectedSlot !== null) {
      void onJoin(codeDraft, joinSelectedSlot);
    }
  }
</script>

<section class="farm-setup">
  <header class="intro">
    <p class="step">Step 2 of 2</p>
    <h1>Set up your farm</h1>
    <p class="muted">{EMPTY_STATES.noFarm}</p>
  </header>

  {#if $screen.error}
    <p class="banner error" role="alert">
      <Icon name="alert" />{friendlyErrorMessage($screen.error)}
    </p>
  {/if}
  {#if $screen.message}
    <p class="banner ok" role="status"><Icon name="check" />{$screen.message}</p>
  {/if}

  <div class="options">
    <form class="card option" onsubmit={submitCreate}>
      <span class="option-icon"><Icon name="plus" size={20} /></span>
      <h2>Create a farm</h2>
      <p class="muted">You become the owner and get a code to invite friends.</p>
      <input
        bind:value={nameDraft}
        placeholder="Farm name"
        aria-label="Farm name"
        maxlength="48"
        disabled={$screen.creating}
      />
      <div class="slot-choice">
        <p class="eyebrow">Pick the save slot to start with</p>
        <SlotPicker
          cards={slotCards}
          selected={selectedSlot}
          onSelect={(card) => (selectedSlot = card.slot)}
        />
      </div>
      <button
        type="submit"
        class="primary"
        disabled={$screen.creating || !nameDraft.trim() || selectedSlot === null}
      >
        {$screen.creating ? "Creating…" : "Create Farm"}
      </button>
    </form>

    <div class="divider" aria-hidden="true"><span>or</span></div>

    <form class="card option" onsubmit={submitJoin}>
      <span class="option-icon join"><Icon name="users" size={20} /></span>
      <h2>Join a farm</h2>
      <p class="muted">Enter the farm code a friend shared with you.</p>
      <input
        class="code-input"
        bind:value={codeDraft}
        placeholder="X7K9-PQ2"
        aria-label="Farm code"
        autocomplete="off"
        spellcheck="false"
        disabled={$screen.joining}
      />
      <div class="slot-choice">
        <p class="eyebrow">Pick the save slot to link to this farm</p>
        <SlotPicker
          cards={joinSlotCards}
          selected={joinSelectedSlot}
          onSelect={(card) => (joinSelectedSlot = card.slot)}
        />
      </div>
      <button
        type="submit"
        class="outline"
        disabled={$screen.joining || !codeDraft.trim() || joinSelectedSlot === null}
      >
        {$screen.joining ? "Sending…" : "Request to Join"}
      </button>
    </form>
  </div>
</section>

<style>
  .farm-setup {
    max-width: 50rem;
    margin: 1.5rem auto 0;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .intro {
    text-align: center;
  }
  .intro h1 {
    margin: 0.35rem 0 0.4rem;
    font-size: 1.85rem;
  }
  .intro p {
    margin: 0;
  }
  .step {
    color: var(--accent);
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .options {
    display: grid;
    grid-template-columns: 1fr;
    align-items: stretch;
    gap: 1rem;
  }
  .slot-choice {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .option {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1.4rem;
  }
  .option h2 {
    margin: 0.2rem 0 0;
    font-size: 1.15rem;
  }
  .option p {
    margin: 0 0 0.4rem;
    flex: 1;
  }
  .option-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 12px;
    background: var(--accent-soft);
    color: var(--accent);
  }
  .option-icon.join {
    background: var(--info-soft);
    color: var(--info);
  }
  .code-input {
    font-family: var(--mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .code-input::placeholder {
    text-transform: none;
  }
  .divider {
    display: flex;
    align-items: center;
    color: var(--muted);
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  @media (max-width: 60rem) {
    .options {
      grid-template-columns: 1fr;
    }
    .divider {
      justify-content: center;
    }
  }
</style>
