# 47: Reliability failure-mode pass

**What to build:** A recorded manual pass over the Stage 7 failure checklist, confirming every failure case leaves the local save recoverable.

**Priority:** P2

**Blocked by:** 41, 42, 43

**Status:** done

- [x] The Stage 7 checklist is executed and results are recorded (interrupted upload/download, offline, corrupt save, hash mismatch, duplicate requests, simultaneous uploads, large saves, missing save, invalid paths, permission violations, multiple farms/PCs, leave/rejoin, backend failure)
- [x] Every failure case leaves the local save recoverable
- [x] Bugs found are fixed in place or filed as follow-up tickets

## Work Log
- Done: New `docs/reliability-pass.md` (all 16 checklist items with exact commands + observed results) and `scripts/reliability-e2e.mjs` (28/0). Full suite: `node --test` 98/0, `cargo test` 54/0, backend `npm test` 37/0, upload-e2e 13/0, download-e2e 21/0, lifecycle-e2e 41/0. Every failure case left the original save byte-unchanged.
- Follow-up recorded F-47-1: `upload-complete` trusts client-sent sha256 (cloud-metadata hardening; not local-save safety). Limits stated: no live GUI, no true process-kill, large-save simulated, permission test ran as uid 1000.
