# Project state

Updated: 2026-08-12

## Purpose

개인 시장 리서치 웹사이트. 주요 콘텐츠는 데일리 리포트 HTML, 위클리 HTML, 비정기 리서치 HTML, 시장 공부, 자유 글(끄적끄적)이다. 현재는 낮은 트래픽을 전제로 단순하고 유지보수 쉬운 구조를 우선한다.

## Current stack

- Source: GitHub repository `snowshagal-bot/market-research-site`
- Hosting: Cloudflare Pages
- Production URL: `https://market-research-site.pages.dev`
- Frontend: static HTML/CSS/vanilla JavaScript
- Server-side features: Cloudflare Pages Functions
- Comments storage: Cloudflare D1 database `market-research-comments`
- No framework and no user membership system at present

## Public information architecture

Locale structure:

- Korean is the default at `/`; English uses `/en/` on the same domain.
- `/about/` and `/en/about/` are matching locale shells.
- the shared `assets/locale.js` treats posts without `lang` as Korean, filters homepage data by `ko` or `en`, preserves category queries across explicit language switches, and resolves optional `translationGroup` counterparts;
- browser language never redirects visitors automatically; `site-language` is written only after an explicit KO/EN choice;
- English can remain empty without mixing Korean posts into its carousel, latest cards, archive, counts, or search.

Main categories:

- `daily` → 데일리
- `weekly` → 위클리
- `research` → 비정기
- `basics` → 시장 공부 / Market Basics
- `note` → 끄적끄적

The homepage supports category filtering and search. Its v2 featured carousel selects one latest post from each available core category (`daily`, `weekly`, `research`, `basics`) rather than rotating chronologically. `note` remains available as a secondary navigation and archive category.

`/about/` is a noindex site-shell page reserved for a future user-authored introduction. It currently contains the shared header, navigation, theme control, empty main area, and footer only.

Homepage v2 also provides:

- manual previous/next and category-tab carousel controls with no autoplay
- optional post cover images through `coverImage`
- rendered 900×1350 WebP covers for the latest representative DAILY, WEEKLY, and RESEARCH posts
- CSS/typographic fallback covers for posts without `coverImage`
- full-width category-latest cards without a separate introduction copy block
- the existing report archive, URL category filtering, and report-date sorting
- a denser two-column desktop archive with the recent-report list beside a five-category index whose counts are calculated from the current post data; tablet and mobile stack the index after the list

## Report publishing flow

Admin page: `/admin/`

1. User drops a standalone HTML report into the admin page.
2. `assets/admin.js` reads the file locally and attempts to infer category, report date, title, and subtitle. The five report categories remain visible as keyboard-accessible radio chips; automatic detection selects an initial value and the administrator can override it before publishing.
3. The administrator chooses Korean (default) or English and may optionally connect an opposite-language post as its translation pair.
4. Title extraction prefers report metadata/HTML content such as `meta[name="report-title"]`, `h1`, cover title, generic title class, and finally document title/file name.
5. An optional cover can be reviewed locally with the homepage's actual `cover` / `center top` crop at PC 1280, mobile 430, and mobile 360 before publishing. The preview uses a temporary browser object URL and does not upload the image.
6. User can review/edit the extracted publishing metadata before publishing.
7. `/api/publish` authenticates with `ADMIN_KEY` and uses `GITHUB_TOKEN` server-side. It accepts only `ko` or `en`; Korean reports keep `reports/`, while English reports are written under `reports/en/`.
8. An optional JPG/PNG/WebP cover image can be uploaded separately from the report HTML.
9. A single Git commit updates the report HTML, optional `covers/` asset, `data/posts.json`, and `data/posts.js`.
10. Cloudflare Pages automatically deploys the new Git commit.
11. Admin UI polls `data/posts.json` until the new post appears, then shows completion and redirects to the relevant locale/category.

The publishing UI now warns before the final confirmation when no optional homepage cover is selected. Publishing without a cover remains supported and uses the homepage fallback cover.

## Existing post management

Admin page: `/admin/manage/`

The management page extends the existing static admin and GitHub-backed publishing architecture without introducing a CMS or database:

- loads and sorts the canonical `data/posts.json` list, with title/URL search and category filters;
- displays each post's language, treating legacy missing `lang` as Korean, and shows but does not edit `translationGroup`;
- edits only category, report date, title, subtitle, and description while preserving post ID, public URL, registration fields, and legacy-import state;
- optionally replaces standalone report HTML at its existing `reports/` path;
- keeps, replaces, or removes the optional homepage cover with the same PC/mobile crop preview used by the homepage;
- requires a confirmation prompt plus exact-title entry before deletion;
- uses authenticated `/api/manage` updates that create one Git commit for synchronized metadata and any report/cover changes;
- checks the exact `main` SHA again before updating the ref and returns a conflict instead of force-pushing when the repository changes;
- refuses to delete report or cover paths outside the managed `reports/` and `covers/` directories.
- keeps the editor unchanged after a successful mutation, shows a centered completion overlay, and polls the Production `data/posts.json` plus any updated cover until Cloudflare reflects the commit;
- redirects to the homepage after confirmed deployment, while allowing the administrator to cancel the redirect and reload the latest management list.

Cloudflare Preview hosts disable actual update/delete actions in the client, and `/api/manage` independently rejects every mutation whose request hostname is not exactly `market-research-site.pages.dev`. Preview validation must use list, form, sandboxed local HTML/cover preview, and mocked API tests only.

Important date semantics:

- `reportDate`: date the report itself belongs to / was authored or issued.
- `registeredDate`, `registeredAt`: date/time the report was added to the website.
- Archive sorting uses `reportDate` first, then registration time as a tiebreaker.

## Report rendering and shared shell

Files under `reports/` are standalone HTML documents that may contain their own CSS, JavaScript, interactions, embedded images, tooltips, fold/unfold behavior, and animations.

`functions/_middleware.js` intercepts HTML responses under `/reports/` and injects `/assets/report-shell.js`.

`assets/report-shell.js` currently provides:

- fixed shared navigation bar
- active category state
- guest comment UI
- Korean/English common navigation and comment copy based on the report locale
- a KO/EN report switch that opens the matching `translationGroup` report when present and otherwise falls back to the target-language homepage
- Shadow DOM isolation to reduce style collision with report HTML

The shared navigation is fixed at the top and inserts spacing so it does not cover the original report. Public links are `데일리 / 위클리 / 비정기 / 시장 공부 / 끄적끄적 / 소개`.

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
- `assets/home-v2.css` — homepage v2 carousel, fallback cover, and latest-card layout
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
- Custom domain is not required yet. Pages.dev is acceptable during early low-traffic operation.
- No major framework migration planned unless the current architecture becomes a real blocker.

## Known operational principle

A UI change is not complete until both mobile and desktop are checked. The project previously exposed real regressions when a mobile-oriented shared navigation change rendered incorrectly on desktop, so this rule is mandatory rather than optional.
