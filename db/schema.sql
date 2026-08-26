CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  report_key TEXT NOT NULL,
  nickname TEXT NOT NULL,
  body TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_comments_report_created
  ON comments (report_key, created_at);

CREATE INDEX IF NOT EXISTS idx_comments_ip_created
  ON comments (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS market_close_snapshots (
  market_date TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  auth_source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_close_generated
  ON market_close_snapshots (generated_at);

CREATE TABLE IF NOT EXISTS engagement_sessions (
  session_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  country TEXT,
  lang TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  active_ms INTEGER NOT NULL DEFAULT 0,
  max_scroll INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_engagement_started
  ON engagement_sessions (started_at);

CREATE INDEX IF NOT EXISTS idx_engagement_path_started
  ON engagement_sessions (path, started_at);

CREATE INDEX IF NOT EXISTS idx_engagement_country_started
  ON engagement_sessions (country, started_at);
