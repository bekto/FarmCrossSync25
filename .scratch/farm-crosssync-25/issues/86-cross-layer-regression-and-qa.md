# 86: Add cross-layer regression and QA coverage

**What to build:** Add automated coverage for the real desktop/backend boundaries that existing injected unit fakes do not exercise.

**Priority:** P1

**Blocked by:** 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 89

**Status:** pending

- [ ] Regression tests cover the production Rust hash metadata contract used by the UI.
- [ ] Regression tests cover upload baseline updates and download conflicts after local modification.
- [ ] Regression tests cover empty bound-slot downloads and installation/state recovery failures.
- [ ] Regression tests cover unauthorized recovery, farm capacity races, duplicate requests, and upload metadata mismatch.
- [ ] A documented verification pass records desktop, backend, Rust, and E2E results from a clean run.

**Verify:** Run the complete desktop check, Rust tests, backend tests/typecheck, and applicable E2E suites.

## Work Log
