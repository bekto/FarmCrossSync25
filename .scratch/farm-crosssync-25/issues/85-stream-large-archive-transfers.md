# 85: Stream large upload and download archives

**What to build:** Move large archive bytes through file-based or streaming transport so a large save does not need to be held entirely in webview memory or serialized as a number array through IPC.

**Priority:** P1

**Blocked by:** 78

**Status:** pending

- [ ] Upload progress works for archives larger than the warning threshold without creating a webview-sized byte copy.
- [ ] Download writes bytes to temporary storage without passing the entire archive through a JSON number array.
- [ ] Hash verification and safe replacement behavior remain unchanged for streamed transfers.
- [ ] Temporary files are cleaned up after success and failure.

**Verify:** Run upload/download E2E tests with a large mock archive and observe bounded process memory.

## Work Log
