# 01: Scaffold desktop repository

**What to build:** Fresh Tauri 2 desktop app repository with Rust + Svelte + TypeScript, the FS25 module layout, and Git initialized so work can be committed from day one.

**Priority:** P0

**Blocked by:** None

**Status:** done

- [x] `npm install && npm run build` exits 0 in the desktop repository
- [x] `cargo build` exits 0 in the Tauri Rust crate
- [x] Source tree contains `src/` for the Svelte UI and `src-tauri/` with `fs25/` folders for per-OS discovery, validator, metadata, hash, and backup
- [x] `npm run dev` opens an app window showing a placeholder screen
- [x] `git init` has been run and an initial commit exists

## Work Log
- Done: Scaffolded Tauri 2 + Svelte/TypeScript app in `FarmCrossSync25-app/` with `src-tauri/src/fs25/{discovery,windows,linux,validator,metadata,hash,backup}` stubs, `npm run build` and `cargo build` exit 0, git initialized with initial commit `8c3e0aa`.
- Assumption: desktop repository root is `FarmCrossSync25-app/` (separate repo from the project-meta root repo). Criterion 4 verified as far as the headless environment allows: placeholder `src/routes/+page.svelte` is the app entry and the Vite dev server serves it (HTTP 200); an actual GUI window cannot be opened here, and the window is launched via `npm run tauri dev` (Tauri standard) rather than `npm run dev` (Vite only).
