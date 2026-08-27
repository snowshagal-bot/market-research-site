# Roadmap

Updated: 2026-08-27

This roadmap records implementation order, not a promise to build every future idea. Keep the current site small until traffic and actual needs justify added complexity.

## Next action

Review the SEO Foundation PR in Cloudflare Preview. Verify HTML source and rendered output for the KO/EN homepages, all ten category landings, and representative paired/unpaired reports without merging to Production.

## In progress

### 15. SEO Foundation

- server-render crawlable report anchors into homepage Latest/Archive without replacing the existing interactive list/calendar/search behavior;
- add KO and EN landing pages for Daily, Weekly, Research, Market Basics, and Notes from shared metadata and the current post dataset;
- generate unique report titles and non-empty descriptions in the common middleware while preserving editorial titles inside report content;
- keep self-canonicals and emit reciprocal report hreflang only for real `translationGroup` pairs;
- extend the dynamic sitemap with category landing URLs and validate source HTML, links, desktop, and mobile in Preview before any Production merge.

### 14. Privacy-minimal Engagement Analytics

- retain Cloudflare Web Analytics and add independent page-load reading sessions backed by the existing `COMMENTS_DB` binding;
- collect only foreground active time, maximum scroll, path, locale, temporary UUID, server timestamps, and server-derived connection country;
- exclude Preview and administrator/API paths, use no cookie or persistent visitor identity, and perform no historical backfill;
- expose authenticated 1/7/28-day overall, page, and country aggregates inside `/admin/analytics/`;
- validate all existing tests and responsive Preview UI before Production merge.

### 13. Snowshagal homepage brand redesign

- replace the rotating report-led opener with a fixed Snowshagal brand hero and the approved Korean copy;
- use one original watercolor illustration with desktop and mobile-specific crops;
- keep Daily / Weekly / Research entry points concise while preserving every existing category, search, archive, locale, theme, and mobile-menu path;
- keep latest report content driven by the current localized post data and leave SEO, Pages Functions, Analytics, admin, and publishing behavior unchanged;
- validate the Draft PR in Cloudflare Preview on desktop and mobile before Production merge.

### 12. Lightweight admin Web Analytics

- add `/admin/analytics/` with today, 7-day, and 28-day Visits/Page views and lightweight trend/ranking views;
- protect `/api/analytics` with the existing `ADMIN_KEY` and keep every Cloudflare credential server-only;
- discover and validate the account's `rumPageloadEventsAdaptiveGroups` schema before querying;
- distinguish empty data, configuration, schema, timeout, authentication, and upstream failures;
- validate responsive light/dark UI and read-only Preview behavior without report mutations.

### 11. Explicit Cloudflare Pages 404 handling

- add a minimal, non-indexable root `404.html` so unknown paths no longer receive the homepage with HTTP 200;
- preserve 404 and redirect responses in the shared middleware without report-shell injection;
- validate real Preview HTTP status and SEO regressions without Production mutations.

### 10. Korean / English site structure

In the current Draft PR:

- add `/en/` and `/en/about/` while keeping Korean as the default locale;
- isolate carousel, latest cards, archive counts, search, and filters by post language, with missing `lang` treated as Korean;
- add explicit desktop/mobile KO/EN controls without automatic browser-language redirects;
- support `translationGroup` report counterparts and localized report-shell/comment copy without editing uploaded report HTML;
- publish English HTML under `reports/en/`, expose a simple optional pair selector, and preserve locale metadata in management updates.

## Completed

### 9. Homepage archive density and admin category selection

Squash-merged and deployed to Production on 2026-08-12. The homepage now uses a dynamic five-category archive index beside compact recent-report rows on desktop and stacked below on smaller screens. The new-report admin keeps five accessible category chips visible, with conservative automatic detection and manual override.

### 8. Post-management deployment feedback

Squash-merged and deployed to Production on 2026-08-11. Successful update/delete actions keep the editor stable, show a centered completion overlay, poll Production metadata and covers, support automatic homepage redirect or continued management, and present deployment timeouts as delayed confirmation rather than failed saves.

### 7. Existing post management

Squash-merged and deployed to Production on 2026-08-11. `/admin/manage/` provides list/search/filter/edit, optional HTML and cover replacement, exact-title deletion confirmation, atomic GitHub updates, Preview write blocking, and managed-path safety.

### 6. Admin cover preview

Squash-merged and deployed to Production on 2026-08-11. The new-report admin provides local PC 1280, mobile 430, and mobile 360 homepage crop previews, clears undecodable images before publishing, and keeps the optional fallback-cover path.

### 5. Representative report covers

Squash-merged and deployed to Production on 2026-08-11. The latest representative DAILY, WEEKLY, and RESEARCH posts use rendered 900×1350 WebP covers, synchronized metadata, and the existing homepage crop while the fallback remains available for posts without a cover.

### 4. Homepage cleanup and About page shell

Squash-merged and deployed to Production on 2026-08-11. The homepage introduction copy was removed, full-width latest-category cards were retained, `소개` was added to public navigation, and the empty noindex `/about/` common shell was added without changing report content.

### 3. Homepage v2 editorial redesign

Squash-merged and deployed to Production on 2026-08-11. Production validation covered the category-representative carousel, light/dark mode, search and filters, 360px/430px/1280px layouts, mobile swipe/menu behavior, existing report shell/comments, and the admin Market Basics/optional-cover controls.

### 1. Finish guest comments validation

Completed on 2026-08-10. The D1 database `market-research-comments` and Production binding `COMMENTS_DB` are active.

Production validation confirmed:

- desktop comment creation succeeded and persisted after refresh;
- wrong-password deletion was rejected;
- correct-password deletion succeeded;
- mobile comment creation and deletion succeeded;
- mobile and desktop report layouts showed no regressions.

### 2. Basic site polish

Completed and deployed to Production on 2026-08-10. The work stabilized the existing site as the v1 baseline without adding features or redesigning the product.

Validation and polish covered:

- light and dark modes across the homepage, admin page, and shared report shell;
- site-controlled shared shell theming without changing original report designs;
- common light-mode text contrast, keyboard focus visibility, and category/form accessibility semantics;
- Android-sized layouts at 360px and 430px;
- desktop layout at 1280px;
- horizontal overflow, fixed/sticky UI spacing, hover/pointer behavior, and representative daily/weekly/research reports;
- guest comments regression coverage after the UI changes.

## Near-term priorities

### 6. Improve publishing workflow only where friction appears

Current `/admin/` publishing already supports HTML parsing, metadata review, secure server-side publishing, deployment progress, and redirect.

Potential incremental improvements:

- clearer duplicate-file handling;
- optional manual slug/file rename if needed;
- better extraction rules for future report HTML templates;
- optional standard metadata in new report templates (`report-title`, `report-date`, `report-type`, `report-subtitle`).

Do not replace the working publisher with a large CMS unless the current flow becomes a real bottleneck.

## Maintenance / when needed

### Harden comment operations

The guest comment flow has passed Production E2E validation and has no currently observed operational issues. Continue hardening only when a real need is observed:

- review rate-limit behavior or user-facing error messages if they cause operational friction;
- add simple admin moderation only if abusive comments create a real moderation need;
- add lightweight spam controls only if real spam appears;
- avoid CAPTCHA or account requirements unless necessary.

## Later, when traffic justifies it

### Community board

Future community posts should use a data model separate from owner reports. Do not store visitor community posts as arbitrary HTML.

Possible future entities:

- `community_posts`
- `comments`
- optional `users` / roles later

The current guest-comment system should not block future membership, but membership is not a current requirement.

### Market indicators

Possible header indicators: KOSPI, KOSDAQ, Nasdaq, Dow, USD/KRW, Bitcoin.

Priority rule: use free data only. Delayed data is acceptable if clearly labeled. If reliable display requires paid market-data licensing, omit the feature rather than add recurring cost at the current stage.

### Custom domain and search indexing

`snowshagal.com` is connected as the Production apex and the former Pages Production URL redirects to it. Canonical metadata, real KO/EN alternates, a data-driven sitemap, and robots policy now use the apex domain. The remaining manual operation is Domain-property DNS verification and sitemap submission in Google Search Console.

### Tistory and social

Tistory does not need automatic cross-posting. Use Tistory/social posts as distribution channels linking back to the canonical website.

### International expansion follow-ups

Add actual English reports only through the authenticated publishing flow when translations are ready. `hreflang` connects report pages only after an explicit `translationGroup` has real KO and EN records; do not bulk-translate or duplicate existing production records merely to populate the English archive.

### Ads / donations / paid access

Not current priorities.

The architecture should remain extensible enough for future premium/member roles, donations, or advertising, but do not add payment/account complexity now. Any future paid investment-research model should receive a separate legal/regulatory review before implementation.

## Explicit non-priorities now

- popular posts
- view counts
- ranking systems
- automatic Tistory posting
- paid real-time market data
- user membership/login
- paid subscription
- large frontend framework migration

## Architecture guardrail

When a future feature seems to require a rewrite, first ask whether it can be added as a small isolated layer around the current static-site + Pages Functions architecture. Preserve working report HTML and the publishing path unless there is a concrete reason not to.
