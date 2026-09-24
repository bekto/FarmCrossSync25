import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "svelte/store";
import {
  activeFarmId,
  destination,
  selectFarm,
  setDestination,
} from "./uiState.ts";

test("navigation state survives switching destinations", () => {
  selectFarm("local");
  setDestination("settings");
  assert.equal(get(destination), "settings");
  assert.equal(get(activeFarmId), "local");

  setDestination("farm");
  assert.equal(get(destination), "farm");
  assert.equal(get(activeFarmId), "local");
});
