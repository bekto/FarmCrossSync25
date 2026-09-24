# 79: Harden Tauri CSP and command permissions

**What to build:** Restrict the desktop webview and Tauri capabilities so frontend code cannot access more local resources or commands than the product requires.

**Priority:** P0

**Blocked by:** 76

**Status:** done

- [x] The application uses a restrictive Content Security Policy instead of disabling CSP.
- [x] The main window exposes only the permissions and plugins required by the product.
- [x] The unused opener plugin and its capability are removed if no production feature uses it.
- [x] The Tauri build and development commands still run with the reduced policy.

**Verify:** Run the desktop build, typecheck, and a security-configuration review of the generated Tauri capability set.

## Work Log

CSP (src-tauri/tauri.conf.json:23-25, replacing `"csp": null`):

- Production `csp` is `default-src 'self'; script-src 'self'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src
  'self' ipc: http://ipc.localhost http://localhost:8787
  https://farm-crosssync-backend-staging.workers.dev
  https://farm-crosssync-backend.workers.dev https://*.r2.cloudflarestorage.com;
  object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self';
  frame-ancestors 'none'`.
- `script-src 'self'` in production: the shipped bundle is static module JS from
  the app origin, and Tauri appends nonces/hashes for its own injected
  bootstrap scripts automatically (tauri manager/mod.rs:86-101), so no inline
  or eval relaxation is needed in the built app.
- The SvelteKit/Vite dev-server relaxations (`'unsafe-inline' 'unsafe-eval'`
  script sources, plus `ws://localhost:1420` for HMR) ARE scoped to dev only:
  Tauri supports a separate `devCsp` (tauri-utils config.rs:2906-2907) that
  `tauri dev` injects instead of `csp`.
- `style-src 'unsafe-inline'` stays in both policies on purpose and cannot be
  dev-scoped: the built `src/app.html` contains a literal `style` attribute and
  Svelte sets styles at runtime. CSS sources cannot execute script, so this is
  not a script-execution hole (the script relaxations are the dangerous ones,
  and those are dev-only).
- `connect-src` is exactly what the product needs: the three API hosts from
  `src/lib/config.ts:19-23` (the packaged app defaults to the local Worker on
  `http://localhost:8787`), `https://*.r2.cloudflarestorage.com` for presigned
  archive downloads (`downloadTransport.ts`), and `ipc: http://ipc.localhost`
  for Tauri command IPC (including the raw-IPC chunks of ticket 85).
- Everything else is closed: `object-src`/`frame-src 'none'`,
  `base-uri 'self'`, `form-action`/`frame-ancestors 'none'`; `img-src`/`font-src`
  are `'self' data:` (local favicon + inline SVG icons only).

Opener removal (no production feature uses it — no `@tauri-apps/plugin-opener`
import exists anywhere in `src/`):

- src-tauri/capabilities/default.json — permissions are now exactly
  `core:default` + `dialog:default` (`dialog` stays: `folderPicker.ts:5-8` uses
  the directory picker).
- src-tauri/Cargo.toml:22 — `tauri-plugin-opener` dependency removed.
- src-tauri/src/lib.rs:13 — `tauri_plugin_opener::init()` removed.
- package.json / package-lock.json — `@tauri-apps/plugin-opener` removed via
  `npm uninstall`.

Kept unchanged as required: `dialog:default`, and the asset protocol with
`scope: ["$TEMP/**"]` (tauri.conf.json:26-29) — no wider than the app's own
temp archives.

Security-configuration review of the generated capability set
(src-tauri/gen/schemas/capabilities.json + acl-manifests.json after the build):
the `default` capability grants the `main` window exactly `["core:default",
"dialog:default"]`; the ACL manifests contain only `core:*` and `dialog` —
no opener entry remains in the generated schemas.

Evidence: `npm run build` succeeds with the policy, `cargo test` passes 93/93,
`npm run check` reports 205 files / 0 errors / 0 warnings.

Full verification battery (after all three tickets landed):
`npm run check` 205 files / 0 errors / 0 warnings · `node --test src/lib/*.test.ts`
177 pass / 0 fail · `cargo test` 93 pass / 0 fail · `npm run build` OK ·
`npm run upload:e2e` 17/0 · `npm run download:e2e` 23/0 ·
`npm run reliability:e2e` 28/0 · `npm run lifecycle:e2e` 41/0.
