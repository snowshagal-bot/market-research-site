-- Market Close cards: one 1200x630 image per published session and language
-- (/market/YYYY-MM-DD/card.jpg), captured once from the record by Cloudflare
-- Browser Rendering and served as the session page's share image.
-- Separate from market_close_snapshots, which it never changes.
-- status: pending (an attempt is under way), ready, failed. source_key names the
-- record version and card design the stored image was drawn from.
-- Idempotent: safe to run again. No other table is touched.
CREATE TABLE IF NOT EXISTS market_close_cards (
  market_date TEXT NOT NULL,
  lang TEXT NOT NULL,
  status TEXT NOT NULL,
  source_key TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  content_type TEXT,
  image BLOB,
  created_at TEXT,
  PRIMARY KEY (market_date, lang)
);
