CREATE TABLE IF NOT EXISTS player_saves (
  farm_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  save_name TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  PRIMARY KEY (farm_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_player_saves_farm ON player_saves(farm_id);
