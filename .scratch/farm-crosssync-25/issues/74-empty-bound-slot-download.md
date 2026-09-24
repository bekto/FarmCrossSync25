# 74: Fix downloads into empty bound slots

**What to build:** Allow a farm bound to an empty slot to download into that slot without attempting to read or back up nonexistent local content.

**Priority:** P0

**Blocked by:** 71

**Status:** done

- [x] A bound empty slot follows the empty-slot installation path.
- [x] A download into a bound empty slot succeeds and creates the selected slot.
- [x] A download into a bound empty slot does not show a replacement confirmation or create a backup for nonexistent content.
- [x] Used slots continue to require replacement confirmation and backup behavior.

**Verify:** Run the slot-flow unit tests and the empty-bound-slot download E2E case.

## Work Log

## Work Log

- `src/lib/slots.ts:20-23` — `SlotCard` now carries `used` straight from `SlotInfo.used` (actual folder existence); `slots.ts:123-129` sets it in `buildSlotCards` with a comment that binding/status must never drive used-vs-empty. `slots.ts:145-157` — `downloadGate` returns `"none"` for any card without a folder (including `linkedThis`), `"conflict"` for this farm's bound slot *with* a save, `"overwrite"` otherwise.
- `src/routes/+page.svelte:355-366` — the download input derives `slotUsed: card.used` instead of `card.status !== "empty"`, so a bound-but-empty slot takes the empty path (no replacement confirm, no conflict gate, no backup).
- Tests — gate level `slots.test.ts:381-425`: "a bound-but-empty slot is used=false and needs no gate" (linkedThis + used=false -> gate none, no overwrite confirm), "a bound slot with a save still needs the conflict gate and confirm", "used slots continue to require the overwrite gate". RunDownload level `download.test.ts:325-382`: "a bound-but-empty slot installs through the empty path without touching local content" (readMetadata/createBackup fakes throw if called; empty-slot confirm copy; install creates the slot with `wasEmpty: true`).
