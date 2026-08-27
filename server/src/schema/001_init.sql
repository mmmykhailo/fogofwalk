-- Fog of Walk sync server schema. Applied idempotently at boot by the
-- sqlite-fs driver; every statement is IF NOT EXISTS so re-running is a no-op.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  handle TEXT UNIQUE,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'allowed' | 'blocked'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS users_handle ON users(handle);

CREATE TABLE IF NOT EXISTS identities (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider_login TEXT,
  email TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS activities (
  user_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL,
  activity_type TEXT,
  start_sun_phase TEXT,
  started_at_ms INTEGER,
  distance_km REAL NOT NULL,
  point_count INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  blob_ref TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Denormalized from `stats` at upload time so the public profile endpoint
  -- can list activities without decompressing/parsing every blob.
  duration_ms REAL,
  moving_time_ms REAL,
  elevation_gain_m REAL NOT NULL DEFAULT 0,
  avg_moving_speed_kmh REAL,
  PRIMARY KEY (user_id, content_hash)
);

-- content_hash is part of the index so the manifest cursor can page on the
-- composite (updated_at, content_hash) key without a filesort.
CREATE INDEX IF NOT EXISTS activities_sync ON activities(user_id, updated_at, content_hash);

CREATE INDEX IF NOT EXISTS activities_public_user ON activities(user_id, is_public, updated_at);

CREATE TABLE IF NOT EXISTS activity_tombstones (
  user_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, content_hash)
);

CREATE INDEX IF NOT EXISTS tombstones_sync
  ON activity_tombstones(user_id, deleted_at, content_hash);

CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  notification_status TEXT NOT NULL DEFAULT 'not_configured',
  notification_attempted_at INTEGER
);

CREATE INDEX IF NOT EXISTS access_requests_status_requested
  ON access_requests(status, requested_at);

CREATE TABLE IF NOT EXISTS server_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
