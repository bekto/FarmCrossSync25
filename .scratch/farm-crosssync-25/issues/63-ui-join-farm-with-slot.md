# 63: UI — Join Farm lets the user pick a slot (empty or used)

**What to build:** The Join form also shows a SlotPicker (`mode: "join"`). The join request already resolves the farm id through `/farms/lookup`, so the chosen slot is bound to that farm id right away. The binding is local only, so it is safe while the request is pending.

**Priority:** P0

**Blocked by:** 62

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- `src/lib/farmSetup.ts`:
  - `FarmSetupApi.joinFarm(code)` now returns `Promise<{ farmId: string }>`. `httpFarmSetupApi` returns the id it looked up.
  - `join(code, slot: number)` requires a slot and calls `bindSlot(farmId, slot)` after the join request succeeds.
  - A bindSlot failure is not fatal. Show the message "Request sent. Choose your slot on the Farm screen once accepted."
- Tests in `farmSetup.test.ts`: missing slot, success binds the returned farm id, bindSlot failure
- `FarmSetup.svelte`: the join form has its own slot selection, independent of the create form's selection
- `+page.svelte`: pass mode-join cards

**Acceptance:**
- [x] Both Empty and Used slots can be picked when joining
- [x] When the owner accepts and the farm becomes active, the sidebar already shows the chosen slot (Empty slot: "Slot N · empty")
- [x] A join failure (bad code) does not bind anything

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check && npm run build` — all pass. Visual check is optional (headless is fine); note it in the Work Log.

## Work Log
- Done: join form picks a slot (empty or used), `join(code, slot)` binds after a successful request, non-fatal bind failure; node tests 139 pass, check/build clean; visual check headless only.
- Failed: acceptance #2 (sidebar shows "Slot N · empty" for an Empty slot) conflicts with ticket 60's `resolveBoundSave`, which deliberately returns null for empty slots and is asserted in `slots.test.ts`; satisfying it would require changing ticket 60's completed behaviour, so left unimplemented.
- Done (retry): criterion #2 satisfied without touching ticket 60: new display-only `emptySlot` store in `uiState.ts` set by `refreshBoundSave` when the farm's slot is Empty; sidebar pill shows "Slot N · empty". `resolveBoundSave`/`boundSave` unchanged. node tests pass, check/build clean.
