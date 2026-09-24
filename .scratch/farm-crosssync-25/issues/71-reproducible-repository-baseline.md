# 71: Make the repository reproducible from a clean checkout

**What to build:** Make the complete FarmCrossSync project available from a clean Git checkout, with ignored local state and generated artifacts excluded and no secrets committed.

**Priority:** P0

**Blocked by:** None

**Status:** done

- [x] A clean checkout contains the desktop app, backend, specifications, documentation, and active ticket pool.
- [x] A root Git ignore policy prevents local Wrangler state, dependencies, build output, and secrets from being staged.
- [x] The tracked tree contains no session tokens, R2 credentials, private save archives, or local identity data.
- [x] Repository layout and setup documentation describe how the nested desktop and backend projects relate.

**Verify:** Clone the repository into a fresh temporary directory and run the documented install and typecheck commands successfully.

## Work Log

- 2026-09-24: Done. The desktop app and backend were **embedded Git repositories** — a clone of the outer repo produced only docs/specs/tickets and no source. Flattened into a single monorepo with history preserved (both scaffold commits `8c3e0aa`, `5ecc36a` are parents of `92b5dbb`). Nested `.git` dirs moved to a sibling `FarmCrossSync25-nested-git-backup/` directory outside the tree as a reversible backup.
  - Root `.gitignore` added: node_modules, dist/build/.svelte-kit/target, `src-tauri/gen/` (Tauri-generated capability schemas), `.wrangler/`, `.env*`, `.dev.vars`, identity/sync-state files.
  - Secrets scan before staging: clean. Only env var *names* and the well-known AWS doc example key `AKIAIOSFODNN7EXAMPLE` (botocore SigV4 test vectors in `farms.test.mjs`). `.dev.vars` holds only `ENABLE_R2_TEST=true`. No save archives, no local identity data, no tokens.
  - Root `README.md` documents how the desktop app and backend relate, prerequisites, and the documented install/typecheck commands.
  - **Verified** by clone: `git clone . /tmp/fcs25-verify` → app+backend+docs+specs+all 90 tickets present; `npm install` + `npm run check` = 205 files, 0 errors; `npm install` + `npm run typecheck` clean; `npm test` = 37/37 pass.
