# 85: Stream large upload and download archives

**What to build:** Move large archive bytes through file-based or streaming transport so a large save does not need to be held entirely in webview memory or serialized as a number array through IPC.

**Priority:** P1

**Blocked by:** 78

**Status:** done

- [x] Upload progress works for archives larger than the warning threshold without creating a webview-sized byte copy.
- [x] Download writes bytes to temporary storage without passing the entire archive through a JSON number array.
- [x] Hash verification and safe replacement behavior remain unchanged for streamed transfers.
- [x] Temporary files are cleaned up after success and failure.

**Verify:** Run upload/download E2E tests with a large mock archive and observe bounded process memory.

## Work Log

### How bytes travel now

Download (was: full `arrayBuffer()` in the webview -> `Array.from` -> JSON
number array over IPC -> `write_temp_archive(Vec<u8>)`):

1. `createGetToDisk` (downloadTransport.ts) fetches the presigned URL as before,
   then drains `res.body` with `getReader()`, batching stream chunks to at most
   `DEFAULT_CHUNK_BYTES` = 256 KiB per append and copying them out of the
   stream's buffers.
2. Each batch goes over Tauri raw IPC: `append_temp_archive` (contract.rs:497)
   receives the chunk as a binary request body (`tauri::ipc::Request`), never a
   number array, with the staged file path in the `x-archive-path` header
   (contract.rs:484).
3. Rust appends the chunk to `fs25-download-<uuid>.zip` under the system temp
   dir (pack.rs:131 `append_download_chunk`); the guard (pack.rs:157
   `is_staged_download`) only accepts that naming convention directly under the
   temp dir, so no other path is writable through the command.
4. `unpackSave` -> `computeHash(stagedPath)` -> `installSaveToSlot` are
   byte-for-byte the unchanged paths (download.ts:255-280).

Upload (was: `readArchive` buffered the packed archive as a Uint8Array via the
asset protocol, then PUT the buffer):

- `createPutToR2` (uploadTransport.ts) now only selects the target (presigned
  URL vs the local-dev `/r2-test` fallback — logic unchanged) and maps the
  response status to the existing `Upload to storage failed (N). The save was
  not published.` copy. The bytes move through the injected `putArchive`:
  production wires `putArchiveFile` (fs25.ts:190 -> contract.rs:531), a Rust
  command that streams the packed `fs25-pack-<uuid>.zip` file to the target
  with `ureq` (transfer.rs:41 `put_archive`) — `Content-Length` from the file
  size, `host`/`content-length`/`transfer-encoding` reserved (derived from the
  URL/stack as the browser did), and a guard so only archives this app packed
  or staged can be sent (transfer.rs:48, pack.rs:172 `is_managed_archive`).
  The webview passes only the path/URL/headers — zero archive bytes.
- File-based transport was chosen deliberately for the upload direction:
  WebKitGTK/Linux webviews reject streaming request bodies ("ReadableStream
  uploading is not supported", WebKit bug 203617), so a webview streaming PUT
  would break uploads on one of the bundled platforms. Streaming the file from
  the backend process is the cross-platform "file-based transport" the ticket
  allows and bounds memory everywhere.

What bounds peak memory:

- Webview (download): one copied chunk per append (<= 256 KiB) plus at most one
  fetched stream chunk — independent of archive size; the batch buffer is the
  only accumulation and flushes at the same bound.
- Webview (upload): zero archive bytes; only the path, URL, and headers.
- Rust: ureq's bounded 128 KiB I/O buffers (config.rs `input_buffer_size`/
  `output_buffer_size`) for the transfer, one chunk per append for staging.
- Measured (throwaway smoke, 220 MB mock archive): upload heap growth ~2 MB,
  download heap growth 0, all 230,686,720 bytes staged byte-for-byte.

Cleanup is unchanged where it existed and extended where staging became
streamed: `runDownload`'s `finally` still runs `cleanupPack`/`cleanupUnpack`
(download.ts:295-308), and a mid-stream failure now also removes the partial
staged archive inside `createGetToDisk` before rethrowing (downloadTransport.ts
`catch` -> `removeArchive`), so no temp file outlives a failed download.

### Files

- src-tauri/src/fs25/pack.rs:107-175 — `new_download_archive`,
  `append_download_chunk`, `is_staged_download`, `is_managed_archive`;
  `write_temp_archive` deleted. Tests pack.rs:483-531 (ordered appends + byte
  totals + idempotent cleanup; append rejects foreign paths untouched; guard
  covers only `fs25-pack-`/`fs25-download-` names).
- src-tauri/src/fs25/transfer.rs (new) — file-based streaming PUT + tests
  (streams 300 KB byte-for-byte with `Content-Length` from the file size,
  filters reserved headers, non-2xx status is data, unmanaged files are never
  sent, invalid methods rejected before transfer).
- src-tauri/src/fs25/contract.rs:484-543 — `ARCHIVE_PATH_HEADER`,
  `open_temp_archive`, raw-IPC `append_temp_archive`, `put_archive_file`;
  command table updated (contract.rs:18-20); `write_temp_archive` removed.
- src-tauri/src/lib.rs:24-26 — the three commands registered.
- src-tauri/Cargo.toml:30 — `ureq` (rustls, default features off).
- src/lib/fs25.ts:161-205 — `openTempArchive`, `appendTempArchive` (raw
  binary invoke + header), `putArchiveFile`; `writeTempArchive` and its
  `Array.from` round trip deleted.
- src/lib/downloadTransport.ts (rewritten) — streamed staging with bounded
  chunk batching; `stageArchive` dep replaced by
  `openArchive`/`appendArchive`/`removeArchive`.
- src/lib/uploadTransport.ts (rewritten) — `readFile` dep replaced by the
  file-based `putArchive(request) -> status`; target selection and error copy
  preserved exactly.
- src/routes/+page.svelte:163-180 — wires `putArchiveFile` and the staging
  commands; `readArchive`/`convertFileSrc` removed.
- Tests: downloadTransport.test.ts (8: reconstruction, bounded-chunk
  invariant, 64 MB heap-growth bound, dev fallback, no staging on non-ok,
  partial removal on mid-stream failure, marker, default chunk bound),
  uploadTransport.test.ts (4: request spec, dev fallback, status error copy,
  marker). `node --test src/lib/*.test.ts`: 177 pass / 0 fail.
- E2E: all four suites moved to the new seams (streaming `putArchive` via
  node file streams; `stagingFns()` chunk appends in download-e2e), and the
  required large-archive checks were added: upload-e2e criterion 5 runs a
  220 MB mock archive (> the 200 MB warning threshold) through the real
  `runUpload` size-warning + progress phases + `createPutToR2` into a local
  sink, asserting the full byte count and heap growth < 55 MB; download-e2e
  criterion 5 streams a 220 MB synthetic body through `createGetToDisk` into
  the staged temp file with the same bounds. Rust `cargo test` 93/93;
  `npm run check` 0 errors.

Full verification battery (after all three tickets landed):
`npm run check` 205 files / 0 errors / 0 warnings · `node --test src/lib/*.test.ts`
177 pass / 0 fail · `cargo test` 93 pass / 0 fail · `npm run build` OK ·
`npm run upload:e2e` 17/0 · `npm run download:e2e` 23/0 ·
`npm run reliability:e2e` 28/0 · `npm run lifecycle:e2e` 41/0.
