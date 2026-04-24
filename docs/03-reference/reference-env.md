# Reference Env

**Role:** compact runtime and secret lookup guide  
**Audience:** implementers touching deployment, auth, providers, or secret wiring  
**When to read:** only when environment or deployment details matter  
**Authority:** reference-only; core truth lives in `01-core/engineering-core.md` and `01-core/system-core.md`

## Summary

- Deployment hosting is operational context, not product architecture.
- Secrets stay backend-only.
- Runtime headers, CSP, and edge protections may live outside app code and require runtime confirmation.

## High-Risk Secret Families

- Google auth/session secrets
- provider API credentials
- webhook verification secrets
- database and service-role credentials
- Anthropic credentials

## Runtime Rules

- no secrets in browser code, docs, fixtures, or examples
- environment values exposed to the browser must be intentionally non-secret
- runtime-specific security headers still need explicit verification even if the hosting edge provides defaults

## Stage 4 Notion Sync

| Env var | Runtime | Required | Notes |
| --- | --- | --- | --- |
| `NOTION_API_KEY` | `worker` | yes | Internal Notion integration token. Keep backend-only. |
| `NOTION_GENERAL_TRAINING_PAGE_ID` | `worker` | yes | Default local/example value: `3278a9129211804baa72c76a86d084d0`. Read at worker startup; missing config surfaces `integration_health.notion = not_configured`. |
| `NOTION_PROJECT_TRAINING_DATABASE_ID` | `worker` | yes | Default local/example value: `3278a91292118095b86aff5836821428`. Read at worker startup; missing config surfaces `integration_health.notion = not_configured`. |

The worker cron is the only current consumer. The web service may carry the same env values in shared deployment config, but it does not call Notion directly in this brief.

The one-time `migrate-notion-child-dbs-to-project-knowledge` ops script reuses
`NOTION_API_KEY` and `NOTION_PROJECT_TRAINING_DATABASE_ID`. It also requires
`DATABASE_URL` or `WORKER_DATABASE_URL` and accepts `--slug-map <file.json>` for
mapping Notion project slugs to Salesforce project ids.

## Stage 4 AI Drafting And Bootstrap

| Env var | Runtime | Required | Notes |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | `web`, `worker` | yes | Anthropic API key for Stage 4 draft generation and the `bootstrap-project-knowledge` synthesis job. Missing web config downgrades draft requests into `deterministic_fallback` with `provider_not_configured`; missing worker config marks bootstrap runs as `error`. |
| `AI_DAILY_CAP_USD` | `web`, `worker` | no | Soft daily spend cap for AI drafts and bootstrap synthesis. Default `20`. Over-budget emits `budget_warn`; it does not hard-block drafting or bootstrap runs. |
| `ANTHROPIC_MODEL` | `web`, `worker` | no | Default draft and bootstrap synthesis model. Current default is `claude-sonnet-4-6`. |

The bootstrap worker fetches configured project source links, extracts readable HTML
with `@mozilla/readability` + `jsdom`, optionally digests bounded Gmail alias
history, and writes unapproved `bootstrap_synthesized` candidates for admin
review in Settings.

## Deep References

- full donor lookup: [`../../restart-prd/env-and-secrets-matrix.md`](../../restart-prd/env-and-secrets-matrix.md)
- security model: [`../01-core/system-core.md`](../01-core/system-core.md)
