# Reference Donor Reuse

**Role:** compact donor-reuse policy guide  
**Audience:** implementers considering porting code or behavior from the donor repo  
**When to read:** before reusing donor logic  
**Authority:** reference-only; core truth lives in `01-core/decision-core.md` and `01-core/engineering-core.md`

## Summary

- The donor repo is evidence and a logic library, not the baseline architecture.
- Reuse is allowed only when it fits the locked product and engineering canon.

## Reuse Rules

| Reuse carefully | Reference only | Do not inherit |
| --- | --- | --- |
| provider-close integration logic | old milestone plans and UI narratives | donor repo as implementation baseline |
| proven persistence and replay ideas | benchmark-era UI decisions | manual Notion approval workflow |
| verification ideas and service evidence | runbooks and service dossiers | thread-first or row-mutable Inbox behavior |

## Always Check First

- does this donor logic fit the locked repo contract?
- does it preserve the current mixed-list Inbox model with bucket-derived unread, explicit `needsFollowUp`, and unresolved overlay?
- does it preserve the one-normalization-path rule?
- does it reintroduce approval-heavy, UI-owned, or benchmark-era assumptions?

## Deep Reference

- donor reuse map: [`../../restart-prd/donor-map.md`](../../restart-prd/donor-map.md)
