# Backlog

**Role:** durable, lightweight list of known follow-up items that aren't actively scoped for work
**Audience:** architect and implementers
**When to read:** when planning the next scope of work, or before opening a new issue (check this first)
**Authority:** non-blocking; items here are candidates, not commitments

## How to use

- One entry per item, kept short. The point is durability, not detail.
- An item becomes a GitHub issue (or `/to-prd` PRD) when it's actually being scoped for work. At that point, add the issue link to the entry; do not delete the entry until the work is merged.
- If you create a `/to-prd` issue for something, you can ALSO list it here with a link, but only if there's value in keeping a doc-canon-resident pointer (e.g., the work touches a load-bearing seam future readers will hit).
- Entries are grouped by area, not priority. Use the **Status** column to mark `open`, `tracked`, or `done`.

## Entry template

```
### YYYY-MM-DD — Short title

- **Status:** open | tracked (#NNN) | done (#NNN)
- **Area:** worker | web | domain | docs | data-hygiene | ...
- **Why it's here:** one sentence on what we noticed and what's wrong/missing
- **Suggested scope:** one or two sentences on what fixing it would entail; do not over-scope
- **Discovered in:** session date + ops context (so future readers know where to look for warm context)
```

## Items

### 2026-05-21 — Clear canonical_event_ledger.review_state when resolving routing/identity queue cases

- **Status:** open
- **Area:** worker / domain
- **Why it's here:** When a routing-review or identity-review case is marked `resolved`, the underlying canonical_event_ledger rows keep their `review_state` set to `needs_routing_review` / `needs_identity_review`. The convention has been intentional since the reconciler shipped — `markRoutingCaseResolved` only updates the queue table — but it leaves a permanent inconsistency between case status and event state. Currently 25+ historical canonical events have non-clear review_state with already-resolved cases.
- **Suggested scope:** (1) Update `markRoutingCaseResolved` (and the identity-queue equivalent) to also clear the matching canonical_event_ledger.review_state in the same transaction. (2) One-time backfill pass over the existing inconsistent rows. (3) Audit consumers of `canonical_event_ledger.review_state` first — there may be analytics or audit-trail uses that rely on the historical marker, in which case introduce a separate "review_history" signal before clearing.
- **Discovered in:** 2026-05-21 ops session, follow-up to manually resolving the 4 open `routing_context_conflict` cases for Matt Enos + Erasme Uyizeye. Related PRs: #455 (rebuild inbox projection after merge), #456 (auto-merge email-only into SF anchor).
