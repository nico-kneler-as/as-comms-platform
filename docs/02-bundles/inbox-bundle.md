# Inbox Bundle

**Role:** task packet for Stage 3 Inbox work  
**Audience:** implementers working on one-to-one operator workflows  
**When to read:** before Inbox routes, queue logic, timeline logic, or reply flows  
**Authority:** derivative bundle; core truth lives in `01-core/*`

## Purpose

Build the one-to-one operator workspace on top of canonical projections.

## Required Reading

1. [`../00-index.md`](../00-index.md)
2. [`../01-core/product-core.md`](../01-core/product-core.md)
3. [`../01-core/system-core.md`](../01-core/system-core.md)
4. [`../01-core/data-core.md`](../01-core/data-core.md)
5. [`../01-core/interfaces-core.md`](../01-core/interfaces-core.md)
6. [`../01-core/engineering-core.md`](../01-core/engineering-core.md)
7. [`../01-core/frontend-patterns.md`](../01-core/frontend-patterns.md)
8. [`../01-core/delivery-core.md`](../01-core/delivery-core.md)
9. [`../01-core/decision-core.md`](../01-core/decision-core.md)

## Locked

- one row per person, not one row per thread
- one mixed contact list sorted by most recent inbound message
- `New` and `Opened` remain projection-driven bucket states, but they are row states and filters rather than the primary Inbox partition
- unread comes from bucket state
- `needsFollowUp` is an explicit operator-controlled follow-up flag, not a bucket synonym (pure toggle, no auto-clear on inbound/reply/bucket transitions)
- unresolved review layers on top of the row state model
- `hasUnresolved` triggers only on genuine ambiguity cases (`identity_multi_candidate`, `identity_conflict`, `identity_anchor_mismatch`, replay/collapse conflicts), and routing review cases only for Salesforce-anchored contacts (per `D-027`, `D-028`)
- the contact rail shows lifecycle activity only; 1:1 email and SMS render in the main timeline
- the unresolved state in the detail pane replaces the normal "Volunteer details" rail trigger with an "Unresolved details" rail that explains the specific reason and provides a searchbar over Salesforce-anchored canonical contacts to manually link
- send and compose details live in the Composer stage (see `D-026`); inbox stage covers read, overlays, and follow-up toggle
- internal notes are included and stored separately from the canonical event ledger (per `D-029`); team-visible, plain text, inline in the timeline
- owners and tags are not in the first Inbox release
- send behavior defaults to send and remain opened
- first release does not depend on close / reopen lifecycle actions

## Required Interfaces / Concepts

- contact-centric queue read model
- per-person timeline read model (unions canonical events + operator-authored notes)
- manual identity resolution path (invoked from the unresolved-details rail variant)
- note-taking support (team-visible, plain text)
- project context and relevant memberships with links to the Expedition Member Salesforce record per project
- reply by email and eligible SMS **is Composer stage scope**, not Inbox stage scope (see `D-026`)
- reminders are **MVP-mock, client-session-only** (per `D-030`); do not build a durable reminders table in this stage

## Allowed / Not Allowed

| Allowed | Not allowed |
| --- | --- |
| projection-driven bucket state plus explicit follow-up flags | UI-owned queue state |
| one mixed contact list with secondary row-state filters | resurrecting queue-tab-first or `Closed` / reopen lifecycle logic in first release |
| unresolved overlays and review queues | treating unresolved as its own queue bucket |
| timeline + notes in one workspace | thread-first Inbox behavior |

## Acceptance

- queue bucket changes are projection-driven
- default Inbox ordering is `lastInboundAt desc`, with `lastActivityAt desc` fallback when `lastInboundAt` is missing
- unread filter keys off bucket state, follow-up filter keys off `needsFollowUp`, and unresolved filter keys off `hasUnresolved`
- timeline remains correct for volunteers and non-volunteer contacts
- unresolved/manual-link flows refresh context without duplicate history
- opening, replying, new inbound resets, and follow-up toggles stay consistent without collapsing bucket and follow-up semantics
- campaign events do not mutate Inbox bucket state

## Common Failure Modes

- modeling Inbox around transport threads instead of people
- treating Needs Follow-Up as a substitute for queue state
- reintroducing queue tabs as the primary Inbox model
- leaking raw provider models into the workspace
- reintroducing close / reopen complexity because donor code had it

## Reference Links

- services summary: [`../03-reference/reference-services.md`](../03-reference/reference-services.md)
- donor reuse guide: [`../03-reference/reference-donor-reuse.md`](../03-reference/reference-donor-reuse.md)
