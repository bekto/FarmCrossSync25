import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cloudUpdateFailedMessage,
  createSettings,
  DISPLAY_NAME_SYNCED_MESSAGE,
  leaveConfirmation,
  MAX_DISPLAY_NAME_LENGTH,
  signOutConfirmation,
  type SettingsDeps,
} from "./settings.ts";
import type { Identity } from "./identity.ts";
import type { SyncState } from "./fs25.ts";

const FARM = {
  id: "f1",
  name: "Green Acres",
  code: "ABCD-1234",
  owner_id: "u1",
};

interface Recorded {
  calls: string[];
  confirms: string[];
  confirmsWith: boolean;
  backupLocation: string | null;
  displayName: string | null;
  fs25Root: string | null;
  slot: number | null;
  pickResult: string | null;
  listSlotsError: string | null;
  cloudNameError: string | null;
}

function record(): Recorded {
  return {
    calls: [],
    confirms: [],
    confirmsWith: true,
    backupLocation: null,
    displayName: null,
    fs25Root: null,
    slot: null,
    pickResult: null,
    listSlotsError: null,
    cloudNameError: null,
  };
}

function makeDeps(record: Recorded, overrides: Partial<SettingsDeps> = {}): SettingsDeps {
  const identity: Identity = {
    installationId: "install-1",
    displayName: record.displayName,
    backupLocation: record.backupLocation,
    fs25Root: record.fs25Root,
  };
  return {
    getIdentity: async () => {
      record.calls.push("getIdentity");
      return identity;
    },
    setDisplayName: async (name) => {
      record.calls.push(`setDisplayName:${name}`);
      record.displayName = name;
      return { ...identity, displayName: name };
    },
    updateCloudDisplayName: async (name) => {
      record.calls.push(`updateCloudDisplayName:${name}`);
      if (record.cloudNameError) throw new Error(record.cloudNameError);
    },
    getSyncState: async (farmId) => {
      record.calls.push(`getSyncState:${farmId}`);
      return {
        farmId,
        boundSavePath: null,
        slot: record.slot,
      } as SyncState;
    },
    getFs25Root: async () => {
      record.calls.push("getFs25Root");
      return record.fs25Root;
    },
    setFs25Root: async (path) => {
      record.calls.push(`setFs25Root:${path}`);
      record.fs25Root = path;
      return { ...identity, fs25Root: path };
    },
    listSlots: async (root) => {
      record.calls.push(`listSlots:${root}`);
      if (record.listSlotsError) throw new Error(record.listSlotsError);
      return [];
    },
    setFarmSlot: async (farmId, root, slot) => {
      record.calls.push(`setFarmSlot:${farmId}:${root}:${slot}`);
      record.slot = slot;
      return { farmId, boundSavePath: null, slot } as SyncState;
    },
    pickFolder: async () => {
      record.calls.push("pickFolder");
      return record.pickResult;
    },
    getBackupLocation: async () => {
      record.calls.push("getBackupLocation");
      return record.backupLocation;
    },
    setBackupLocation: async (path) => {
      record.calls.push(`setBackupLocation:${path}`);
      record.backupLocation = path;
      return identity;
    },
    fetchFarm: async (farmId) => {
      record.calls.push(`fetchFarm:${farmId}`);
      return { ...FARM, id: farmId };
    },
    leaveFarm: async (farmId) => {
      record.calls.push(`leaveFarm:${farmId}`);
    },
    signOut: async () => {
      record.calls.push("signOut");
    },
    confirm: (message) => {
      record.confirms.push(message);
      return record.confirmsWith;
    },
    ...overrides,
  };
}

// --- Criterion 1: display name edit persists -------------------------------

test("load surfaces the stored display name", async () => {
  const r = record();
  r.displayName = "Ada";
  const settings = createSettings(makeDeps(r));

  await settings.load("f1");
  assert.equal(settings.snapshot().displayName, "Ada");
});

// --- Criterion 1: display name edit persists -------------------------------
// Since ticket 84 the name has two homes: the local setting (identity store)
// and the cloud row (`PATCH /me`). `saveDisplayName` writes both and returns
// true only when the cloud confirmed, so "updated" always means synced.

test("saveDisplayName persists locally and syncs the cloud name", async () => {
  const r = record();
  r.displayName = "Ada";
  const settings = createSettings(makeDeps(r));

  const ok = await settings.saveDisplayName("  Grace  ");
  assert.equal(ok, true);
  assert.ok(r.calls.includes("setDisplayName:Grace"));
  assert.ok(r.calls.includes("updateCloudDisplayName:Grace"));
  assert.equal(settings.snapshot().displayName, "Grace");
  assert.equal(settings.snapshot().message, DISPLAY_NAME_SYNCED_MESSAGE);
});

test("saveDisplayName accepts a 64-character name like the backend does", async () => {
  const r = record();
  const settings = createSettings(makeDeps(r));
  const name = "x".repeat(MAX_DISPLAY_NAME_LENGTH);

  const ok = await settings.saveDisplayName(name);
  assert.equal(ok, true);
  assert.ok(r.calls.includes(`setDisplayName:${name}`));
  assert.ok(r.calls.includes(`updateCloudDisplayName:${name}`));
});

test("saveDisplayName rejects a blank name without calling Tauri", async () => {
  const r = record();
  const settings = createSettings(makeDeps(r));

  const ok = await settings.saveDisplayName("   ");
  assert.equal(ok, false);
  assert.deepEqual(r.calls, []);
  assert.ok(settings.snapshot().error);
});

test("saveDisplayName rejects an over-long name instead of truncating", async () => {
  const r = record();
  const settings = createSettings(makeDeps(r));

  const ok = await settings.saveDisplayName("x".repeat(MAX_DISPLAY_NAME_LENGTH + 1));
  assert.equal(ok, false);
  assert.deepEqual(r.calls, [], "the backend's 64-char cap is enforced up front");
  assert.ok(settings.snapshot().error);
});

test("a failed cloud update leaves a clearly diverged local setting", async () => {
  const r = record();
  r.cloudNameError = "boom";
  const settings = createSettings(makeDeps(r));

  const ok = await settings.saveDisplayName("Grace");

  assert.equal(ok, false, "no ambiguous success when only the local write landed");
  assert.equal(settings.snapshot().displayName, "Grace", "the local name did change");
  assert.equal(
    settings.snapshot().error,
    cloudUpdateFailedMessage("boom"),
    "the error states the local/cloud split plainly",
  );
  assert.notEqual(settings.snapshot().message, DISPLAY_NAME_SYNCED_MESSAGE);
  assert.ok(r.calls.includes("updateCloudDisplayName:Grace"));
});

test("a failed local write never reaches the cloud update", async () => {
  const r = record();
  const settings = createSettings(makeDeps(r, {
    setDisplayName: async () => {
      throw new Error("secureStore");
    },
  }));

  const ok = await settings.saveDisplayName("Grace");

  assert.equal(ok, false);
  assert.equal(settings.snapshot().error, "secureStore");
  assert.ok(!r.calls.some((c) => c.startsWith("updateCloudDisplayName")));
});

// --- Criterion 1 + 4: FS25 folder + slot surfaced by load ------------------

test("load surfaces the stored FS25 folder and farm slot", async () => {
  const r = record();
  r.fs25Root = "/saves";
  r.slot = 3;
  const settings = createSettings(makeDeps(r));

  await settings.load("f1");
  assert.equal(settings.snapshot().fs25Root, "/saves");
  assert.equal(settings.snapshot().slot, 3);
});

// --- Criterion 2: Change FS25 folder normalizes, persists, reflects --------

test("changeFs25Root normalizes, lists slots, persists, reflects immediately", async () => {
  const r = record();
  r.pickResult = "/saves/savegame2";
  const settings = createSettings(makeDeps(r));

  const root = await settings.changeFs25Root();
  assert.equal(root, "/saves");
  assert.deepEqual(r.calls, [
    "pickFolder",
    "listSlots:/saves",
    "setFs25Root:/saves",
  ]);
  assert.equal(settings.snapshot().fs25Root, "/saves");
  assert.equal(settings.snapshot().message, "FS25 folder updated.");
});

test("changeFs25Root does nothing when the picker is cancelled", async () => {
  const r = record();
  r.fs25Root = "/old";
  r.pickResult = null;
  const settings = createSettings(makeDeps(r));
  await settings.load("f1");

  const root = await settings.changeFs25Root();
  assert.equal(root, null);
  assert.deepEqual(r.calls, ["getIdentity", "getSyncState:f1", "getBackupLocation", "fetchFarm:f1", "getFs25Root", "pickFolder"]);
  assert.equal(settings.snapshot().fs25Root, "/old");
});

test("changeFs25Root shows the error and keeps the old root when listSlots fails", async () => {
  const r = record();
  r.fs25Root = "/old";
  r.pickResult = "/new";
  r.listSlotsError = "Cannot read folder";
  const settings = createSettings(makeDeps(r));
  await settings.load("f1");

  const root = await settings.changeFs25Root();
  assert.equal(root, null);
  assert.equal(settings.snapshot().fs25Root, "/old");
  assert.equal(settings.snapshot().error, "Cannot read folder");
  assert.ok(!r.calls.some((c) => c.startsWith("setFs25Root")));
});

test("changeFs25Root does not change any farm's slot number", async () => {
  const r = record();
  r.slot = 3;
  r.pickResult = "/saves/savegame4";
  const settings = createSettings(makeDeps(r));
  await settings.load("f1");

  await settings.changeFs25Root();
  assert.equal(settings.snapshot().slot, 3);
  assert.ok(!r.calls.some((c) => c.startsWith("setFarmSlot")));
});

// --- Criterion 5: Change slot binds the farm to a slot ---------------------

test("changeSlot binds the farm to the slot and reflects immediately", async () => {
  const r = record();
  r.fs25Root = "/saves";
  const settings = createSettings(makeDeps(r));
  await settings.load("f1");

  const ok = await settings.changeSlot("f1", 2);
  assert.equal(ok, true);
  assert.ok(r.calls.includes("setFarmSlot:f1:/saves:2"));
  assert.equal(settings.snapshot().slot, 2);
  assert.equal(settings.snapshot().message, "Save slot updated.");
});

test("changeSlot reports the error when setFarmSlot fails", async () => {
  const r = record();
  r.fs25Root = "/saves";
  const settings = createSettings(makeDeps(r, {
    setFarmSlot: async () => {
      throw new Error("slot busy");
    },
  }));
  await settings.load("f1");

  const ok = await settings.changeSlot("f1", 2);
  assert.equal(ok, false);
  assert.equal(settings.snapshot().error, "slot busy");
  assert.equal(settings.snapshot().slot, null);
});

test("changeSlot surfaces a slot owned by another farm clearly", async () => {
  const r = record();
  r.fs25Root = "/saves";
  const settings = createSettings(makeDeps(r, {
    setFarmSlot: async () => {
      throw { kind: "slotConflict", slot: 2, ownerFarmId: "f2" };
    },
  }));
  await settings.load("f1");

  const ok = await settings.changeSlot("f1", 2);
  assert.equal(ok, false);
  assert.equal(
    settings.snapshot().error,
    "Slot 2 is already linked to another farm; choose a different slot",
  );
  assert.equal(settings.snapshot().slot, null, "the failed bind changes nothing");
});

test("changeSlot refuses when no FS25 folder is selected", async () => {
  const r = record();
  const settings = createSettings(makeDeps(r));

  const ok = await settings.changeSlot("f1", 2);
  assert.equal(ok, false);
  assert.ok(!r.calls.some((c) => c.startsWith("setFarmSlot")));
  assert.ok(settings.snapshot().error);
});

// --- Criterion 1 + 4: backup location change persists ----------------------

test("load surfaces the stored backup location", async () => {
  const r = record();
  r.backupLocation = "/backups";
  const settings = createSettings(makeDeps(r));

  await settings.load("f1");
  assert.equal(settings.snapshot().backupLocation, "/backups");
});

test("changeBackupLocation persists and reflects immediately", async () => {
  const r = record();
  r.pickResult = "/mnt/backups";
  const settings = createSettings(makeDeps(r));

  const ok = await settings.changeBackupLocation();
  assert.equal(ok, true);
  assert.ok(r.calls.includes("setBackupLocation:/mnt/backups"));
  assert.equal(settings.snapshot().backupLocation, "/mnt/backups");
});

// --- Criterion 2: farm id + code surfaced ----------------------------------

test("load surfaces the farm id and code", async () => {
  const r = record();
  const settings = createSettings(makeDeps(r));

  await settings.load("f1");
  assert.equal(settings.snapshot().farm?.id, "f1");
  assert.equal(settings.snapshot().farm?.code, "ABCD-1234");
});

// --- Criterion 3: Leave Farm requires confirmation -------------------------

test("leave proceeds only after confirmation", async () => {
  const r = record();
  const settings = createSettings(makeDeps(r));
  await settings.load("f1");

  const left = await settings.leave("f1");
  assert.equal(left, true);
  assert.equal(r.confirms.length, 1);
  assert.equal(r.confirms[0], leaveConfirmation("Green Acres"));
  assert.ok(r.confirms[0].includes("local save is untouched"));
  assert.ok(r.calls.includes("leaveFarm:f1"));
});

test("leave is skipped when the confirmation is declined", async () => {
  const r = record();
  r.confirmsWith = false;
  const settings = createSettings(makeDeps(r));

  const left = await settings.leave("f1");
  assert.equal(left, false);
  assert.equal(r.confirms.length, 1, "dialog was shown");
  assert.ok(!r.calls.includes("leaveFarm:f1"), "no backend call after declining");
});

// --- Ticket 83: Sign out ---------------------------------------------------

test("signOut proceeds only after confirmation", async () => {
  const r = record();
  const settings = createSettings(makeDeps(r));

  const ok = await settings.signOut();
  assert.equal(ok, true);
  assert.deepEqual(r.confirms, [signOutConfirmation()]);
  assert.ok(r.calls.includes("signOut"));
});

test("signOut is skipped when the confirmation is declined", async () => {
  const r = record();
  r.confirmsWith = false;
  const settings = createSettings(makeDeps(r));

  const ok = await settings.signOut();
  assert.equal(ok, false);
  assert.equal(r.confirms.length, 1, "dialog was shown");
  assert.ok(!r.calls.includes("signOut"), "no session change after declining");
});

test("signOut reports a failure to sign out locally", async () => {
  const r = record();
  const settings = createSettings(makeDeps(r, {
    signOut: async () => {
      throw new Error("secureStore");
    },
  }));

  const ok = await settings.signOut();
  assert.equal(ok, false);
  assert.equal(settings.snapshot().error, "secureStore");
});
