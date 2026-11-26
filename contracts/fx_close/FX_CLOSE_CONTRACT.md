# FX Close contract (schema_version 1.0.0)

The Seoul FX market's USD/KRW rate at 3:30 p.m. KST for each KRX trading day, from the Bank of Korea's ECOS. This is the figure the news and Bank of Korea statistics use. The publisher core collects it; the site stores it and shows it as that day's USD/KRW, in place of the Market Close record's bank rate.

## Why

기초 데이터 가이드 3편 「원·달러 환율 종가는 몇 시 숫자인가」 teaches that three numbers are different:

| Number | What it is |
|---|---|
| 오후 3시 30분 기준가 | The Seoul FX market's 15:30 KST price. News and ECOS use it. |
| 공식 매매기준율 | Seoul Money Brokerage's volume average of the previous business day's trades, dated the next day. |
| 은행 고시 매매기준율 | A bank's own rate, posted every round. |

The Market Close record's USD/KRW is Hana Bank's posted rate from its last round before 15:30 KST. That is a bank rate, and the site labels it so (website #274). This dataset lets the site show the 15:30 rate itself.

## Why a separate dataset

- ECOS publishes a day's value after the session. On 2026-11-26 it was already there at 17:23 KST; the hour is measured in `docs/ROADMAP.md`.
- A Market Close record becomes final at 16:05 KST and is frozen once published, so the record cannot carry the ECOS value.
- FX Close therefore has its own publish document, endpoint and table. The site joins it to the session by `market_date` and never changes a Market Close record.
- Past days come from ECOS's archive (a backfill).

## Instrument

| code | ECOS | Name (KO / EN) | Unit | Page |
|---|---|---|---|---|
| `USDKRW` | 731Y003 · 0000003 「원/달러(종가 15:30)」 | 원/달러 · 오후 3시 30분 기준가 / USD/KRW · 3:30 p.m. rate | KRW per USD | `/market/usdkrw/` |

ECOS publishes one decimal. The same table's 0000013 「원/달러(종가)」 is the 02:00 close of the extended session (since 2024-07). That is a different figure and is not used.

## Document

`fx_close.schema.json` is the structure; `fx_close.example.json` is an example.

- `days`: 1 to 60 days, each `market_date` once. Daily use sends one or two days; a backfill request sends up to 60.
- `previous_date`: the previous KRX trading day that has an ECOS row.
  - ECOS 731Y003 also carries rows on some KRX holidays: 2026-09-24, 09-25, 10-05 and 10-09.
  - On those days the official 매매기준율 (731Y001) has no row, because the Seoul FX market was closed. So they are not market closes and are never used, neither as a day nor as a previous day.
  - The move after a holiday is therefore against the last session's 15:30 rate. For example, 10-06 1,343.6 is compared with 10-02 1,350.6 (−7.0), not with 10-05.
- `retrieved_at`: when the collector read ECOS.
- `source`: the attribution, `한국은행 ECOS 원/달러(종가 15:30)`.
- `items`: exactly one, `USDKRW`.
  - `value` is `market_date`'s 15:30 rate.
  - `previous_value` is the rate on `previous_date`, from the same ECOS series.

## Server rules beyond the schema

The whole request is rejected (422) and nothing is written when any of these fails.

**Dates**
- `market_date` is a real calendar date and a KRX trading date (`functions/_trading-calendar.js`). A year the calendar does not cover fails closed.
- `market_date` is not after today in KST.
- `previous_date` is a weekday 1 to 14 calendar days before `market_date`. It is not required to be a KRX trading date.

**Timing**
- `retrieved_at` is not before 15:30 KST on `market_date`. A day's 15:30 rate cannot be read before 15:30.
- `retrieved_at` and `generated_at` are not more than 5 minutes ahead of the server clock.

**Values**
- `value` and `previous_value` are between 100 and 5,000 KRW with at most two decimals.
- `value` is within 10% of `previous_value`.

## Endpoints

### `POST /api/market/fx/publish`

- Same hosts and credentials as Market Close, Domestic Rates and Market Funds: `x-market-publish-key`, or an admin session.
- Production or an isolated branch Preview only. Body limit 64 KB.
- Each day is written in one D1 batch with one of these outcomes:
  - **created**: no stored row for the date.
  - **unchanged**: a stored row with the same `previous_date`, `source` and item.
  - **updated**: different figures, retrieved later than the stored row. An ECOS revision propagates this way.
  - **skipped_older**: different figures, retrieved earlier than or at the same time as the stored row.
- Response: `{ ok, schema_version, received, created, updated, unchanged, skipped_older, published_at }`.

### `GET /api/market/fx/date?date=YYYY-MM-DD` or `?date=latest`

- **200** `{ schema_version, day }`. `day` is `{ market_date, previous_date, retrieved_at, source, items, published_at }` as published. `latest` is the newest stored date.
- **404** `NOT_FOUND` when the date has no row.
- **400** `INVALID_DATE` for anything else.

Both endpoints answer `503 FX_CLOSE_SCHEMA_NOT_READY` until migration `migrations/comments/0007_market_fx_close.sql` is applied. Requests never create the table.

## How the site uses it

Every reader of a Market Close record joins that day's FX Close row with `applyFxClose` (`functions/api/market/_shared.js`). The readers are:
- `/api/market/latest` and `/date` (the ETag includes the FX Close row);
- the session pages and TODAY's first HTML;
- the archive and `/market/usdkrw/`;
- the 1W/1M range and the trend lines;
- the share card, the blog text and the Telegram caption.

What USD/KRW shows:
- **With a row:** the 15:30 rate. The move is `value − previous_value`. The label is "15:30 기준가" / "3:30 p.m. rate", and the source is 한국은행 ECOS.
- **Without a row yet:** the record's Hana Bank rate, labeled "잠정 · 하나은행 고시" / "Provisional · Hana Bank rate".
  - Its move is against the previous day's Hana Bank rate, so it stays within one series.
  - The ECOS value replaces it once published.

`/market/usdkrw/` lists ECOS days only.

## Storage

D1 `COMMENTS_DB`, table `market_fx_close`, one row per `market_date`. `auth_source` is stored but never served.
