# 62: UI — Create Farm requires choosing a used slot

**What to build:** The Create Farm form in `FarmSetup.svelte` shows a SlotPicker (`mode: "create"`). Create stays disabled until a Used slot is picked. After the farm is created, the slot is bound to the new farm.

**Priority:** P0

**Blocked by:** 58, 60

**Status:** done

**Design:** `.scratch/farm-crosssync-25/slots-design.md` (read it first; do not redesign).

**Files:**
- `src/lib/farmSetup.ts`:
  - `create(name, slot: number)`: validate that `slot` is given (error "Pick the save slot to start this farm with.").
  - After `api.createFarm`, call the new dependency `bindSlot(farmId, slot): Promise<void>`, then `setActiveFarm`.
  - If `bindSlot` fails, still make the farm active, and set `state.error` to "Farm created, but the slot could not be linked. Choose it on the Farm screen."
- `src/lib/farmSetup.test.ts` (create it if it is missing): tests for the missing slot, success calling bindSlot before setActiveFarm, and bindSlot failure
- `src/lib/components/FarmSetup.svelte`: new props `slotCards` and `onCreate(name, slot)`. It tracks the selected slot locally.
- `src/routes/+page.svelte`:
  - Build the cards (mode create) from `listSlots($fs25Root)` and `listSlotBindings()`.
  - Wire `bindSlot: (id, slot) => setFarmSlot(id, $fs25Root, slot)`, then `refreshBoundSave()`.

**Acceptance:**
- [x] Empty and unusable slots cannot be picked for create
- [x] The created farm immediately shows "Slot N · <map>" in the sidebar, and upload is enabled
- [x] Unit tests above pass

**Verify:** `cd FarmCrossSync25-app && node --test src/lib/*.test.ts && npm run check && npm run build` — all pass. Visual check is optional (headless is fine); note it in the Work Log.

## Work Log
- Done: `FarmSetup` create form requires a Used slot via SlotPicker(mode create); `farmSetup.create(name, slot)` binds slot before activating; node tests 135 pass, check/build clean; visual check headless only.
