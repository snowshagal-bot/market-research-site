-- Global Latest: the current observation of each global indicator (US indices,
-- rates, FX, DXY, commodities, bitcoin), published by the collector on its own
-- schedule, independent of the KRX calendar. Separate from
-- market_close_snapshots, which keeps the KRX trading-session snapshot.
-- One row per instrument code; the row only ever moves forward in as_of.
-- Idempotent: safe to run again. No other table is touched.
CREATE TABLE IF NOT EXISTS market_global_latest (
  code TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  source_date TEXT NOT NULL,
  as_of TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  data_state TEXT NOT NULL CHECK(data_state IN ('intraday', 'final_close')),
  payload_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  auth_source TEXT NOT NULL
);
