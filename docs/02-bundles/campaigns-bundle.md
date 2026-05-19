# Broadcasts Bundle

**Role:** task packet for Stage 5 broadcasts work  
**Audience:** implementers working on one-to-many messaging  
**When to read:** before broadcast audience, compose, review, send, or monitor work  
**Authority:** derivative bundle; core truth lives in `01-core/*`

## Purpose

Add one-to-many messaging inside the same product foundation, with Email first and SMS second.

## Required Reading

1. [00-index.md](../00-index.md)
2. [product-core.md](../01-core/product-core.md)
3. [system-core.md](../01-core/system-core.md)
4. [data-core.md](../01-core/data-core.md)
5. [interfaces-core.md](../01-core/interfaces-core.md)
6. [engineering-core.md](../01-core/engineering-core.md)
7. [frontend-patterns.md](../01-core/frontend-patterns.md)
8. [delivery-core.md](../01-core/delivery-core.md)
9. [decision-core.md](../01-core/decision-core.md)

## Locked

- `5A` Email Broadcasts (project-scope) ship before `5B` SMS Broadcasts (`D-014`)
- broadcast runs remain single-channel
- audience uses canonical platform identity and exclusions
- broadcast content, review state, and frozen audience remain product-owned
- Postmark is the Email delivery provider, not the authoring source of truth (`D-045`)
- Stage structure locked by `D-046` (2026-05-19): **5A** = project-specific Normal Email sends via the Composer-style Markdown editor (shipped #418-#436; gate to 5C is real operator use of project broadcasts in production); **5B** = SMS Broadcasts, gated on A2P 10DLC approval (external, independent of 5A and 5C); **5C** = Newsletters + Unlayer drag-and-drop HTML composer + full Mailchimp decommission, gated on 5A operator validation; **Stage 6** = Workflows replacing Salesforce Auto-Emails, roadmap intent only (no product definition yet). Supersedes the prior D-045 "Phase A → B → C → D=5B" rollout shape. See PRD [#412](https://github.com/nico-kneler-as/as-comms-platform/issues/412) and [stage-5a-campaigns.md](../04-implementation-specs/stage-5a-campaigns.md)
- Mailchimp remains historical and transition-period live ingest scope until Stage 5C decommissions it
- transition-period live Mailchimp ingest is now operational for the cutover window; see PRD #283 and the [Mailchimp decommission runbook](../runbooks/mailchimp-decommission.md)

## Required Interfaces / Concepts

- recent broadcast runs and run detail
- guided audience builder
- compose, preview, and optional test send
- frozen review and final confirmation
- send now, schedule, monitoring, cancel, retry
- timeline visibility for broadcast events

## Allowed / Not Allowed

| Allowed | Not allowed |
| --- | --- |
| Email-first rollout | early bulk SMS expansion before Email trust is proven |
| product-owned broadcast review state | provider-owned authoring truth |
| broadcast timeline visibility | broadcast events mutating Inbox bucket state |
| transition-period Mailchimp ingest | treating Mailchimp as the future authoring UX |

## Acceptance

- broadcast state is durable and auditable
- review and frozen-audience safeguards block unsafe launch behavior
- timeline integration does not corrupt Inbox state
- Email Broadcasts are operationally trusted before SMS expansion

## Common Failure Modes

- export-first audience workflows
- hidden exclusions or dedupe behavior
- turning Broadcasts into a separate identity universe from Inbox

## Reference Links

- services summary: [reference-services.md](../03-reference/reference-services.md)
- Salesforce mapping reference: [reference-salesforce-mapping.md](../03-reference/reference-salesforce-mapping.md)
