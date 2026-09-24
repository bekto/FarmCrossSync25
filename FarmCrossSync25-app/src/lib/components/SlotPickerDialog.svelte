<script lang="ts">
  import { untrack } from "svelte";
  import type { SlotCard } from "$lib/slots";
  import SlotPicker from "./SlotPicker.svelte";

  interface Props {
    title: string;
    cards: SlotCard[];
    onResolve: (card: SlotCard | null) => void;
  }

  let { title, cards, onResolve }: Props = $props();

  let selected = $state<SlotCard | null>(
    untrack(() => cards.find((card) => card.preselected) ?? null),
  );

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") onResolve(null);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="modal-backdrop">
  <div class="modal slot-modal" role="dialog" aria-modal="true" aria-label={title}>
    <h2>{title}</h2>
    <SlotPicker
      {cards}
      selected={selected?.slot ?? null}
      onSelect={(card) => (selected = card)}
    />
    <div class="modal-actions">
      <button class="ghost" onclick={() => onResolve(null)}>Cancel</button>
      <button class="primary" disabled={!selected} onclick={() => onResolve(selected)}>
        {selected ? `Download to Slot ${selected.slot}` : "Download to Slot"}
      </button>
    </div>
  </div>
</div>

<style>
  .slot-modal {
    width: min(40rem, 100%);
  }
</style>
