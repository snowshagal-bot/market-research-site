# Roadmap

Updated: 2026-08-10

This roadmap records implementation order, not a promise to build every future idea. Keep the current site small until traffic and actual needs justify added complexity.

## Next action

### 2. Harden comment operations

The guest comment flow is working in production. Continue with small operational improvements only where they solve an observed need:

- review rate-limit behavior and user-facing error messages;
- decide whether the owner needs a simple admin moderation UI for deleting abusive comments without knowing guest passwords;
- add lightweight spam controls only if real spam appears;
- avoid CAPTCHA or account requirements unless necessary.

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

### 4. Basic site polish

- validate light and dark modes across homepage/admin/shared report shell;
- tune mobile typography/spacing from real-device screenshots;
- verify desktop hover/pointer behavior for interactive report elements;
- review accessibility basics for navigation, forms, contrast, and focus states.

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
