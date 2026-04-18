# Stage 1 Review Queue Reason Codes

**Role:** minimum Stage 1 reason-code taxonomy for manual review and replay quarantine  
**Audience:** implementers defining review queues, operational workflows, or replay safeguards  
**When to read:** before defining queue schemas, case payloads, or review UI contracts  
**Authority:** implementation-spec guidance under the core canon

## Summary

- reason codes must be stable and intentionally small
- ambiguous identity must not be auto-linked
- routing ambiguity remains a separate queue from identity ambiguity
- replay conflicts must be quarantined explicitly, not silently merged away

## Minimum Evidence Pack For Any Case

Every Stage 1 case should preserve at least:

- source-evidence ID or IDs
- provider and provider record IDs
- normalized identity fields involved
- candidate contact IDs when applicable
- current explanation for why the case was opened

## Identity Resolution Queue

| Reason code | Open when | Minimum evidence beyond the baseline pack | Expected resolution outcomes | Must never auto-resolve |
| --- | --- | --- | --- | --- |
| `identity_missing_anchor` | source evidence is too ambiguous or conflicting to produce a safe canonical contact (e.g., malformed identifiers, quarantined replay). **NOT** triggered by a plain unmatched email or phone — those produce a new canonical contact with `salesforceContactId=null` per `D-027` | normalized identity fields, reason evidence is unsafe, any prior canonical identity matches | link to an existing contact, create a new contact, or keep quarantined if the source evidence is invalid | no |
| `identity_multi_candidate` | one normalized email or phone matches multiple plausible contacts | candidate contact IDs with why each matched | choose one contact explicitly or reject all candidates and create a new contact | yes |
| `identity_conflict` | replay or new evidence attempts to attach the same logical activity to a different contact than the currently anchored interpretation | prior chosen contact, newly proposed contact, and conflict rationale | keep the existing link, relink deliberately, or split supporting evidence if it was not a true duplicate | yes |
| `identity_anchor_mismatch` | Salesforce Contact ID disagrees with an earlier weaker email or phone-based link | Salesforce Contact ID, weaker prior link, and timestamps of both | honor the stronger anchor with explicit review, or quarantine if the source itself is suspect | yes |

### Additional guidance

- `identity_conflict` is the cutover-blocking identity backlog reason code referenced by delivery canon.
- if identity is not safely resolved, prefer queueing the case before canonical-event creation.
- **Non-Salesforce contacts are first-class** (per `D-027`). Missing Salesforce Contact ID by itself is a valid state, not a review case. The narrowed `identity_missing_anchor` reserves the queue for genuine ambiguity/conflict situations only.

## Routing Review Queue

**Eligibility** (per `D-028`): routing review only opens for contacts where `salesforceContactId IS NOT NULL`. External-partner and non-volunteer contacts have no project context by definition and are not eligible for routing review.

| Reason code | Open when | Minimum evidence beyond the baseline pack | Expected resolution outcomes | Must never auto-resolve |
| --- | --- | --- | --- | --- |
| `routing_missing_membership` | the Salesforce-anchored contact is known but required project or expedition context cannot be determined | contact ID, event timestamp, known memberships or lack of memberships | attach the correct membership context, mark context intentionally unknown if policy allows, or quarantine the evidence | no |
| `routing_multiple_memberships` | more than one plausible project or expedition context exists for the event | candidate memberships and why each is plausible | choose one routing target explicitly | yes |
| `routing_context_conflict` | provider-supplied routing context conflicts with canonical membership context | provider context, canonical context, and the conflicting identifiers | confirm provider context, confirm canonical context, or quarantine until the source discrepancy is resolved | yes |

### Additional guidance

- routing review only opens after a Salesforce-anchored contact is safely chosen
- routing review must not mutate contact identity decisions silently
- non-SF canonical contacts are skipped entirely by routing evaluation

## Conflict And Replay Quarantine

These cases may live in dedicated quarantine handling or in operational dead-letter state, but the reason-code vocabulary should stay stable.

| Reason code | Open when | Minimum evidence beyond the baseline pack | Expected resolution outcomes | Must never auto-resolve |
| --- | --- | --- | --- | --- |
| `replay_checksum_mismatch` | the same provider record ID or idempotency key reappears with a materially different checksum or payload reference | old and new checksum or payload refs, ingest timestamps, idempotency key | confirm the latest evidence as a legitimate correction, preserve both as distinct evidence if justified, or reject the mutation and dead-letter it | yes |
| `duplicate_collapse_conflict` | a replay would change which source or contact wins a previously established duplicate collapse | prior winner, newly proposed winner, all related evidence IDs | keep one winner explicitly, or split the records into separate canonical events if they were not true duplicates | yes |

## Cases That Must Never Be Auto-Resolved

- `identity_multi_candidate`
- `identity_conflict`
- `identity_anchor_mismatch`
- `routing_multiple_memberships`
- `routing_context_conflict`
- `replay_checksum_mismatch`
- `duplicate_collapse_conflict`
