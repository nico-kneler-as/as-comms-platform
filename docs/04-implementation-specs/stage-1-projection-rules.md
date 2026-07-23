# Stage 1 Projection Rules

**Role:** implementation-ready Stage 1 projection semantics for timeline and Inbox read models  
**Audience:** implementers building the Stage 1 projection layer or replay logic  
**When to read:** before defining projection storage, rebuild logic, or projection update jobs  
**Authority:** implementation-spec guidance under the core canon
**Last reviewed:** 2026-07-23

## Summary

- Projections are derived views, never durable truth.
- Timeline and Inbox projections must rebuild from canonical inputs.
- Broadcast activity belongs in timeline history but must not change Inbox bucket state.
- Projection behavior must stay explainable from canonical events, source evidence, and review state.

## Contact Timeline Projection

### Scope

- one projection row per canonical event
- one timeline per canonical contact
- the 1-to-1 anchor row is preserved for replay-stability and audit. For Gmail events, the read path additionally unions the `canonical_event_audience` junction so every participant of a thread sees every message they were on (PRD #482)
- timeline rows may include lifecycle, one-to-one communication, and transition-period broadcast events

### Ordering and sort guidance

- timeline sorts strictly by `occurredAt`
- when multiple entries share the same `occurredAt`, break ties by a replay-stable identifier (`id`)
- projection and selector ordering must not depend on insertion order or provider fetch order
- volunteer lifecycle ordering (`signed_up` → `received_training` → `completed_training` → `submitted_first_data`) is a post-sort cleanup only inside adjacent same-day lifecycle runs
- a lifecycle reorder must never move a lifecycle item ahead of a non-lifecycle message or note

### Refresh rules

- insert or update timeline rows only from canonical events and any review-state changes needed for explainability
- for Gmail canonical events, write one `canonical_event_audience` row per resolved participant alongside the anchor projection row. The audience write uses `ON CONFLICT (canonical_event_id, contact_id) DO UPDATE` so replay is idempotent.
- do not create timeline rows directly from raw provider payloads
- replaying the same canonical event set must reproduce the same timeline ordering and row contents

### Provenance and explainability

Each timeline row should preserve enough information to explain:

- the canonical `eventType`
- the `channel`
- the event summary used by downstream surfaces
- the canonical event ID
- the primary provider or source winner
- any collapse or tie-break rationale when applicable

## Contact Inbox Projection

### Scope

- one Inbox row per canonical contact
- Inbox rows are driven by one-to-one communication events plus explicit follow-up state
- lifecycle and broadcast events may enrich timeline history but must not create or rebucket Inbox rows on their own

### Row refresh rules

- create or refresh an Inbox row when a canonical one-to-one email or SMS event is applied
- `lastInboundAt` tracks the newest inbound one-to-one event
- `lastOutboundAt` tracks the newest outbound one-to-one event
- `lastActivityAt` is the newest of `lastInboundAt` and `lastOutboundAt`
- `snippet` comes from the newest one-to-one communication event that refreshed the row
- default Inbox list order is `lastInboundAt desc`, falling back to `lastActivityAt desc` when `lastInboundAt` is missing

### Rebuild vs incremental apply

- `rebuildInboxProjectionForContact` is the replay/backfill truth: it may inspect the whole contact history and the existing row before deciding whether the bucket reopens
- `applyInboxProjection` is the incremental live-ingest path: it applies the incoming canonical event against the stored row only
- document and preserve their different `New` semantics; they are intentionally not identical

### Bucket semantics

#### `New`

- means the row has inbound one-to-one activity that has not been cleared by a later explicit open action
- the UI projects this row state as unread
- first inbound one-to-one contact activity initializes the row to `New`
- incremental live apply resets the row to `New` when the incoming inbound is strictly newer than stored `lastInboundAt`; if stored `lastInboundAt` is null, any inbound live event reopens it
- rebuild/replay resets the row to `New` only when inbound is strictly newer than stored `lastInboundAt`, or newer than stored `lastActivityAt` when stored `lastInboundAt` is null
- a null stored `lastInboundAt` on rebuild means "projection predates inbound tracking", not "all historical inbound is unread"

#### `Opened`

- means the row does not currently have uncleared new inbound activity
- first outbound-only one-to-one history initializes the row to `Opened`
- outbound events alone must not clear `New` automatically; that later operator action belongs to Inbox-stage behavior, not provider-driven projection rules

#### `Needs Follow-Up`

- `needsFollowUp` is a separate explicit follow-up flag
- it must not replace or mutate the bucket meaning
- provider data must not infer follow-up state
- until explicit Inbox-stage actions exist, Stage 1 should treat `needsFollowUp` as explicit projection state, not an event-derived inference

### Unresolved overlays

- `hasUnresolved` is an overlay, not a bucket
- open routing-review cases tied to the contact set `hasUnresolved=true`
- open identity conflicts tied to an already chosen anchored contact may also set `hasUnresolved=true`
- identity cases with no chosen contact do not create a synthetic Inbox row

### Broadcast-event non-effects

- `campaign.email.*` events appear in timeline history only
- they must not set or reset `New`
- they must not set or clear `Opened`
- they must not imply `needsFollowUp`

## Rebuild And Replay Expectations

- both timeline and Inbox projections must rebuild from canonical truth
- rebuild must be deterministic for the same canonical inputs
- replay of source evidence must not duplicate projection rows
- later product-layer state changes, such as explicit open or follow-up actions, should remain separate projection inputs when those stages arrive; Stage 1 should not fake them from provider traffic

## Explainability Requirement

Projection rows must preserve enough provenance to let later operators and implementers answer:

- which canonical event most recently changed this row
- why a row is `New` versus `Opened`
- why `hasUnresolved` is true
- whether a duplicate collapse or tie-break affected the visible result
