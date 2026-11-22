-- Domestic Rates: the KOFIA final quote yields (16:00 KST basis) of each KRX
-- trading day, published by the collector after the day's Market Close record
-- (contracts/domestic_rates/). Separate from market_close_snapshots, which it
-- never changes; pages join the two by market_date.
-- One row per market_date. Idempotent: safe to run again. No other table is touched.
CREATE TABLE IF NOT EXISTS market_domestic_rates (
  market_date TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  basis_time TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  auth_source TEXT NOT NULL
);
