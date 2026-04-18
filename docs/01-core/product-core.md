# Product Core

**Role:** product truth for the restart  
**Audience:** all implementers  
**When to read:** before any stage bundle that touches product behavior  
**Authority:** authoritative for scope, users, Inbox model, stage map  
**Decides:** what the product is, who it serves, what is locked in scope  
**Does not decide:** repo shape, CI, package boundaries, low-level integration details

## Summary

- Build a new internal platform for Adventure Scientists that unifies volunteer history and communication in one trusted place.
- The restart is a fresh build, not a continuation of the current repo.
- Core progression: data foundation first, then settings, then inbox, then AI, then campaigns, then later reporting.

## Locked Product Truth

| ID | Locked truth |
| --- | --- |
| `P-01` | One person, one timeline. |
| `P-02` | Contact-centric Inbox, not thread-centric Inbox. |
| `P-03` | Explicit manual resolution beats wrong auto-linking. |
| `P-04` | AI is human-in-the-loop only. |
| `P-05` | Campaigns share the same identity and timeline foundation as Inbox. |

## Users

- Primary operators: internal staff handling volunteer communications
- Admin operators: staff managing routing, access, integrations, timezone, and AI knowledge
- Supported contacts: Salesforce-linked volunteers plus non-volunteer contacts who still need durable communication history

## Locked Stage Map

| Stage | Outcome |
| --- | --- |
| `0` | engineering foundation and repo bootstrap |
| `1` | trusted identity, canonical events, projections, cutover tooling |
| `2` | app-owned settings, access, integration health, timezone (knowledge config deferred to Stage 4) |
| `3` | one-to-one Inbox on canonical projections (read surface, follow-up, overlays) |
| `3.5` | Composer: real send/reply via Gmail with optimistic UI, net-new to SF contacts and external partners |
| `4` | grounded AI drafts and reusable memory (depends on Composer) |
| `V` | validation gate — real operator use of Inbox + Composer + AI in production, harden before Campaigns |
| `5A` | Email Campaigns (gated on `V`) |
| `5B` | SMS Campaigns after Email trust gates pass |
| `6` | later reporting only after the operating system is stable |

## Inbox Model

| ID | Locked truth |
| --- | --- |
| `INBX-01` | Inbox shows one row per person, not one row per thread. |
| `INBX-02` | Inbox is a single mixed contact list sorted by most recent inbound message, not primarily partitioned into queue tabs. |
| `INBX-03` | `New` and `Opened` remain projection-driven bucket states, but they are row states and filter inputs rather than the primary Inbox partition. |
| `INBX-04` | Unread is derived from bucket state. |
| `INBX-05` | `needsFollowUp` is an explicit operator-controlled follow-up flag that stays separate from bucket state. |
| `INBX-06` | Unresolved review layers on top; it is not its own bucket. |
| `INBX-07` | New inbound on an `Opened` conversation resets it to `New`. |
| `INBX-08` | Toggling follow-up does not change list ordering by itself. |
| `INBX-09` | First restart Inbox does not depend on close / reopen lifecycle actions. |

## Locked Scope Highlights

- Internal notes are in the first restart Inbox release.
- Owners and tags are out of the first restart Inbox release.
- Gmail remains the one-to-one email transport after cutover.
- Platform-native Email Campaigns ship before SMS Campaigns.
- Mailchimp historical and transition-period live campaign events remain in transition scope until native Email Campaigns are trusted.
- Organization timezone is `America/Denver`.

## Highest-Value Non-Goals

- using the donor repo UI or milestone plans as the implementation baseline
- rebuilding every optional Salesforce event family on day one
- introducing owner/tag-heavy Inbox workflows in the first release
- fully automated no-human-review AI sending
- launching reporting before earlier stages are trusted

## Read Next

- system shape: [`system-core.md`](./system-core.md)
- canonical entities and queues: [`data-core.md`](./data-core.md)
- stage order and gates: [`delivery-core.md`](./delivery-core.md)
