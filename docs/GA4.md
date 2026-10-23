# Google Analytics 4

Measurement ID: `G-L3XBBY93CG`. Owner approved merge/deployment in chat; required Google property settings were verified disabled on 2026-10-23. Rollout and post-deployment verification are recorded in PR #177.

## Integration and installation audit

The 2026-10-23 audit found no GA4, Google tag, GTM or Universal Analytics loader/config in the tracked frontend, Functions or 210 uploaded reports. Read-only checks of the actual Production `/`, `/en/` and `/market/` HTML also found none. Existing Cloudflare analytics and `/api/engagement` are separate systems; this change does not modify them.

`functions/_ga4.js` supplies one inline bootstrap in `<head>` through the existing `functions/_middleware.js` response transform (both Cloudflare HTMLRewriter and the Node string fallback). After parsing, it queues the official `gtag('js', ...)`, `gtag('set', ...)` and a single `gtag('config', 'G-L3XBBY93CG', { send_page_view: true })`, then asynchronously inserts Google's `https://www.googletagmanager.com/gtag/js?id=G-L3XBBY93CG` script. The page's final SEO title is then available. Loading never blocks parsing, rendering, Market requests or publishing.

The browser initializer is a literal `String.raw` asset. Never inject a server function using `Function#toString`: Cloudflare/esbuild can add `__name` helpers inside that function, and those server-bundle helpers are absent in the visitor's page. The initial rollout exposed this error; the correction was verified against actual esbuild `keepNames` output in an isolated browser context (old output reproduced `__name is not defined`; corrected output starts exactly one loader/config).

All successful public HTML at `https://snowshagal.com` is covered: KO/EN HOME, MARKET, Daily, Weekly, Research, Investment Insights (`/notes/`), Market Basics / glossary-style content (`/basics/`), About, disclosures, calendar and standalone reports. Future automated report publications pass through the same middleware, so neither uploaded source HTML nor the publisher needs a tag edit. Static files viewed directly without Pages Functions do not contain the injected tag; check the **served response HTML**.

Preview, localhost, the admin origin, `/admin/`, `/api/`, `/cdn-cgi/`, redirects, failed responses and non-HTML are excluded. Preview QA must not inflate the live property's visitor counts. The bootstrap also rejects those origins if copied into a page.

Repeated bootstrap execution cannot configure or load the tag twice. If an existing Google loader, `gtag` function, queued config or GTM container is present, the bootstrap skips installation rather than adding another tracker. If future report sources embed their own Google tracking, review and consolidate that installation: the guard prevents duplication but does not migrate an existing tag to this measurement ID or sanitize someone else's tracking code.

## Pageviews and required property settings BEFORE approval/deployment

Pre-deployment verification on 2026-10-23 fetched the public `gtag/js?id=G-L3XBBY93CG` configuration without executing it or sending analytics events. After the owner changed the property settings, all stream-specific `__ccd_em_*` tags were absent, and `__ogt_1p_data_v2` had `vtp_isEnabled: false`. Email redaction remained enabled (`vtp_redactEmail: true`). This confirms the previously enabled enhanced measurement and user-provided-data detection were disabled before merge. Preserve these settings for future deployments.

The site uses full document navigation between pages. HOME category filters and MARKET date/range tabs use `pushState`/`replaceState`/`popstate` to change the current page's state; they are not virtual document navigation. There is no SPA router to instrument. This implementation sends the initial pageview through `config` only; it adds no manual `page_view`, router hooks or extra pageviews for filtering, hash anchors or tab changes.

**Keep the following property settings in place. The owner changed them, and the public tag configuration was verified before merge; the repository does not change them.**

1. Admin → Data collection and modification → Data streams → the web stream whose measurement ID is `G-L3XBBY93CG`: turn **Enhanced measurement OFF**. This avoids automatic browser-history pageviews, site-search terms, outbound-link URLs, downloads, video and form-interaction events. The normal pageview from `gtag('config', ...)` remains enabled. If Enhanced measurement is re-enabled later, first review every event and keep **Page changes based on browser history events**, **Site search**, **Outbound clicks**, **File downloads**, **Video engagement** and **Form interactions** disabled for this integration.
2. Under Google tag → Configure tag settings → **Allow user-provided data capabilities**, turn that capability **OFF** (not just individual fields). This prevents automatic email/phone/address detection. Keep email redaction enabled as an additional safeguard. Inspect any other Google tag destinations and event settings; do not connect extra tags or enable user-provided-data collection as part of this change.
3. Keep Google Signals and advertising personalization off. The code also sets `allow_google_signals: false` and `allow_ad_personalization_signals: false`.
4. Completion was verified before merge and recorded in PR #177. Recheck after any future property-setting changes: code-level single-config tests alone do **not** prove there are no extra automatically collected pageviews or input-related events.

If the site later introduces an actual SPA router, revise this policy together with the property settings and test one pageview per completed virtual navigation. Do not simply add manual pageviews alongside the current automatic config pageview.

## Data minimization and attribution

- The explicitly supplied `page_location` is the current origin + public pathname. Every query parameter (including search, email, tokens, UTM and click IDs) and fragment is omitted. Reports retain their distinct public canonical paths and language prefixes.
- `page_referrer` is the referring HTTP(S) **origin only**, without credentials, path, query or fragment. Search-engine/referral domains remain available for acquisition classification, without their search terms or private path details. A missing referrer stays empty; do not fabricate one.
- No `user_id`, user properties, comment content, nicknames, passwords, form values, custom search events or private admin events are sent by this integration. Do not add personal data to public report URLs or titles.
- GA4's normal browser/cookie-based visitor and session measurement still applies; blocking, missing referrers and user/browser privacy settings can limit counts. Removing all URL queries intentionally prevents campaign-level UTM/click-ID reporting. Organic/referral domain measurement does not require forwarding those query values. Search keywords/impressions require Search Console; they are not sent from the visitor's URL.
- This does not alter SEO titles/canonicals, data payloads, Core collection, Market APIs, publishing transactions, report interactions or the existing engagement tracker. It adds one small inline bootstrap and one asynchronously loaded third-party script; that script has a real network/CPU cost. No absolute zero-performance-impact claim is made.

## Repository and response checks

`node --test tests/ga4.test.mjs` covers every current public shell and published report's actual middleware response HTML, future KO/EN publishing behavior, one async loader and one config, idempotency, existing-tag guards, URL/referrer sanitization, host/path exclusions and both response-transform integrations. These tests do not contact Google or create analytics visits. The HTMLRewriter integration test records the registered handlers; it is not a substitute for a Cloudflare browser/network check after approved deployment.

Validation on 2026-10-23 after the bundle correction: `node scripts/verify.mjs` passed all 1,397 tests, JS syntax checks, repository invariants and the SEO audit (104 advisory warnings, zero hard failures). The GA4 suite passed 9 tests, including the response HTML for 20 public shells and all 209 published reports (109 KO, 100 EN), plus a simulated future report. Actual esbuild `keepNames` output also passes isolated browser initialization with one loader/config. No Google collection requests were sent by those tests. No Production merge or deployment is authorized by running these checks or opening a PR.

## After an owner-approved Production deployment

1. Use a clean browser profile without a tracking blocker. Open a public page on `https://snowshagal.com`; in DevTools → Network, filter `gtag/js` and confirm one loader for `G-L3XBBY93CG`. Then filter `collect`, inspect the payload (including batched request bodies), and count events with `en=page_view` and `tid=G-L3XBBY93CG`: expect **one event for each full page load**, not necessarily one HTTP request overall. GA4 may send separate session/engagement events.
2. Check `/`, `/en/`, `/market/`, `/en/market/`, and one KO and EN report from each category. Use View Source/response HTML to find one `data-snowshagal-ga4` bootstrap in `<head>`; Elements will also show the one dynamically inserted async Google script.
3. Inspect the event's `dl` (page location) and `dr` (referrer): no queries, fragments or credentials; `dr` contains only a referring origin. Use harmless synthetic query values when testing, never actual personal data or secrets. No `view_search_results`, `form_start`, `form_submit`, outbound `click` or `file_download` should appear with Enhanced measurement off.
4. On HOME, change a category/year/month filter; on MARKET, switch date/range, then use Back/Forward. These actions must add **zero** pageviews. Follow a real KO/EN/category/report link; its new document must add exactly one pageview. Returning via browser back-forward cache is not a fresh document load and does not trigger an extra manual event.
5. Open GA4 → Reports → Realtime, select the correct property, and inspect active users, page titles and `page_view` events for this test session. Counts should appear within a few minutes; this PR does not claim actual GA4 receipt before an approved deployment or access to that report. For DebugView, use Google's Tag Assistant in an explicit QA session rather than leaving `debug_mode` enabled for all users.
6. After processing (allow 24–48 hours), check Reports → Acquisition → Traffic acquisition with **Session default channel group** / **Session source / medium** for `Organic Search` and referrals; use Engagement → Pages and screens for per-path traffic. A direct test visit should not be expected to appear as organic. For an organic test, follow an actual indexed result in a search engine and verify its referrer domain; do not inject a fake referrer.
7. Confirm Preview and `/admin/` make no requests to the GA4 property. Verify one subsequently auto-published report needs no manual tag edit.

Official references:

- [Configure the Google tag](https://developers.google.com/tag-platform/gtagjs/configure)
- [Pageviews and history-event duplication](https://developers.google.com/analytics/devguides/collection/ga4/views?client_type=gtag)
- [Enhanced measurement and its collected fields](https://support.google.com/analytics/answer/9216061?hl=en)
- [GA4 configuration fields](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)
- [Data redaction](https://support.google.com/analytics/answer/13544947?hl=en)
- [User-provided data collection and how to disable it](https://support.google.com/analytics/answer/14077171?hl=en)
