-- Market Funds: the KOFIA FreeSIS stock market funds of each KRX trading day:
-- investor deposits, margin loans, unpaid margin and forced selling. The
-- collector publishes them on a later business day, when KOFIA has them
-- (contracts/market_funds/). Separate from market_close_snapshots, which it
-- never changes; pages join the two by market_date.
-- One row per market_date. Idempotent: safe to run again. No other table is touched.
CREATE TABLE IF NOT EXISTS market_funds (
  market_date TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  auth_source TEXT NOT NULL
);
