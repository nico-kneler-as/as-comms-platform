# Data Foundation Bundle

**Role:** task packet for Stage 1 data foundation work  
**Audience:** implementers working on data model, ingest, projections, or cutover  
**When to read:** before Stage 1 implementation  
**Authority:** derivative bundle; core truth lives in `01-core/*`

## Purpose

Build canonical identity, source evidence, normalized history, review queues, projections, and cutover tooling.

## Required Reading

1. [`../00-index.md`](../00-index.md)
2. [`../01-core/product-core.md`](../01-core/product-core.md)
3. [`../01-core/system-core.md`](../01-core/system-core.md)
4. [`../01-core/data-core.md`](../01-core/data-core.md)
5. [`../01-core/interfaces-core.md`](../01-core/interfaces-core.md)
6. [`../01-core/delivery-core.md`](../01-core/delivery-core.md)
7. [`../01-core/decision-core.md`](../01-core/decision-core.md)

## Locked

- one normalization path for historical and live ingest
- Salesforce Contact ID primary identity anchor
- ambiguous identity goes to manual resolution
- Gmail wins canonical email tie-breaks
- hybrid cutover with explicit approval or rollback

## Required Interfaces / Concepts

- source evidence log
- canonical event ledger
- contacts, identities, memberships
- identity and routing review queues
- inbox and timeline projections
- sync, backfill, parity, and dead-letter state
- audit and policy evidence

## Allowed / Not Allowed

| Allowed | Not allowed |
| --- | --- |
| provider adapters | separate import-only normalization rules |
| durable replay-safe jobs | guessing through identity ambiguity |
| rebuildable projections | UI-owned truth for queue or timeline behavior |
| explicit parity state | silent duplicate collapse without provenance |

## Acceptance

- every event resolves to a person or a review queue entry
- replaying webhooks/backfill pages is safe
- projections rebuild from canonical truth
- cutover path is documented, tested, and reversible
- hybrid cutover thresholds are measurable

## Common Failure Modes

- treating provider payloads as product state
- mixing dedupe logic into the UI
- building historical import logic that does not match live ingest logic
- overfitting to donor repo structure instead of the locked repo contract

## Reference Links

- services summary: [`../03-reference/reference-services.md`](../03-reference/reference-services.md)
- Salesforce mapping: [`../03-reference/reference-salesforce-mapping.md`](../03-reference/reference-salesforce-mapping.md)
- deep donor details if needed: [`../03-reference/reference-donor-reuse.md`](../03-reference/reference-donor-reuse.md)
