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

## Ops Alert Notifications

Single ops-alert sender in the worker emails the architect when first-party failures fire (`D-047`). Transport is Gmail via the volunteers@ OAuth — the same creds the integration-health alerter has used since `D-038`. All defaults are safe, so the foundation ships without any Railway-side action; configure these only when overriding behavior.

| Env var | Runtime | Required | Notes |
| --- | --- | --- | --- |
| `OPS_ALERT_RECIPIENT` | `worker` | no | Default `nico@adventurescientists.org`. Flip to `operations@adventurescientists.org` (or any team alias) on the worker Railway service when the operator team grows past one — no code change. Applies to every alert category except `integration_health`, which honors `INTEGRATION_HEALTH_ALERT_RECIPIENT` first. |
| `OPS_ALERT_FROM_ALIAS` | `worker` | no | Default `volunteers@adventurescientists.org`. Must be a configured Gmail Send-As alias on the live OAuth account. Reuses the same OAuth as composer sends and integration-health alerts — no separate mailbox. |
| `OPS_ALERT_DEFAULT_COOLDOWN_MS` | `worker` | no | Default `3600000` (1 hour, matches `D-038`). Per-`(category, dedup_key)` throttle window; the sender skips with `kind: "skipped_cooldown"` rather than re-sending inside the window. |
| `OPS_ALERT_COOLDOWN_MS__<CATEGORY_UPPER>` | `worker` | no | Optional per-category override. Example: `OPS_ALERT_COOLDOWN_MS__POSTMARK_WEBHOOK_DEADLETTER=86400000` for a slow-signal category. Category is upper-cased and joined with `__` (double underscore). |
| `INTEGRATION_HEALTH_ALERT_RECIPIENT` | `worker` | no | Legacy from `D-038`. Still honored and takes precedence over `OPS_ALERT_RECIPIENT` for the `integration_health` category only. Default falls through to `OPS_ALERT_RECIPIENT`, then to the hard default. |
| `INTEGRATION_HEALTH_ALERT_FROM_ALIAS` | `worker` | no | Legacy from `D-038`. Category-scoped override for `integration_health`; falls through to `OPS_ALERT_FROM_ALIAS`. |
| `INTEGRATION_HEALTH_ALERT_SETTINGS_URL` | `worker` | no | Legacy from `D-038`. Explicit deep-link URL into Settings → Integrations rendered in the alert body; falls back to `NEXT_PUBLIC_APP_URL` / `APP_BASE_URL` / `WEB_BASE_URL` / `INBOX_REVALIDATE_BASE_URL` + `/settings/integrations`. |

Underlying Gmail OAuth credentials live under their own env family — `GMAIL_LIVE_ACCOUNT`, `GMAIL_GOOGLE_OAUTH_CLIENT_ID`, `GMAIL_GOOGLE_OAUTH_CLIENT_SECRET`, `GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN`, optional `GMAIL_GOOGLE_TOKEN_URI`, optional `GMAIL_SEND_TIMEOUT_MS`. The ops-alert sender reads them at construction time; missing creds return `kind: "auth_error"` without throwing, so a misconfig cannot crash the worker.

## Deep References

- full donor lookup: [env-and-secrets-matrix.md](../../restart-prd/env-and-secrets-matrix.md)
- security model: [system-core.md](../01-core/system-core.md)
