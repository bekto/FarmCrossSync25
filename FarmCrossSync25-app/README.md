# FarmCrossSync25 — Desktop Application

The desktop client for Farm CrossSync 25: a Tauri 2 app that lets a small
FS25 multiplayer farm share their latest savegames through the cloud. It owns
everything local — save discovery, validation, hashing, backup, safe replace,
per-farm sync state and secure identity storage — and talks to the
`FarmCrossSync25-backend` Worker for identity, farm membership and save
metadata.

See the repository root `README.md` for how this project relates to the
backend, and `specs/farm-crosssync-25/` for the product and system specs.

## Layout

| Path | What lives there |
| --- | --- |
| `src/lib/` | TypeScript services, pure view models and their `*.test.ts` suites |
| `src/routes/` | SvelteKit pages; `+page.svelte` is the wiring layer |
| `src/lib/components/` | Svelte components (thin — they delegate to `src/lib`) |
| `src-tauri/src/fs25/` | Rust FS25 module: discovery, validator, metadata, hash, backup, replace, slots, packing, sync state |
| `src-tauri/src/identity.rs` | Installation identity + session token in OS secure storage |
| `src-tauri/capabilities/` | Tauri capability set (source of truth for permissions) |
| `scripts/` | End-to-end harnesses driving the real flows |

## Prerequisites

- Node.js 22+ (Node's built-in test runner and type stripping are used)
- Rust stable with `cargo`, plus `clippy`
- Tauri 2 platform dependencies — on Linux: `libwebkit2gtk-4.1-dev`,
  `libayatana-appindicator3-dev`, `librsvg2-dev`

## Local development

```bash
npm install
npm run dev          # Vite dev server; use `npm run tauri dev` for the app shell
```

The client needs a running backend. Start one locally with
`npm run dev` in `FarmCrossSync25-backend` (see its README); the local
environment points at `http://localhost:8787` by default.

## Environment configuration

`src/lib/config.ts` is the single source of truth for the API host. The client
embeds only a base URL — never secrets.

| Variable | Meaning |
| --- | --- |
| `VITE_APP_ENV` | `local` (default) \| `staging` \| `production` — selects the API host |
| `VITE_API_BASE_URL` | Optional override of the host for a build, without editing code |

## Tests

```bash
npm run check                                   # svelte-check (typecheck)
node --test src/lib/*.test.ts                   # TypeScript unit tests
cargo test  --manifest-path src-tauri/Cargo.toml            # Rust unit tests
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

End-to-end suites — each starts its own local Worker and drives the real
client flow (see the backend README for the dev-only R2 route markers these
rely on):

```bash
npm run upload:e2e        # pack, upload, complete, metadata integrity
npm run download:e2e      # authorize, stream, verify, install, backup
npm run reliability:e2e   # failure modes, offline, interrupted transfers
npm run lifecycle:e2e     # farm create/join/accept/kick/leave/deletion
```

## Build and installers

```bash
npm run build                                   # web bundle (adapter-static)
npm run tauri build                             # app + native installers
```

`src-tauri/tauri.conf.json` configures the bundle: product `FarmCrossSync25`,
identifier `com.farmcrosssync.desktop`, targets `nsis` (Windows) and `appimage`
(Linux). Installers land under `src-tauri/target/<profile>/bundle/`.

## Security posture

- **CSP is enabled and restrictive.** `script-src 'self'`; the SvelteKit/Vite
  relaxations live in a separate `devCsp` that only `tauri dev` injects.
- **Capability set is minimal**: `core:default` + `dialog:default` only. There
  is no filesystem or HTTP plugin — the frontend cannot reach arbitrary local
  paths. All FS25 filesystem work goes through the scoped Tauri commands in
  `src-tauri/src/fs25/`.
- **Session tokens** live in OS secure storage (`keyring`), falling back to a
  `0600` file only when no secret service is available. They are never written
  to `identity.json`.
