# Reference Services

**Role:** compact service lookup for agent work  
**Audience:** implementers needing integration context without opening all service dossiers  
**When to read:** only when a task touches a specific provider or service  
**Authority:** reference-only; core truth lives in `01-core/*`

## Service Summary

| Service | Product role | Use often for |
| --- | --- | --- |
| Gmail | one-to-one email history and live one-to-one transport | Inbox, email replies, historical email import |
| Salesforce | identity anchor, memberships, journey context, outbound communication metadata | identity, routing, project context, lifecycle events |
| SimpleTexting | one-to-one SMS/MMS history and live SMS/MMS transport | Inbox SMS, compliance events |
| Mailchimp | historical and transition-period campaign email ingest | transition-period Campaigns data |
| Notion | AI instructions and approved knowledge source | AI knowledge sync/cache |
| OpenAI | request-time draft generation | AI assistant |
| SendGrid | Campaigns Email delivery provider | Email Campaigns transport |
| Supabase/Postgres | durable persistence | canonical state, projections, replay, audit |

## Frequent Reminders

- Gmail stays the one-to-one email transport after cutover.
- Salesforce Contact ID is the primary identity anchor.
- Mailchimp remains transition ingest scope, not the future authoring UX.
- SendGrid delivers Email Campaigns but is not the authoring source of truth.

## Notion

- Purpose: source of truth for Stage 4 tiers 1-3 knowledge. The worker polls one General Training page plus the Project Training database and caches page bodies into `ai_knowledge_entries`.
- Cron cadence: every 15 minutes via the `notion-knowledge-sync` Graphile Worker cron.
- Env vars: `NOTION_API_KEY`, `NOTION_GENERAL_TRAINING_PAGE_ID`, `NOTION_PROJECT_TRAINING_DATABASE_ID`.
- Failure modes:
  missing env writes `integration_health.notion = not_configured` and the worker no-ops.
  auth / permissions / missing page or database access writes `integration_health.notion = needs_attention`.
  partial mid-sync failures keep already-committed rows, skip reconcile for that cycle, and surface `needs_attention` until a later successful poll.

## Deep References

- full service dossiers live in [`../../restart-prd`](../../restart-prd)
- especially useful donor docs:
  - `service-gmail.md`
  - `service-salesforce.md`
  - `service-simpletexting.md`
  - `service-mailchimp.md`
  - `service-notion.md`
  - `service-sendgrid.md`
