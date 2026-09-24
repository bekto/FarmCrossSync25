# 71: Make the repository reproducible from a clean checkout

**What to build:** Make the complete FarmCrossSync project available from a clean Git checkout, with ignored local state and generated artifacts excluded and no secrets committed.

**Priority:** P0

**Blocked by:** None

**Status:** pending

- [ ] A clean checkout contains the desktop app, backend, specifications, documentation, and active ticket pool.
- [ ] A root Git ignore policy prevents local Wrangler state, dependencies, build output, and secrets from being staged.
- [ ] The tracked tree contains no session tokens, R2 credentials, private save archives, or local identity data.
- [ ] Repository layout and setup documentation describe how the nested desktop and backend projects relate.

**Verify:** Clone the repository into a fresh temporary directory and run the documented install and typecheck commands successfully.

## Work Log
