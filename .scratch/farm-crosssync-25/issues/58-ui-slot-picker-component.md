# 58: UI — SlotPicker component

**What to build:** A presentational `SlotPicker.svelte` that renders `SlotCard[]` as selectable cards, one per slot. It has no data loading.

**Priority:** P0

**Blocked by:** 56

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:** new `src/lib/components/SlotPicker.svelte`

**Props:** `cards: SlotCard[]` (all of them), `selected: number | null`, `onSelect: (card: SlotCard) => void`, `readonly?: boolean` (preview only; nothing is clickable).

**Rules:**
- Each card is a `<button>` showing the title, the subtitle, and a status chip: Used / Empty / Unusable / Linked.
- Non-selectable cards are `disabled`.
- The selected card is highlighted with `aria-pressed`.
- Match the existing look: copy the CSS variables and card/chip styling from `SaveLocation.svelte` and `FarmScreen.svelte`. Reuse `Icon.svelte` (e.g. `check` for Used, `alert` for Unusable). Do not add new colors.
- The component keeps a local `expanded` flag (default false) and renders `visibleCards(cards, expanded)` from `slots.ts`. Do not filter in the component.
- Compact view: full-size cards in a 3-column grid that wraps.
- Expanded view: small tiles (slot number, a status dot, map name truncated with ellipsis) in a 5-column grid.
- A text button under the grid toggles between "Show all N slots" and "Show fewer". Hide it when `hiddenCount` is 0 and the view is not expanded.
- Everything must work at a width of 900px with no horizontal scroll.

**Acceptance:**
- [x] With 20 cards (2 used), the compact view shows 3 cards plus "Show all 20 slots"; expanding shows 20 tiles
- [x] The selected card stays highlighted when switching between compact and expanded
- [x] Disabled cards cannot be clicked
- [x] `readonly` disables all clicks but keeps the normal (non-greyed) styling
- [x] `npm run audit:styles` passes

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check && npm run build` — all pass. Visual check is optional (headless is fine); note it in the Work Log.

## Work Log
- Done: added presentational `SlotPicker.svelte` (compact/expanded via `visibleCards`, chips, aria-pressed, readonly); node tests 128 pass, check/build/audit:styles clean; visual check headless SSR only.
