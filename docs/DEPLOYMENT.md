# Deployment and environment

Updated: 2026-08-09

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

Production URL: `https://market-research-site.pages.dev`

Current application model:

- static repository files are served by Pages
- `functions/` contains Pages Functions
- Git pushes trigger automatic deployments
- the project does not depend on a frontend framework build

A previous working setup used a no-op build command (`exit 0`) for the static repository. If build settings are changed later, confirm the deployed root still serves `index.html`, `assets/`, `data/`, `reports/`, and Pages Functions correctly.

## Cloudflare Secrets

Configured project secrets:

### `GITHUB_TOKEN`

Fine-grained GitHub PAT used only by `functions/api/publish.js` to publish report files and metadata to the repository.

### `ADMIN_KEY`

Private admin password used by the `/admin/` publishing flow. The browser sends it to `/api/publish` in `X-Admin-Key` after the user enters it. The current admin UI stores the entered value only in browser `sessionStorage` for the session.

Do not commit either secret value.

## Cloudflare D1

Database name: `market-research-comments`

Pages binding name: `COMMENTS_DB`

The binding has been created/saved in Cloudflare as of 2026-08-09. Cloudflare indicates binding changes take effect on the next deployment, so production comment validation must happen after a new deployment.

`functions/api/comments.js` reads the database through `env.COMMENTS_DB`.

The API inspects and prepares the comments schema on first use, so a manual schema paste is not required for initial setup. If it finds an incompatible pre-release `comments` table, it preserves that table as `comments_legacy_v1` and then creates the current table and indexes. `db/schema.sql` remains the schema reference.

## Report publishing dependencies

For `/admin/` publishing to work, production needs:

- `GITHUB_TOKEN` secret
- `ADMIN_KEY` secret
- GitHub token still valid and scoped to this repository with Contents read/write permission
- Cloudflare Pages Git integration operational

The publisher writes the report HTML and both post data files in one Git tree/commit to reduce partial publication states.

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
