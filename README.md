# Farm CrossSync 25

A desktop app and cloud backend for sharing Farming Simulator 25 savegames
between players on a farm.

## Repository layout

This is a single monorepo. The desktop app and the backend are sibling
directories in one Git repository; neither is a submodule or a nested
repository.

| Path | What it is | Stack |
| --- | --- | --- |
| `FarmCrossSync25-app/` | Desktop application: UI, FS25 save handling, local sync state | SvelteKit + Svelte 5 + TypeScript, Tauri 2 (Rust) |
| `FarmCrossSync25-app/src/` | Frontend (SvelteKit) | `src/lib` services + tests, `src/routes` screens |
| `FarmCrossSync25-app/src-tauri/` | Native side: FS25 discovery, hashing, backup, safe replace, secure identity storage | Rust |
| `FarmCrossSync25-backend/` | Cloud API: identity, farms, membership, save metadata, R2 transfer authorization | Hono on Cloudflare Workers, D1 + R2 |
| `specs/farm-crosssync-25/` | Product and system specifications | `SPEC.md`, `DESIGN.md`, `systems/` |
| `docs/` | Durable product documentation | |
| `.scratch/farm-crosssync-25/` | Working state: ticket pool and progress index | |

How the two projects relate: the desktop app is the only client of the
backend. It calls the HTTP API for identity, farm membership, and save
metadata, and it talks to R2 directly using presigned URLs issued by the
backend. All filesystem access to FS25 saves happens in the desktop app's
Rust layer — the backend never reads save bytes, it only stores and serves
them from R2.

The backend is independently deployable and knows nothing about FS25 slots;
the slot model is a desktop-only concern.

## Prerequisites

- Node.js 22+ (Node's built-in test runner and type stripping are used)
- Rust toolchain (stable) with `cargo`
- Tauri 2 platform dependencies (Linux: `webkit2gtk`, `libayatana-appindicator`)
- For the backend: `npx wrangler` (pulled in by `npm install`)

## Setup and verification

```bash
# Desktop app
cd FarmCrossSync25-app
npm install
npm run check                       # svelte-check (typecheck)
node --test src/lib/*.test.ts       # TypeScript unit tests
npm run build                       # production web build
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests

# Backend
cd ../FarmCrossSync25-backend
npm install
npm run typecheck
npm test
```

Each project's own `README.md` documents local startup, environment
variables, builds, and installers.

## What is deliberately not tracked

See `.gitignore`. Dependencies, build output (including the Rust `target/`
directory and Tauri-generated capability schemas), Wrangler local state,
environment and secret files, and local identity/session data are all
excluded. Everything needed to reproduce them is in the tree.
