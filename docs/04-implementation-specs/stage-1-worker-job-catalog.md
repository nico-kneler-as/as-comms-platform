# Stage 1 Worker Job Catalog

**Role:** minimum Stage 1 job catalog for data-foundation operations  
**Audience:** implementers defining background-job responsibilities and worker boundaries  
**When to read:** before worker architecture or Stage 1 job payload contracts are implemented  
**Authority:** implementation-spec guidance under the core canon

## Summary

- Stage 1 jobs should be small, replay-safe, and explicit about their inputs and outputs.
- Web request lifecycles must not absorb these responsibilities.
- Queue names and code structure remain an implementation choice; durable job responsibilities do not.

## Required First-Implementation Job Responsibilities

| Job responsibility | Consumes | Produces | Why it is required now |
| --- | --- | --- | --- |
| historical provider backfill fetch | provider credentials, sync windows, cursors, provider-specific record identifiers | provider-close source-evidence batches and updated sync state | Stage 1 trust depends on historical backfill using the same normalization path as live ingest |
| live provider ingest capture | webhooks, deltas, or provider poll windows | source-evidence records and updated sync state | Stage 1 must prove that live and historical ingest converge into one durable path |
| source-evidence validation and recording | raw provider payloads plus ingest metadata | immutable source-evidence records with idempotency keys and checksums | replay safety starts at the source-evidence boundary |
| canonical normalization and identity resolution | source-evidence records, contact identities, memberships, existing canonical state | canonical events, contact updates, membership updates, or review-queue cases | this is the core Stage 1 normalization boundary |
| duplicate collapse and provenance attach | candidate canonical events and prior canonical evidence | one winning canonical event plus supporting provenance, or quarantine | duplicate logic must stay explicit and replay-safe |
| review-case open or refresh | source-evidence records, identity outcomes, routing outcomes, replay conflicts | identity-resolution cases, routing-review cases, or quarantine state | ambiguity is first-class Stage 1 behavior |
| incremental projection apply | canonical events and resolved review outcomes | timeline and Inbox projection updates | Stage 1 projections must be derived from canonical truth, not from provider payloads |
| projection rebuild | canonical events, contacts, memberships, and review outcomes | deterministic full or scoped projection rebuilds | rebuildability is a locked Stage 1 requirement |
| parity snapshot and drift measurement | sync state, source evidence, canonical counts, projection counts | parity summaries, drift metrics, and cutover evidence | Stage 1 acceptance includes measurable parity and cutover readiness |
| final delta sync orchestration | open provider cursors, cutover windows, current sync state | final backfill deltas, reconciliation inputs, and approval-ready cutover evidence | hybrid cutover is locked in system canon |
| retry and dead-letter reprocessing | failed job state, dead-letter metadata, corrected configuration or replay decisions | retried work, retained dead-letter evidence, or escalated quarantine | Stage 1 needs bounded retry and explicit failure handling |

## Deferred Job Responsibilities

| Deferred responsibility | Why it stays out of first implementation |
| --- | --- |
| AI knowledge sync and prompt-cache jobs | belongs to later AI stages |
| campaign authoring, rollout, or approval jobs | belongs to campaign stages, not Stage 1 data foundation |
| provider-specific enrichment or non-essential analytics rollups | not required to establish trusted canonical history |
| web-driven inline long-running sync work | violates the locked web versus worker boundary |

## Historical Backfill Vs Live Ingest

- the fetch or capture jobs may differ by source mechanics
- the normalization, dedupe, review, and projection responsibilities must stay shared
- do not create separate historical-only canonicalization logic

## Replay And Idempotency Expectations

- every Stage 1 ingest path must be safe to run more than once
- reprocessing the same source evidence must not duplicate canonical events or projection rows
- replay conflicts must produce quarantine or review outcomes, not silent merges

## Projection Boundary Expectations

- projection jobs consume canonical truth and review outcomes
- projection jobs do not reinterpret raw provider payloads
- rebuild jobs must be able to regenerate the same result from the same canonical inputs

## Notes On Concrete Naming

- do not lock concrete queue names yet unless implementation needs them
- keep job names descriptive of responsibility rather than provider-specific implementation detail
