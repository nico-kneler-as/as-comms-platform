# Campaigns Bundle

**Role:** task packet for Stage 5 campaigns work  
**Audience:** implementers working on one-to-many messaging  
**When to read:** before campaign audience, compose, review, send, or monitor work  
**Authority:** derivative bundle; core truth lives in `01-core/*`

## Purpose

Add one-to-many messaging inside the same product foundation, with Email first and SMS second.

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

- `5A` Email Campaigns precede `5B` SMS Campaigns
- campaign runs remain single-channel
- audience uses canonical platform identity and exclusions
- campaign content, review state, and frozen audience remain product-owned
- SendGrid is the Email delivery provider, not the authoring source of truth
- Mailchimp remains historical and transition-period live ingest scope until native Email Campaigns are trusted

## Required Interfaces / Concepts

- recent campaign runs and run detail
- guided audience builder
- compose, preview, and optional test send
- frozen review and final confirmation
- send now, schedule, monitoring, cancel, retry
- timeline visibility for campaign events

## Allowed / Not Allowed

| Allowed | Not allowed |
| --- | --- |
| Email-first rollout | early bulk SMS expansion before Email trust is proven |
| product-owned campaign review state | provider-owned authoring truth |
| campaign timeline visibility | campaign events mutating Inbox bucket state |
| transition-period Mailchimp ingest | treating Mailchimp as the future authoring UX |

## Acceptance

- campaign state is durable and auditable
- review and frozen-audience safeguards block unsafe launch behavior
- timeline integration does not corrupt Inbox state
- Email Campaigns are operationally trusted before SMS expansion

## Common Failure Modes

- export-first audience workflows
- hidden exclusions or dedupe behavior
- turning Campaigns into a separate identity universe from Inbox

## Reference Links

- services summary: [`../03-reference/reference-services.md`](../03-reference/reference-services.md)
- Salesforce mapping reference: [`../03-reference/reference-salesforce-mapping.md`](../03-reference/reference-salesforce-mapping.md)
