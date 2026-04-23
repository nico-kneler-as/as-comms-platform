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
- **Auth.js v5 (NextAuth)** with Google OAuth provider and Drizzle session adapter (per `D-025`)
- 30-day rolling cookie sessions
- Google SSO + server-owned sessions in production
- **Two flat roles: `admin` and `operator`** — no permissions matrix (per `D-025`)
- First-time Google sign-in creates an `operator` by default; admins are promoted via a one-time ops script
- header auth is dev/internal only: trusted header `x-dev-operator: <email>` is accepted only when `NODE_ENV !== 'production'`, seeded by a dev-only `/api/dev-auth?email=X` route that must 404 in prod
- Notion-backed AI knowledge uses background sync/cache with no approval gate
- admin mutations must be auditable via `audit_policy_evidence`
- Settings blocks Composer stage (per `D-026`); Composer builds on real Stage 2 auth
- Composer depends on DB-backed project-inbox aliases (`project_aliases` table replacing the `GMAIL_PROJECT_INBOX_ALIASES` env var; worker reads DB first, env as fallback during cutover)
- project activation requires a short project alias, at least one project-inbox alias, and synced AI knowledge

## Required Interfaces / Concepts

### MVP scope (must ship)

- Google SSO sign-in + session middleware gating `/inbox/*` and `/settings/*`
- project-inbox alias admin CRUD (replaces `GMAIL_PROJECT_INBOX_ALIASES` env var)
- short project alias admin editing on active/inactive projects
- users + roles admin (list users, promote/demote admin, deactivate)

### MVP scope (ship thin)

- organization settings (read-only card — org name, timezone `America/Denver`)
- integration health (read-only summary of `sync_state` by provider)

### Deferred to Stage 4

- knowledge-source and sync configuration (Notion workspace/page picker) — unblocks AI, not Composer

### Out of scope

- routing rules / assignee partitioning (no assignee-based queue partitioning per current product decisions)
- multi-tenancy, multiple organizations
- password auth, email-magic-link, non-Google OAuth providers

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
