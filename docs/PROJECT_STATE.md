# Project state

Updated: 2026-08-30

## Purpose

개인 시장 리서치 웹사이트. 주요 콘텐츠는 데일리 리포트 HTML, 위클리 HTML, 비정기 리서치 HTML, 시장 공부, 자유 글(끄적끄적)이다. 현재는 낮은 트래픽을 전제로 단순하고 유지보수 쉬운 구조를 우선한다.

## Current stack

- Source: GitHub repository `snowshagal-bot/market-research-site`
- Hosting: Cloudflare Pages
- Production URL: `https://snowshagal.com`
- Frontend: static HTML/CSS/vanilla JavaScript
- Server-side features: Cloudflare Pages Functions
- Comments storage: Cloudflare D1 database `market-research-comments`
- No framework and no user membership system at present

## Public information architecture

Locale structure:

- Korean is the default at `/`; English uses `/en/` on the same domain.
- `/about/` and `/en/about/` are matching locale shells.
- the shared `assets/locale.js` treats posts without `lang` as Korean, filters homepage data by `ko` or `en`, preserves category queries across explicit language switches, and resolves optional `translationGroup` counterparts;
- browser language never redirects visitors automatically; `site-language` is written only after an explicit KO/EN choice and is read only on `/` to restore an English choice while preserving `?category=`;
- English can remain empty without mixing Korean posts into its carousel, latest cards, archive, counts, or search.

`/market/` and `/en/market/` are the Market Close pages. They read the published close from
`GET /api/market/latest`, which serves the newest row of the D1-backed `market_close` table.
The record is uploaded through `/admin/market/` against the JSON Schema in
`contracts/market_close/`. Authenticated Market Close writes are allowed on branch Preview
hosts only because their `COMMENTS_DB` is isolated; the bare Pages hostname and unrelated
Preview hosts remain blocked, and all non-Market mutation APIs keep their existing policy.

## Deployment verification

Repository and deployment verification are separate by design. `scripts/verify.mjs` remains
the hermetic repository gate and never requests a deployed website. `scripts/smoke-site.mjs`
is a Node built-in-fetch smoke engine for GET-only Production or Preview validation. It
selects current report URLs from `data/posts.json`, checks the public locale/category/report
surface, redirect/404/sitemap/canonical behavior, and validates the public Market/comments
read contracts without pinning changing values or requiring any comment to exist.

`.github/workflows/deployment-smoke.yml` is the post-deployment detection layer. On a main
push it waits, with a three-minute bound, for the exact commit SHA's `Cloudflare Pages`
check-run from Cloudflare's GitHub App to report success. Only then does it run the
Production smoke. A missing or timed-out check fails closed, so an older Production cannot
be inspected and reported as the new commit. There is no automatic rollback.

Preview Functions must use the same `COMMENTS_DB` binding name as Production while pointing
to a different Preview-only D1 database. This parity is complete: Preview uses
`market-research-comments-preview`, Production uses `market-research-comments`, and no
Production data was copied. The Preview schema is initialized, with one clearly marked
`1900-01-01` / `preview-smoke-test` Market Close fixture used only for read verification.
Preview Market and comments GET both return HTTP 200, and the shared Preview smoke passes
20/20.

Main categories:

- `daily` → 데일리
- `weekly` → 위클리
- `research` → 리서치
- `basics` → 시장 공부 / Market Basics
- `note` → 끄적끄적

Each category also has a landing route in both locales:

- Korean: `/daily/`, `/weekly/`, `/research/`, `/basics/`, `/notes/`
- English: `/en/daily/`, `/en/weekly/`, `/en/research/`, `/en/basics/`, `/en/notes/`

Indexability follows current locale content in `data/posts.json`: an empty locale route returns `X-Robots-Tag: noindex, follow`, stays out of the sitemap and crawlable category navigation, and is not declared as an `hreflang` counterpart. Publishing the first post restores all four automatically. The existing homepage `?category=` filters remain supported for bookmarks and in-page archive controls. Primary homepage category links lead to the landing URLs, and both surfaces consume the same current post data.

The homepage supports category filtering and search. Its opening surface is now a fixed Snowshagal brand hero rather than a post carousel. The hero keeps the brand promise stable while three concise Daily / Weekly / Research entry points lead to their category landing pages. `basics` and `note` remain available in the shared navigation, filters, and archive, and legacy `?category=` URLs remain functional.

`/about/` and `/en/about/` carry a written introduction and a contact section. They are
indexable, declare their own title, description, Open Graph and X metadata, and appear in
the sitemap with reciprocal `hreflang`. Preview stays non-indexable through the shared
middleware's `X-Robots-Tag` header rather than a meta tag.

The homepage opens with the brand hero, then a TODAY strip summarising the latest market
close. `/api/market/latest` is the source of truth for both the strip's numbers and its
market date; `data/market-summary.js` is a fallback used only when that request fails, and
it also holds the editorial one-liner. The markup ships a neutral placeholder and the strip
is painted exactly once, after the request settles, so a past session is never shown while
the request is in flight. A payload that does not resolve all five items is rejected whole
rather than topped up, and the one-liner links strictly by `reportDate === displayed
marketDate`: with no matching daily report it falls back to Market Close instead of opening
another day's report. Freshness is whatever `market_date` the API returns, never the
calendar, so a weekend or holiday keeps showing the last trading session as current.

The homepage also provides:

- an original watercolor hero asset with separate desktop and mobile composition rules
- a fixed Korean hero headline and supporting copy, with a matching English-language hero on `/en/`
- post-driven latest DAILY, WEEKLY, and RESEARCH cards using the current localized `posts` data
- optional post cover images through `coverImage`, with a restrained CSS fallback when no cover exists
- the existing report archive, URL category filtering, and report-date sorting
- a paged archive: 20 rows render at a time behind a `더 보기` / `Show more` control that
  names how many remain. Changing category, year, month or tag, resetting the filters, or
  navigating back restarts the window
- a calendar view for `daily` and `weekly`, plus year, month and tag filters
- topic tags from `data/tags.json`, rendered in the reader's language
- reading time per report, computed at publish time
- a denser two-column desktop archive with the recent-report list beside a five-category index whose counts are calculated from the current post data; tablet and mobile stack the index after the list

## Search

A global dialog on every public shell. Every report body is indexed in full, deliberately:
a keyword deep inside a long report must stay findable, so `bodyText` is never truncated.
That makes the combined index roughly 2.4MB, so it is published in tiers by
`functions/api/_search-index.js`:

- `data/search-index-meta.js` (~34KB) — every field except `bodyText`. Loaded when the
  dialog opens and enough to answer title, tag and summary queries immediately.
- `data/search-index-body-ko.js` / `-en.js` — report bodies, one shard per locale, loaded in
  the background. The query re-runs when a shard lands so body-only matches join then. A
  reader never downloads the other locale's bodies.
- `data/search-index.json` — the canonical full artifact. Read by the publisher and the post
  manager, never shipped to the browser.

`scripts/build-search-index.mjs`, `functions/api/publish.js` and `functions/api/manage.js`
all emit that set through the shared serializer, so the three writers cannot drift apart.
Scoring weights title over tags over summary over body. If the index cannot be fetched the
dialog falls back to the post data already on the page.

## Report publishing flow

Admin page: `/admin/`

1. User drops a standalone HTML report into the admin page.
2. `assets/admin.js` reads the file locally and attempts to infer category, report date, title, subtitle, and optional `meta[name="report-summary"]`. Report-date detection accepts explicit metadata, year-first numeric dates, and natural English dates such as `August 4, 2026`; an unrecognized date remains blank for manual confirmation instead of defaulting silently to the current day. The five report categories remain visible as keyboard-accessible radio chips; automatic detection selects an initial value and the administrator can override it before publishing.
3. The administrator chooses Korean (default) or English and may optionally connect an opposite-language post as its translation pair. Selecting a pair copies its `reportDate` into the form. Both the browser and `/api/publish` reject a paired submission whose date differs from its counterpart.
4. Title extraction prefers report metadata/HTML content such as `meta[name="report-title"]`, `h1`, cover title, generic title class, and finally document title/file name.
5. An optional cover can be reviewed locally with the homepage's actual `cover` / `center top` crop at PC 1280, mobile 430, and mobile 360 before publishing. The preview uses a temporary browser object URL and does not upload the image. The admin can also generate a 900×1350 cover once at publish time from the uploaded HTML: `report-cover-selector` metadata wins, conservative first-page heuristics follow, and failed or ambiguous capture uses a restrained Canvas template. The generated file enters the same preview/upload path as a manual cover, which remains available.
6. User can review/edit the extracted publishing metadata before publishing. `summary` is an optional homepage hero teaser, separate from `description`; 2–3 sentences or about 90–140 characters is recommended.
7. `/api/publish` authenticates with `ADMIN_KEY` and uses `GITHUB_TOKEN` server-side. It accepts only `ko` or `en`; Korean reports keep `reports/`, while English reports are written under `reports/en/`.
8. An optional JPG/PNG/WebP cover image can be uploaded separately from the report HTML.
9. A single Git commit updates the report HTML, optional `covers/` asset, `data/posts.json`, and `data/posts.js`.
10. Cloudflare Pages automatically deploys the new Git commit.
11. Admin UI polls `data/posts.json` until the new post appears, then shows completion and redirects to the relevant locale/category.

The publisher and post manager read repository JSON through the Git blob API when a file is too large for the GitHub Contents API to return inline. This keeps the growing full-text search index publishable beyond the Contents API's 1MB inline-content limit.

The publishing UI now warns before the final confirmation when no optional homepage cover is selected. Publishing without a cover remains supported and uses the homepage fallback cover.
Publish failures remain visible without clearing the selected report or metadata. An invalid administrator key is identified explicitly, marked on the key field, and can be corrected before retrying.

## Existing post management

Admin page: `/admin/manage/`

The management page extends the existing static admin and GitHub-backed publishing architecture without introducing a CMS or database:

- loads and sorts the canonical `data/posts.json` list, with title/URL search and category filters;
- displays each post's language, treating legacy missing `lang` as Korean, and shows but does not edit `translationGroup`;
- edits category, report date, title, subtitle, description, and optional homepage summary while preserving post ID, public URL, registration fields, and legacy-import state;
- optionally replaces standalone report HTML at its existing `reports/` path;
- keeps, replaces, or removes the optional homepage cover with the same PC/mobile crop preview used by the homepage;
- requires a confirmation prompt plus exact-title entry before deletion;
- uses authenticated `/api/manage` updates that create one Git commit for synchronized metadata and any report/cover changes;
- checks the exact `main` SHA again before updating the ref and returns a conflict instead of force-pushing when the repository changes;
- refuses to delete report or cover paths outside the managed `reports/` and `covers/` directories.
- keeps the editor unchanged after a successful mutation, shows a centered completion overlay, and polls the Production `data/posts.json` plus any updated cover until Cloudflare reflects the commit;
- redirects to the homepage after confirmed deployment, while allowing the administrator to cancel the redirect and reload the latest management list.

Cloudflare Preview hosts disable actual update/delete actions in the client, and `/api/manage` independently rejects every mutation whose request hostname is not exactly `snowshagal.com`. Preview validation must use list, form, sandboxed local HTML/cover preview, and mocked API tests only.

## Admin Web Analytics

Admin page: `/admin/analytics/`

The lightweight analytics dashboard reuses the existing `ADMIN_KEY` and `mrs-admin-key` session storage convention. Its authenticated `/api/analytics` Pages Function reads the account-scoped Cloudflare Web Analytics `rumPageloadEventsAdaptiveGroups` dataset through GraphQL and sends only aggregate results to the browser. The Function discovers and validates the current GraphQL schema before building its query, uses the site tag to isolate `snowshagal.com`, applies a timeout, and returns private/no-store responses.

The UI offers today, 7-day, and 28-day views for Visits, Page views, trend, top paths, referers, connection-location countries, device types, browsers, and operating systems. An empty dataset is a successful empty state; configuration, schema, timeout, and upstream failures remain visible errors rather than fake zeroes. Country copy explicitly describes connection location, not nationality.

### Engagement Analytics

The same `/admin/analytics/` page also contains an independent `읽기 행동 / Engagement` section. `/assets/engagement.js` creates one temporary UUID per public page load, counts only foreground active time, retains the maximum scroll depth, and sends changed values at roughly 30-second intervals plus a final background/page-hide update. `functions/_middleware.js` injects the deferred tracker into successful public HTML only when the request hostname is exactly `snowshagal.com`; Preview hosts and `/admin/*`, `/api/*`, and `/cdn-cgi/*` are never tracked.

`POST /api/engagement` validates and UPSERTs one row per page-load session into `engagement_sessions`. `GET /api/engagement-stats?days=1|7|28` reuses `ADMIN_KEY`, returns private/no-store aggregates, and maps report paths to titles using `data/posts.json` where possible. Reading sessions are tracker page loads, not people or Cloudflare Visits. The dashboard reports average and median active time, average maximum scroll, reading/scroll thresholds, and page/country breakdowns. Collection starts only after Production deployment; no historical backfill is inferred.

The tracker stores no IP address, cookie, name, email, login data, fingerprint, advertising ID, persistent visitor ID, or cross-site identifier. Country is supplied only by the server-side `request.cf.country` connection location (or `XX`), and does not represent nationality.

## OpenDART Disclosure Monitor & MARKET Public Feed (PR #79)

Admin page: `/admin/disclosures/`
Public feed: `/market/` and `/en/market/` (Section 11) via `GET /api/disclosures/feed`

The disclosure architecture is cleanly decoupled across collection, curation, public display, and AI explanation layers:

- **Admin Collection & Curation**:
  - `functions/api/disclosures/_source.js`: OpenDART adapter collecting all daily market disclosures (`Y, K`) safely bounded by page caps and daily request quotas.
  - `functions/api/disclosures/watchlist.js` & `disclosure_watchlist` table: Dynamic watchlist management (pre-seeded with 30 core Korean market leaders) editable in admin without redeployment.
  - `functions/api/disclosures/publish.js`: Manual toggle to publish any disclosure to MARKET (`manual`) or unpublish (`admin_only`).
  - Auto-publish rule: Filings with `is_watchlist = 1` AND `rule_score >= 7` (High/Critical) AND `rcept_dt === KST today` (Date Guard) are automatically published (`publish_status = 'auto'`) to the public MARKET feed; past lookback filings and routine filings (`score < 7`) remain `admin_only`.
- **Public MARKET Feed**:
  - `functions/api/disclosures/feed.js`: Public, fast-loading, cache-controlled (`Cache-Control: public, max-age=30, s-maxage=60`) endpoint serving only published items with a minimal whitelisted DTO (`rceptNo`, `priority`, `fact`, `ai`). Operational fields are strictly withheld.
  - `assets/market-close.js` & `assets/market-close.css`: Renders Section 11 `DISCLOSURE · 오늘의 주요 공시` with separate Fact Box (official DART metadata, title, date, correction badge) and AI Insight Box (`해설 보기 ▾`), expandable list, and responsive layout down to 360px without horizontal overflow.
- **Reader-Facing AI Explanation Layer**:
  - `functions/api/disclosures/_llm.js`: Gemini 3.5 Flash-Lite structured output providing reader-facing explanation (`summary`, `what_it_means`, `watch_points`, `impact`, `importance`, `limitation`). Metadataless number generation (`key_figures`) is omitted to ensure zero hallucination risk. Decoupled from internal report preparation.
  - Failure Isolation: AI or location errors log cleanly as `ai_status = 'error'` and never crash OpenDART sync, D1 storage, or public feed rendering.


Important date semantics:

- `reportDate`: date the report itself belongs to / was authored or issued.
- `registeredDate`, `registeredAt`: date/time the report was added to the website.
- Archive sorting uses `reportDate` first, then registration time as a tiebreaker.

## Report rendering and shared shell

Files under `reports/` are standalone HTML documents that may contain their own CSS, JavaScript, interactions, embedded images, tooltips, fold/unfold behavior, and animations.

`functions/_middleware.js` intercepts HTML responses under `/reports/` and injects `/assets/report-shell.js`.

The same middleware injects canonical `snowshagal.com` metadata into published report responses and marks non-Production hosts `noindex, nofollow` by response header. It generates the report `<title>` from the real report date, category, and editorial title. Description preserves an explicit `summary`; otherwise it prefixes the available `description`, `subtitle`, or localized default with the report date and title so generic editorial copy remains report-specific. Missing date/title values retain the safe fallback. It adds `hreflang` only when both sides of an explicit `translationGroup` exist, so untranslated reports never point to invented English pages.

For the homepage and category landings, the middleware reads the current `data/posts.json` asset and places real report `<a href>` elements in the HTML response before client JavaScript runs. `assets/site.js` and `assets/category-landing.js` then render the interactive views from `data/posts.js`, preserving search, filters, list/calendar modes, and category browsing without duplicating post data. Static KO/EN category shells keep self-canonicals, while locale alternates, navigation exposure and sitemap inclusion are generated only for populated locale categories. The data-driven `/sitemap.xml` lists eligible locale/category pages and current published reports. `/robots.txt` allows public crawling and excludes administrator/API routes.

The repository root also contains a non-indexable `404.html`. Its presence disables Cloudflare Pages' homepage SPA fallback for unknown paths, so missing public and report URLs return HTTP 404. The shared middleware preserves redirects and error statuses without injecting the report shell or report SEO metadata.

`assets/report-shell.js` currently provides:

- a share section between the report body and the comments
- fixed shared navigation bar
- active category state
- guest comment UI
- Korean/English common navigation and comment copy based on the report locale
- a KO/EN report switch that opens the matching `translationGroup` report when present and otherwise falls back to the target-language homepage
- Shadow DOM isolation to reduce style collision with report HTML

The share section shares one canonical URL, never the address bar. A coarse pointer with no
hover gets `navigator.share` and the operating system sheet, which is how Instagram,
KakaoTalk and other apps are reached; everything else gets a popover with Copy Link, X,
Facebook and LinkedIn. The routing decision reads `matchMedia`, never a user agent. No
Instagram deep link and no Kakao SDK or app key exist in the codebase. Cancelling a share
is not reported as a failure, and copy falls back from the async clipboard to `execCommand`
and finally to a selectable field holding the URL.

The shared navigation is fixed at the top and inserts spacing so it does not cover the original report. Public links are `데일리 / 위클리 / 리서치 / 시장 공부 / 끄적끄적 / 소개`.

## Icons, social cards and report metadata

`favicon.ico` (16/32/48), `favicon-32x32.png`, `apple-touch-icon.png` and `site.webmanifest`
are generated from the existing owl artwork on the brand ivory ground. Browsers request
`/favicon.ico` from the origin root when a document declares no icon, which already covers
uploaded reports; the shared middleware also appends the full set to report heads, so no
report HTML is edited. The manifest declares `display: browser` and there is no service
worker — this is not a PWA.

Two 1200x630 JPEGs live in `assets/social/`: `snowshagal-home.jpg` for the homepages, About
and every report, and `market-close-share.jpg` for the Market Close pages. Market keeps its
PNG/WebP hero on screen and points crawlers only at the share JPEG, so on-screen art and
crawler art are separate.

Report covers are 900x1350 portrait, and a 1.91:1 unfurl keeps only the middle third of
them — measured on five representative covers, four lost their title outright. So
`og:image` always carries a 1200x630 landscape card while `twitter:image` keeps the report's
own cover under `twitter:card=summary`, where a thumbnail is shown rather than a cropped
band. `SOCIAL_REPORT_IMAGE` in `functions/_seo.js` is the seam a per-report card would plug
into if Social Card v2 is ever built. No X handle is claimed: `twitter:site` and
`twitter:creator` are omitted rather than guessed.

## Comments feature

Status: complete and validated in production on desktop and mobile.

Relevant files:

- `assets/report-shell.js` — guest comment UI
- `functions/api/comments.js` — GET/POST/DELETE API
- `db/schema.sql` — schema reference

Current behavior:

- no membership required
- nickname + comment + deletion password
- comment body is inserted with `textContent`, not raw HTML
- deletion password is salted and hashed using PBKDF2/SHA-256 with 100,000 iterations before storage
- `password_hash` stores the algorithm and iteration count as `pbkdf2-sha256$<iterations>$<hash>` so future KDF changes do not invalidate existing comments
- soft delete via `deleted_at`
- same-origin check for write/delete requests
- honeypot field for simple bot filtering
- per-IP-hash rate limit: 5 comments / 10 minutes
- API auto-creates the D1 table/indexes on first use if they do not exist
- if an incompatible pre-release `comments` table exists, the API preserves it as `comments_legacy_v1` before creating the current schema
- mobile: comment composer is collapsed by default and opened with `댓글 쓰기`
- desktop: composer is visible by default

Production validation completed on 2026-08-10:

- desktop comment creation succeeded and persisted after refresh
- wrong deletion passwords were rejected and the correct password deleted the comment
- mobile comment creation and deletion succeeded
- report layouts remained stable on both mobile and desktop

## V1 baseline polish

Status: complete and deployed to production on 2026-08-10.

The v1 polish pass confirmed and stabilized:

- synchronized light/dark theme state, controls, and browser theme color on the homepage and admin page
- site-controlled dark mode for the shared report navigation and comments without recoloring original report content
- WCAG AA-oriented light-mode text contrast for common site UI
- visible keyboard focus treatment and accessible selected/current category semantics
- explicit accessible names for guest comment fields
- responsive layouts at 360px, 430px, and 1280px, including horizontal overflow and fixed/sticky UI checks
- representative daily, weekly, and research report layouts with their original HTML unchanged

The current v1 baseline is now in normal operation. There is no predetermined next feature; the next task should be chosen only when actual production use reveals a concrete inconvenience, defect, or maintenance need.

## Key files

- `index.html` — homepage shell and category/search markup
- `about/index.html` / `en/about/index.html` — indexable About pages with introduction and contact
- `assets/site.css` — main site visual styles
- `assets/home-v2.css` — Snowshagal hero, responsive artwork, latest-card, and archive layout
- `assets/category-state.css` — category state styles
- `assets/site.js` — homepage category filtering, TODAY strip, paged archive, calendar, search dialog, theme/menu behavior
- `assets/category-landing.js` / `assets/category-landing.css` — shared KO/EN category archive rendering and presentation
- `assets/locale.js` — shared locale copy, legacy-language normalization, filtering, URL, and translation-pair helpers
- `assets/language.css` — restrained desktop/mobile language selector styling
- `en/index.html` — English homepage shell
- `market/index.html` / `en/market/index.html` — Market Close pages
- `assets/market-close.js` / `assets/market-close.css` — Market Close rendering
- `functions/api/market/latest.js` / `publish.js` / `_shared.js` — D1-backed Market Close read, authenticated publish, shared validation
- `contracts/market_close/` — Market Close JSON Schema, example payload and data contract
- `admin/market/index.html` / `assets/admin-market.js` — Market Close upload UI
- `data/market-summary.js` — fallback data and editorial one-liner for the homepage TODAY strip
- `data/tags.json` / `data/tags.js` — canonical topic tag registry
- `scripts/build-search-index.mjs` — builds the search index and syncs reading time
- `functions/api/_search-index.js` — shared search index serializer used by the build script, publisher and manager
- `data/search-index.json` — canonical full index; `data/search-index-meta.js` and `data/search-index-body-{ko,en}.js` are the browser tiers
- `data/posts.json` — canonical post metadata used by publishing flow and deployment checks
- `data/posts.js` — browser-consumable post data
- `admin/index.html` — report publishing admin UI
- `assets/admin.js` — local HTML parsing, client-only cover crop preview, publish flow, deployment polling
- `functions/api/publish.js` — authenticated server-side publisher using GitHub API
- `admin/manage/index.html` — existing-post search, edit, cover/HTML replacement, and deletion UI
- `assets/admin-manage.js` / `assets/admin-manage.css` — post-management client flow and responsive presentation
- `functions/api/manage.js` — authenticated atomic update/delete commits with ref-conflict protection
- `admin/analytics/index.html` / `assets/admin-analytics.js` / `assets/admin-analytics.css` — authenticated lightweight Cloudflare Web Analytics dashboard
- `functions/api/analytics.js` — authenticated, schema-discovered GraphQL Analytics aggregation endpoint
- `assets/engagement.js` / `functions/api/engagement.js` / `functions/api/engagement-stats.js` — privacy-minimal Production-only reading-session tracker, D1 writer, and authenticated aggregate endpoint
- `functions/api/_engagement.js` — shared Engagement schema, validation, date-range, and aggregation helpers
- `functions/_middleware.js` — injects crawlable homepage/category report links, the shared report shell, favicon set and report SEO, and marks non-Production hosts noindex
- `functions/_seo.js` — canonical URLs, category metadata, report title/description, crawlable discovery markup, hreflang, sitemap and social constants
- `scripts/verify.mjs` — single official repository verification gate running all test suites, JS/MJS syntax validation, and integrity invariants
- `.github/workflows/verify.yml` — lightweight GitHub Actions CI running `node scripts/verify.mjs` and `git diff --check` on pull requests and main pushes
- `.github/workflows/deployment-smoke.yml` — waits for the exact main SHA's Cloudflare Pages success check before GET-only Production smoke
- `scripts/smoke-site.mjs` — shared Production/Preview deployed-site smoke engine using current post data
- `scripts/wait-for-cloudflare-deployment.mjs` — bounded GitHub check-run poller that prevents pre-deployment Production PASS
- `scripts/build-category-pages.mjs` — regenerates the ten static KO/EN category landing shells from shared metadata
- `favicon.ico` / `favicon-32x32.png` / `apple-touch-icon.png` / `site.webmanifest` — icon set
- `assets/social/` — 1200x630 social cards
- `assets/report-shell.js` — isolated navigation, share section and comments UI for report pages
- `functions/api/comments.js` — D1-backed guest comment API
- `admin/disclosures/index.html` / `functions/api/disclosures/` — authenticated OpenDART disclosure monitor, deterministic triage, D1 storage and optional swappable LLM analysis
- `docs/DISCLOSURES.md` — provider, budget, failure, concurrency and activation contract for the disclosure monitor
- `covers/` — optional separately stored homepage cover assets created by the publisher
- `reports/` — uploaded standalone report HTML files

## Current constraints / deliberate non-features

- No paid membership or account system yet.
- No popular-post ranking or view counter.
- No automated Tistory cross-posting; Tistory can link back to the site.
- Market ticker is not currently a priority. Free/delayed data may be added later; paid market data is not required.
- `snowshagal.com` is the sole Production and SEO canonical origin; Pages Preview subdomains are development-only.
- No major framework migration planned unless the current architecture becomes a real blocker.
- Report bodies are indexed in full. Truncating `bodyText` to shrink the index would remove a
  working feature and is covered by a test.
- Share targets are Copy Link, X, Facebook and LinkedIn plus the operating system sheet. No
  Instagram deep link and no Kakao SDK, app key or custom scheme.
- Per-report social cards are not generated. Social Card v2 remains a candidate, not a plan.
- Existing Korean report URLs are not renamed; only future reports could take ASCII slugs.

## Known operational principle

A UI change is not complete until both mobile and desktop are checked. The project previously exposed real regressions when a mobile-oriented shared navigation change rendered incorrectly on desktop, so this rule is mandatory rather than optional.
