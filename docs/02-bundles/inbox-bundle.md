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
- primary queue buckets are `New` and `Opened`
- `Starred` is a follow-up flag, not a queue bucket replacement
- unresolved review layers on top of the queue model
- internal notes are included
- owners and tags are not in the first Inbox release
- send behavior defaults to send and remain opened
- first release does not depend on close / reopen lifecycle actions

## Required Interfaces / Concepts

- contact-centric queue read model
- per-person timeline read model
- manual identity resolution path
- note-taking support
- reply by email and eligible SMS
- project context and relevant memberships

## Allowed / Not Allowed

| Allowed | Not allowed |
| --- | --- |
| projection-driven queue buckets | UI-owned queue state |
| Gmail-familiar `New` / `Opened` / `Starred` semantics | resurrecting `Closed` / reopen lifecycle logic in first release |
| unresolved overlays and review queues | treating unresolved as its own queue bucket |
| timeline + notes in one workspace | thread-first Inbox behavior |

## Acceptance

- queue bucket changes are projection-driven
- timeline remains correct for volunteers and non-volunteer contacts
- unresolved/manual-link flows refresh context without duplicate history
- opening, replying, new inbound resets, and star/unstar behavior stay consistent
- campaign events do not mutate Inbox bucket state

## Common Failure Modes

- modeling Inbox around transport threads instead of people
- making `Starred` a substitute for queue state
- leaking raw provider models into the workspace
- reintroducing close / reopen complexity because donor code had it

## Reference Links

- services summary: [`../03-reference/reference-services.md`](../03-reference/reference-services.md)
- donor reuse guide: [`../03-reference/reference-donor-reuse.md`](../03-reference/reference-donor-reuse.md)
