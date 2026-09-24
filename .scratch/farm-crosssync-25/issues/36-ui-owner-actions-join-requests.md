# 36: UI owner actions and join requests

**What to build:** Owner-side controls — pending join requests with Accept/Deny, and Make owner / kick actions on player rows with confirmations.

**Priority:** P0

**Blocked by:** 21, 22, 23

**Status:** done

- [x] Owner sees pending join requests with Accept and Deny
- [x] Owner-only Make owner and kick actions appear on player rows
- [x] Transfer ownership and kick each require a confirmation dialog
- [x] Non-owners do not see owner-only actions

## Work Log
- 2026-09-24: Verified complete. Acceptance criteria already implemented and gated:
  - `src/lib/ownerActions.ts` `createOwnerActions` (accept/deny/makeOwner/kick) + `src/lib/components/JoinRequestsPanel.svelte` (Accept/Deny).
  - `ownerRowActions()` gates Make owner / Kick to `isOwner && rowUserId !== currentUserId`; `MemberRow.svelte` renders them only when `canMakeOwner`/`canKick` are set.
  - `FarmScreen.svelte:214` renders the join-requests panel only for `isOwner`; non-owners get no owner-only affordances.
  - `transferConfirmation()` / `kickConfirmation()` back both destructive actions.
  - `node --test src/lib/ownerActions.test.ts` = 9/9 pass (covers all four criteria).
