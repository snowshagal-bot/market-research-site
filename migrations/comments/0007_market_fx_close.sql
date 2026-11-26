-- FX Close: the Seoul FX market's USD/KRW 15:30 KST rate of each KRX trading
-- day, from the Bank of Korea ECOS (731Y003 / 0000003), published by the
-- collector once ECOS has it (contracts/fx_close/). Separate from
-- market_close_snapshots, which it never changes; pages join the two by
-- market_date.
-- One row per market_date. Idempotent: safe to run again. No other table is touched.
CREATE TABLE IF NOT EXISTS market_fx_close (
  market_date TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  published_at TEXT NOT NULL,
  auth_source TEXT NOT NULL
);
