# 80: Enforce one farm per local slot

**What to build:** Prevent two farms from being bound to the same local FS25 slot, including when state is written through commands or recovered after interrupted setup.

**Priority:** P1

**Blocked by:** 71

**Status:** done

- [x] Binding a farm to a slot already owned by another farm fails with a clear user-facing error.
- [x] Existing conflicting bindings are detected and reported during recovery rather than silently overwritten.
- [x] The slot view model and list-bindings output cannot represent two owners for one slot.
- [x] Unbinding or changing a farm slot leaves the remaining bindings accurate.

**Verify:** Run local sync-state tests for duplicate binding, rebinding, and recovery cases.

## Work Log

## Work Log

- `src-tauri/src/fs25/contract.rs:45-52` — new `Fs25Error::SlotConflict { slot, ownerFarmId }` (serialized `kind: "slotConflict"`, camelCase field) with Display (contract.rs:74-77); `SlotBinding` gains `conflicting_farm_ids` (contract.rs:280-296) and the `set_farm_slot`/`list_slot_bindings` command docs state the one-farm-per-slot contract (contract.rs:355-360, 529-535).
- `src-tauri/src/fs25/sync_state.rs:85-120` — `set_farm_slot` rejects a slot claimed by any other farm with `SlotConflict` before touching any state; `sync_state.rs:130-176` — `list_bindings` is provably single-owner-per-slot (deterministic: sorted claimants, alphabetically first owns the entry) and reports pre-existing conflicting claimants in `conflicting_farm_ids` instead of silently dropping/overwriting them; shared deterministic scan `claimants_by_slot`.
- TS surfacing: `src/lib/fs25.ts:111-118` `slotConflictMessage` (single source of copy) + `Fs25Error` union/`SlotBinding` mirror (fs25.ts:100-109); `src/lib/errors.ts:82-99` `describeError` renders `slotConflict` as "Slot N is already linked to another farm; choose a different slot" (used by settings changeSlot and the Farm-screen slot picker); `src/lib/farmSetup.ts:117-128,159-167` create/join bind failures include the described cause; the download post-install recovery path reports it via `detailOf` (download.ts:147-159). `src/lib/slots.ts:96-104` — the view model dedupes per slot (first claimant wins) so it cannot represent two owners.
- Tests — Rust (`sync_state.rs:407-545`): "set_farm_slot_rejects_a_slot_owned_by_another_farm" (error shape + nothing written), "set_farm_slot_rebinds_a_farm_to_another_slot" (remaining bindings accurate, old slot cleared), "set_farm_slot_to_a_taken_slot_keeps_the_old_binding", "set_farm_slot_to_the_farms_own_slot_is_idempotent", "preexisting_conflicting_bindings_are_reported_not_overwritten" (recovery reporting: one entry + `conflicting_farm_ids`, rejected bind never steals, claimants unchanged). TS: `download.test.ts` "recovery reports a pre-existing slot conflict instead of overwriting it", `settings.test.ts` "changeSlot surfaces a slot owned by another farm clearly", `farmSetup.test.ts` "create surfaces a slot owned by another farm clearly", `errors.test.ts` "describeError renders a slot conflict as clear user copy", `slots.test.ts` "the view model never represents two owners for one slot".
- Changed tests (intentional, ticket 80): `farmSetup.test.ts` BIND/JOIN bind-failure copy expectations now include the surfaced cause; `sync_state.rs` `list_bindings_returns_only_farms_with_a_slot` literal updated for the new `conflicting_farm_ids` field (assertions unchanged).
