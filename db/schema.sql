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

CREATE TABLE IF NOT EXISTS disclosure_filings (
  rcept_no TEXT PRIMARY KEY,
  corp_cls TEXT NOT NULL,
  corp_name TEXT NOT NULL,
  corp_code TEXT NOT NULL,
  stock_code TEXT NOT NULL DEFAULT '',
  report_nm TEXT NOT NULL,
  flr_nm TEXT NOT NULL DEFAULT '',
  rcept_dt TEXT NOT NULL,
  rm TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL,
  rule_score INTEGER NOT NULL DEFAULT 0,
  rule_priority TEXT NOT NULL DEFAULT 'low',
  rule_reasons_json TEXT NOT NULL DEFAULT '[]',
  ai_eligible INTEGER NOT NULL DEFAULT 0,
  ai_status TEXT NOT NULL DEFAULT 'skipped',
  publish_status TEXT NOT NULL DEFAULT 'admin_only',
  is_watchlist INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL DEFAULT '',
  superseded_by TEXT NOT NULL DEFAULT '',
  ai_provider TEXT NOT NULL DEFAULT '',
  ai_model TEXT NOT NULL DEFAULT '',
  ai_json TEXT NOT NULL DEFAULT '',
  ai_error TEXT NOT NULL DEFAULT '',
  ai_analyzed_at TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_disclosure_date_priority
  ON disclosure_filings (rcept_dt DESC, rule_score DESC);

CREATE INDEX IF NOT EXISTS idx_disclosure_ai_queue
  ON disclosure_filings (ai_eligible, ai_status, rcept_dt DESC, rule_score DESC);

CREATE INDEX IF NOT EXISTS idx_disclosure_published
  ON disclosure_filings (publish_status, rcept_dt DESC, rule_score DESC);

CREATE INDEX IF NOT EXISTS idx_disclosure_superseded
  ON disclosure_filings (superseded_by, publish_status);

-- A company is followed for two independent reasons: disclosure priority and
-- calendar tracking. Existing rows were migrated with both enabled.
CREATE TABLE IF NOT EXISTS disclosure_watchlist (
  stock_code TEXT PRIMARY KEY,
  corp_code TEXT NOT NULL DEFAULT '',
  corp_name TEXT NOT NULL,
  corp_name_en TEXT NOT NULL DEFAULT '',
  corp_cls TEXT NOT NULL DEFAULT 'Y',
  active INTEGER NOT NULL DEFAULT 1,
  disclosure_enabled INTEGER NOT NULL DEFAULT 1,
  calendar_enabled INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_disclosure_watchlist_calendar
  ON disclosure_watchlist (calendar_enabled, active, sort_order);

CREATE INDEX IF NOT EXISTS idx_disclosure_watchlist_active
  ON disclosure_watchlist (active, sort_order, corp_name);

CREATE TABLE IF NOT EXISTS disclosure_usage_daily (
  usage_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (usage_date, kind)
);

CREATE TABLE IF NOT EXISTS disclosure_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_announcements (
  id TEXT PRIMARY KEY,
  notice_type TEXT NOT NULL CHECK(notice_type IN ('major', 'general')),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  content TEXT NOT NULL CHECK(length(trim(content)) > 0),
  audience TEXT NOT NULL CHECK(audience IN ('all', 'group')),
  target_group TEXT,
  publish_state TEXT NOT NULL CHECK(publish_state IN ('draft', 'published')),
  exposure_start_at TEXT NOT NULL,
  exposure_end_at TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  CHECK(
    (audience = 'all' AND target_group IS NULL)
    OR
    (audience = 'group' AND length(trim(target_group)) > 0)
  ),
  CHECK(exposure_end_at IS NULL OR exposure_end_at >= exposure_start_at)
);

CREATE INDEX IF NOT EXISTS idx_admin_announcements_public
  ON admin_announcements (publish_state, audience, exposure_start_at, exposure_end_at);

CREATE INDEX IF NOT EXISTS idx_admin_announcements_updated
  ON admin_announcements (updated_at DESC);

-- Market events shown on /calendar/. Exchange closures stay in
-- functions/_trading-calendar.js; what lives here arrives from outside and
-- therefore needs identity, a status, and a last-verified time.
-- event_time is nullable: several official schedules publish a date and no
-- clock time, and a guessed time would read as a fact.
CREATE TABLE IF NOT EXISTS market_calendar_events (
  event_id TEXT PRIMARY KEY,
  event_date TEXT NOT NULL,
  event_time TEXT,
  timezone TEXT NOT NULL,
  market TEXT NOT NULL,
  category TEXT NOT NULL,
  importance TEXT NOT NULL DEFAULT 'normal',
  title_ko TEXT NOT NULL DEFAULT '',
  title_en TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  source_event_id TEXT NOT NULL,
  company_stock_code TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',
  first_seen_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_month
  ON market_calendar_events (event_date, market, category);

CREATE INDEX IF NOT EXISTS idx_calendar_events_source
  ON market_calendar_events (source_type, source_name, event_date);

CREATE INDEX IF NOT EXISTS idx_calendar_events_company
  ON market_calendar_events (company_stock_code, event_date);

-- When each official source last answered, so a stale feed is visible.
CREATE TABLE IF NOT EXISTS market_calendar_sources (
  source_name TEXT PRIMARY KEY,
  source_url TEXT NOT NULL DEFAULT '',
  last_success_at TEXT NOT NULL DEFAULT '',
  last_attempt_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  event_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
