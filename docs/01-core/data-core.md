# Data Core

**Role:** canonical data and identity contract  
**Audience:** implementers touching persistence, projections, sync, Inbox, AI, or Campaigns  
**When to read:** before data model, integration, worker, or projection work  
**Authority:** authoritative for canonical concepts, identity rules, dedupe, projections, review queues  
**Decides:** what durable concepts must exist and how identity/projection logic behaves  
**Does not decide:** exact table names, migration filenames, index syntax

## Summary

- Historical import and live ingest must use the same normalization and identity rules.
- Canonical history is durable, provenance-aware, and replay-safe.
- Review queues are first-class; ambiguity is not guessed away.

## Required Canonical Concepts

| Concept | Purpose |
| --- | --- |
| source evidence log | immutable provider-close evidence |
| canonical event ledger | normalized timeline events |
| contacts | canonical person record |
| contact identities | durable email and phone ownership |
| contact memberships | project and expedition context |
| identity resolution queue | ambiguous or unresolved person matching |
| routing review queue | project or routing ambiguity |
| contact timeline projection | chronological person history |
| contact inbox projection | contact-centric Inbox read model |
| campaign projections | audience, runs, snapshots |
| sync + parity state | cursors, backfills, parity, dead letters |
| audit + policy evidence | audit records, webhook verification, policy decisions |
| AI durable state | knowledge cache, resolved reply examples, assistant feedback |

## Identity Rules

| Order | Rule |
| --- | --- |
| `ID-01` | Salesforce Contact ID is the strongest anchor when available. |
| `ID-02` | Normalized email is the next strongest anchor. |
| `ID-03` | Normalized phone is next. |
| `ID-04` | Synthetic fallback is last resort only. |
| `ID-05` | Ambiguous matches must not auto-link. |
| `ID-06` | Non-volunteer contacts remain first-class supported records. |

## Dedupe And Replay Rules

- Every provider needs an explicit idempotency key strategy.
- Replaying the same webhook, delta event, or backfill page must be safe.
- Conflicting replays are quarantined or flagged, not silently merged.
- Gmail wins duplicate collapse when Gmail and Salesforce represent the same outbound email.
- Dedupe keeps provenance so operators can understand why one source won.

## Projection Rules

- Inbox is one row per person, not one row per thread.
- Inbox is one mixed contact list sorted by most recent inbound message.
- Timeline is one chronological history per person.
- `New` and `Opened` remain projection-driven bucket states, but they are row states and filters rather than the primary Inbox partition.
- Unread is derived from bucket state.
- `needsFollowUp` is a separate explicit follow-up flag, not a replacement for bucket state.
- Unresolved review is layered on top of the row state model, not its own bucket.
- Default Inbox ordering is `lastInboundAt desc`, falling back to `lastActivityAt desc` when `lastInboundAt` is missing.
- Campaign events appear in the timeline but do not drive Inbox bucket changes.

## Manual Resolution Model

- unresolved identity and routing are explicit operational queues
- manual resolution must show evidence and candidate matches
- resolving identity must refresh projections without duplicating history
- the system must preserve what was inferred, what was explicit, and what was manually chosen

## Read Next

- product-facing behavior: [`product-core.md`](./product-core.md)
- task-focused implementation: open the relevant file under [`../02-bundles`](../02-bundles)
