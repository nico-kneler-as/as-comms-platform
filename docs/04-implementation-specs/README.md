# Implementation Specs

**Role:** compact execution-spec layer for coding after core canon is already locked  
**Audience:** implementers beginning Stage 1 work  
**When to read:** after the relevant `02-bundles/*` packet and before schema, repository, worker, or projection coding  
**Authority:** downstream implementation guidance; `01-core/*` still wins on contradictions

## Purpose

These docs narrow Stage 1 implementation choices that were still too open after reading only the core canon and task bundle.

They are meant to prevent code-first guessing, not to replace the bundle or core canon.

## Read Order For Stage 1

1. [`../02-bundles/data-foundation-bundle.md`](../02-bundles/data-foundation-bundle.md)
2. [`stage-1-event-taxonomy.md`](./stage-1-event-taxonomy.md)
3. [`stage-1-provider-ingest-matrix.md`](./stage-1-provider-ingest-matrix.md)
4. [`stage-1-review-queue-reason-codes.md`](./stage-1-review-queue-reason-codes.md)
5. [`stage-1-projection-rules.md`](./stage-1-projection-rules.md)
6. [`stage-1-worker-job-catalog.md`](./stage-1-worker-job-catalog.md)

## Shared Stage 1 Vocabulary

- `source evidence`: immutable provider-close evidence before normalization
- `canonical event`: normalized durable event linked to one canonical contact
- `first implementation`: minimum Stage 1 scope required to make the data foundation trusted and replay-safe
- `deferred`: intentionally out of Stage 1 and not to be guessed into code

## Shared Review-State Vocabulary

Use the same Stage 1 review-state labels across event, queue, and projection work:

- `clear`: identity and routing are sufficiently resolved for canonical storage and projection
- `needs_identity_review`: only allowed when a deterministic contact anchor exists but conflicting weaker evidence still needs manual confirmation
- `needs_routing_review`: contact is resolved but project or expedition routing context is not
- `quarantined`: replay or duplicate-collapse conflict blocks the record from normal projection flow
