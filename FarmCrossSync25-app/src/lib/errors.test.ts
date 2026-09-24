import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import {
  describeError,
  dismissToast,
  EMPTY_STATES,
  ERROR_MESSAGES,
  errorMessage,
  friendlyErrorMessage,
  isNetworkError,
  pushToast,
  showError,
  toasts,
  type ErrorKey,
} from "./errors.ts";
import { NEED_INTERNET_MESSAGE } from "./session.ts";

const KEYS: ErrorKey[] = ["no-internet", "farm-not-found"];

test("catalog covers every rendered error with non-empty copy", () => {
  for (const key of KEYS) {
    assert.equal(typeof ERROR_MESSAGES[key], "string", `${key} is present`);
    assert.ok(ERROR_MESSAGES[key].length > 0, `${key} has copy`);
    assert.equal(errorMessage(key), ERROR_MESSAGES[key]);
  }
});

test("offline copy is the exact spec wording and promises local safety", () => {
  assert.equal(
    ERROR_MESSAGES["no-internet"],
    "Unable to connect to cloud. Your local save has not been changed.",
  );
  assert.equal(ERROR_MESSAGES["no-internet"], NEED_INTERNET_MESSAGE);
});

test("empty states are informative", () => {
  for (const copy of Object.values(EMPTY_STATES)) {
    assert.ok(copy.length > 0);
  }
  assert.match(EMPTY_STATES.noFarm, /farm/i);
  assert.match(EMPTY_STATES.noSaves, /save/i);
  assert.match(EMPTY_STATES.noRequests, /request/i);
});

test("isNetworkError recognizes offline failure shapes only", () => {
  assert.equal(isNetworkError(new TypeError("fetch failed")), true);
  assert.equal(isNetworkError(new Error("Failed to fetch")), true);
  assert.equal(
    isNetworkError(new Error("NetworkError when attempting to fetch resource.")),
    true,
  );
  assert.equal(isNetworkError("Network request failed"), true);
  assert.equal(isNetworkError(new Error("request failed: 500")), false);
  assert.equal(isNetworkError(undefined), false);
});

test("friendlyErrorMessage maps known situations and keeps service copy", () => {
  assert.equal(
    friendlyErrorMessage("fetch failed"),
    ERROR_MESSAGES["no-internet"],
  );
  assert.equal(
    friendlyErrorMessage("farm not found"),
    ERROR_MESSAGES["farm-not-found"],
  );
  const serviceCopy = "Upload failed: boom. Your local save is unchanged and safe.";
  assert.equal(friendlyErrorMessage(serviceCopy), serviceCopy);
});

test("toasts push, carry the catalog copy, and dismiss", () => {
  clearAll();
  const id = showError("no-internet");
  const list = get(toasts);
  assert.equal(list.length, 1);
  assert.equal(list[0].message, ERROR_MESSAGES["no-internet"]);
  assert.equal(list[0].key, "no-internet");
  assert.equal(list[0].id, id);

  pushToast("raw message");
  assert.equal(get(toasts).length, 2);

  dismissToast(id);
  const remaining = get(toasts);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].message, "raw message");
  clearAll();
});

test("describeError renders a slot conflict as clear user copy", () => {
  assert.equal(
    describeError({ kind: "slotConflict", slot: 2, ownerFarmId: "f2" }),
    "Slot 2 is already linked to another farm; choose a different slot",
  );
  // Errors and plain strings pass through unchanged.
  assert.equal(describeError(new Error("slot busy")), "slot busy");
  assert.equal(describeError("raw"), "raw");
});

function clearAll() {
  toasts.set([]);
}
