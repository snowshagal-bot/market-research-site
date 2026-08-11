# Roadmap

Updated: 2026-08-11

This roadmap records implementation order, not a promise to build every future idea. Keep the current site small until traffic and actual needs justify added complexity.

## Next action

Review the admin cover-preview Draft PR and its Cloudflare Pages Preview. Confirm the local-only cover crop preview, responsive admin layout, and unchanged publish path before deciding whether to merge.

## In progress

### 6. Admin cover preview

In the current Draft PR:

- show the selected optional cover in the same `cover` / `center top` crop used by the homepage;
- provide accessible PC 1280, mobile 430, and mobile 360 preview modes;
- keep the image local until the existing publish action and release temporary object URLs when they are no longer needed;
- preserve the existing cover validation, optional no-cover path, publisher API, metadata structure, and report HTML.

## Completed

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

### Custom domain

Not urgent while traffic is very low. The site can continue on `pages.dev`. Add a custom domain later without changing the content architecture.

### Tistory and social

Tistory does not need automatic cross-posting. Use Tistory/social posts as distribution channels linking back to the canonical website.

### International expansion

When there is evidence of overseas readership:

- consider locale-aware URLs such as `/ko/`, `/en/`, `/ja/`;
- start with translated title/summary and selected high-value reports rather than translating everything;
- then add sitemap/hreflang/canonical metadata as needed.

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
