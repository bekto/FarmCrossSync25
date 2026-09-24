# 88: Remove unused dependencies, commands, and capabilities

**What to build:** Delete code and dependency registrations that are not used by the product after the slot rework and API consolidation.

**Priority:** P2

**Blocked by:** 87

**Status:** pending

- [ ] The unused opener dependency and capability are removed if no product feature requires them.
- [ ] Unused legacy scan, replace, and identity commands have no production or test callers.
- [ ] The standalone poller, fabricated presence indicator, and unused error catalog entries are removed or retained only when a real consumer exists.
- [ ] Lockfiles and dependency manifests match the code after cleanup.

**Verify:** Run dependency auditing, desktop typecheck, Rust tests, and the complete unit suite.

## Work Log
