# Roadmap

Updated: 2026-08-29

This roadmap records implementation order, completed capabilities, and operational priorities, not a promise to build every future idea. Keep the current site small and stable until real traffic, indexing, and operational needs justify added complexity.

## Current Stage & Next Action

The core site architecture, bilingual structure, SEO/clean URLs, category discovery, analytics, and publishing pipeline are fully implemented and running in Production. The project is currently in the **Search indexing + traffic observation + operational stabilization** stage.

### Next action

1. **Google Search Console Domain property confirmation & Sitemap monitoring**:
   - Verify `snowshagal.com` DNS Domain-property in Google Search Console.
   - Confirm `/sitemap.xml` coverage, indexing status, and crawl rates for KO/EN homepages, category landings, and published reports.
2. **Observe real visitor traffic & reading engagement**:
   - Accumulate baseline data across `/admin/analytics/` (Cloudflare Web Analytics: Visits, Page views, referrers, devices, connection countries; and Privacy-minimal Engagement Analytics: active reading time, scroll depth, session completion).
3. **Operational stabilization**:
   - Defer large feature additions; focus on publishing rhythm and monitor for real friction in day-to-day writing and report management.
4. **Preview D1 parity (manual Cloudflare dependency)**:
   - Code-level Production/Preview smoke and exact-SHA Cloudflare deployment waiting are implemented on the deployment reliability branch.
   - The currently inspected Preview still returns `503 DB_NOT_CONFIGURED` for Market and comments GET.
   - An authenticated operator must bind `COMMENTS_DB` in the Preview environment to an existing Preview-only D1 database, verify that its database ID differs from Production, reuse `db/schema.sql`, and avoid copying Production data.
   - Do not mark Preview parity complete until the branch Preview passes `node scripts/smoke-site.mjs --origin <preview-url> --mode preview`.

## Near-term Priorities

Focus on operational observation and incremental refinement rather than new product features:

### 1. Search Indexing & Discovery
- Monitor Search Console indexing coverage, canonical resolution, and search appearance for both Korean and English reports.
- Validate that all newly published reports are smoothly indexed with extensionless Clean URLs.

### 2. Traffic & Engagement Data Accumulation
- Observe real visitor behavior across desktop and mobile devices without tracking personal data or adding intrusive scripts.
- Track which categories and reports attract meaningful active reading time and deep scroll engagement.

### 3. Publishing Workflow Refinement (Friction-Driven Only)
Refine `/admin/` and `/admin/manage/` only when recurring operational pain points are observed:
- Clearer duplicate-file / existing-slug warnings at publish time;
- Potential manual slug or filename customization if needed for future reports;
- Standardized metadata support in incoming HTML report templates (`report-title`, `report-date`, `report-type`, `report-summary`, `report-subtitle`);
- Parser adjustments for evolving chart or table formats.
- *Guardrail*: Preserve the current lightweight GitHub-backed publisher; do not replace it with a heavyweight CMS.

### 4. Distribution Channel Strategy
- Use external platforms (X/Twitter, Tistory, newsletters, social links) as distribution channels that route readers back to canonical `snowshagal.com` report URLs.
- Automated cross-posting remains low priority; prioritize editorial quality and direct link sharing.

## Completed Milestones

### Repository Verification & CI Gate (2026-08)
- **Repository Verification Automation & CI Safety Gate** (PR #72): Created official single verification entry point (`node scripts/verify.mjs`) running all Node test suites, comprehensive JS/MJS syntax validation via `node --check`, and repository invariant checks. Added `.github/workflows/verify.yml` for automated CI on pull requests and pushes without requiring branch protection that would interfere with direct admin publishing.
- **Naver Search Advisor Verification** (PR #71): Integrated Naver Search Advisor site ownership verification file (`naver96f43741acd96bcdeb679f22cddc4a80.html`) at domain root.
- **Google Structured Data / JSON-LD Foundation** (PR #70): Implemented SSR JSON-LD structured data following Google 2026 guidelines, providing `WebSite` and `Organization` on root homepage, `BreadcrumbList` on 10 category landings, and `Article` + `Organization` + `BreadcrumbList` on published reports.

### Category Landing & Public Navigation Redesign (2026-08)
- **Category Landing UX Revamp** (PR #66): Converted `/daily/`, `/weekly/`, `/research/`, `/basics/`, and `/notes/` (and `/en/...`) from raw archive lists into an editorial layout featuring **Latest 3 Featured Cards** + a quiet **Previous Reports Archive** list. Total post counts <= 3 automatically hide the archive section to prevent empty boxes.
- **Mobile Horizontal Swipe Carousel** (PR #66): Implemented CSS native scroll-snap horizontal carousel (~85% card width with clear swipe affordance) and compact 2-column internal card layout on mobile (`<=680px`), eliminating text clipping and page-level overflow.
- **Canonical Public Navigation** (PR #66, #68): Added explicit `홈 / Home` navigation item before Market across desktop `main-nav` and mobile `mobile-quick-nav`. All global category links now route directly to canonical landing pages (`/daily/`, etc.), while preserving `?category=` for in-page filtering and legacy bookmark compatibility.
- **SSR / CSR Card Parity** (PR #66): Synchronized server-side HTML generation (`functions/_seo.js`) and client rendering (`category-landing.js`, `site.js`) to render identical metadata, tags, summaries, reading times, and Clean URLs without layout shifts.

### Routing, Caching & Resilience Infrastructure (2026-08)
- **Internal Clean URL Consistency** (PR #65): Converted all internal report links across homepages, category landings, search results, previous/next bars, and related reading to canonical extensionless Clean URLs (`/reports/...`), while legacy `.html` requests redirect via HTTP 308. Physical `.html` paths remain safely preserved in `data/posts.json`.
- **Search Index & Dynamic Data Freshness** (PR #64): Enforced strict `Cache-Control: no-cache, no-store, must-revalidate` in `_headers` for dynamic data artifacts (`posts.json`, `posts.js`, `search-index*.js`, `market-summary.js`), preventing stale CDN/browser caching after new report publications.
- **Publishing Concurrency & Atomic Snapshot** (PR #63): Added snapshot-atomic publishing in `functions/api/publish.js`, detecting repository state changes before Git ref updates and returning HTTP 409 conflict errors to prevent silent overwrites.
- **Automated Content-Hash Asset Versioning** (PR #62): Implemented automated content-hash stamping (`scripts/stamp-asset-versions.mjs`) for mutable CSS/JS assets (`?v=<hash>`), eliminating stale asset caching during production deployments.

### Homepage Brand & Content Presentation (2026-08)
- **Compact Brand Hero & 2-Slide Editorial Carousel** (PR #61, #62): Evolved homepage header from previous iterations into a compact brand hero featuring a 2-slide manual carousel (PR #61: Slide 01 Snowshagal brand mission, scaled owl icon, and action labels; PR #62: Slide 02 latest Research highlight refinement and automated asset hashing integration).
- **TODAY Market Close Strip & Takeaway Pipeline** (PR #49, #54, #55, #56, #60, #67): Integrated D1-backed Market Close summary (`/api/market/latest`), dynamic TODAY strip, and published daily takeaway management in `/admin/manage/`.

### Internal Discovery UX (2026-08)
- **Previous / Next Navigation & Related Reading** (PR #59): Added isolated bottom navigation to all reports in `assets/report-shell.js`, providing chronologically adjacent report links and contextually relevant recommendations based on shared topic tags and category.

### SEO Foundation & Public Shells (2026-08)
- **SEO Foundation** (PR #57): Server-rendered crawlable report anchors, 10 static KO/EN category landing shells, dynamic metadata generation (`<title>`, `<meta name="description">`), self-canonicals, reciprocal `hreflang` for translation pairs, dynamic `sitemap.xml`, and crawler-friendly `robots.txt`.
- **Explicit 404 Handling**: Root `404.html` with `X-Robots-Tag: noindex` prevents Cloudflare Pages SPA fallback on missing routes.
- **Bilingual Structure (KO/EN)**: Dedicated `/en/` and `/en/about/` shells, language isolation for archive/search/filters, and `translationGroup` pair linkages.
- **Favicon Set & Share Cards** (PR #50, #53): Multi-size favicon/manifest suite and 1200x630 share card generator at publish time (`covers/share/`).

### Analytics & Privacy (2026-08)
- **Lightweight Admin Web Analytics**: Authenticated `/admin/analytics/` reading Cloudflare Web Analytics GraphQL RUM dataset for Visits, Page views, referrers, countries, and devices.
- **Privacy-Minimal Engagement Analytics**: Independent page-load reading session tracking via `assets/engagement.js` and D1 database `market-research-comments`, measuring active reading time and maximum scroll depth with zero persistent visitor identification.

### V1 Baseline & Core Features (2026-08)
- **Report Reading Time & Canonical Topic Tags** (PR #44, #48): Weighted DOM reading time calculation with category adjustments, canonical tag registry (`data/tags.json` / `data/tags.js`), and tag filtering.
- **Full-Text Tiered Search Index** (PR #47, #52): Sharded search index (`search-index-meta.js`, `search-index-body-ko.js`, `search-index-body-en.js`) with Git blob reading for large index files.
- **Social Sharing Section** (PR #51): Shadow DOM report share bar supporting native OS share sheet and desktop copy/social links.
- **Post Management Flow** (PR #10, #11): `/admin/manage/` supporting post metadata editing, HTML/cover replacement, exact-title deletion confirmation, and deployment polling.
- **Guest Comments System**: D1-backed salt-and-hash PBKDF2 guest comment system with rate limiting and responsive Shadow DOM UI.

## Maintenance / When Needed

- **Comment Moderation & Spam Protection**: Monitor guest comments; add lightweight moderation or rate-limit tightening only if real spam or abusive content appears.
- **D1 Database Maintenance**: Periodic review of comment and engagement storage metrics.

## Later, When Traffic Justifies It

- **Community Discussion Layer**: Separate data model from owner reports (`community_posts`, `comments`); do not store user-submitted posts as raw HTML.
- **Market Indicators**: Optional free/delayed index indicators (KOSPI, KOSDAQ, Nasdaq, USD/KRW). Never introduce paid real-time market data subscriptions.
- **International Expansion**: Publish English reports via authenticated translation pairing as translations become ready; avoid bulk machine translation.

## Explicit Non-priorities Now

- User membership / login / accounts
- Paid subscriptions / paywalls / donations
- Large frontend framework migration (preserve static HTML + Pages Functions)
- Paid real-time market data feeds
- Public view counters, ranking systems, or competitive popularity UI (internal analytics remain available in `/admin/analytics/`)
- Automated Tistory cross-posting
- Unnecessary CMS or backend rewrite

## Architecture Guardrails

- **Static HTML + Cloudflare Pages Functions**: Keep the foundation simple, fast, and serverless.
- **Preserve Report Integrity**: Never bulk-modify uploaded HTML files in `reports/`. Use the shared `report-shell.js` and middleware for common UI layers.
- **Isolated Feature Additions**: Implement new features as small, independent, isolated layers rather than rewriting core infrastructure.
- **Friction-Driven Evolution**: Refactor or extend publisher/admin tools only when concrete operational friction is identified.
- **Fail-Closed Deployment Detection**: Production smoke must wait for Cloudflare's success check on the exact main SHA. If that signal is absent or times out, fail without testing the previous Production. Repository verification remains network-free.
