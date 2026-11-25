# Market Funds contract (schema_version 1.0.0)

Korean stock market funds for each KRX trading day, from KOFIA (금융투자협회) FreeSIS:
- investor deposits,
- margin loans,
- unpaid margin,
- forced selling.

The publisher core collects them, and the site stores them and shows them beside that day's Market Close record.

## Why a separate dataset

- KOFIA publishes a trading day's figures on a **later business day**: the 2026-11-24 row was not yet there at 19:00 KST on 2026-11-24.
- The Market Close record of a day becomes final at 16:05 KST and is frozen once published. So a record can never carry its own day's funds.
- Market Funds therefore has its own publish document, endpoint and table, and pages join it to the session by `market_date`.
- It never changes a Market Close record. Past days can be published from KOFIA's archive (a backfill) without touching any snapshot.

## Instruments

FreeSIS screens:
- `STATSCU0100000060`: 증시자금 추이, KRW million.
- `STATSCU0100000070`: 신용공여 잔고 추이, KRW million.

The FreeSIS columns were matched against figures reported in the press:
- deposits on 2026-10-14 and 2026-11-10;
- forced selling on 2026-10-08 and 2026-10-12 to 2026-10-14;
- credit on 2026-11-10.

| code | FreeSIS screen · column | Name (KO / EN) | Unit | Page |
|---|---|---|---|---|
| `DEPOSITS` | 증시자금 · TMPV2 투자자예탁금(장내파생상품 거래예수금 제외) | 투자자예탁금 / Investor deposits | KRW million | `/market/deposits/` |
| `CREDIT` | 신용공여 · TMPV2 신용거래융자 전체 | 신용거래융자 잔고 / Margin loans | KRW million | `/market/margin-loans/` |
| `CREDIT_KOSPI` | 신용공여 · TMPV3 신용거래융자 유가증권 | 코스피 / KOSPI | KRW million | — |
| `CREDIT_KOSDAQ` | 신용공여 · TMPV4 신용거래융자 코스닥 | 코스닥 / KOSDAQ | KRW million | — |
| `UNPAID` | 증시자금 · TMPV5 위탁매매 미수금 | 위탁매매 미수금 / Unpaid margin | KRW million | — |
| `FORCED_SALE` | 증시자금 · TMPV6 위탁매매 미수금 대비 실제 반대매매금액 | 반대매매 / Forced selling | KRW million | `/market/forced-selling/` |
| `FORCED_SALE_RATIO` | 증시자금 · TMPV7 미수금 대비 반대매매 비중 | 미수금 대비 반대매매 비중 / Forced selling to unpaid | percent | — |

Two relationships hold in the 2026 data:
- **`CREDIT` = `CREDIT_KOSPI` + `CREDIT_KOSDAQ`** within KRW 1 million (rounding) on all 219 days to 2026-11-24.
- **`FORCED_SALE_RATIO` = `FORCED_SALE` ÷ the *previous* day's `UNPAID` × 100**, rounded to 0.1, exactly on every day.

## Document

`market_funds.schema.json` is the structure. `market_funds.example.json` is an example.

- `days`: 1 to 60 days, each `market_date` once.
  - One request carries one or two days in daily use and up to 60 in a backfill.
- `previous_date`: the date of KOFIA's row just before `market_date`. This is normally the previous KRX trading day. KOFIA has no rows for KRX holidays, except the KRX year-end closure (12-31): 2024-12-31 and 2025-12-31 both have rows. So 2026-01-02's `previous_date` is 2025-12-31, and KOFIA's ratio that day is computed on it.
- `retrieved_at`: when the collector read FreeSIS.
- `source`: the attribution shown on the pages, `금융투자협회 증시자금 추이`.
- `items`: 1 to 7, each code once.
  - `value`: `market_date`'s figure.
  - `previous_value`: the figure on `previous_date`, from the same KOFIA table.
  - An instrument KOFIA did not publish that day is absent, never null.
  - Amounts are whole KRW millions as KOFIA publishes them. The ratio is a percent with one decimal.

## Server rules beyond the schema

The whole request is rejected (422) and nothing is written when any of these fails:

- **Dates**
  - `market_date` is a real calendar date and a KRX trading date (`functions/_trading-calendar.js`). A year the calendar does not cover fails closed.
  - `market_date` is not after today in KST.
  - `previous_date` is a weekday 1 to 14 calendar days before `market_date`. It is not required to be a KRX trading date, because KOFIA's row before the first session of a year is the KRX year-end closure.
- **Timing**
  - `retrieved_at` is not before 15:30 KST on `market_date` (the regular close). A day's balances cannot be read before its session ends.
  - `retrieved_at` and `generated_at` are not more than 5 minutes ahead of the server clock.
- **Credit parts.** When `CREDIT`, `CREDIT_KOSPI` and `CREDIT_KOSDAQ` are all present, the total equals the parts within KRW 2 million. This holds for `value` and for `previous_value`.
- **Forced-selling ratio.** When `FORCED_SALE`, `UNPAID` and `FORCED_SALE_RATIO` are all present, the ratio equals `FORCED_SALE.value ÷ UNPAID.previous_value × 100` within 0.051. A zero `UNPAID.previous_value` skips this check.

## Endpoints

### `POST /api/market/funds/publish`

- Same hosts and credentials as Market Close and Domestic Rates: `x-market-publish-key`, or an admin session.
- Production or an isolated branch Preview only. Body limit 64 KB.
- Each day is written in one D1 batch with one of these outcomes:
  - **created**: no stored row for the date.
  - **unchanged**: a stored row with the same `previous_date`, `source` and items.
  - **updated**: different figures, retrieved later than the stored row. This lets a KOFIA revision propagate.
  - **skipped_older**: different figures, retrieved earlier than or at the same time as the stored row.
- Response: `{ ok, schema_version, received, created, updated, unchanged, skipped_older, published_at }`. The four lists hold dates.

### `GET /api/market/funds/date?date=YYYY-MM-DD` or `?date=latest`

- **200** `{ schema_version, day }`. `day` is `{ market_date, previous_date, retrieved_at, source, items, published_at }` as published.
  - Items are in the order of the instruments table.
  - `latest` is the newest stored date.
- **404** `NOT_FOUND` when the date has no row.
- **400** `INVALID_DATE` for anything else.

Both endpoints answer `503 MARKET_FUNDS_SCHEMA_NOT_READY` until migration `migrations/comments/0006_market_funds.sql` is applied. Requests never create the table.

## Storage

D1 `COMMENTS_DB`, table `market_funds`, one row per `market_date`. `auth_source` is stored but never served.
