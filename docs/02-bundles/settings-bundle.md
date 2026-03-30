# Settings Bundle

**Role:** task packet for Stage 2 settings and admin work  
**Audience:** implementers working on admin, access, routing, health, timezone, or knowledge config  
**When to read:** before Stage 2 implementation  
**Authority:** derivative bundle; core truth lives in `01-core/*`

## Purpose

Make routing, access, integration health, timezone, and AI knowledge configuration app-owned instead of scattered across env vars or scripts.

## Required Reading

1. [`../00-index.md`](../00-index.md)
2. [`../01-core/product-core.md`](../01-core/product-core.md)
3. [`../01-core/system-core.md`](../01-core/system-core.md)
4. [`../01-core/engineering-core.md`](../01-core/engineering-core.md)
5. [`../01-core/frontend-patterns.md`](../01-core/frontend-patterns.md)
6. [`../01-core/delivery-core.md`](../01-core/delivery-core.md)
7. [`../01-core/decision-core.md`](../01-core/decision-core.md)

## Locked

- Settings is required before Inbox is production-ready
- Google SSO + server-owned sessions in production
- header auth is dev/internal only
- Notion-backed AI knowledge uses background sync/cache with no approval gate
- admin mutations must be auditable

## Required Interfaces / Concepts

- project activation and routing config
- role-aware admin/settings surface
- integration health views
- timezone and organization settings
- knowledge-source and sync configuration

## Allowed / Not Allowed

| Allowed | Not allowed |
| --- | --- |
| app-owned config surfaces | env-only hidden operational behavior for supported settings |
| server-evaluated role checks | client-trusted role or auth logic |
| auditable admin changes | silent raw provider error leakage |
| background knowledge sync config | approval-heavy manual Notion sync workflow |

## Acceptance

- Inbox no longer depends on scattered env/script-only config for supported settings behavior
- admin-only boundaries are enforced server-side
- settings changes are auditable
- knowledge sync model matches the locked simplified background-cache behavior

## Common Failure Modes

- postponing settings because the UI can “hardcode it for now”
- leaking raw provider/system errors into the UI
- recreating manual review/confirm knowledge flows from the donor project

## Read Next

- after Stage 2, most operator-facing work starts from [`inbox-bundle.md`](./inbox-bundle.md)
