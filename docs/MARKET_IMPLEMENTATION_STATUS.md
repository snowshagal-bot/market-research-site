# Market Close implementation status

Updated: 2026-08-25
Branch: `feature/market-close`
Contract: `1.0.1`

## DONE

- Created an isolated feature branch from the latest `origin/main`.
- Read the approved Market Close request, data contract, JSON Schema, example payload, and design reference.

## TODO

- Checkpoint 1: copy the contract files and build the static KO/EN Market UI, navigation, responsive layout, and dark mode.
- Checkpoint 2: add D1-backed publish/latest APIs, validation, authentication, and the manual admin uploader.
- Checkpoint 3: connect the public page to the API, add loading/empty/error states and SEO, run regressions, and validate the Cloudflare Preview.

## 현재 동작 상태

- Production and `main` are unchanged.
- No Market routes or APIs exist yet.

## 다음 작업 위치

- Start Checkpoint 1 from the shared public navigation and the new `/market/` and `/en/market/` page shells.

## 주의사항

- `schema_version`, field names, types, units, and meanings are fixed by contract v1.0.1 and must not be changed by the website.
- The example JSON is a development/Preview fixture only and must never become a Production fallback.
- Do not modify the local market-dashboard program in this branch.
