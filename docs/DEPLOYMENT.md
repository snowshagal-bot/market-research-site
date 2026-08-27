# Deployment and environment

Updated: 2026-08-27

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

## Web Analytics dependencies

`/admin/analytics/` requires `ADMIN_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ANALYTICS_API_TOKEN`, and `CLOUDFLARE_WEB_ANALYTICS_SITE_TAG` in each Cloudflare Pages environment where live analytics should be queried. Configure Preview and Production separately.

`/api/analytics` first uses GraphQL introspection to verify the current account's `rumPageloadEventsAdaptiveGroups` dataset and available dimensions, metrics, filters, and ordering fields. Every aggregate is filtered by both the configured site tag and the exact Production host `snowshagal.com`, and uses the schema-supported `requestPath_notlike: "/admin/%"` filter so Preview traffic and all `/admin/*` operator activity are excluded before aggregation. The primary trend and rankings also use Cloudflare's `excludeBots: "Yes"` filter and are labeled Bots excluded. These figures are closer to actual-user traffic, but do not mean that every automated request has been removed. One additional trend alias uses the same date/site/host/admin-path conditions without the bot filter to provide All traffic comparison totals. If a required production, admin-path, or bot filter is unavailable, the endpoint fails closed with `ANALYTICS_SCHEMA_UNSUPPORTED` rather than returning polluted statistics. The response contains only aggregated visits, page views, dates, paths, referers, countries, devices, browsers, and operating systems. It is returned with `private, no-store`; the API token, account ID, and site tag are never returned.

No rows is a normal successful response and renders an empty state. Missing configuration, unsupported schema, timeout, authentication failure, and Cloudflare query failure are separate error states and must not be converted to zero totals. Preview validation can use mocked GraphQL responses before Preview secrets are configured; the endpoint never writes Analytics data.

## Cloudflare D1

Database name: `market-research-comments`

Pages binding name: `COMMENTS_DB`

The binding has been created/saved in Cloudflare as of 2026-08-09. Cloudflare indicates binding changes take effect on the next deployment, so production comment validation must happen after a new deployment.

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

Both `/api/publish` and `/api/manage` reject mutation requests unless the request hostname is exactly `snowshagal.com`; Preview, the former Pages Production hostname, and local validation must never perform a real publish, update, or delete.

`/api/manage` uses the same secrets and repository permissions. It reads `data/posts.json` from the exact current `main` commit, creates one commit containing all requested metadata/report/cover changes, rechecks the branch ref, and updates it with `force: false`. If `main` moves during the operation, the API returns HTTP 409 and the administrator must refresh before retrying. Delete operations are limited to canonical paths under `reports/` and `covers/`.

After a successful update or delete, `/admin/manage/` polls the Production `/data/posts.json` with cache busting for up to about 90 seconds. Updates must match the API-returned post metadata and any new cover must return HTTP 200 before the UI reports deployment complete. Deletes complete only after the post ID disappears. A delayed deployment check remains a successful GitHub save and is presented as a non-error state.

Cloudflare Preview validation must not perform real `/api/manage` mutations. Both the management client and `/api/manage` enforce read-only behavior outside the exact production hostname `snowshagal.com`; Preview, the former Pages Production hostname, localhost, IP hosts, and other hostnames receive HTTP 403 `PREVIEW_READ_ONLY` before GitHub access. Use local file previews and mocked API tests there.

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
