# 90: Remove generated artifacts and stale point-in-time docs

**What to build:** Keep the repository focused on source, active specifications, active tickets, and durable documentation while retaining reproducible local setup.

**Priority:** P2

**Blocked by:** 71, 89

**Status:** done

- [x] Generated dependency, build, Tauri target, Wrangler state, and temporary test artifacts are excluded from the repository and documented as reproducible.
- [x] Completed point-in-time reliability reports are archived or clearly marked as historical.
- [x] Superseded prototype references and obsolete product briefs no longer direct contributors to removed files.
- [x] The active ticket pool and current progress index remain complete and usable.

**Verify:** Clone the repository into a clean temporary directory, inspect the tracked tree, and run the documented setup checks.

## Work Log

- 2026-09-25: Done.
  - Generated artifacts excluded and documented as reproducible: root `.gitignore` covers node_modules, dist/build/.svelte-kit/target, `src-tauri/gen/`, `.wrangler/`, `.env*`, `.dev.vars`, identity/sync-state files. Verified the tracked tree (254 files) contains none of them — largest entries are lockfiles and app icons. The stray root `.wrangler/` (local Miniflare test state) was deleted.
  - Point-in-time reports marked historical: `FarmCrossSync25-app/docs/reliability-pass.md` now carries a banner stating its counts are frozen and where to get current ones.
  - Superseded references removed: `docs/PRODUCT.md` gained a status banner directing readers to `specs/` and the root README, its two-repo/Git-strategy sections were rewritten for the monorepo, and the GUI-prototype section is marked completed-and-removed. `docs/copy-audit.md` no longer points at the deleted `SaveLocation.svelte`.
  - Ticket pool and progress index complete and usable: `PROGRESS.md` regenerated from the issue files (90 tickets) instead of the stale 70-ticket index that claimed "Pending: 0" while listing pending work.
