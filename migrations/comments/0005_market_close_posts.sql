-- Market Close posts to outside channels: one row per published session and
-- channel (today only 'telegram'), so a session is announced once however many
-- times its record is published again.
-- status: pending (an attempt is under way), sent, failed. detail keeps the
-- channel's own short error text of a failed attempt; it never holds a token.
-- Separate from market_close_snapshots and market_close_cards, which it never changes.
-- Idempotent: safe to run again. No other table is touched.
CREATE TABLE IF NOT EXISTS market_close_posts (
  market_date TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  message_id TEXT,
  with_card INTEGER,
  detail TEXT,
  posted_at TEXT,
  PRIMARY KEY (market_date, channel)
);
