# 84: Synchronize display-name changes with the backend

**What to build:** Make the display name shown to farm members update when the user changes it in Settings.

**Priority:** P1

**Blocked by:** 76

**Status:** pending

- [ ] An authenticated user can update their display name through the backend.
- [ ] The desktop Settings flow sends the changed name through the shared API client.
- [ ] Farm member lists show the new name after the next refresh.
- [ ] A failed update leaves the local setting clearly distinguishable from a confirmed cloud update.

**Verify:** Run backend identity tests, settings tests, and a farm-member refresh regression test.

## Work Log
