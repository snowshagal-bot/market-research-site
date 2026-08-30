# Disclosure Monitor

Updated: 2026-08-30

## Purpose

`/admin/disclosures/` is an administrator-only Korean equity disclosure monitor. It collects listed-company disclosure metadata, applies a deterministic rule engine first, stores the result in the existing D1 binding, and sends only selected material filings to an LLM for a conservative first-pass classification.

The design goal is not to reproduce DART. It is to reduce the amount of disclosure noise an editor must inspect while keeping upstream API consumption bounded and replaceable.

## Current flow

1. `POST /api/disclosures/sync` authenticates with `ADMIN_KEY` or optional `DISCLOSURE_SYNC_KEY`.
2. `functions/api/disclosures/_source.js` calls the configured disclosure source. V1 implements `opendart`.
3. The source adapter returns normalized filing metadata; the rest of the application does not depend on OpenDART field names.
4. `functions/api/disclosures/_shared.js` assigns a deterministic materiality score and reasons.
5. All normalized filings are UPSERTed into `disclosure_filings` in `COMMENTS_DB`.
6. Only filings with `ai_eligible=1` enter the AI queue. The sync processes at most `DISCLOSURE_LLM_PER_RUN` items.
7. `functions/api/disclosures/_llm.js` calls the configured LLM adapter and stores structured JSON beside the filing.
8. `/admin/disclosures/` reads stored results through the authenticated `GET /api/disclosures/latest` endpoint. A single stored filing can be re-analyzed through `POST /api/disclosures/analyze`.

Every filing is keyed by OpenDART `rcept_no`. The insert path uses `ON CONFLICT DO NOTHING` followed by a metadata-only update for an existing key, so concurrent syncs cannot create duplicate rows and an already completed AI result is not silently requeued.

The public website does not call OpenDART or an LLM when a reader loads a page. API consumption occurs only during an authenticated sync or explicit administrator re-analysis.

## Free-tier guardrails

Provider quotas change independently of this repository. The application therefore uses its own limits below the provider quota instead of trying to consume the full advertised allowance.

Default internal limits:

- OpenDART upstream requests: `1000` per Korea date;
- Total AI analysis jobs: `12` per Korea date;
- Auto AI analysis jobs: `4` per Korea date;
- Auto AI score floor: `10` (Critical priority);
- AI jobs performed by one sync: `2`;
- OpenDART pages per corporation class per sync: `10`, at `100` rows per page;
- default corporation classes: `Y,K` (KOSPI and KOSDAQ);
- default lookback window: `1` day (today only for automated runs; expandable up to 30 for backfill).

Every upstream OpenDART request reserves one source request before calling the provider. Every AI analysis job reserves one AI request before calling the provider. The reservation is one conditional D1 `UPSERT ... RETURNING` statement, not a `SELECT` followed by an increment, so simultaneous requests cannot all pass the same stale quota check. Usage is stored in `disclosure_usage_daily`, and repeated clicks cannot bypass the app-side daily ceiling.

AI queue rows are atomically claimed by changing `ai_status` from `available` to `processing`. A second sync or repeated analyze click cannot claim the same live row. A claim older than ten minutes is considered abandoned and may be recovered on a later run; provider/configuration exhaustion releases the row back to `available`, while a real provider/output failure leaves it `error` for later retry. Past lookback filings or non-critical eligible filings remain `available` without creating an automatic processing backlog.

These are safety budgets, not statements of OpenDART or Gemini's contractual quota. They may be lowered without code changes.

## Rule engine

The rule engine is intentionally deterministic and runs before AI. Current high-value groups include:

- listing/audit/default/legal survival risk (10 pts);
- controlling shareholder, merger, split and business-transfer changes (8 pts);
- rights issues, capital reduction, CB/BW/EB and treasury-stock actions (7 pts);
- material supply contracts, investments and asset transfers (7 pts);
- earnings changes (6 pts);
- litigation, guarantees, collateral and production suspension (6 pts);
- major event reports (5 pts generic fallback if no specific rule matches) and shareholder returns (4 pts);
- management changes (3 pts) and investment guidance disclosures (2 pts).

Specific event rules take precedence so generic major event report points (+5) are not double-counted. Routine periodic and procedural filings are down-weighted unless another material rule matches. Withdrawn filings are not sent to AI.

`score >= 5` is currently AI-eligible (`ai_status = 'available'`). Automatic AI during sync selects only today's Critical filings (`score >= 10`). The score is a triage device, not investment advice or a prediction of share-price direction.

## AI safety boundary

V1 gives the LLM only disclosure-list metadata: company, stock code, disclosure title, filer, receipt date, remarks and deterministic rule reasons. It does not pretend that this metadata is the filing body.

The prompt explicitly prohibits inventing amounts, counterparties, contract periods, earnings figures or other facts absent from the metadata. Local output validation also rejects a generated numeric token in the headline, summary or watch points unless that token appears in the supplied metadata. Required text, enums, integer confidence bounds and watch-point shape are validated again after JSON parsing. The saved result contains a headline, short summary, impact label, urgency, confidence, watch points and a limitation notice. The DART original link remains the source of truth.

A future phase can add type-specific OpenDART detail endpoints before AI analysis. That should be a separate adapter/data-contract change, not a prompt-only change.

## Secrets and configuration

Never commit values. Configure them as Cloudflare Pages secrets/environment variables separately for Production and Preview as appropriate.

Required for source sync:

- `OPENDART_API_KEY`

Gemini primary configuration:

- `GEMINI_API_KEY`
- `DISCLOSURE_LLM_PROVIDER=gemini`
- `DISCLOSURE_LLM_MODEL=gemini-3.5-flash-lite`

The model ID and integration were rechecked against Google's official Gemini documentation on 2026-08-30. `gemini-3.5-flash-lite` is the recommended successor stable model ID that supports structured output. The adapter uses `POST https://generativelanguage.googleapis.com/v1beta/interactions` with top-level `response_format` (`application/json` plus JSON Schema), `generation_config`, and `store=false`. Google's published free-tier availability can change and is not treated as the application's quota; Snowshagal's smaller internal budgets remain authoritative.

Optional scheduler credential:

- `DISCLOSURE_SYNC_KEY`

Optional source controls:

- `DISCLOSURE_SOURCE_PROVIDER=opendart`
- `DISCLOSURE_CORP_CLASSES=Y,K`
- `DISCLOSURE_DART_DAILY_BUDGET=1000`
- `DISCLOSURE_DART_MAX_PAGES_PER_CLASS=10`
- `DISCLOSURE_LOOKBACK_DAYS=1`

Optional LLM controls:

- `DISCLOSURE_LLM_DAILY_BUDGET=12`
- `DISCLOSURE_LLM_AUTO_DAILY_BUDGET=4`
- `DISCLOSURE_LLM_AUTO_SCORE_FLOOR=10`
- `DISCLOSURE_LLM_PER_RUN=2`

If `DISCLOSURE_LLM_PROVIDER` is omitted but `GEMINI_API_KEY` exists, Gemini is selected automatically. If no LLM is configured, source sync and deterministic scoring still work; AI queue items remain available.

## Replacing the LLM provider

The caller imports only `analyzeWithLlm()`. Provider-specific HTTP formats live in `_llm.js`.

V1 includes an OpenAI-compatible adapter. To replace Gemini without changing the UI, sync pipeline, D1 schema or rule engine, configure:

- `DISCLOSURE_LLM_PROVIDER=openai-compatible`
- `DISCLOSURE_LLM_BASE_URL=https://provider.example/v1`
- `DISCLOSURE_LLM_API_KEY=...`
- `DISCLOSURE_LLM_MODEL=<provider-model>`

A fallback can be configured while retaining Gemini as primary:

- `DISCLOSURE_LLM_FALLBACK_PROVIDER=openai-compatible`
- `DISCLOSURE_LLM_FALLBACK_MODEL=<provider-model>`

The fallback is attempted only for retryable upstream failures such as rate limiting, server errors, timeouts or malformed structured output. Authentication/configuration failures do not fall through to another provider and hide the real setup problem. Upstream errors are sanitized before they can reach the API response; provider authentication values and full upstream URLs never reach the browser.

For a provider that is not OpenAI-compatible, add one provider function in `_llm.js`, normalize its response to the existing analysis contract, and route it through `callProvider()`. No downstream code should change.

## Replacing the disclosure source

The caller imports only `fetchDisclosureSource()`. OpenDART-specific URL and response parsing live in `_source.js`.

To add KIND or another source later:

1. implement a provider adapter in `_source.js`;
2. return the same normalized filing objects;
3. select it with `DISCLOSURE_SOURCE_PROVIDER`;
4. give the new provider its own app-side usage counter/budget.

The rule engine, database, UI and LLM adapters should remain unchanged.

## D1 tables

The feature reuses `COMMENTS_DB` and does not require another D1 binding.

- `disclosure_filings` — normalized filing, deterministic score and optional AI result;
- `disclosure_usage_daily` — app-side source/LLM request and token counters;
- `disclosure_state` — last sync metadata.

`db/schema.sql` is the reference definition. The Pages Functions also perform guarded `CREATE TABLE IF NOT EXISTS` initialization on first use, matching the project's existing lightweight D1 convention.

## Operations

Initial Production activation:

1. add `OPENDART_API_KEY` and `GEMINI_API_KEY` to Cloudflare Pages Production secrets;
2. set the optional budget/provider environment variables if defaults are not desired;
3. deploy the branch/PR;
4. open `/admin/disclosures/` and authenticate with the existing administrator key;
5. run one manual OpenDART sync;
6. verify source counts, D1 usage counters, rule classifications, AI budget and DART original links before enabling any scheduler.

Do not schedule automatic sync until a successful manual Production run has been inspected. The endpoint already supports a separate `DISCLOSURE_SYNC_KEY`, so a future scheduler can be added without exposing `ADMIN_KEY`.

For the current Draft PR, configure and test Preview first with Preview-scoped `OPENDART_API_KEY` and `GEMINI_API_KEY` values. Preview must continue using the isolated Preview `COMMENTS_DB`. Do not copy Production disclosure rows into Preview, do not enable a scheduler, and do not merge to `main` until the manual source/AI results and usage counters have been reviewed.

## Failure behavior

- OpenDART or AI quota/rate limit: fail visibly; never fabricate an empty successful result.
- AI unavailable: keep deterministic disclosure collection working and leave AI items pending.
- AI malformed JSON: mark that filing's AI attempt as an error; retain the filing and DART link.
- page cap reached: return `truncated=true`; do not pretend the source window is complete.
- missing secrets: return a configuration error without exposing secret values.

This feature remains administrator-only until its data quality and operating cost are observed in Production.
