import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, initials, relativeTime } from "./format.ts";

test("relativeTime buckets into just-now/m/h/d and falls back", () => {
  const now = Date.now();
  assert.equal(relativeTime(new Date(now - 5_000).toISOString()), "just now");
  assert.equal(relativeTime(new Date(now - 5 * 60_000).toISOString()), "5m ago");
  assert.equal(
    relativeTime(new Date(now - 3 * 60 * 60_000).toISOString()),
    "3h ago",
  );
  assert.equal(
    relativeTime(new Date(now - 2 * 24 * 60 * 60_000).toISOString()),
    "2d ago",
  );
  assert.equal(relativeTime(null), "never");
  assert.equal(relativeTime("not-a-date"), "not-a-date");
});

test("formatBytes renders human units and clamps at GB", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(2 * 1024 * 1024), "2 MB");
  assert.equal(formatBytes(3.5 * 1024 ** 3), "3.5 GB");
  assert.equal(formatBytes(100 * 1024 ** 4), "102400 GB");
});

test("initials takes up to two leading initials", () => {
  assert.equal(initials("Farm Hand"), "FH");
  assert.equal(initials("single"), "S");
  assert.equal(initials("  spaced   out  "), "SO");
  assert.equal(initials("   "), "?");
});
