import { test } from "node:test";
import assert from "node:assert/strict";
import type { SlotInfo } from "./fs25.ts";
import {
  createFs25Root,
  normalizeRoot,
  NO_FS25_ROOT_MESSAGE,
  type Fs25RootDeps,
} from "./fs25Root.ts";

function slot(n: number, root = "/root"): SlotInfo {
  return {
    slot: n,
    path: `${root}/savegame${n}`,
    used: n === 1,
    validation: n === 1 ? "valid" : null,
    mapName: n === 1 ? "Riverbend" : null,
    lastModified: null,
  };
}

function fakeDeps(overrides: Partial<Fs25RootDeps> = {}) {
  const calls = {
    detected: 0,
    listed: [] as string[],
    picked: 0,
    persisted: [] as string[],
  };
  const deps: Fs25RootDeps = {
    detectFs25Roots: async () => {
      calls.detected++;
      return ["/games/FS25"];
    },
    listSlots: async (root) => {
      calls.listed.push(root);
      return [slot(1, root)];
    },
    pickFolder: async () => {
      calls.picked++;
      return "/picked/FS25";
    },
    setFs25Root: async (path) => {
      calls.persisted.push(path);
      return { path };
    },
    ...overrides,
  };
  return { deps, calls };
}

test("normalizeRoot strips savegameN on Linux and Windows, trailing separator", () => {
  assert.equal(normalizeRoot("/home/me/FS25/savegame3"), "/home/me/FS25");
  assert.equal(
    normalizeRoot("C:\\Users\\me\\FarmingSimulator2025\\savegame5"),
    "C:\\Users\\me\\FarmingSimulator2025",
  );
  assert.equal(normalizeRoot("/home/me/FS25/savegame3/"), "/home/me/FS25");
  // A folder that is already the FS25 root is returned unchanged.
  assert.equal(normalizeRoot("/home/me/FS25"), "/home/me/FS25");
  assert.equal(normalizeRoot("C:\\Games\\FarmingSimulator2025"), "C:\\Games\\FarmingSimulator2025");
});

test("detect with zero candidates sets the guidance error", async () => {
  const { deps } = fakeDeps({ detectFs25Roots: async () => [] });
  const controller = createFs25Root(deps);

  await controller.detect();

  const view = controller.snapshot();
  assert.equal(view.candidates.length, 0);
  assert.equal(view.root, null);
  assert.deepEqual(view.slots, []);
  assert.equal(view.error, NO_FS25_ROOT_MESSAGE);
});

test("detect with one candidate auto-chooses it and lists slots", async () => {
  const { deps, calls } = fakeDeps({ detectFs25Roots: async () => ["/games/FS25"] });
  const controller = createFs25Root(deps);

  await controller.detect();

  const view = controller.snapshot();
  assert.equal(view.root, "/games/FS25");
  assert.equal(view.slots.length, 1);
  assert.equal(view.slots[0].path, "/games/FS25/savegame1");
  assert.equal(view.error, null);
  assert.deepEqual(calls.listed, ["/games/FS25"]);
});

test("detect with two candidates chooses the first", async () => {
  const { deps, calls } = fakeDeps({
    detectFs25Roots: async () => ["/games/FS25", "/other/FS25"],
  });
  const controller = createFs25Root(deps);

  await controller.detect();

  assert.equal(controller.snapshot().root, "/games/FS25");
  assert.equal(controller.snapshot().candidates.length, 2);
  assert.deepEqual(calls.listed, ["/games/FS25"]);
});

test("choose normalizes a savegame pick before listing slots", async () => {
  const { deps, calls } = fakeDeps();
  const controller = createFs25Root(deps);

  await controller.choose("/games/FS25/savegame4");

  assert.equal(controller.snapshot().root, "/games/FS25");
  assert.deepEqual(calls.listed, ["/games/FS25"]);
});

test("choose that errors sets error and leaves root null", async () => {
  const { deps } = fakeDeps({
    listSlots: async () => {
      throw new Error("cannot read folder");
    },
  });
  const controller = createFs25Root(deps);

  await controller.choose("/games/FS25");

  const view = controller.snapshot();
  assert.equal(view.root, null);
  assert.deepEqual(view.slots, []);
  assert.equal(view.error, "cannot read folder");
});

test("a cancelled picker changes nothing", async () => {
  const { deps, calls } = fakeDeps();
  let picks = 0;
  deps.pickFolder = async () => {
    picks++;
    return null;
  };
  const controller = createFs25Root(deps);

  await controller.choose("/games/FS25");
  const before = controller.snapshot();
  await controller.selectFolder();

  assert.equal(picks, 1);
  assert.deepEqual(calls.listed, ["/games/FS25"]);
  assert.deepEqual(controller.snapshot(), before);
});

test("selectFolder chooses the picked folder", async () => {
  const { deps, calls } = fakeDeps({ pickFolder: async () => "/picked/FS25/savegame2" });
  const controller = createFs25Root(deps);

  await controller.selectFolder();

  assert.equal(controller.snapshot().root, "/picked/FS25");
  assert.deepEqual(calls.listed, ["/picked/FS25"]);
});

test("confirm without a root returns false and does not persist", async () => {
  const { deps, calls } = fakeDeps();
  const controller = createFs25Root(deps);

  assert.equal(await controller.confirm(), false);
  assert.deepEqual(calls.persisted, []);
});

test("confirm persists the chosen root", async () => {
  const { deps, calls } = fakeDeps();
  const controller = createFs25Root(deps);
  await controller.choose("/games/FS25");

  assert.equal(await controller.confirm(), true);
  assert.deepEqual(calls.persisted, ["/games/FS25"]);
});
