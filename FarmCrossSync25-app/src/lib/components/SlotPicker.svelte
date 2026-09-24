<script lang="ts">
  import type { SlotCard, SlotStatus } from "$lib/slots";
  import { visibleCards } from "$lib/slots";
  import Icon, { type IconName } from "./Icon.svelte";

  interface Props {
    /** Every card from `buildSlotCards`; filtering happens in `visibleCards`. */
    cards: SlotCard[];
    selected: number | null;
    onSelect: (card: SlotCard) => void;
    /** Preview only: nothing is clickable, but styling stays normal. */
    readonly?: boolean;
  }

  let { cards, selected, onSelect, readonly = false }: Props = $props();

  let expanded = $state(false);

  const view = $derived(visibleCards(cards, expanded));

  const CHIP: Record<SlotStatus, { label: string; icon: IconName }> = {
    empty: { label: "Empty", icon: "plus" },
    used: { label: "Used", icon: "check" },
    unusable: { label: "Unusable", icon: "alert" },
    linkedOther: { label: "Linked", icon: "users" },
    linkedThis: { label: "Linked", icon: "users" },
  };

  function pick(card: SlotCard) {
    if (readonly || !card.selectable) return;
    onSelect(card);
  }
</script>

<div class="slot-picker">
  {#if expanded}
    <ul class="tiles">
      {#each view.cards as card (card.slot)}
        <li>
          <button
            class="tile"
            class:selected={selected === card.slot}
            class:readonly
            aria-pressed={selected === card.slot}
            aria-disabled={readonly || undefined}
            disabled={!card.selectable}
            title={card.title}
            onclick={() => pick(card)}
          >
            <span class="tile-num">{card.slot}</span>
            <span class="dot {card.status}" aria-hidden="true"></span>
            <span class="tile-map">{card.subtitle}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <ul class="cards">
      {#each view.cards as card (card.slot)}
        {@const chip = CHIP[card.status]}
        <li>
          <button
            class="slot-card"
            class:selected={selected === card.slot}
            class:readonly
            aria-pressed={selected === card.slot}
            aria-disabled={readonly || undefined}
            disabled={!card.selectable}
            onclick={() => pick(card)}
          >
            <span class="card-head">
              <span class="card-title">{card.title}</span>
              <span class="chip {card.status}">
                <Icon name={chip.icon} size={13} />
                {chip.label}
              </span>
            </span>
            <span class="card-subtitle">{card.subtitle}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if expanded || view.hiddenCount > 0}
    <button class="ghost sm toggle" onclick={() => (expanded = !expanded)}>
      {expanded ? "Show fewer" : `Show all ${cards.length} slots`}
    </button>
  {/if}
</div>

<style>
  .slot-picker {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
  }
  .cards,
  .tiles {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .cards {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .tiles {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.5rem;
  }
  .cards li,
  .tiles li {
    min-width: 0;
  }
  .slot-card {
    flex-direction: column;
    align-items: stretch;
    gap: 0.4rem;
    width: 100%;
    padding: 0.8rem 0.9rem;
    text-align: left;
    white-space: normal;
    background: var(--surface);
    border-color: var(--border);
    border-radius: var(--radius-lg);
    font-weight: 400;
  }
  .slot-card:hover:not(:disabled) {
    background: var(--surface-2);
    border-color: var(--accent);
  }
  .slot-card.selected,
  .slot-card.selected:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-width: 0;
  }
  .card-title {
    font-weight: 600;
  }
  .card-subtitle {
    color: var(--muted);
    font-size: 0.85em;
    overflow-wrap: anywhere;
  }
  .chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--surface-3);
    color: var(--text-soft);
  }
  .chip.used,
  .chip.linkedThis {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .chip.empty {
    background: var(--info-soft);
    color: var(--info);
  }
  .chip.unusable {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .chip.linkedOther {
    background: var(--warn-soft);
    color: var(--warn);
  }
  .tile {
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    width: 100%;
    padding: 0.6rem 0.4rem;
    background: var(--surface);
    border-color: var(--border);
    border-radius: var(--radius);
    font-weight: 400;
  }
  .tile:hover:not(:disabled) {
    background: var(--surface-2);
    border-color: var(--accent);
  }
  .tile.selected,
  .tile.selected:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .tile-num {
    font-weight: 700;
    font-size: 0.95em;
  }
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--muted);
  }
  .dot.used,
  .dot.linkedThis {
    background: var(--accent);
  }
  .dot.empty {
    background: var(--info);
  }
  .dot.unusable {
    background: var(--danger);
  }
  .dot.linkedOther {
    background: var(--warn);
  }
  .tile-map {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 0.78em;
  }
  .slot-card.readonly,
  .tile.readonly {
    pointer-events: none;
  }
  .toggle {
    align-self: center;
  }
</style>
