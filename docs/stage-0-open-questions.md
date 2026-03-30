# Stage 0 Open Questions

These are intentionally deferred and should be resolved in their proper stage rather than inside bootstrap.

## Stage 1

- Which canonical business tables and migrations are required first
- How repository interfaces in `packages/domain` should be implemented in `packages/db`
- Which durable sync/parity/backfill state tables are needed first

## Stage 2

- Which auth provider and session model should back Admin and Agent access
- How admin actions will be persisted as auditable events
- Which settings surfaces ship before Inbox becomes production-ready

## Stage 3 and later

- Inbox and timeline read models
- internal note semantics
- provider ingest and webhook topology for Gmail, Salesforce, SimpleTexting, and Mailchimp
- replay, projection, parity, and cutover workflows
- AI durable state and campaign authoring flows
