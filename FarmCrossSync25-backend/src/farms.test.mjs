import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FARM_MEMBERS,
  isAtCapacity,
  assertCanAddMember,
  FarmCapacityError,
  generateFarmCode,
  generateUniqueFarmCode,
  normalizeFarmCode,
  decideJoinRequest,
  canRemoveMember,
  decideOwnershipTransfer,
  FARM_CODE_PATTERN,
} from "./farms.ts";
import {
  deleteFarmSaves,
  farmSavesPrefix,
  presignR2Put,
  presignR2Get,
  r2S3Config,
} from "./saves.ts";

test("MAX_FARM_MEMBERS is 16", () => {
  assert.equal(MAX_FARM_MEMBERS, 16);
});

test("15 members is under capacity and can add", () => {
  assert.equal(isAtCapacity(15), false);
  assert.doesNotThrow(() => assertCanAddMember(15));
});

test("16 members is at capacity and is rejected", () => {
  assert.equal(isAtCapacity(16), true);
  assert.throws(() => assertCanAddMember(16), FarmCapacityError);
});

test("over capacity is rejected", () => {
  assert.equal(isAtCapacity(17), true);
  assert.throws(() => assertCanAddMember(17), FarmCapacityError);
});

test("generateFarmCode produces the X7K9-PQ2 shape", () => {
  for (let i = 0; i < 100; i++) {
    const code = generateFarmCode();
    assert.match(code, FARM_CODE_PATTERN, `bad code: ${code}`);
  }
});

test("normalizeFarmCode is case-insensitive and trims", () => {
  assert.equal(normalizeFarmCode(" x7k9-pq2 "), "X7K9-PQ2");
});

test("generateUniqueFarmCode skips codes that already exist", async () => {
  const taken = new Set(["AAAA-AAA"]);
  const attempts = [];
  const code = await generateUniqueFarmCode(async (candidate) => {
    attempts.push(candidate);
    return taken.has(candidate);
  });
  assert.equal(attempts.length, 1, "first candidate should be the only check");
  assert.notEqual(code, "AAAA-AAA");
});

test("generateUniqueFarmCode regenerates when the first code is taken", async () => {
  let calls = 0;
  let firstCandidate;
  const code = await generateUniqueFarmCode(async (candidate) => {
    calls++;
    if (calls === 1) firstCandidate = candidate;
    return calls === 1;
  });
  assert.equal(calls, 2, "first candidate collided, second accepted");
  assert.notEqual(code, firstCandidate);
  assert.ok(FARM_CODE_PATTERN.test(code));
});

test("decideJoinRequest creates a request for a new caller", () => {
  assert.equal(decideJoinRequest(false, false), "create_request");
});

test("decideJoinRequest rejects an existing member", () => {
  assert.equal(decideJoinRequest(true, false), "already_member");
});

test("decideJoinRequest rejects a caller with a pending invite", () => {
  assert.equal(decideJoinRequest(false, true), "pending_request");
});

test("decideJoinRequest prefers already_member over pending", () => {
  assert.equal(decideJoinRequest(true, true), "already_member");
});

test("canRemoveMember: any member may leave (remove self)", () => {
  assert.equal(canRemoveMember("u1", "member", "u1"), true);
});

test("canRemoveMember: the owner may leave too", () => {
  assert.equal(canRemoveMember("owner", "owner", "owner"), true);
});

test("canRemoveMember: the owner may kick another member", () => {
  assert.equal(canRemoveMember("owner", "owner", "u2"), true);
});

test("canRemoveMember: a non-owner may not kick another member", () => {
  assert.equal(canRemoveMember("u1", "member", "u2"), false);
});

test("canRemoveMember: a non-member may not kick another member", () => {
  assert.equal(canRemoveMember("outsider", null, "u2"), false);
});

test("decideOwnershipTransfer: owner transferring to another member", () => {
  assert.equal(decideOwnershipTransfer("a", "owner", "b", "member"), "transfer");
});

test("decideOwnershipTransfer: a non-owner may not transfer", () => {
  assert.equal(decideOwnershipTransfer("a", "member", "b", "member"), "forbidden");
  assert.equal(decideOwnershipTransfer("a", null, "b", "member"), "forbidden");
});

test("decideOwnershipTransfer: forbidden wins over a missing target", () => {
  assert.equal(decideOwnershipTransfer("a", "member", "ghost", null), "forbidden");
});

test("decideOwnershipTransfer: target must be a member", () => {
  assert.equal(decideOwnershipTransfer("a", "owner", "ghost", null), "target_not_found");
});

test("decideOwnershipTransfer: self-transfer is rejected", () => {
  assert.equal(decideOwnershipTransfer("a", "owner", "a", "owner"), "cannot_transfer_to_self");
});

test("deleteFarmSaves deletes every object under the prefix across pages", async () => {
  const prefix = farmSavesPrefix("farm1");
  const pages = [
    { objects: [{ key: `${prefix}p1/save` }, { key: `${prefix}p2/save` }], truncated: true, cursor: "c1" },
    { objects: [{ key: `${prefix}p3/save` }], truncated: false, cursor: undefined },
  ];
  const seenCursors = [];
  const deleted = [];
  const bucket = {
    async list({ prefix: p, cursor }) {
      assert.equal(p, prefix);
      seenCursors.push(cursor);
      return pages[seenCursors.length - 1];
    },
    async delete(keys) {
      deleted.push(...(Array.isArray(keys) ? keys : [keys]));
    },
  };

  await deleteFarmSaves(bucket, "farm1");

  assert.deepEqual(seenCursors, [undefined, "c1"]);
  assert.deepEqual(deleted.sort(), [
    `${prefix}p1/save`,
    `${prefix}p2/save`,
    `${prefix}p3/save`,
  ]);
});

test("deleteFarmSaves makes no delete call for an empty prefix", async () => {
  let deleteCalls = 0;
  const bucket = {
    async list() {
      return { objects: [], truncated: false, cursor: undefined };
    },
    async delete() {
      deleteCalls++;
    },
  };

  await deleteFarmSaves(bucket, "farm1");

  assert.equal(deleteCalls, 0);
});

test("r2S3Config returns null unless every credential is set", () => {
  assert.equal(r2S3Config({}), null);
  assert.equal(
    r2S3Config({
      R2_ACCOUNT_ID: "a",
      R2_ACCESS_KEY_ID: "b",
      R2_SECRET_ACCESS_KEY: "c",
    }),
    null,
  );
  assert.deepEqual(
    r2S3Config({
      R2_ACCOUNT_ID: "a",
      R2_ACCESS_KEY_ID: "b",
      R2_SECRET_ACCESS_KEY: "c",
      R2_BUCKET: "d",
    }),
    { accountId: "a", accessKeyId: "b", secretAccessKey: "c", bucket: "d" },
  );
});

// Expected URL/signature generated with botocore's S3SigV4QueryAuth for the
// same inputs, so a regression in canonicalisation or the HMAC chain fails here.
test("presignR2Put matches botocore S3SigV4QueryAuth for a region-auto PUT", async () => {
  const result = await presignR2Put(
    {
      accountId: "abcd1234",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      bucket: "farm-crosssync-saves",
    },
    "farms/farm-1/players/user-1/save",
    900,
    new Date("2013-05-24T00:00:00Z"),
  );

  assert.equal(
    result.url,
    "https://abcd1234.r2.cloudflarestorage.com/farm-crosssync-saves/farms/farm-1/players/user-1/save" +
      "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fauto%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20130524T000000Z" +
      "&X-Amz-Expires=900" +
      "&X-Amz-SignedHeaders=host" +
      "&X-Amz-Signature=5b10a876d7d5e3c89d9ac84c27e905be26298a0aed30e71db42e5cd2de14d5ab",
  );
  assert.equal(result.method, "PUT");
  assert.deepEqual(result.headers, { host: "abcd1234.r2.cloudflarestorage.com" });
  assert.equal(result.expiresAt, "2013-05-24T00:15:00.000Z");
});

// Same botocore S3SigV4QueryAuth oracle, but for a GET (download) presign. The
// only difference from the PUT test is the request method in the canonical
// request, which must change the signature while leaving the expiry intact.
test("presignR2Get matches botocore S3SigV4QueryAuth for a region-auto GET", async () => {
  const result = await presignR2Get(
    {
      accountId: "abcd1234",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      bucket: "farm-crosssync-saves",
    },
    "farms/farm-1/players/user-1/save",
    900,
    new Date("2013-05-24T00:00:00Z"),
  );

  assert.equal(
    result.url,
    "https://abcd1234.r2.cloudflarestorage.com/farm-crosssync-saves/farms/farm-1/players/user-1/save" +
      "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fauto%2Fs3%2Faws4_request" +
      "&X-Amz-Date=20130524T000000Z" +
      "&X-Amz-Expires=900" +
      "&X-Amz-SignedHeaders=host" +
      "&X-Amz-Signature=d32dfdd492a6f49ba746bb7df30b8c6e8602807ce14e04dae5710e99277d33f1",
  );
  assert.equal(result.method, "GET");
  assert.deepEqual(result.headers, { host: "abcd1234.r2.cloudflarestorage.com" });
  assert.equal(result.expiresAt, "2013-05-24T00:15:00.000Z");
});

test("presignR2Get signs the requested TTL into the URL and expiresAt", async () => {
  const issuedAt = new Date("2026-01-01T00:00:00Z");
  const result = await presignR2Get(
    {
      accountId: "abcd1234",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      bucket: "farm-crosssync-saves",
    },
    "farms/farm-1/players/user-1/save",
    300,
    issuedAt,
  );

  assert.match(result.url, /X-Amz-Expires=300(&|$)/, "URL must carry the TTL");
  assert.match(result.url, /X-Amz-Date=20260101T000000Z/);
  assert.equal(result.expiresAt, "2026-01-01T00:05:00.000Z");
  assert.equal(
    new Date(result.expiresAt).getTime() - issuedAt.getTime(),
    300 * 1000,
    "expiresAt must be issuedAt + TTL",
  );
});
