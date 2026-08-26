# Project state

Updated: 2026-08-24

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

Main categories:

- `daily` → 데일리
- `weekly` → 위클리
- `research` → 리서치
- `basics` → 시장 공부 / Market Basics
- `note` → 끄적끄적

The homepage supports category filtering and search. Its opening surface is now a fixed Snowshagal brand hero rather than a post carousel. The hero keeps the brand promise stable while three concise Daily / Weekly / Research entry points lead into the existing category query flow. `basics` and `note` remain available in the shared navigation, filters, and archive.

`/about/` is a noindex site-shell page reserved for a future user-authored introduction. It currently contains the shared header, navigation, theme control, empty main area, and footer only.

The homepage also provides:

- an original watercolor hero asset with separate desktop and mobile composition rules
- a fixed Korean hero headline and supporting copy, with a matching English-language hero on `/en/`
- post-driven latest DAILY, WEEKLY, and RESEARCH cards using the current localized `posts` data
- optional post cover images through `coverImage`, with a restrained CSS fallback when no cover exists
- the existing report archive, URL category filtering, and report-date sorting
- a denser two-column desktop archive with the recent-report list beside a five-category index whose counts are calculated from the current post data; tablet and mobile stack the index after the list

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

Important date semantics:

- `reportDate`: date the report itself belongs to / was authored or issued.
- `registeredDate`, `registeredAt`: date/time the report was added to the website.
- Archive sorting uses `reportDate` first, then registration time as a tiebreaker.

## Report rendering and shared shell

Files under `reports/` are standalone HTML documents that may contain their own CSS, JavaScript, interactions, embedded images, tooltips, fold/unfold behavior, and animations.

`functions/_middleware.js` intercepts HTML responses under `/reports/` and injects `/assets/report-shell.js`.

The same middleware injects canonical `snowshagal.com` metadata into published report responses and marks non-Production hosts `noindex, nofollow` by response header. It adds `hreflang` only when both sides of an explicit `translationGroup` exist, so untranslated reports never point to invented English pages. Static KO/EN home shells declare reciprocal alternates, the empty About shells remain `noindex`, and the data-driven `/sitemap.xml` excludes them while listing current published reports. `/robots.txt` allows public crawling and excludes administrator/API routes.

The repository root also contains a non-indexable `404.html`. Its presence disables Cloudflare Pages' homepage SPA fallback for unknown paths, so missing public and report URLs return HTTP 404. The shared middleware preserves redirects and error statuses without injecting the report shell or report SEO metadata.

`assets/report-shell.js` currently provides:

- fixed shared navigation bar
- active category state
- guest comment UI
- Korean/English common navigation and comment copy based on the report locale
- a KO/EN report switch that opens the matching `translationGroup` report when present and otherwise falls back to the target-language homepage
- Shadow DOM isolation to reduce style collision with report HTML

The shared navigation is fixed at the top and inserts spacing so it does not cover the original report. Public links are `데일리 / 위클리 / 리서치 / 시장 공부 / 끄적끄적 / 소개`.

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
- `about/index.html` — empty noindex About page shell
- `assets/site.css` — main site visual styles
- `assets/home-v2.css` — Snowshagal hero, responsive artwork, latest-card, and archive layout
- `assets/category-state.css` — category state styles
- `assets/site.js` — homepage category filtering, featured article, search, theme/menu behavior
- `assets/locale.js` — shared locale copy, legacy-language normalization, filtering, URL, and translation-pair helpers
- `assets/language.css` — restrained desktop/mobile language selector styling
- `en/index.html` / `en/about/index.html` — English homepage and About shells
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
- `functions/_middleware.js` — injects shared report shell into `/reports/` HTML
- `assets/report-shell.js` — isolated navigation + comments UI for report pages
- `functions/api/comments.js` — D1-backed guest comment API
- `covers/` — optional separately stored homepage cover assets created by the publisher
- `reports/` — uploaded standalone report HTML files

## Current constraints / deliberate non-features

- No paid membership or account system yet.
- No popular-post ranking or view counter.
- No automated Tistory cross-posting; Tistory can link back to the site.
- Market ticker is not currently a priority. Free/delayed data may be added later; paid market data is not required.
- `snowshagal.com` is the sole Production and SEO canonical origin; Pages Preview subdomains are development-only.
- No major framework migration planned unless the current architecture becomes a real blocker.

## Known operational principle

A UI change is not complete until both mobile and desktop are checked. The project previously exposed real regressions when a mobile-oriented shared navigation change rendered incorrectly on desktop, so this rule is mandatory rather than optional.
