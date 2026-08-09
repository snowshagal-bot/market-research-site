# Market Research Site

Personal market research website for publishing standalone daily, weekly, and irregular research HTML reports.

Production: `https://market-research-site.pages.dev`

## Project documentation

Long-term development context lives in the repository rather than in chat history.

- [`AGENTS.md`](./AGENTS.md) — Codex working rules and required checks
- [`docs/index.md`](./docs/index.md) — documentation map
- [`docs/PROJECT_STATE.md`](./docs/PROJECT_STATE.md) — current architecture and implementation state
- [`docs/UI_RULES.md`](./docs/UI_RULES.md) — responsive/UI rules
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — Cloudflare/GitHub/D1 configuration
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — current next action and future priorities

## Current stack

Static HTML/CSS/JavaScript + Cloudflare Pages Functions + Cloudflare D1 for guest comments.

Before changing code, read `AGENTS.md` and the relevant files under `docs/`.
