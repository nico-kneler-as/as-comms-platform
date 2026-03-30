# Stage 1 Event Taxonomy

**Role:** minimum canonical event taxonomy for first Stage 1 implementation  
**Audience:** implementers defining contracts, normalization rules, event storage, and projections  
**When to read:** before creating canonical event schemas or provider-to-event mappings  
**Authority:** implementation-spec guidance under the core canon

## Summary

- Keep the first implementation small and stable.
- Canonical event types must be provider-agnostic.
- Provider-specific detail belongs in provenance and source evidence, not in the event type name.
- Membership and identity state are first-class Stage 1 data, but not every state change needs to become a canonical event in the first pass.

## Minimum Stage 1 Event Families

| Family | Channel | First-implementation canonical event types | Deferred examples |
| --- | --- | --- | --- |
| one-to-one email | `email` | `communication.email.inbound`, `communication.email.outbound` | drafts, read-state, labels, delivery/bounce detail, thread-close semantics |
| one-to-one SMS | `sms` | `communication.sms.inbound`, `communication.sms.outbound`, `communication.sms.opt_in`, `communication.sms.opt_out` | delivery receipts, media enrichment, bulk-SMS analytics |
| lifecycle | `lifecycle` | `lifecycle.signed_up`, `lifecycle.received_training`, `lifecycle.completed_training`, `lifecycle.submitted_first_data` | later lifecycle milestones, inferred volunteer journey states |
| transition-period campaign email | `campaign_email` | `campaign.email.sent`, `campaign.email.opened`, `campaign.email.clicked`, `campaign.email.unsubscribed` | native campaign authoring state, automation internals, richer deliverability families |

## Not Canonical Events In First Pass

- contact identity records
- contact membership rows
- provider health or sync telemetry
- internal notes
- AI state

Those are still Stage 1 or later durable concepts where canon requires them, but they should not be invented as additional canonical event families during the first pass.

## Source And Provenance Expectations

Every canonical event in Stage 1 should preserve enough provenance to answer:

- which provider won as the primary source for this canonical event
- which source-evidence record directly produced it
- whether supporting source evidence from another provider was attached
- whether duplicate-collapse or tie-break logic was applied
- why the chosen event type and contact link were considered valid

Minimum provenance expectations:

- one primary source-evidence reference
- provider name for the primary source
- supporting source-evidence references when multiple providers describe the same activity
- explicit winner rationale when a duplicate collapse occurs

## Review-State Expectations

Use the shared Stage 1 review-state vocabulary from [`README.md`](./README.md).

### Expected usage

- `clear`: default for canonical events that resolved cleanly
- `needs_routing_review`: allowed for events tied to a contact but still missing project or expedition context
- `quarantined`: allowed for replay or duplicate-collapse conflicts that must not drive projections yet
- `needs_identity_review`: allowed only when a deterministic anchor already chose the contact, typically via Salesforce Contact ID, but weaker conflicting evidence still requires manual confirmation

### Important constraint

If Stage 1 cannot pick one canonical contact safely, prefer opening an identity review case from source evidence and delaying canonical-event creation rather than forcing a contact-less or guessed canonical event.

## Duplicate-Collapse And Tie-Break Rules

- Collapse only within the same canonical event type and the same canonical contact.
- Never collapse one-to-one email events into campaign-email events.
- Never collapse lifecycle events into membership state rows.
- Keep SMS compliance events distinct from SMS message events even when timestamps match.
- When Gmail and Salesforce describe the same outbound one-to-one email, emit one canonical `communication.email.outbound` event and keep Gmail as the primary provenance winner.
- When SimpleTexting and Salesforce describe the same outbound SMS, keep the SimpleTexting transport event as primary and use Salesforce only as supporting provenance if needed.

## First-Implementation Vs Deferred

### First implementation

- one-to-one email inbound and outbound
- one-to-one SMS inbound and outbound
- SMS opt-in and opt-out
- the four locked Salesforce lifecycle milestones
- transition-period Mailchimp campaign history for sent, opened, clicked, and unsubscribed

### Deferred

- any broader event family not listed above
- fine-grained delivery state families
- provider-specific thread or conversation state
- campaign authoring or approval events
- AI or note-specific events
