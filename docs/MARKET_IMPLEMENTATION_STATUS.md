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
- Checkpoint 2 commit: `a694f8f` (`Add Market Close D1 publishing flow`), pushed to the Draft PR branch.
- Checkpoint 3 code is ready for Preview:
  - switched both public locale pages from the example fixture to `GET /api/market/latest` only;
  - added distinct loading, no-data, and retryable error states;
  - added localized canonical, hreflang, description, Open Graph, image, and WebPage structured data;
  - added `/market/` and `/en/market/` to the dynamic sitemap with locale alternates.
- Checkpoint 3 commit: `87c712c` (`Connect Market Close UI to live API`).
- Cloudflare compatibility follow-ups:
  - `eae9f80` loads the authoritative schema through the Pages `ASSETS` binding for Wrangler 3 compatibility;
  - `9483714` shows the copied example only on `*.pages.dev`/localhost with a visible `PREVIEW FIXTURE` label when Preview has no D1 binding. Production can never use this fallback.
- Active Preview: `https://feature-market-close.market-research-site.pages.dev/` (deployment `53a6bd26`, source `9483714`).
- Final Preview route checks:
  - `/market/`, `/en/market/`, and `/admin/market/`: HTTP 200 with `X-Robots-Tag: noindex, nofollow`;
  - `/sitemap.xml`: includes both localized Market canonical URLs and alternates;
  - `POST /api/market/publish`: HTTP 403 on Preview before authentication or storage;
  - `GET /api/market/latest`: HTTP 503 `DB_NOT_CONFIGURED` on Preview because `COMMENTS_DB` is Production-only, followed by the explicitly labeled client-side Preview fixture.
- Final browser QA passed at KO 1280/430 and EN 360, plus light/dark mode: 10 sections, localized Daily CTA, correct active navigation, zero horizontal overflow, and zero console warnings/errors.
- Final full regression: 155/155 tests passed.
- Cloudflare environment audit: Production already has encrypted `ADMIN_KEY`; `MARKET_PUBLISH_KEY` is not configured yet and is required for the automated local-dashboard uploader. No secret values were read or exposed.
- D1 migration status: SQL and guarded runtime initialization are implemented, but no Production migration/write has been run because this Draft PR is not merged. The first Production GET/POST after merge will create the table through the existing `COMMENTS_DB` binding.

## TODO

- Before Production use, configure encrypted `MARKET_PUBLISH_KEY` in the Cloudflare Pages Production environment and point the local market-dashboard uploader at `https://snowshagal.com/api/market/publish` with `X-Market-Publish-Key`.
- After explicit merge approval in a separate step, confirm the first Production `GET /api/market/latest` initializes `market_close_snapshots`, then publish the first final v1.0.1 snapshot.

## 현재 동작 상태

- Production and `main` are unchanged.
- `/market/` and `/en/market/` now read only `/api/market/latest`; the example JSON is no longer a runtime source or fallback.
- The Market API, admin uploader, SEO, sitemap, and Preview UI are complete on the feature branch. No Production D1 write has been performed.

## 다음 작업 위치

- Await review on Draft PR #34. Do not merge or configure Production from this task.

## 주의사항

- `schema_version`, field names, types, units, and meanings are fixed by contract v1.0.1 and must not be changed by the website.
- The example JSON is a development/Preview fixture only and must never become a Production fallback.
- Do not modify the local market-dashboard program in this branch.
