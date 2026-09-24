import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import {
  MAX_FARM_MEMBERS,
  isAtCapacity,
  generateUniqueFarmCode,
  normalizeFarmCode,
  decideJoinRequest,
  canRemoveMember,
  decideOwnershipTransfer,
} from "./farms";
import {
  saveObjectKey,
  deleteFarmSaves,
  isPlayerSaveObjectKey,
  isLoopbackHost,
  maxSaveSizeBytes,
  r2S3Config,
  presignR2Put,
  presignR2Get,
} from "./saves";
import { SESSION_TTL_MS, MAX_DISPLAY_NAME_LENGTH } from "./identity";

type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ENABLE_R2_TEST?: string;
  FARM_CROSSSYNC_LOCAL_DEV?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET?: string;
  MAX_SAVE_SIZE_BYTES?: string;
};

type UserRow = {
  id: string;
  installation_id: string;
  display_name: string;
  created_at: string;
  last_seen_at: string;
};

type Variables = { user: UserRow; tokenHash: string };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// The desktop webview cross-origin fetches from tauri:// — preflights must not
// fall through to the router (they used to 404 and block every API call).
app.use("*", cors());

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

const hashToken = async (token: string) =>
  toHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  );

const newToken = () =>
  toHex(crypto.getRandomValues(new Uint8Array(32)));

const now = () => new Date().toISOString();

const toUser = (row: UserRow) => ({
  id: row.id,
  installationId: row.installation_id,
  displayName: row.display_name,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
});

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/register", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { installationId?: unknown; displayName?: unknown }
    | null;
  const installationId =
    typeof body?.installationId === "string" ? body.installationId.trim() : "";
  const displayName =
    typeof body?.displayName === "string" ? body.displayName.trim() : "";
  if (!installationId || !displayName) {
    return c.json({ error: "installationId and displayName are required" }, 400);
  }

  let user = await c.env.DB.prepare(
    "SELECT * FROM users WHERE installation_id = ?",
  )
    .bind(installationId)
    .first<UserRow>();

  if (!user) {
    const ts = now();
    user = {
      id: crypto.randomUUID(),
      installation_id: installationId,
      display_name: displayName,
      created_at: ts,
      last_seen_at: ts,
    };
    await c.env.DB.prepare(
      "INSERT INTO users (id, installation_id, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        user.id,
        user.installation_id,
        user.display_name,
        user.created_at,
        user.last_seen_at,
      )
      .run();
  }

  const token = newToken();
  await c.env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(
      await hashToken(token),
      user.id,
      now(),
      new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    )
    .run();

  return c.json({ user: toUser(user), token });
});

const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> =
  async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return c.json({ error: "unauthorized" }, 401);

    const tokenHash = await hashToken(token);
    const session = await c.env.DB.prepare(
      "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
    )
      .bind(tokenHash)
      .first<{ user_id: string; expires_at: string | null }>();
    if (!session) return c.json({ error: "unauthorized" }, 401);

    // Ticket 83: a session whose expiry has passed (or is missing or
    // unparseable — fail closed) is dead. The response is byte-identical to a
    // missing/unknown token so expiry and revocation are indistinguishable and
    // the client recovers through the single unauthorized path.
    const expiresAt = session.expires_at ? Date.parse(session.expires_at) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return c.json({ error: "unauthorized" }, 401);
    }

    await c.env.DB.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?")
      .bind(now(), session.user_id)
      .run();

    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?")
      .bind(session.user_id)
      .first<UserRow>();
    if (!user) return c.json({ error: "unauthorized" }, 401);

    c.set("user", user);
    c.set("tokenHash", tokenHash);
    await next();
  };

app.use("/me", requireAuth);

app.get("/me", (c) => c.json({ user: toUser(c.get("user")) }));

// Ticket 84: rename. The trimmed value is stored verbatim; blank and
// over-long values are rejected with distinct 400s (never silently coerced or
// truncated) so a failed cloud update is clearly distinguishable from a
// confirmed one. Every list that shows names (`/farms/:farmId/members`,
// `/farms/:farmId/invites`, `/farms/:farmId/saves`) joins `users.display_name`,
// so they all show the new name on the next refresh.
app.patch("/me", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { displayName?: unknown }
    | null;
  const displayName =
    typeof body?.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName) return c.json({ error: "displayName is required" }, 400);
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return c.json(
      {
        error: `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`,
      },
      400,
    );
  }

  const user = c.get("user");
  await c.env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
    .bind(displayName, user.id)
    .run();

  return c.json({ user: toUser({ ...user, display_name: displayName }) });
});

app.use("/logout", requireAuth);

// Ticket 83: sign out. Revokes exactly the calling session — the row whose
// hash `requireAuth` matched — so other devices keep working. A revoked token
// is gone for good: registering again inserts a fresh random token instead of
// resurrecting the old row.
app.post("/logout", async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(c.get("tokenHash"))
    .run();
  return c.json({ ok: true });
});

// Farms & membership route surface. All routes require an authenticated user.
app.use("/farms", requireAuth);
app.use("/farms/*", requireAuth);
app.use("/invites/*", requireAuth);

app.post("/farms", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "name is required" }, 400);

  const user = c.get("user");

  let code: string;
  try {
    code = await generateUniqueFarmCode(async (candidate) => {
      const existing = await c.env.DB.prepare(
        "SELECT 1 FROM farms WHERE code = ?1",
      )
        .bind(candidate)
        .first();
      return existing !== null;
    });
  } catch {
    return c.json({ error: "farm_code_collision" }, 500);
  }

  const farm = {
    id: crypto.randomUUID(),
    code,
    name,
    owner_id: user.id,
    created_at: now(),
  };

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO farms (id, code, name, owner_id, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(farm.id, farm.code, farm.name, farm.owner_id, farm.created_at),
    c.env.DB.prepare(
      "INSERT INTO farm_members (farm_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    ).bind(farm.id, user.id, farm.created_at),
  ]);

  return c.json({ farm }, 201);
});

// List the farms the caller belongs to (drives the active-farm dropdown and
// restores the selection on launch). Ordered by membership age.
app.get("/farms", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT f.id, f.code, f.name, f.owner_id, f.created_at, m.role, m.joined_at
       FROM farms f
       JOIN farm_members m ON m.farm_id = f.id
      WHERE m.user_id = ?1
      ORDER BY m.joined_at ASC`,
  )
    .bind(user.id)
    .all();
  return c.json({ farms: results ?? [] });
});

// Resolve a farm code to its id so the client can call the join route, which
// takes the id in the path (the code stays an invitation mechanism only).
app.get("/farms/lookup", async (c) => {
  const code = c.req.query("code") ?? "";
  if (!code.trim()) return c.json({ error: "code is required" }, 400);
  const farm = await c.env.DB.prepare(
    "SELECT id, code, name FROM farms WHERE code = ?1",
  )
    .bind(normalizeFarmCode(code))
    .first();
  if (!farm) return c.json({ error: "farm not found" }, 404);
  return c.json({ farm });
});

app.get("/farms/:farmId", async (c) => {
  const user = c.get("user");
  const farmId = c.req.param("farmId");

  const farm = await c.env.DB.prepare(
    "SELECT id, code, name, owner_id, created_at FROM farms WHERE id = ?1",
  )
    .bind(farmId)
    .first();
  if (!farm) return c.json({ error: "farm not found" }, 404);

  if ((await getFarmRole(c.env.DB, farmId, user.id)) === null) {
    return c.json({ error: "forbidden" }, 403);
  }

  return c.json({ farm });
});

app.post("/farms/:farmId/join", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null;
  const rawCode = typeof body?.code === "string" ? body.code : "";
  if (!rawCode.trim()) return c.json({ error: "code is required" }, 400);

  // Join is by code; the path farmId must agree with the code's farm.
  const farm = await c.env.DB.prepare("SELECT id FROM farms WHERE code = ?1")
    .bind(normalizeFarmCode(rawCode))
    .first<{ id: string }>();
  if (!farm || farm.id !== c.req.param("farmId")) {
    return c.json({ error: "farm not found" }, 404);
  }

  const user = c.get("user");

  const member = await c.env.DB.prepare(
    "SELECT 1 FROM farm_members WHERE farm_id = ?1 AND user_id = ?2",
  )
    .bind(farm.id, user.id)
    .first();
  const pendingInvite = await c.env.DB.prepare(
    "SELECT 1 FROM farm_invites WHERE farm_id = ?1 AND user_id = ?2 AND status = 'pending'",
  )
    .bind(farm.id, user.id)
    .first();

  const decision = decideJoinRequest(member !== null, pendingInvite !== null);
  if (decision === "already_member") {
    return c.json({ error: "already a member" }, 409);
  }
  if (decision === "pending_request") {
    return c.json({ error: "pending request" }, 409);
  }

  // Maximum 16 members per farm. A pending request is not a membership, but the
  // spec rejects joins at capacity. Early-out only — the authoritative guard is
  // the conditional INSERT in the accept handler (ticket 81). Fail closed: an
  // unreadable count must not silently allow the add.
  const row = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM farm_members WHERE farm_id = ?1",
  )
    .bind(farm.id)
    .first<{ count: number }>();
  if (row === null || isAtCapacity(row.count)) {
    return c.json({ error: "farm_full", max: MAX_FARM_MEMBERS }, 409);
  }

  // A denied request may be re-submitted: insert a fresh pending row rather than
  // reopening the denied one, keeping prior decisions as history.
  const invite = {
    id: crypto.randomUUID(),
    farm_id: farm.id,
    user_id: user.id,
    status: "pending" as const,
    created_at: now(),
  };
  try {
    await c.env.DB.prepare(
      "INSERT INTO farm_invites (id, farm_id, user_id, status, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(
        invite.id,
        invite.farm_id,
        invite.user_id,
        invite.status,
        invite.created_at,
      )
      .run();
  } catch (error) {
    // A concurrent request created the pending row between the check above and
    // this insert; the partial unique index (0005) rejects the duplicate.
    // Surface the existing-request result instead of a 500.
    if (/unique/i.test(String(error))) {
      return c.json({ error: "pending request" }, 409);
    }
    throw error;
  }

  return c.json({ invite }, 201);
});

type InviteRow = {
  id: string;
  farm_id: string;
  user_id: string;
  status: "pending" | "accepted" | "denied";
  created_at: string;
};

const getFarmRole = async (
  db: D1Database,
  farmId: string,
  userId: string,
): Promise<string | null> => {
  const row = await db
    .prepare(
      "SELECT role FROM farm_members WHERE farm_id = ?1 AND user_id = ?2",
    )
    .bind(farmId, userId)
    .first<{ role: string }>();
  return row?.role ?? null;
};

app.get("/farms/:farmId/invites", async (c) => {
  const user = c.get("user");
  const farmId = c.req.param("farmId");

  if ((await getFarmRole(c.env.DB, farmId, user.id)) !== "owner") {
    return c.json({ error: "forbidden" }, 403);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT i.id, i.farm_id, i.user_id, i.status, i.created_at, u.display_name " +
      "FROM farm_invites i JOIN users u ON u.id = i.user_id " +
      "WHERE i.farm_id = ?1 AND i.status = 'pending' ORDER BY i.created_at ASC",
  )
    .bind(farmId)
    .all();

  return c.json({ invites: results ?? [] });
});

// Only the owner resolves a request, and only while it is still pending. A
// repeat accept/deny is a conflict so the client does not double-add a member.
const loadPendingInvite = async (
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<InviteRow | Response> => {
  const invite = await c.env.DB.prepare(
    "SELECT id, farm_id, user_id, status, created_at FROM farm_invites WHERE id = ?1",
  )
    .bind(c.req.param("inviteId"))
    .first<InviteRow>();
  if (!invite) return c.json({ error: "invite not found" }, 404);

  const user = c.get("user");
  if ((await getFarmRole(c.env.DB, invite.farm_id, user.id)) !== "owner") {
    return c.json({ error: "forbidden" }, 403);
  }
  if (invite.status !== "pending") {
    return c.json({ error: "invite_not_pending" }, 409);
  }
  return invite;
};

app.post("/invites/:inviteId/accept", async (c) => {
  const invite = await loadPendingInvite(c);
  if (invite instanceof Response) return invite;

  // Authoritative capacity guard: the membership INSERT is itself conditional
  // on capacity, on the caller not already being a member, and on the invite
  // still being pending, so two racing accepts can never push the farm past
  // MAX_FARM_MEMBERS — D1 has no interactive transactions, so the check lives
  // inside the statement. The invite transition is conditional on the
  // membership existing and the invite still being pending, so the invite can
  // never resolve without the member being added. Every statement is
  // self-contained, so statement-level interleaving between racing requests is
  // safe even where batches are not serialized.
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO farm_members (farm_id, user_id, role, joined_at) " +
        "SELECT ?1, ?2, 'member', ?3 " +
        "WHERE (SELECT COUNT(*) FROM farm_members WHERE farm_id = ?1) < ?4 " +
        "AND NOT EXISTS (SELECT 1 FROM farm_members WHERE farm_id = ?1 AND user_id = ?2) " +
        "AND EXISTS (SELECT 1 FROM farm_invites WHERE id = ?5 AND status = 'pending')",
    ).bind(invite.farm_id, invite.user_id, now(), MAX_FARM_MEMBERS, invite.id),
    c.env.DB.prepare(
      "UPDATE farm_invites SET status = 'accepted' " +
        "WHERE id = ?1 AND status = 'pending' " +
        "AND EXISTS (SELECT 1 FROM farm_members WHERE farm_id = ?2 AND user_id = ?3)",
    ).bind(invite.id, invite.farm_id, invite.user_id),
  ]);

  // The invite transition is the observable success: exactly one racing accept
  // can perform it, and it only happens with the membership in place.
  if ((results[1]?.meta?.changes ?? 0) > 0) {
    return c.json({ invite: { ...invite, status: "accepted" } });
  }

  // Nothing resolved. If a concurrent request resolved the invite first, the
  // result matches a sequential repeat accept (invite_not_pending). The invite
  // can only still be pending here when the capacity guard blocked the insert.
  const current = await c.env.DB.prepare(
    "SELECT status FROM farm_invites WHERE id = ?1",
  )
    .bind(invite.id)
    .first<{ status: string }>();
  if (current?.status !== "pending") {
    return c.json({ error: "invite_not_pending" }, 409);
  }
  return c.json({ error: "farm_full", max: MAX_FARM_MEMBERS }, 409);
});

app.post("/invites/:inviteId/deny", async (c) => {
  const invite = await loadPendingInvite(c);
  if (invite instanceof Response) return invite;

  await c.env.DB.prepare(
    "UPDATE farm_invites SET status = 'denied' WHERE id = ?1",
  )
    .bind(invite.id)
    .run();

  return c.json({ invite: { ...invite, status: "denied" } });
});
app.get("/farms/:farmId/members", async (c) => {
  const user = c.get("user");
  const farmId = c.req.param("farmId");

  // Membership is the read gate: non-members must not enumerate the group.
  if ((await getFarmRole(c.env.DB, farmId, user.id)) === null) {
    return c.json({ error: "forbidden" }, 403);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT m.user_id, m.role, m.joined_at, u.display_name " +
      "FROM farm_members m JOIN users u ON u.id = m.user_id " +
      "WHERE m.farm_id = ?1 ORDER BY m.joined_at ASC",
  )
    .bind(farmId)
    .all();

  return c.json({ members: results ?? [] });
});

app.delete("/farms/:farmId/members/:userId", async (c) => {
  const user = c.get("user");
  const farmId = c.req.param("farmId");
  const targetId = c.req.param("userId");

  const callerRole = await getFarmRole(c.env.DB, farmId, user.id);
  const targetRole = await getFarmRole(c.env.DB, farmId, targetId);
  if (targetRole === null) return c.json({ error: "member not found" }, 404);
  if (!canRemoveMember(user.id, callerRole, targetId)) {
    return c.json({ error: "forbidden" }, 403);
  }

  // Kick = leave: end membership and drop that player's cloud save in the farm.
  // Local filesystem saves are a client concern and are never touched here.
  const statements = [
    c.env.DB.prepare(
      "DELETE FROM player_saves WHERE farm_id = ?1 AND user_id = ?2",
    ).bind(farmId, targetId),
    c.env.DB.prepare(
      "DELETE FROM farm_members WHERE farm_id = ?1 AND user_id = ?2",
    ).bind(farmId, targetId),
  ];

  // Owner leaving with members remaining: the earliest-joined survivor becomes
  // owner so the farm stays valid. `joined_at` can tie at millisecond
  // resolution, so user_id is the deterministic tie-break.
  if (targetRole === "owner") {
    const successor = await c.env.DB.prepare(
      "SELECT user_id FROM farm_members WHERE farm_id = ?1 AND user_id != ?2 " +
        "ORDER BY joined_at ASC, user_id ASC LIMIT 1",
    )
      .bind(farmId, targetId)
      .first<{ user_id: string }>();
    if (successor) {
      // Role and owner_id must not disagree: the farm detail, transfer check,
      // and UI all read owner_id as the authoritative owner.
      statements.push(
        c.env.DB.prepare(
          "UPDATE farm_members SET role = 'owner' WHERE farm_id = ?1 AND user_id = ?2",
        ).bind(farmId, successor.user_id),
        c.env.DB.prepare("UPDATE farms SET owner_id = ?1 WHERE id = ?2").bind(
          successor.user_id,
          farmId,
        ),
      );
    }
    // No successor means this was the last member; the cascade below deletes
    // the farm.
  }

  await c.env.DB.batch(statements);

  // Last member left: the farm and everything it owns in the cloud are deleted.
  // DB cascade first, then the R2 prefix — an R2 failure leaves orphaned
  // objects, which the spec accepts.
  const remaining = await c.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM farm_members WHERE farm_id = ?1",
  )
    .bind(farmId)
    .first<{ count: number }>();

  if ((remaining?.count ?? 0) === 0) {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM farm_invites WHERE farm_id = ?1").bind(farmId),
      c.env.DB.prepare("DELETE FROM player_saves WHERE farm_id = ?1").bind(farmId),
      c.env.DB.prepare("DELETE FROM farm_members WHERE farm_id = ?1").bind(farmId),
      c.env.DB.prepare("DELETE FROM farms WHERE id = ?1").bind(farmId),
    ]);
    await deleteFarmSaves(c.env.BUCKET, farmId);
    return c.json({ removed: targetId, own: targetId === user.id, farmDeleted: true });
  }

  // Farm survives: only the departing player's cloud save is dropped.
  await c.env.BUCKET.delete(saveObjectKey(farmId, targetId));

  return c.json({ removed: targetId, own: targetId === user.id, farmDeleted: false });
});

// Owner hands ownership to a chosen member. The previous owner stays a member,
// and the new owner immediately inherits owner powers (pending invites are
// farm-scoped, so no separate handoff is needed). Body: `{ userId }`.
app.post("/farms/:farmId/transfer-owner", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { userId?: unknown } | null;
  const targetUserId =
    typeof body?.userId === "string" ? body.userId.trim() : "";
  if (!targetUserId) return c.json({ error: "userId is required" }, 400);

  const user = c.get("user");
  const farmId = c.req.param("farmId");

  const callerRole = await getFarmRole(c.env.DB, farmId, user.id);
  const targetRole = await getFarmRole(c.env.DB, farmId, targetUserId);

  const decision = decideOwnershipTransfer(
    user.id,
    callerRole,
    targetUserId,
    targetRole,
  );
  if (decision === "forbidden") return c.json({ error: "forbidden" }, 403);
  if (decision === "target_not_found") {
    return c.json({ error: "member not found" }, 404);
  }
  if (decision === "cannot_transfer_to_self") {
    return c.json({ error: "cannot_transfer_to_self" }, 400);
  }

  // Single batch: demote the old owner, promote the target, and repoint the
  // farm. Role and owner_id must not disagree at any observable point.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE farm_members SET role = 'member' WHERE farm_id = ?1 AND user_id = ?2",
    ).bind(farmId, user.id),
    c.env.DB.prepare(
      "UPDATE farm_members SET role = 'owner' WHERE farm_id = ?1 AND user_id = ?2",
    ).bind(farmId, targetUserId),
    c.env.DB.prepare("UPDATE farms SET owner_id = ?1 WHERE id = ?2").bind(
      targetUserId,
      farmId,
    ),
  ]);

  const farm = await c.env.DB.prepare(
    "SELECT id, code, name, owner_id, created_at FROM farms WHERE id = ?1",
  )
    .bind(farmId)
    .first();

  return c.json({ farm });
});

// Player saves route surface (spec: cloud-save-sync). All routes require an
// authenticated user. The R2 key layout lives in `saveObjectKey` in
// src/saves.ts. Save bytes never pass through the Worker: the client PUTs/GETs
// them straight to/from R2 using the authorization returned below, and this
// route surface only ever reads object metadata (`BUCKET.head`).
app.use("/saves/*", requireAuth);

/** Lifetime of a presigned R2 PUT (spec leaves the exact value open). */
const UPLOAD_AUTH_TTL_SECONDS = 900;

/** Lifetime of a presigned R2 GET (spec leaves the exact value open). */
const DOWNLOAD_AUTH_TTL_SECONDS = 900;

// Save list for the farm (cloud-save-sync). Membership is the read gate, so a
// non-member gets 403 rather than an enumeration of the group's saves. A farm
// whose members have not uploaded yet is a valid empty list, not an error.
app.get("/farms/:farmId/saves", async (c) => {
  const user = c.get("user");
  const farmId = c.req.param("farmId");

  if ((await getFarmRole(c.env.DB, farmId, user.id)) === null) {
    return c.json({ error: "forbidden" }, 403);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT s.user_id, u.display_name, s.save_name, s.file_size, s.sha256, s.uploaded_at, s.object_key " +
      "FROM player_saves s JOIN users u ON u.id = s.user_id " +
      "WHERE s.farm_id = ?1 ORDER BY s.uploaded_at DESC, s.user_id ASC",
  )
    .bind(farmId)
    .all();

  return c.json({ saves: results ?? [] });
});

app.post("/saves/upload-authorize", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { farmId?: unknown; objectKey?: unknown }
    | null;
  const farmId = typeof body?.farmId === "string" ? body.farmId.trim() : "";
  if (!farmId) return c.json({ error: "farmId is required" }, 400);

  const user = c.get("user");
  if ((await getFarmRole(c.env.DB, farmId, user.id)) === null) {
    return c.json({ error: "forbidden" }, 403);
  }

  // The slot is always the caller's own. If the caller names any key (e.g.
  // another member's slot), it must match exactly; there is no way to upload
  // to someone else's slot.
  const objectKey = saveObjectKey(farmId, user.id);
  const requestedKey =
    typeof body?.objectKey === "string" ? body.objectKey : objectKey;
  if (requestedKey !== objectKey) return c.json({ error: "forbidden" }, 403);

  // Authorize only: this route never writes player_saves, so an authorize
  // without a matching upload-complete leaves prior metadata authoritative.
  const issuedAt = new Date();
  const config = r2S3Config(c.env);
  const authorization = config
    ? {
        objectKey,
        presigned: true,
        ...(await presignR2Put(
          config,
          objectKey,
          UPLOAD_AUTH_TTL_SECONDS,
          issuedAt,
        )),
      }
    : {
        objectKey,
        presigned: false,
        url: `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_BUCKET>/${objectKey}`,
        method: "PUT",
        headers: { host: "<R2_ACCOUNT_ID>.r2.cloudflarestorage.com" },
        expiresAt: new Date(
          issuedAt.getTime() + UPLOAD_AUTH_TTL_SECONDS * 1000,
        ).toISOString(),
        note: "R2 S3 credentials are not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET); this placeholder is not usable. Configure them to receive a presigned PUT URL.",
      };

  return c.json({ authorization });
});

app.post("/saves/upload-complete", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    farmId?: unknown;
    objectKey?: unknown;
    fileSize?: unknown;
    sha256?: unknown;
    saveName?: unknown;
  } | null;
  const farmId = typeof body?.farmId === "string" ? body.farmId.trim() : "";
  const saveName =
    typeof body?.saveName === "string" ? body.saveName.trim() : "";
  const fileSize = body?.fileSize;
  const sha256 =
    typeof body?.sha256 === "string" ? body.sha256.trim().toLowerCase() : "";
  if (!farmId) return c.json({ error: "farmId is required" }, 400);
  if (!saveName) return c.json({ error: "saveName is required" }, 400);
  if (
    typeof fileSize !== "number" ||
    !Number.isInteger(fileSize) ||
    fileSize < 0
  ) {
    return c.json({ error: "fileSize must be a non-negative integer" }, 400);
  }
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    return c.json({ error: "sha256 must be a 64-character hex string" }, 400);
  }

  const user = c.get("user");
  if ((await getFarmRole(c.env.DB, farmId, user.id)) === null) {
    return c.json({ error: "forbidden" }, 403);
  }

  const objectKey = saveObjectKey(farmId, user.id);
  const requestedKey =
    typeof body?.objectKey === "string" ? body.objectKey : objectKey;
  if (requestedKey !== objectKey) return c.json({ error: "forbidden" }, 403);

  // The client PUT directly to R2; the Worker confirms the object landed and
  // matches the report. Every rejection below returns before the upsert, so a
  // missing, oversized, or mismatched upload never replaces the previous
  // authoritative player_saves row.
  const object = await c.env.BUCKET.head(objectKey);
  if (!object) return c.json({ error: "object not found" }, 404);

  // The stored object is authoritative for its size: reject an oversized
  // object first, then a report that disagrees with what actually landed.
  const maxSaveSize = maxSaveSizeBytes(c.env);
  if (object.size > maxSaveSize) {
    return c.json({ error: "object_too_large", max: maxSaveSize }, 413);
  }
  if (object.size !== fileSize) {
    return c.json(
      {
        error: "size_mismatch",
        objectSize: object.size,
        reportedSize: fileSize,
      },
      409,
    );
  }

  const uploadedAt = now();
  await c.env.DB.prepare(
    "INSERT INTO player_saves (farm_id, user_id, object_key, file_size, sha256, save_name, uploaded_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) " +
      "ON CONFLICT(farm_id, user_id) DO UPDATE SET " +
      "object_key = excluded.object_key, file_size = excluded.file_size, " +
      "sha256 = excluded.sha256, save_name = excluded.save_name, " +
      "uploaded_at = excluded.uploaded_at",
  )
    .bind(farmId, user.id, objectKey, fileSize, sha256, saveName, uploadedAt)
    .run();

  return c.json({
    save: {
      farmId,
      userId: user.id,
      objectKey,
      fileSize,
      sha256,
      saveName,
      uploadedAt,
    },
  });
});

// Any authenticated member may read another member's save slot. Body
// `{ farmId }`; `:playerId` names whose save. Bytes never pass through the
// Worker: the client GETs the object straight from R2 with the authorization
// below, then verifies the content hash itself.
app.post("/saves/:playerId/download-authorize", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { farmId?: unknown } | null;
  const farmId = typeof body?.farmId === "string" ? body.farmId.trim() : "";
  if (!farmId) return c.json({ error: "farmId is required" }, 400);

  const user = c.get("user");
  if ((await getFarmRole(c.env.DB, farmId, user.id)) === null) {
    return c.json({ error: "forbidden" }, 403);
  }

  // The target must belong to the farm, and have actually uploaded a save.
  const playerId = c.req.param("playerId");
  if ((await getFarmRole(c.env.DB, farmId, playerId)) === null) {
    return c.json({ error: "member not found" }, 404);
  }
  const save = await c.env.DB.prepare(
    "SELECT object_key FROM player_saves WHERE farm_id = ?1 AND user_id = ?2",
  )
    .bind(farmId, playerId)
    .first<{ object_key: string }>();
  if (!save) return c.json({ error: "save not found" }, 404);

  const issuedAt = new Date();
  const config = r2S3Config(c.env);
  const authorization = config
    ? {
        objectKey: save.object_key,
        presigned: true,
        ...(await presignR2Get(
          config,
          save.object_key,
          DOWNLOAD_AUTH_TTL_SECONDS,
          issuedAt,
        )),
      }
    : {
        objectKey: save.object_key,
        presigned: false,
        url: `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com/<R2_BUCKET>/${save.object_key}`,
        method: "GET",
        headers: { host: "<R2_ACCOUNT_ID>.r2.cloudflarestorage.com" },
        expiresAt: new Date(
          issuedAt.getTime() + DOWNLOAD_AUTH_TTL_SECONDS * 1000,
        ).toISOString(),
        note: "R2 S3 credentials are not configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET); this placeholder is not usable. Configure them to receive a presigned GET URL.",
      };

  return c.json({ authorization });
});

// Dev-only R2 round-trip route (see README "Development-only R2 test route").
// Fail-closed stack: reachable only when (1) the local switch ENABLE_R2_TEST is
// explicitly "true", (2) the instance is marked as local development via
// FARM_CROSSSYNC_LOCAL_DEV="true", (3) the request arrives over loopback, and
// (4) the key is a player-save key of the documented shape. A deployed Worker
// satisfies (2)/(3) never; `scripts/deploy-guard.mjs` (wired into `npm run
// deploy`) additionally refuses to ship a wrangler config that sets the dev
// vars at all.
app.use("/r2-test/*", async (c, next) => {
  if (c.env.ENABLE_R2_TEST !== "true") return c.notFound();
  const host = new URL(c.req.url).host;
  if (c.env.FARM_CROSSSYNC_LOCAL_DEV !== "true" || !isLoopbackHost(host)) {
    // Loud misconfiguration signal in the logs: the dev switch is on outside
    // local development. The request is rejected regardless.
    console.warn(
      `r2-test: rejected request outside local development (host=${host}); ` +
        "unset ENABLE_R2_TEST in deployed environments",
    );
    return c.json({ error: "r2_test_local_only" }, 403);
  }
  await next();
});

app.put("/r2-test/:key", async (c) => {
  const key = c.req.param("key");
  if (!isPlayerSaveObjectKey(key)) return c.json({ error: "invalid_key" }, 400);
  const body = await c.req.arrayBuffer();
  await c.env.BUCKET.put(key, body);
  return c.json({ put: true, size: body.byteLength });
});

app.get("/r2-test/:key", async (c) => {
  const key = c.req.param("key");
  if (!isPlayerSaveObjectKey(key)) return c.json({ error: "invalid_key" }, 400);
  const object = await c.env.BUCKET.get(key);
  if (!object) return c.notFound();
  return new Response(object.body);
});

export default app;
