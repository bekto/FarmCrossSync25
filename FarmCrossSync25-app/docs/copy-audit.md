# Copy audit (ticket 49)

Systematic pass over every user-facing string against the specs
(`specs/farm-crosssync-25/systems/desktop-ui.md`, `cloud-save-sync.md`,
`farms-and-membership.md`). Where the spec gives exact wording it is used
verbatim; deviations are listed at the bottom. Copy is checked by grep here,
not visually: this environment is headless (no GUI).

## Spec-mandated copy

| Spec string | Where it lives | Rendered by |
| --- | --- | --- |
| "Unable to connect to cloud. Your local save has not been changed." | `session.ts` `NEED_INTERNET_MESSAGE`; `errors.ts` `ERROR_MESSAGES["no-internet"]` | `friendlyErrorMessage` in `FarmScreen`, `showError("no-internet")` in `+page.svelte` |
| "This will replace your current local FS25 save. A backup will automatically be created first." | `download.ts` `DOWNLOAD_CONFIRMATION_MESSAGE` | `ConfirmDialog` via `runDownload`'s `confirm` |
| "Download & Replace" / "Cancel" | `+page.svelte` confirm label; `ConfirmDialog.svelte` | download confirmation dialog |
| "Keep My Save" / "Download Cloud Save" / "Cancel" | `ConflictDialog.svelte` buttons | conflict dialog |
| Failed cloud operations state local data is safe | `errors.ts` `ERROR_MESSAGES`; `upload.ts` `LOCAL_SAVE_SAFE_MESSAGE`; `download.ts` `ORIGINAL_SAVE_RECOVERABLE_MESSAGE` | toasts / inline alerts |
| Settings: player name, FS25 save, backup location, farm ID, farm code, Change Save, Leave Farm | `SettingsScreen.svelte` headings and buttons | Settings screen |
| "Make owner" and kick | `MemberRow.svelte`; `ownerActions.ts` `transferConfirmation` / `kickConfirmation` | player rows + confirmation |
| "Upload My Save" and "Download" on rows | `FarmScreen.svelte`; `MemberRow.svelte` | farm screen |
| Join Requests panel Accept / Deny | `JoinRequestsPanel.svelte` | owner view |
| Farm name + code with copy, latest upload, player list | `FarmScreen.svelte` | farm screen |
| FS25 Save Location, Scan Automatically / Select Folder | `SaveLocation.svelte` | onboarding |
| Size warning above ~200 MB | `upload.ts` `SIZE_WARNING_MESSAGE` | `UploadProgress.svelte` |
| Kick / leave delete the cloud save, local save untouched | `ownerActions.ts` `kickConfirmation`; `settings.ts` `leaveConfirmation` | confirmation dialog; leave blurb |
| Error states: no internet, upload failed, download failed, farm not found, already member, pending request, savegame not found, invalid save, hash mismatch | `errors.ts` `ERROR_MESSAGES` (one entry per `ErrorKey`) | toasts |

## Empty states

| State | Copy | Where rendered |
| --- | --- | --- |
| No active farm | `EMPTY_STATES.noFarm` — "No active farm. Create or join a farm to get started." | `FarmScreen.svelte`, `SettingsScreen.svelte`, `+page.svelte` |
| No saves | `EMPTY_STATES.noSaves` — "No saves in this farm yet. Upload yours to get started." | `FarmScreen.svelte` (latest upload) |
| No join requests | `EMPTY_STATES.noRequests` — "No pending join requests yet. New requests will appear here." | `JoinRequestsPanel.svelte` |

All three are non-blank, use the same "state + what to do / what happens next"
tone, and are actually rendered (branching on the empty collection, not `loading`).

## Destructive confirmations

| Action | What the dialog says | Primary button |
| --- | --- | --- |
| Download & Replace | exact spec sentence: replaces the current local FS25 save, backup created first | "Download & Replace" |
| Leave Farm | "Leave {farm}? Your cloud save in this farm will be deleted. Your local save is untouched." | "Leave Farm" |
| Kick | "Kick {name} from the farm? Their cloud save in this farm will be deleted. Your local save is untouched." | "Kick" |
| Transfer ownership | "Make {name} the farm owner? They will control joins, kicks, and ownership. You remain a member. Your local save is untouched." | "Make owner" |

Every dialog states what is deleted/replaced and whether the local save is
affected. `ConfirmDialog` now takes an action-specific `confirmLabel` so the
destructive choice is never a bare "Confirm".

## Deliberate deviations

- Conflict dialog uses **"Keep My Save"** (spec wording) rather than the
  ticket shorthand "Keep Mine".
- Download button uses **"Download & Replace"** (spec) rather than the
  prototype's "Download and Replace".
- Transfer confirmation adds "You remain a member. Your local save is
  untouched." The spec only requires a confirming dialog; this states the
  consequences explicitly.
- `farm-not-found`, `already-member`, and `pending-request` do **not** carry a
  local-save promise: those requests never touch local files, so the promise
  is reserved for failures that could affect a save (offline, upload, download,
  savegame-not-found, invalid-save, hash-mismatch).
- Upload/download failure copy uses the phrases "local save is unchanged and
  safe" / "original save is unchanged and recoverable" rather than reusing the
  offline sentence; the spec requires the promise, not specific wording. The
  "unchanged/recoverable" promise is reserved for failures *before* the install
  replaces the save: a download whose install succeeded but whose bookkeeping
  failed reports partial success (`download.ts` `INSTALLED_NOT_RECORDED_MESSAGE`)
  — it states the save WAS installed and never claims the original is
  unchanged (ticket 75).
- A local slot owned by another farm renders `fs25.ts` `slotConflictMessage`
  ("Slot N is already linked to another farm; choose a different slot") wherever
  a binding error surfaces (settings, farm setup, download recovery) instead of
  raw error JSON (ticket 80).
- `noRequests` extends the bare "No pending join requests." with "New requests
  will appear here." for informativeness (criterion 2).
- Confirmation dialogs render the action button before Cancel; the spec lists
  the actions as "Cancel / Download & Replace", which is treated as an
  enumeration, not button order.
