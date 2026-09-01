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
