# Domestic Rates contract (schema_version 1.0.0)

Korean bond and money-market yields for each KRX trading day, from the KOFIA (금융투자협회) final quote yields (최종호가수익률). The publisher core collects them; the site stores them and shows them beside that day's Market Close record.

## Why a separate dataset

- KOFIA computes the afternoon final quote yields at **16:00 KST** (its notice: "(오후) 16시 기준", since 2017-03-27). They appear minutes later.
- The Market Close record of the same day becomes final at 16:05 KST and is frozen once published. So a record cannot carry that day's yields.
- Domestic Rates therefore has its own publish document, endpoint and table. Pages join it to the session by `market_date`.
- It never changes a Market Close record. Past days can be published from KOFIA's archive (a backfill) without touching any snapshot.

## Instruments

| code | KOFIA row (종류명) | KOFIA code | Name (KO / EN) | Page |
|---|---|---|---|---|
| `KTB3Y` | 국고채권(3년) | 3000 | 국고채 3년 / KTB 3Y | `/market/ktb3y/` |
| `KTB10Y` | 국고채권(10년) | 3013 | 국고채 10년 / KTB 10Y | `/market/ktb10y/` |
| `CORPAA3Y` | 회사채(무보증3년)AA- | 3009 | 회사채 AA- 3년 / Corporate AA- 3Y | `/market/corpaa3y/` |
| `CD91` | CD수익률(91일) | 4000 | CD 91일 / CD 91-day | `/market/cd91/` |

Values are percent. KOFIA publishes bonds with 3 decimals and CD with 2.

## Document

`domestic_rates.schema.json` is the structure. `domestic_rates.example.json` is an example.

- `days`: 1 to 60 days, each `market_date` once. One request carries one day in daily use and up to 60 in a backfill.
- `basis_time`: KOFIA's afternoon basis time, KST `HH:MM`.
  - It is `16:00` on a normal day.
  - On a day KOFIA moves it (for example the CSAT day), it is the time KOFIA announces.
- `retrieved_at`: when the collector read KOFIA.
- `source`: the attribution shown on the pages, `금융투자협회 최종호가수익률`.
- `items`: 1 to 4, each code once.
  - `value`: the afternoon (오후) yield of `market_date`.
  - `previous_value`: KOFIA's own previous-business-day yield (전일).
  - `change_bp`: `(value − previous_value) × 100`, rounded to 0.1.
  - An instrument KOFIA did not publish that day is absent, never null.

## Server rules beyond the schema

The whole request is rejected (422) and nothing is written when any of these fails:

- `market_date` is a real calendar date and a KRX trading date (`functions/_trading-calendar.js`). A year the calendar does not cover fails closed.
- `market_date` is not after today in KST.
- `retrieved_at` is not before `market_date` + `basis_time` KST. An afternoon value cannot be read before it exists.
- `retrieved_at` and `generated_at` are not more than 5 minutes ahead of the server clock.
- `change_bp` agrees with `(value − previous_value) × 100` within 0.11bp.

## Endpoints

### `POST /api/market/rates/publish`

- Same hosts and credentials as Market Close and Global Latest: `x-market-publish-key`, or an admin session. Production or an isolated branch Preview only. Body limit 64 KB.
- Writes per day in one D1 batch:
  - **created**: no stored row for the date.
  - **unchanged**: a stored row with the same `basis_time`, `source` and items.
  - **updated**: different figures retrieved later than the stored row. This lets a KOFIA correction propagate.
  - **skipped_older**: different figures retrieved earlier than or at the same time as the stored row.
- Response: `{ ok, schema_version, received, created, updated, unchanged, skipped_older, published_at }`. The four lists hold dates.

### `GET /api/market/rates/date?date=YYYY-MM-DD` or `?date=latest`

- `200 { schema_version, day }`.
  - `day` is `{ market_date, basis_time, retrieved_at, source, items, published_at }` as published. Items are in the order of the instruments table.
  - `latest` is the newest stored date.
- `404 NOT_FOUND` when the date has no row.
- `400 INVALID_DATE` for anything else.

Both endpoints answer `503 DOMESTIC_RATES_SCHEMA_NOT_READY` until migration `migrations/comments/0003_market_domestic_rates.sql` is applied. Requests never create the table.

## Storage

D1 `COMMENTS_DB`, table `market_domestic_rates`, one row per `market_date`. `auth_source` is stored but never served.
