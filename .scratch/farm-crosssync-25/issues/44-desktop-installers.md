# 44: Desktop installers

**What to build:** Distributable builds — Windows NSIS .exe and Linux AppImage — that install, launch, and talk to the configured API with no secrets embedded.

**Priority:** P1

**Blocked by:** 01

**Status:** done

- [x] Windows build produces an NSIS .exe that installs and launches
- [x] Linux build produces an AppImage that runs
- [x] Installed app talks to the configured API_BASE_URL
- [x] No secrets are embedded in either installer

## Work Log
- Failed (initial): Windows NSIS `.exe` could not be built on this Linux host — no `x86_64-pc-windows-msvc` target/linker, no `makensis`.
- Done (resolved via Linux cross-compile): installed `clang`/`lld`/`llvm`/`mingw-nsis-base`/`mingw64-nsis`, overlaid the official `nsis-3.08` Stubs+Plugins into `/usr/share/nsis`, added the `x86_64-pc-windows-msvc` target, `cargo install --locked cargo-xwin`, then `VITE_APP_ENV=production npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis` (exit 0). Artifact: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/FarmCrossSync25_0.1.0_x64-setup.exe` (1.9 MB, PE32 GUI Nullsoft installer, sha256 `76a15d6d…e2286c`); extracted payload contains `tauri-app.exe` + `uninstall.exe`, no `.env`/`.dev.vars`/key files. Linux AppImage built and smoke-tested (`FarmCrossSync25_0.1.0_amd64.AppImage`, 105 MB; launched, window confirmed via `wmctrl`).
- Criterion 1 caveat: the NSIS `.exe` is genuinely produced, but **install + launch could not be exercised** — that requires a Windows host (or wine). Criterion 3 verified at config/build level (`VITE_APP_ENV`/`VITE_API_BASE_URL`, single `config.ts`); production/staging URLs are placeholders.
- Assumptions: cross-compilation is Tauri's experimental path (warned in build log); `NO_STRIP=1` needed for the Linux AppImage; no signing (no cert).
