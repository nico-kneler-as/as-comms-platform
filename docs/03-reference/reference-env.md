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

## Stage 4 AI Drafting

| Env var | Runtime | Required | Notes |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | `web` | yes | Anthropic API key for Stage 4 draft generation. Missing config downgrades requests into `deterministic_fallback` with `provider_not_configured`. |
| `AI_DAILY_CAP_USD` | `web` | no | Soft daily spend cap for AI drafts. Default `20`. Over-budget emits `budget_warn`; it does not hard-block drafting. |
| `ANTHROPIC_MODEL` | `web` | no | Default draft model. Current default is `claude-sonnet-4-6`. |

## Deep References

- full donor lookup: [`../../restart-prd/env-and-secrets-matrix.md`](../../restart-prd/env-and-secrets-matrix.md)
- security model: [`../01-core/system-core.md`](../01-core/system-core.md)
