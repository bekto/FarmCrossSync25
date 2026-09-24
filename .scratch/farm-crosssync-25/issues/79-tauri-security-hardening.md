# 79: Harden Tauri CSP and command permissions

**What to build:** Restrict the desktop webview and Tauri capabilities so frontend code cannot access more local resources or commands than the product requires.

**Priority:** P0

**Blocked by:** 76

**Status:** pending

- [ ] The application uses a restrictive Content Security Policy instead of disabling CSP.
- [ ] The main window exposes only the permissions and plugins required by the product.
- [ ] The unused opener plugin and its capability are removed if no production feature uses it.
- [ ] The Tauri build and development commands still run with the reduced policy.

**Verify:** Run the desktop build, typecheck, and a security-configuration review of the generated Tauri capability set.

## Work Log
