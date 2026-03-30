# System Core

**Role:** high-level architecture and trust-boundary canon  
**Audience:** implementers touching runtime shape or integrations  
**When to read:** before architecture, backend, Inbox, AI, Campaigns, or cutover work  
**Authority:** authoritative for layer model, truth precedence, cutover, trust boundaries  
**Decides:** where truth lives, how layers relate, what boundaries are critical  
**Does not decide:** table names, exact APIs, detailed provider mapping fields

## Summary

- Canonical data comes before operator UX.
- Provider payloads never become the direct product model.
- Projections power the operator surfaces, but canonical state remains the durable truth.
- The restart architecture supports hybrid cutover with explicit approval or rollback.

## Layer Model

| Layer | Purpose | Rule |
| --- | --- | --- |
| Provider ingest | historical fetch, webhook ingest, bounded sync | adapters stay source-close |
| Canonical event + identity | normalized durable truth | ambiguous identity goes to review |
| Projection layer | product-ready read models | rebuildable from canonical state |
| Product app layer | authenticated operator UI and APIs | screens consume projections or canonical views, not provider payloads |
| Operations layer | backfill, parity, cutover, rollback | visible, auditable, reversible |

## Source-Of-Truth Precedence

### Business truth

1. canonical contact identity
2. canonical events and normalized history
3. projections derived from canonical state
4. transient UI state and drafts

### Provider truth

- Gmail wins tie-breaks when Gmail and Salesforce describe the same outbound email
- Salesforce is the primary source for contact identity and expedition/project context
- SimpleTexting is the source for official SMS compliance events
- Notion is the source for AI instructions and approved knowledge
- SendGrid is a delivery provider for Campaigns Email, not the authoring source of truth

## Cutover Model

| Step | Required behavior |
| --- | --- |
| `C-01` | full historical backfill by source |
| `C-02` | safe live sync continues where possible |
| `C-03` | short final delta sync under read-only lock |
| `C-04` | reconciliation and parity review |
| `C-05` | explicit approval or rollback |

### Hard gates

- zero unresolved `identity_conflict` cases at approval
- unresolved routing-review backlog is small, documented, and owned
- unexpected parity drift blocks approval

## Highest-Risk Trust Boundaries

- browser to product backend
- provider webhooks to backend
- backend to durable storage
- AI prompt/output boundary
- cutover and degraded-mode controls

## Build Constraint

- The reference implementation is a new TypeScript monorepo with separate web and worker responsibilities.
- `Build Web Apps` may accelerate approved frontend work but does not own system design.

## Read Next

- canonical entities and queues: [`data-core.md`](./data-core.md)
- implementation shape: [`engineering-core.md`](./engineering-core.md)
- delivery and gate rules: [`delivery-core.md`](./delivery-core.md)
