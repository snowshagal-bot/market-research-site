# Market Close publishing

The current Market Close payload is contract version `1.1.0`; legacy `1.0.1` payloads remain readable and publishable. The canonical contract, compatibility schema, and development fixture are stored in `contracts/market_close/`.

## Endpoints

- `POST /api/market/publish` — authenticated final-snapshot ingestion
- `GET /api/market/latest` — public latest final snapshot

The POST endpoint accepts `https://snowshagal.com` and authenticated branch Preview hosts matching `*.market-research-site.pages.dev`. The bare Pages Production hostname, unrelated Preview hosts, and localhost remain read-only. Branch Preview writes use the isolated Preview `COMMENTS_DB` binding and must never be used to infer Production data state.

When a Preview deployment has no `COMMENTS_DB` binding, the public Preview page labels and renders the checked-in example as `PREVIEW FIXTURE` after the live API attempt fails. This fallback is guarded to `*.pages.dev`, `localhost`, and `127.0.0.1`; it can never run on `snowshagal.com`.

## Automated uploader authentication

The local market-dashboard uploader sends the JSON file as the request body with:

```text
Content-Type: application/json
X-Market-Publish-Key: <the MARKET_PUBLISH_KEY Cloudflare secret>
```

`MARKET_PUBLISH_KEY` must be configured as a Cloudflare Pages secret for `market-research-site`. It must never be committed, included in a URL, exposed in public JavaScript, or reused as the admin key.

## Manual admin authentication

The manual uploader is available at `/admin/market/`. It uses the existing admin secret and sends:

```text
Content-Type: application/json
X-Admin-Key: <the existing ADMIN_KEY Cloudflare secret>
```

The browser keeps the typed admin key in session storage only. The key is never placed in the page source, a query string, or a public payload.

## Validation and storage

Before any D1 write, the server enforces the copied JSON Schema and these publishing gates:

- body size is at most 512KB;
- `meta.schema_version` is supported (`1.0.1` or `1.1.0`);
- `1.1.0` includes complete `krx_groups`; `1.0.1` may omit it;
- KRX group codes are unique per array, names are non-empty, all numeric fields are finite, every `source_date` matches `market_date`, and every source is `KRX`;
- `meta.status` is exactly `final`;
- `validation.passed` is `true` and `validation.errors` is empty;
- all final-only sections and cardinalities required by the schema are present;
- unknown contract fields and invalid field types are rejected.

The existing `COMMENTS_DB` D1 binding is reused. The API creates `market_close_snapshots` and its index with `CREATE TABLE/INDEX IF NOT EXISTS`; the equivalent SQL is also checked into `db/schema.sql`.

`market_date` is the primary key. Re-sending the same date updates that date idempotently. The latest endpoint always selects the greatest `market_date`, so publishing an older snapshot cannot roll the public page backward.

`payload_json` stores the full accepted document, including `krx_groups`, without flattening it into D1 columns. `GET /api/market/latest` parses and returns unknown/optional payload fields losslessly (apart from the separately stored editorial `takeaway` object).
