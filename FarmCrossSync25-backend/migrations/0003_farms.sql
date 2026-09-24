CREATE TABLE IF NOT EXISTS farms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS farm_members (
  farm_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (farm_id, user_id)
);

CREATE TABLE IF NOT EXISTS farm_invites (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','denied')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_farm_members_farm ON farm_members(farm_id);
CREATE INDEX IF NOT EXISTS idx_farm_invites_farm_user ON farm_invites(farm_id, user_id);
