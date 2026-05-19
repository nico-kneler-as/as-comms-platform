# Settings Bundle

**Role:** task packet for Stage 2 settings and admin work  
**Audience:** implementers working on admin, access, routing, health, timezone, or knowledge config  
**When to read:** before Stage 2 implementation  
**Authority:** derivative bundle; core truth lives in `01-core/*`

## Purpose

Make routing, access, integration health, timezone, and AI knowledge configuration app-owned instead of scattered across env vars or scripts.

## Required Reading

1. [00-index.md](../00-index.md)
2. [product-core.md](../01-core/product-core.md)
3. [system-core.md](../01-core/system-core.md)
4. [engineering-core.md](../01-core/engineering-core.md)
5. [frontend-patterns.md](../01-core/frontend-patterns.md)
6. [delivery-core.md](../01-core/delivery-core.md)
7. [decision-core.md](../01-core/decision-core.md)

## Locked

- Settings is required before Inbox is production-ready
- **Auth.js v5 (NextAuth)** with Google OAuth provider and Drizzle session adapter (per `D-025`)
- 30-day rolling cookie sessions
- Google SSO + server-owned sessions in production
- **Two flat roles: `admin` and `operator`** — no permissions matrix (per `D-025`)
- First-time Google sign-in is allowed only for active, pre-seeded `@adventurescientists.org` users; Settings admins (or initial ops setup) create the user row first, and admin promotion remains an explicit ops/admin action
- header auth is dev/internal only: trusted header `x-dev-operator: <email>` is accepted only when `NODE_ENV !== 'production'`, seeded by a dev-only `/api/dev-auth?email=X` route that must 404 in prod
- Notion-backed AI knowledge uses background sync/cache with no approval gate; sources are an n-source registry per `D-043`, managed end-to-end by operators through the Settings activation wizard and project detail page
- per-project `ai_auto_sync_schedule` is operator-configurable (`'never' | 'daily' | 'weekly'`); hourly cron handles the schedule
- admin mutations must be auditable via `audit_policy_evidence`
- Settings blocks Composer stage (per `D-026`); Composer builds on real Stage 2 auth
- Composer depends on DB-backed project-inbox aliases (`project_aliases` table replacing the `GMAIL_PROJECT_INBOX_ALIASES` env var; worker reads DB first, env as fallback during cutover)
- project activation requires a short project alias, at least one project-inbox alias, and a synthesized AI Knowledge document (or no sources registered if the project opts out)
- two or more Salesforce projects can share an alias via host/sub `connected_to_project_id` rollup (per `D-044`); subs inherit alias and AI Knowledge from the host, are excluded from the Inbox project filter, and cascade-deactivate with the host in one transaction

## Required Interfaces / Concepts

### MVP scope (must ship)

- Google SSO sign-in + session middleware gating `/inbox/*` and `/settings/*`
- project-inbox alias admin CRUD (replaces `GMAIL_PROJECT_INBOX_ALIASES` env var)
- short project alias admin editing on active/inactive projects
- users + roles admin (list users, promote/demote admin, deactivate; surfaced under **Settings → Team** as of 2026-05-10)
- activation wizard (pick project → aliases → signature → AI Knowledge sources → connected projects → review)
- AI Knowledge multi-source registry per project (add/remove Notion or web URL with optional per-row label, enable/disable per source, set auto-sync schedule, click Resync, see freshness/last-synthesized-at) — operator-managed end-to-end

### MVP scope (ship thin)

- organization settings (read-only card — org name, timezone `America/Denver`)
- integration health (read-only summary of `sync_state` by provider)

### Connected projects (host/sub rollup)

- activation wizard "Connected projects" step (multi-select inactive unconnected projects to roll into a new host; selections submit alongside activation)
- project detail (host view): "Connected projects" card with Disconnect + Add picker
- project detail (sub view): "Connected to {host}" badge + read-only alias and AI Knowledge sections inheriting from the host + destructive Disconnect at the bottom
- deactivate host cascades to subs in one transaction; deactivate dialog lists subs by name before confirming
- Settings projects list nests subs visually under their host with a "Connected to {host name}" subtitle
- alias-host-hop AI Knowledge fallback for connected subs (PR #405) — drafting in a sub-project reads the host's cached AI Knowledge doc

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

- after Stage 2, most operator-facing work starts from [inbox-bundle.md](./inbox-bundle.md)
