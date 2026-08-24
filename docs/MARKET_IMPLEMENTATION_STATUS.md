# Market Close implementation status

Updated: 2026-08-25
Branch: `feature/market-close`
Contract: `1.0.1`

## DONE

- Created an isolated feature branch from the latest `origin/main`.
- Read the approved Market Close request, data contract, JSON Schema, example payload, and design reference.
- Checkpoint 1 UI is complete:
  - copied the v1.0.1 contract, JSON Schema, and example payload without changing the source files;
  - added `/market/` and `/en/market/` fixture-driven pages;
  - rendered every required contract section with contract-aware close/intraday, ratio, flow-unit, and unavailable-value formatting;
  - added the dedicated watercolor mountain asset, responsive layout, dark mode, KO/EN copy, and localized Daily CTA;
  - replaced the global header/report-shell About slot with Market while retaining About in the footer.
- Checkpoint 1 browser QA passed at 1280px, 430px, and 360px with no horizontal overflow or console warnings/errors. KO/EN and light/dark mode were checked.
- Checkpoint 1 focused tests: 10/10 passed. Full regression before this status update: 135/139 passed; the four expected About-navigation assertions were updated to the approved Market-navigation behavior and now pass.
- Checkpoint 1 commit: `a1d3108` (`Add fixture-driven Market Close UI`), pushed to the Draft PR branch.
- Checkpoint 2 implementation is complete:
  - added public `GET /api/market/latest` with short cache headers and ETag support;
  - added Production-only `POST /api/market/publish` with a 512KB limit, full schema validation, final-only gates, and separate automated/admin header authentication;
  - added idempotent D1 upserts keyed by `market_date` and latest-date-safe reads;
  - reused `COMMENTS_DB`, with guarded runtime table initialization and matching checked-in SQL;
  - added `/admin/market/` for JSON inspection, status display, full Market layout preview, and authenticated manual publishing;
  - documented exact uploader and admin authentication in `docs/MARKET_PUBLISHING.md`.
- Checkpoint 2 focused tests: 14/14 passed. The browser selected the example JSON successfully, showed date/version/final/PASSED, rendered all 10 preview sections, kept publish disabled without an admin key, and emitted no console warnings/errors.

## TODO

- Checkpoint 3: connect the public page to the API, add loading/empty/error states and SEO, run regressions, and validate the Cloudflare Preview.

## 현재 동작 상태

- Production and `main` are unchanged.
- `/market/` and `/en/market/` still read only the copied example fixture for isolated UI verification; Checkpoint 3 will switch them to `/api/market/latest`.
- The Market API and admin uploader are implemented locally. No Production D1 write has been performed.

## 다음 작업 위치

- Start Checkpoint 3 by switching the public pages from the fixture to `/api/market/latest`, then finish SEO/sitemap and Cloudflare Preview QA.

## 주의사항

- `schema_version`, field names, types, units, and meanings are fixed by contract v1.0.1 and must not be changed by the website.
- The example JSON is a development/Preview fixture only and must never become a Production fallback.
- Do not modify the local market-dashboard program in this branch.
