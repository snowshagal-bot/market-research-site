# Roadmap

Updated: 2026-08-10

This roadmap records implementation order, not a promise to build every future idea. Keep the current site small until traffic and actual needs justify added complexity.

## Next action

### 2. Basic site polish

Stabilize the current site as the v1 baseline. This is a validation and polish pass, not a feature expansion or visual redesign.

- validate light and dark modes across the homepage, admin page, and shared report shell;
- inspect real Android layouts at approximately 360–430px wide;
- inspect desktop layouts at 1280px or wider;
- check for horizontal overflow and fixed/sticky UI overlap;
- verify hover and pointer behavior on desktop and touch target sizes on mobile;
- review basic accessibility for navigation, forms, contrast, and focus states.

## Completed

### 1. Finish guest comments validation

Completed on 2026-08-10. The D1 database `market-research-comments` and Production binding `COMMENTS_DB` are active.

Production validation confirmed:

- desktop comment creation succeeded and persisted after refresh;
- wrong-password deletion was rejected;
- correct-password deletion succeeded;
- mobile comment creation and deletion succeeded;
- mobile and desktop report layouts showed no regressions.

## Near-term priorities

### 3. Improve publishing workflow only where friction appears

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
