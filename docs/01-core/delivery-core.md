# Delivery Core

**Role:** stage order and completion gate canon  
**Audience:** implementers planning or closing work  
**When to read:** before stage work starts and before calling work complete  
**Authority:** authoritative for stage sequence, Stage 0, verification/security gates, cutover thresholds  
**Decides:** what must exist before later work starts and what “done” means  
**Does not decide:** product field-level behavior or provider-specific mapping details

## Summary

- Stage order is fixed.
- Stage 0 is mandatory before product implementation.
- No stage is complete when code merely exists.
- CI, verification, and security gates are part of delivery, not optional follow-up.

## Stage Order

| Stage | Outcome |
| --- | --- |
| `0` | engineering foundation |
| `1` | data foundation |
| `2` | settings / admin foundation |
| `3` | Inbox |
| `4` | AI assistant |
| `5A` | Email Campaigns |
| `5B` | SMS Campaigns after Email trust is proven |
| `6` | later reporting |

## Stage 0 Requirements

- scaffold the new repo
- lock package boundaries
- install CI and quality gates
- document Build Web Apps write-scope limits
- get the skeleton passing baseline checks before Stage 1 product work

## Phase-Close Loop

Every stage closes through:

1. requirement check
2. CI quality gates
3. automated verification
4. manual/UAT validation
5. contradiction review
6. security review
7. evidence and doc update

## Hybrid Cutover Thresholds

| Metric | Locked threshold |
| --- | --- |
| `CUT-01` | unresolved `identity_conflict` backlog at approval = `0` |
| `CUT-02` | queue row parity during shadow/cutover `>= 99.5%` |
| `CUT-03` | sampled timeline/event parity `>= 99.0%` |
| `CUT-04` | comms freshness p95 for live Gmail/SimpleTexting `<= 2m` |
| `CUT-05` | comms freshness p99 for live Gmail/SimpleTexting `<= 5m` |
| `CUT-06` | lifecycle freshness p95 for Salesforce lifecycle feeds `<= 10m` |

Threshold failures block approval unless the explicit decision is rollback.

## Stop Conditions

Do not call a stage complete if:

- a locked requirement is still undefined
- current behavior contradicts the canon
- security stop-ship findings remain open
- proof exists only in historical notes and not in current implementation or fresh evidence
- known failures are hidden instead of recorded

## Read Next

- locked decisions: [`decision-core.md`](./decision-core.md)
- stage work packet: open the relevant file under [`../02-bundles`](../02-bundles)
