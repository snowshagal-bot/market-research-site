# Deployment and environment

Updated: 2026-08-30

## GitHub

Repository: `snowshagal-bot/market-research-site`

Main branch: `main`

Cloudflare Pages is connected directly to this repository. New commits on the production branch trigger deployment automatically.

The report publisher uses a fine-grained GitHub personal access token scoped to this repository only. The configured permissions are:

- Metadata: Read-only
- Contents: Read and write

The token was created with expiration date `2027-08-09`. Renew/replace it before expiry if the admin publisher is still in use.

Never store the token value in Git, source code, screenshots, issues, or documentation.

## Cloudflare Pages

Project name: `market-research-site`

Production URL: `https://snowshagal.com`

`www.snowshagal.com` and the former `market-research-site.pages.dev` Production address permanently redirect to the apex custom domain. Branch-specific `*.market-research-site.pages.dev` addresses remain Preview-only.

Current application model:

- static repository files are served by Pages
- `functions/` contains Pages Functions
- Git pushes trigger automatic deployments
- the project does not depend on a frontend framework build

### Prepared administrator custom domain

Phase 1A prepares `admin.snowshagal.com` on this same `market-research-site` Pages project.
It does not create or require a second Pages project. The hostname has not been attached to
Production by the code change. Until the owner performs the documented cutover and approves
a separate enforcement commit, `snowshagal.com/admin/*` remains available in Compatibility
Mode.

The same project means Production/Preview bindings and secrets remain project-environment
bindings rather than hostname-scoped resources. Browser origin isolation is enforced by
the shared hostname policy and exact Origin checks; it is not D1/secret isolation. No D1,
binding, secret, or build setting changes are part of Phase 1A. The manual custom-domain,
SSL smoke, rollback, and enforcement sequence is in `ADMIN_ORIGIN_ISOLATION.md`.

A previous working setup used a no-op build command (`exit 0`) for the static repository. If build settings are changed later, confirm the deployed root still serves `index.html`, `assets/`, `data/`, `reports/`, and Pages Functions correctly.

## Cloudflare Secrets

Configured project secrets:

### `GITHUB_TOKEN`

Fine-grained GitHub PAT used only by the authenticated publishing and post-management Functions to write report files and metadata to the repository.

### `ADMIN_KEY`

Private admin password used by `/admin/`, `/admin/manage/`, and `/admin/analytics/`. The browser sends it to the corresponding Pages Function in `X-Admin-Key` after the user enters it. The admin UI stores the entered value only in browser `sessionStorage` for the session.

### `CLOUDFLARE_ACCOUNT_ID`

Account identifier used only by the server-side analytics Function.

### `CLOUDFLARE_ANALYTICS_API_TOKEN`

Read-only API token used by `/api/analytics` to query Cloudflare GraphQL Analytics. Create a custom token with only `Account` → `Account Analytics` → `Read` for the site account. Do not reuse the Browser Rendering token or expose this value in client code.

### `CLOUDFLARE_WEB_ANALYTICS_SITE_TAG`

The Web Analytics site tag for `snowshagal.com`, used server-side to isolate the RUM dataset to this site.

Do not commit any secret or environment-variable value.

## Disclosure Monitor dependencies (Draft PR #79)

The disclosure monitor reuses the existing `COMMENTS_DB` binding. Do not create a second D1 database for this feature. Configure Preview and Production independently; the current Draft PR must be exercised in Preview first and must not be merged or scheduled automatically without owner approval.

Required for OpenDART collection:

- Secret `OPENDART_API_KEY`

Required when Gemini analysis is enabled:

- Secret `GEMINI_API_KEY`
- Env `DISCLOSURE_LLM_PROVIDER=gemini`
- Env `DISCLOSURE_LLM_MODEL=gemini-3.5-flash-lite`

Recommended source and budget env values:

- `DISCLOSURE_SOURCE_PROVIDER=opendart`
- `DISCLOSURE_CORP_CLASSES=Y,K`
- `DISCLOSURE_DART_DAILY_BUDGET=1000`
- `DISCLOSURE_DART_MAX_PAGES_PER_CLASS=10`
- `DISCLOSURE_LOOKBACK_DAYS=7`
- `DISCLOSURE_LLM_DAILY_BUDGET=24`
- `DISCLOSURE_LLM_PER_RUN=2`

Optional future scheduler credential:

- Secret `DISCLOSURE_SYNC_KEY`

Do not use `ADMIN_KEY` for a future scheduler. Scheduler activation is intentionally out of scope. In the current phase, use `/admin/disclosures/` for one manual Preview sync, verify D1 counts, duplicate-free re-sync, rule scores, at most two AI jobs, structured output, DART links and usage counters, then stop. Missing provider secrets must be reported as configuration errors; they are not a reason to place values in Git or client JavaScript.

The Gemini adapter was checked against the official API on 2026-08-30 and uses the `v1beta/interactions` endpoint with structured JSON output for stable model ID `gemini-3.5-flash-lite`. Provider pricing and free-tier policy remain external and changeable; the repository's internal budgets are deliberately lower and configurable.

## Web Analytics dependencies

`/admin/analytics/` requires `ADMIN_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ANALYTICS_API_TOKEN`, and `CLOUDFLARE_WEB_ANALYTICS_SITE_TAG` in each Cloudflare Pages environment where live analytics should be queried. Configure Preview and Production separately.

`/api/analytics` first uses GraphQL introspection to verify the current account's `rumPageloadEventsAdaptiveGroups` dataset and available dimensions, metrics, filters, and ordering fields. Every aggregate is filtered by both the configured site tag and the exact Production host `snowshagal.com`, and uses the schema-supported `requestPath_notlike: "/admin/%"` filter so Preview traffic and all `/admin/*` operator activity are excluded before aggregation. The primary trend and rankings also use Cloudflare's `excludeBots: "Yes"` filter and are labeled Bots excluded. These figures are closer to actual-user traffic, but do not mean that every automated request has been removed. One additional trend alias uses the same date/site/host/admin-path conditions without the bot filter to provide All traffic comparison totals. If a required production, admin-path, or bot filter is unavailable, the endpoint fails closed with `ANALYTICS_SCHEMA_UNSUPPORTED` rather than returning polluted statistics. The response contains only aggregated visits, page views, dates, paths, referers, countries, devices, browsers, and operating systems. It is returned with `private, no-store`; the API token, account ID, and site tag are never returned.

No rows is a normal successful response and renders an empty state. Missing configuration, unsupported schema, timeout, authentication failure, and Cloudflare query failure are separate error states and must not be converted to zero totals. Preview validation can use mocked GraphQL responses before Preview secrets are configured; the endpoint never writes Analytics data.

## Cloudflare D1

Database name: `market-research-comments`

Pages binding name: `COMMENTS_DB`

The binding has been created/saved in Cloudflare as of 2026-08-09. Cloudflare indicates binding changes take effect on the next deployment, so production comment validation must happen after a new deployment.

### Preview D1 isolation

Production and Preview must use the same binding name, `COMMENTS_DB`, but they must not
point to the same D1 database. The required topology is:

- Production `COMMENTS_DB` -> Production `market-research-comments` D1;
- Preview `COMMENTS_DB` -> an already-existing Preview-only D1 database with a different
  database ID.

Do not copy Production comments, engagement sessions, or Market Close rows into Preview.
Preview may remain empty for comments. If `/api/market/latest` must pass the deployment
smoke, seed only a clearly synthetic Market Close row based on the checked-in
`contracts/market_close/market_close.example.json`, with an operator-visible source such as
`preview-smoke-test`. Do not use a real comment as a fixture.

The schema source of truth remains `db/schema.sql`. The comments and Market Close Functions
also perform the same guarded `CREATE TABLE`/index initialization at runtime; do not create a
second migration system for Preview.

As of 2026-08-29, Preview D1 parity is complete. Preview `COMMENTS_DB` points to
`market-research-comments-preview`, while Production `COMMENTS_DB` continues to point to
`market-research-comments`; the databases are isolated and no Production data was copied.
The Preview database was initialized from `db/schema.sql` and contains `comments`,
`market_close_snapshots`, and `engagement_sessions`.

`POST /api/market/publish` is the sole mutation exception permitted on a branch Preview
hostname matching `*.market-research-site.pages.dev`. It still requires `MARKET_PUBLISH_KEY`
or `ADMIN_KEY` and writes only through the Preview `COMMENTS_DB` binding. The bare
`market-research-site.pages.dev` hostname, other Pages projects, localhost, and all existing
report/manage/engagement mutations retain their fail-closed rules. Preview E2E tests must
verify the binding is the isolated Preview database before posting a real dated fixture.

Preview contains one explicit Market Close smoke fixture only: `market_date=1900-01-01`
with `auth_source=preview-smoke-test`. It is not Production market data. On Preview deployment
`34877694`, `/api/market/latest` and comments GET both returned HTTP 200, and the shared
Preview smoke completed 20/20.

If the Preview database is recreated, repeat the isolation procedure: configure the Preview
environment's `COMMENTS_DB` binding to a Preview-only database, verify that its database ID
differs from Production without recording either ID in Git, initialize it from
`db/schema.sql`, copy no Production data, add only the explicit synthetic Market Close
fixture if the read smoke requires one, redeploy, and rerun
`node scripts/smoke-site.mjs --origin <preview-url> --mode preview`. A 503 from either
D1-backed GET endpoint is a failure, not an accepted empty state.

`functions/api/comments.js` reads the database through `env.COMMENTS_DB`.

The API inspects and prepares the comments schema on first use, so a manual schema paste is not required for initial setup. If it finds an incompatible pre-release `comments` table, it preserves that table as `comments_legacy_v1` and then creates the current table and indexes. `db/schema.sql` remains the schema reference.

### Engagement Analytics on the existing D1 binding

Engagement Analytics reuses `COMMENTS_DB`; do not create another database or change the binding name. Its tables are isolated with the `engagement_*` prefix. `POST /api/engagement` safely creates `engagement_sessions` and its `started_at`, `path + started_at`, and `country + started_at` indexes on first use, independently of the comments schema. `db/schema.sql` is the reference definition; no destructive migration or historical backfill is required.

The shared middleware injects `/assets/engagement.js` only into successful public HTML responses on the exact `snowshagal.com` hostname. Preview hosts do not load the tracker, and the write API independently rejects non-Production hostnames. `/admin/*`, `/api/*`, and `/cdn-cgi/*` are excluded. Once the feature reaches Production, the first tracked public page load initializes the table and begins collection; earlier reading-time data does not exist.

Each row represents one temporary page-load UUID and contains only path, connection-location country code, page language, server timestamps, foreground active milliseconds, and maximum scroll percentage. Country comes only from `request.cf.country` (fallback `XX`). The system does not store IP addresses, cookies, names, emails, login data, fingerprints, advertising IDs, persistent visitor IDs, or cross-site identifiers. Country is network location, not nationality.

`GET /api/engagement-stats?days=1|7|28` uses the existing `ADMIN_KEY`, reads the same D1 binding, and returns `private, no-store` aggregates to `/admin/analytics/`. No new secret or manual database action is needed when the Production `COMMENTS_DB` and `ADMIN_KEY` bindings already exist.

## Report publishing dependencies

For `/admin/` publishing to work, production needs:

- `GITHUB_TOKEN` secret
- `ADMIN_KEY` secret
- GitHub token still valid and scoped to this repository with Contents read/write permission
- Cloudflare Pages Git integration operational

The publisher writes the report HTML, optional cover image, and both post data files in one Git tree/commit to reduce partial publication states. Cover images are limited to JPG, PNG, or WebP files up to 4MB and are stored separately under `covers/`; original files under `reports/` are not modified to embed the cover.

Publishing accepts only `lang=ko|en`. Korean reports retain the existing `reports/` layout, while English reports are stored below `reports/en/`. Optional translation relationships are stored as `translationGroup` metadata in both synchronized post data files. Legacy records without `lang` remain Korean and are not bulk-rewritten.

During Phase 1A Compatibility Mode, `/api/publish` and `/api/manage` accept authenticated administrator mutations on `admin.snowshagal.com` and the legacy `snowshagal.com` path. Both require an explicit `Origin` header that exactly matches the request host's approved origin. Preview, the former Pages Production hostname, and local validation must never perform a real publish, update, or delete.

`/api/manage` uses the same secrets and repository permissions. It reads `data/posts.json` from the exact current `main` commit, creates one commit containing all requested metadata/report/cover changes, rechecks the branch ref, and updates it with `force: false`. If `main` moves during the operation, the API returns HTTP 409 and the administrator must refresh before retrying. Delete operations are limited to canonical paths under `reports/` and `covers/`.

After a successful update or delete, `/admin/manage/` polls the Production `/data/posts.json` with cache busting for up to about 90 seconds. Updates must match the API-returned post metadata and any new cover must return HTTP 200 before the UI reports deployment complete. Deletes complete only after the post ID disappears. A delayed deployment check remains a successful GitHub save and is presented as a non-error state.

Cloudflare Preview validation must not perform real `/api/manage` mutations. The management client treats branch Preview, the former Pages Production hostname, localhost, IP hosts, and unknown hosts as read-only. The API additionally restricts human-admin mutations to the approved Production hosts and exact matching origins. Use local file previews and mocked API tests on Preview.

## Search indexing

The apex custom domain is the only SEO canonical origin. Static locale pages declare their own canonical and real KO/EN alternates. Report responses receive canonical, metadata, and any real `translationGroup` alternates from the shared Pages middleware, without modifying uploaded report HTML. Canonical report URLs omit the stored `.html` suffix because Cloudflare Pages redirects those file URLs to its extensionless Clean URLs. `/sitemap.xml` is generated from `data/posts.json`; repository tests ensure every listed report path exists. `/robots.txt` permits public pages, excludes `/admin/` and `/api/`, and advertises the apex sitemap. The shared middleware also sends `X-Robots-Tag: noindex, nofollow` outside `snowshagal.com`, keeping branch Preview responses available for QA without making them index candidates.

The middleware also server-renders current report anchors into the homepage Latest/Archive containers and the ten KO/EN category landing routes. This makes discovery independent of client JavaScript while keeping `data/posts.json` as the server-side source and `data/posts.js` as the existing interactive client source. A locale category with no posts remains routable but is `noindex, follow`, excluded from sitemap and crawlable category navigation, and omitted from category `hreflang`; publishing its first post reverses that state automatically. Category canonicals use trailing slashes; report canonicals continue to use extensionless Clean URLs. If shared category metadata or chrome changes, run `node scripts/build-category-pages.mjs` and commit the regenerated landing files together.

Search Console should use a Domain property for `snowshagal.com`, verified with its Google-provided DNS TXT record. After verification, submit `sitemap.xml` and inspect the apex homepage. Do not commit a verification token or add it to application secrets.

The root `404.html` is required for Cloudflare Pages to return an actual HTTP 404 instead of using `index.html` as an SPA fallback for unknown paths. Pages Functions middleware must leave redirect and error responses unchanged apart from the existing Preview `X-Robots-Tag` header. After changing this behavior, verify both a random root path and a random `/reports/` path on Preview before Production deployment.

## Comment dependencies

For comments to work, production needs:

- `COMMENTS_DB` D1 binding pointing to `market-research-comments`
- a deployment made after the binding was saved
- Pages Functions enabled and `/api/comments` reachable

`ADMIN_KEY` is also used as part of the server-side IP-hash salt and can authorize administrative comment deletion when supplied by a trusted admin client. Guest deletion uses the user's deletion password.

## Security rules

- Never expose Secret values in frontend JavaScript.
- Never commit Secret values to this repository.
- Guest comment content must remain plain text at render time.
- Do not allow arbitrary visitor-supplied HTML uploads.
- `/admin/` can accept raw standalone HTML because publishing is an administrator-only workflow.
- If a credential is accidentally exposed, revoke/rotate it rather than merely deleting the visible copy.

## When deployment settings change

After changing a Secret, Binding, Function behavior, or Pages build setting:

1. trigger or wait for a new production deployment;
2. confirm the deployment succeeds;
3. smoke-test the affected endpoint/UI;
4. test both mobile and desktop if the change affects visible UI;
5. update `docs/ROADMAP.md` if a manual step is still pending.

## Deployment smoke layers

Repository verification and deployed-site smoke are intentionally separate:

- `node scripts/verify.mjs` is hermetic, local, and read-only. It does not contact
  Production or Preview.
- `node scripts/smoke-site.mjs --origin https://snowshagal.com --mode production` performs
  GET-only Production checks.
- `node scripts/smoke-site.mjs --origin <branch-preview-url> --mode preview` runs the same
  checks and additionally requires the existing Preview `X-Robots-Tag: noindex` policy.

The smoke engine loads current `data/posts.json` to select the latest real KO and EN report;
it does not hardcode a report URL. It verifies the two homepages, all ten locale/category
routes, latest Clean report URLs, legacy `.html` 308 redirects and destinations, a
deterministic 404, dynamic sitemap structure/current populated categories, report/home
canonicals, `/api/market/latest`, and comments GET. API numbers and comment counts are not
fixed. No POST, PUT, PATCH, or DELETE request is made.

`.github/workflows/deployment-smoke.yml` runs on `push` to `main` and may also be dispatched
manually from `main`. It does **not** smoke Production immediately after the push. The job
queries GitHub check-runs for the exact `${GITHUB_SHA}` and waits for the check named
`Cloudflare Pages` from the `cloudflare-workers-and-pages` GitHub App to complete with
`conclusion=success`. Polling is bounded to 36 attempts at five-second intervals (about
three minutes). A missing, failed, cancelled, or timed-out Cloudflare check stops the job
before Production smoke begins.

This is the repository's available deployment-completion signal: Cloudflare's GitHub App
reports that the exact main commit finished deploying and exposes its deployment ID. The
public site does not currently expose an independent commit/version marker, so the smoke
cannot prove the served HTML SHA by reading the site itself. If Cloudflare skips the build
and therefore creates no check-run, the workflow fails rather than inspecting the previous
Production and reporting PASS. Automatic rollback is deliberately out of scope.
