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

## Deep References

- full service dossiers live in [`../../restart-prd`](../../restart-prd)
- especially useful donor docs:
  - `service-gmail.md`
  - `service-salesforce.md`
  - `service-simpletexting.md`
  - `service-mailchimp.md`
  - `service-notion.md`
  - `service-sendgrid.md`
