# Admin origin isolation

Updated: 2026-08-31

## Phase 1A status

Phase 1A prepares the existing Cloudflare Pages project for a future administrator custom
domain without creating accounts, sessions, cookies, a new D1 database, a new secret, a
second Pages project, or a Worker service. `ADMIN_KEY`, `MARKET_PUBLISH_KEY`, and
`DISCLOSURE_SYNC_KEY` retain their existing roles.

The runtime policy is deliberately in **Compatibility Mode**:

- `https://snowshagal.com/admin/*` remains available;
- human-admin mutations from the apex remain available with the existing `ADMIN_KEY` and
  an exact apex `Origin`;
- `https://admin.snowshagal.com/admin/*` and the human-admin API surface are prepared;
- the Production custom domain is not connected by this code change;
- apex redirects and apex human-admin API denial are not active.

The central policy is `functions/_host-policy.js`. The cutover enforcement change is kept
behind the single `ADMIN_APEX_COMPATIBILITY` policy value and requires a separate approved
commit after the custom domain smoke passes.

## Host policy

| Host class | Host | Phase 1A result |
| --- | --- | --- |
| `PUBLIC_PRODUCTION` | `snowshagal.com` | Public site and reports allowed; apex admin retained temporarily |
| `PUBLIC_REDIRECT` | `www.snowshagal.com`, `market-research-site.pages.dev` | Existing Cloudflare redirect policy; never accepted as a human-admin mutation host |
| `ADMIN_PRODUCTION` | `admin.snowshagal.com` | Explicit admin UI/static/data/API allowlist only |
| `PREVIEW` | `<branch-or-hash>.market-research-site.pages.dev` | Preview origin; exact request origin required for human-admin mutations that are enabled in Preview |
| `UNKNOWN` | Everything else | Not a human-admin host; admin-host policy fails closed |

### Admin hostname surface

Allowed:

- `/admin/*`;
- administrator CSS/JavaScript and the two Market Close presentation images;
- `/assets/brand/*` images used by the admin/Market UI;
- `data/posts.js`, `data/posts.json`, and `data/tags.js`;
- image files under `/covers/` needed by the existing-post editor;
- the Market Close JSON Schema;
- human-admin APIs and the public Market/disclosure reads actually used by admin pages;
- favicon/manifest files requested by browsers.

Denied with 404 before Pages static fallback:

- `/reports/*` and `/reports/en/*`;
- `/en/reports/*` aliases or mistakes;
- `/`, `/en/`, `/about/`, `/market/`, and other public active HTML;
- public scripts and data not required by admin UI;
- unlisted APIs and static files.

Public exits from admin pages use absolute `https://snowshagal.com/...` URLs. Internal
administrator navigation stays relative under `/admin/*` so it remains on the administrator
origin.

## API classification

| API | Methods | Class | Host/origin policy |
| --- | --- | --- | --- |
| `/api/publish` | POST | `HUMAN_ADMIN` | Admin host or temporary apex; exact Origin; Preview remains read-only |
| `/api/manage` | POST | `HUMAN_ADMIN` | Admin host or temporary apex; exact Origin; Preview remains read-only |
| `/api/analytics` | GET | `HUMAN_ADMIN` | Admin host, temporary apex, or branch Preview; `ADMIN_KEY` |
| `/api/generate-cover` | POST | `HUMAN_ADMIN` | Admin host, temporary apex, or exact branch Preview origin; `ADMIN_KEY` |
| `/api/engagement-stats` | GET | `HUMAN_ADMIN` | Admin host, temporary apex, or branch Preview; `ADMIN_KEY` |
| `/api/disclosures/latest` | GET | `HUMAN_ADMIN` | Admin host, temporary apex, or branch Preview; `ADMIN_KEY` |
| `/api/disclosures/analyze` | POST | `HUMAN_ADMIN` | Same host policy plus exact Origin; `ADMIN_KEY` |
| `/api/disclosures/publish` | POST | `HUMAN_ADMIN` | Same host policy plus exact Origin; `ADMIN_KEY` |
| `/api/disclosures/watchlist` | GET/POST | `HUMAN_ADMIN` | GET host-gated; POST also exact Origin; `ADMIN_KEY` |
| `/api/disclosures/sync` | POST | `HYBRID` | Browser `ADMIN_KEY` requires human-admin host/origin; `DISCLOSURE_SYNC_KEY` machine flow is unchanged |
| `/api/market/publish` | POST | `HYBRID` | Browser `ADMIN_KEY` requires exact host/origin; `MARKET_PUBLISH_KEY` machine/Preview flow is unchanged |
| `/api/comments` | GET/POST/DELETE | `PUBLIC` + `HYBRID_LEGACY` | Public guest flow remains same-origin; admin-key DELETE uses the common human-admin host/exact-Origin policy and is the only comments operation admitted on admin host |
| `/api/engagement` | POST | `PUBLIC` | Exact apex-only collection policy unchanged; blocked on admin host |
| `/api/market/latest` | GET | `PUBLIC` | Public read; also admitted as admin UI metadata |
| `/api/market/date` | GET | `PUBLIC` | Public read; also admitted for admin Market renderer |
| `/api/market/dates` | GET | `PUBLIC` | Public read; also admitted for admin Market renderer |
| `/api/market/range` | GET | `PUBLIC` | Public read; also admitted for admin Market renderer |
| `/api/disclosures/feed` | GET | `PUBLIC` | Public read; also admitted for admin Market renderer |

`HYBRID` endpoints make their policy decision after authenticating the credential source.
This prevents an `ADMIN_KEY` browser request from bypassing Origin validation by merely
adding a bogus machine-key header, while retaining legitimate machine calls without a
browser `Origin` header.

## Origin and CORS policy

Human-admin `POST`, `PUT`, `PATCH`, and `DELETE` requests require an `Origin` header that
equals the origin implied by the accepted request host:

- admin Production: `https://admin.snowshagal.com`;
- temporary apex Compatibility: `https://snowshagal.com`;
- branch Preview: that exact branch/hash Preview origin.

Missing Origin and mismatched Origin fail closed. No administrator endpoint adds wildcard
CORS, apex-to-admin credentialed CORS, or `Access-Control-Allow-Credentials`. The intended
browser topology is same-origin admin UI + API.

## Administrator response headers

Successful `admin.snowshagal.com/admin/*` HTML receives:

- `Cache-Control: private, no-store, max-age=0`;
- `X-Robots-Tag: noindex, nofollow`;
- `X-Content-Type-Options: nosniff`;
- an administrator-only CSP covering `default-src`, `script-src`, `style-src`,
  `connect-src`, `img-src`, `font-src`, `frame-src`, `manifest-src`, `form-action`,
  `base-uri`, `object-src`, and `frame-ancestors`.

The existing admin HTML contains inline theme/bootstrap scripts and inline styles, so the
Phase 1A policy retains `'unsafe-inline'` for scripts/styles. Network connections remain
`'self'` only, frames remain sandboxed, and report HTML is not admitted to the admin host.
All other allowed responses on the admin host also receive no-store/noindex/nosniff.

## Preview validation

Cloudflare Pages branch and hash Preview URLs remain
`<alias>.market-research-site.pages.dev`. They do not pretend to be
`admin.snowshagal.com` and cannot validate its DNS or certificate.

Preview verification consists of:

1. repository host-matrix tests using real Request URLs for both Production hostnames;
2. Preview UI/static loading on the branch alias;
3. exact Preview-origin checks for enabled human-admin APIs;
4. retaining publish/manage client and server read-only behavior on Preview;
5. confirming existing Preview-only Market writes and machine credentials are unchanged;
6. the standard GET-only Preview smoke with Preview `COMMENTS_DB`.

Do not attach `admin.snowshagal.com` to a Preview branch for this phase.

## Cloudflare Production cutover procedure

This is a manual future operation. It must not be performed from the Phase 1A Preview PR.

1. Merge the reviewed Compatibility implementation only after explicit owner approval and
   wait for its exact `main` SHA to complete the existing `Cloudflare Pages` production
   check.
2. Confirm `https://snowshagal.com/admin/` still works before changing DNS or domains.
3. In Cloudflare Dashboard, open **Workers & Pages → `market-research-site` → Custom
   domains → Set up a domain**.
4. Enter `admin.snowshagal.com` and complete the Pages association. The Cloudflare custom
   domain must be associated in the Pages UI; creating only a manual CNAME is insufficient.
5. Because `snowshagal.com` is already a Cloudflare-managed zone, confirm that the `admin`
   CNAME is created/managed and proxied as shown by the Pages setup. If DNS is external,
   use `admin CNAME market-research-site.pages.dev` only after the Pages association step.
6. Wait for the custom domain status to become Active and for HTTPS to return a valid
   certificate for `admin.snowshagal.com`. Do not accept a certificate warning, 522, or a
   redirect to an unrelated hostname.
7. No separate Pages project, build, D1 binding, secret, or code redeploy is required merely
   to attach the domain: it serves the current Production deployment. Binding changes would
   require a new deployment, but this phase makes none.
8. Run the read-only cutover smoke below. Then have the owner verify the existing
   `ADMIN_KEY` workflow from the admin hostname. Never print the key.
9. Keep apex Compatibility Mode enabled until every smoke passes.
10. After explicit owner approval, create a small separate enforcement PR that changes the
    central compatibility policy: apex `GET/HEAD /admin/*` becomes a 307 equivalent-path
    redirect, while apex human-admin mutations return 403 and are never redirected.

Official references:

- Cloudflare Pages custom domains: https://developers.cloudflare.com/pages/configuration/custom-domains/
- Cloudflare Pages Preview deployments: https://developers.cloudflare.com/pages/configuration/preview-deployments/
- Cloudflare Pages Functions bindings: https://developers.cloudflare.com/pages/functions/bindings/

### Cutover smoke

Expected read-only checks:

| URL | Expected |
| --- | --- |
| `https://admin.snowshagal.com/admin/` | 200, no-store, noindex, admin CSP |
| `https://admin.snowshagal.com/admin/manage/` | 200 and required assets/data load |
| `https://admin.snowshagal.com/admin/analytics/` | 200 |
| `https://admin.snowshagal.com/admin/disclosures/` | 200 |
| `https://admin.snowshagal.com/admin/market/` | 200 |
| `https://admin.snowshagal.com/reports/test` | 404 before report execution |
| `https://admin.snowshagal.com/` | 404 |
| `https://admin.snowshagal.com/about/` | 404 |
| `https://snowshagal.com/` | existing public response |
| `https://snowshagal.com/reports/<current-report>` | existing report response |
| `https://snowshagal.com/admin/` | still 200 during Compatibility Mode |

Also verify through the UI, without exposing the key:

- Analytics and Engagement aggregate reads authenticate with `ADMIN_KEY`;
- disclosure latest/watchlist reads authenticate;
- Market latest data loads;
- publish/manage/Market/disclosure mutations show no CORS or Origin error when initiated
  from the admin hostname. Any mutation that writes GitHub or D1 requires an explicit,
  separately approved test fixture and is not part of the default read-only smoke.

### Rollback

Before enforcement, rollback is configuration-only:

1. keep using `https://snowshagal.com/admin/`;
2. remove `admin.snowshagal.com` from the Pages project's Custom domains screen;
3. remove the corresponding `admin` DNS record if Cloudflare does not remove it;
4. confirm the apex admin and public site still work.

If enforcement has already been enabled, revert/disable the enforcement commit first,
deploy and verify apex Compatibility, and only then detach the custom domain. Do not leave a
redirect pointing to a detached hostname.

## Remaining work

Phase 1A Enforcement, after domain smoke and owner approval:

- enable apex admin GET/HEAD redirect;
- deny apex human-admin mutations without redirect;
- extend Production deployment smoke to the admin hostname.

Phase 1B Authentication, separately:

- authentication data model and D1 decision;
- users/sessions/password/passkey work;
- host-only secure cookie and CSRF token design;
- removal of browser-entered `ADMIN_KEY` only after the replacement is proven.
