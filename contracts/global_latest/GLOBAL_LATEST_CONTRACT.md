# Global Latest contract 1.0.0

Global Latest is the **current observation of global indicators**, published by a collector on
its own schedule and **independent of the KRX calendar**. It is a separate channel from Market
Close:

| | Market Close | Global Latest |
|---|---|---|
| Meaning | KRX trading-session historical snapshot | Latest observation of each global instrument |
| Schedule | KRX trading days only | Any day, including KRX holidays and weekends |
| Contract | `contracts/market_close/` (1.2.0) | `contracts/global_latest/` (1.0.0) |
| Storage | `market_close_snapshots` (one row per market date) | `market_global_latest` (one row per instrument) |
| Read | `GET /api/market/latest`, `/date`, `/range` | `GET /api/market/global/latest` |
| Write | `POST /api/market/publish` | `POST /api/market/global/publish` |

Nothing in Global Latest changes a Market Close payload, row or schema, and historical snapshots
are never rewritten from it. Status after B1: **website receiver ready, collector pending.**

## Instruments

Exactly twelve codes, in this canonical order (the only list is `GLOBAL_INSTRUMENTS` in
`functions/api/market/global/_shared.js`; the schema's `enum` is tested against it):

`NASDAQ`, `DOW`, `SP500`, `SOX`, `VIX`, `US10Y`, `USDKRW`, `JPYKRW`, `DXY`, `WTI`, `GOLD`, `BITCOIN`

KOSPI and KOSDAQ are not Global Latest instruments.

## Publish document

```json
{
  "schema_version": "1.0.0",
  "generated_at": "2026-09-24T13:49:40Z",
  "items": [ { "code": "NASDAQ", "...": "..." } ]
}
```

- `items`: 1 to 12 items, each code at most once. A collector publishes what it read; an
  instrument it could not read is **omitted**, never sent as unavailable and never re-sent with an
  old value under a new timestamp. The stored row then keeps its own, older `as_of`, and the page
  judges it stale.
- Unknown fields are rejected, at the top level and in items.

## Item

| Field | Type | Meaning |
|---|---|---|
| `code` | canonical code | Instrument |
| `ticker` | non-empty string | The provider's own symbol (e.g. `^SOX`) |
| `value` | finite number | This observation: the current value when `intraday`, the session close when `final_close` |
| `previous_close` | finite number > 0, or null | The same provider's close of the previous completed session |
| `change` | finite number, or null | `value − previous_close`, computed by the collector from the same source |
| `change_pct` | finite number, or null | `(value / previous_close − 1) × 100`, same source |
| `source_date` | `YYYY-MM-DD` | The market session the value belongs to (exchange-local, so not necessarily the UTC date of `as_of`) |
| `as_of` | ISO date-time with offset | The value's own source timestamp (e.g. the exchange's last-trade time). **Freshness is judged on this field.** |
| `retrieved_at` | ISO date-time with offset | When the collector received it. A recent `retrieved_at` says nothing about how recent the value is. |
| `data_state` | `intraday` \| `final_close` | Whether the session was still trading at `as_of` |
| `source` | non-empty string | Provider name |

Values from different sources are never combined: `value`, `previous_close`, `change` and
`change_pct` of one item come from one provider and one instrument.

## Server validation (all-or-nothing → 422)

1. `schema_version` is `1.0.0`; `generated_at` is a valid date-time.
2. Every item is well formed as above; no duplicate or unknown code.
3. Numbers are finite (no NaN/Infinity). `previous_close` null ⇔ `change` and `change_pct` null.
   When present, `change` and `change_pct` must agree with `value` and `previous_close` within a
   rounding tolerance (display precision is not enforced; a wrong sign or magnitude is rejected).
4. `as_of ≤ retrieved_at`; neither `as_of`, `retrieved_at` nor `generated_at` more than 5 minutes
   ahead of the server clock.
5. `source_date` is a real date, not beyond tomorrow (UTC). For `NASDAQ`, `DOW`, `SP500`, `SOX`,
   `VIX` and `US10Y` in `final_close`, it must be an NYSE trading date per
   `functions/_trading-calendar.js` (a year the calendar does not cover is rejected). FX, DXY,
   commodities and bitcoin are not held to the NYSE calendar.

## Storage and ordering

Table `market_global_latest` (`migrations/comments/0002_market_global_latest.sql`, mirrored in
`db/schema.sql`), one row per code. Timestamps are stored normalised to UTC ISO strings. The
request handlers never create or alter it: a database without the table answers
`503 GLOBAL_LATEST_SCHEMA_NOT_READY`.

Per instrument, the stored observation never moves backwards:

| Incoming vs stored | Result |
|---|---|
| no stored row | `created` |
| newer `as_of` | `updated` |
| same `as_of`, later `retrieved_at` | `updated` |
| same `as_of` and `retrieved_at`, identical item | `unchanged` (idempotent re-post) |
| same `as_of` and `retrieved_at`, different figures | `skipped_conflict` (stored row kept) |
| older `as_of`, or same `as_of` with earlier `retrieved_at` | `skipped_older` |

A valid document with some older items still updates the newer ones. All rows written by one
request go in a single D1 batch, and each upsert repeats the ordering rule in its `WHERE`, so a
concurrent publish cannot move a row backwards between the read and the write.

## Publish API

`POST /api/market/global/publish` — the Market Close publisher's host and credential policy:
Production or an isolated branch Preview (the bare Pages hostname and unknown hosts get 403), and
`x-market-publish-key` (`MARKET_PUBLISH_KEY`) or an admin session (else 401). Body at most 64 KiB.

```json
{ "ok": true, "schema_version": "1.0.0", "received": 3,
  "created": ["NASDAQ"], "updated": ["US10Y"], "unchanged": [],
  "skipped_older": ["BITCOIN"], "skipped_conflict": [],
  "published_at": "2026-09-24T13:50:02.000Z" }
```

## Read API

`GET /api/market/global/latest` returns every stored row in canonical order, with its own
timestamps and `published_at` (never `auth_source`):

```json
{ "schema_version": "1.0.0", "items": [ { "code": "NASDAQ", "ticker": "^IXIC", "value": 26753.24, "...": "...", "published_at": "..." } ] }
```

- An instrument never published is absent; an empty table is `200` with `items: []`.
- Freshness is not applied here. The TODAY overlay (B3) decides fresh or stale from `as_of`,
  `data_state`, the instrument class and the calendars, and falls back to the Market Close
  snapshot with its own basis label.
- `cache-control: public, max-age=30, s-maxage=60`; a weak ETag over each row's `as_of`,
  `retrieved_at` and `published_at`; `If-None-Match` answers 304.
