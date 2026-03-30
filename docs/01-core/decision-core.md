# Decision Core

**Role:** compact locked-decision canon  
**Audience:** all implementers  
**When to read:** before changing product behavior, architecture, stack, repo shape, or workflow  
**Authority:** authoritative for currently locked decisions needed during implementation  
**Decides:** what may not change without a canon update  
**Does not decide:** deep historical supersession detail or donor evidence rationale

## Summary

- This file is the compact decision surface for agents.
- If implementation needs to break one of these, update the canon before coding.
- Use `restart-prd/decision-log.md` only when deep legacy comparison is needed.

## Locked Decisions

| ID | Locked decision | Why it matters |
| --- | --- | --- |
| `D-001` | `restart-agent-focus` is the preferred implementation canon. | One agent-first authority surface. |
| `D-002` | The restart is a fresh rebuild in a new repo. | Donor repo is evidence, not baseline. |
| `D-003` | Salesforce Contact ID is the primary identity anchor. | Strongest cross-channel identity. |
| `D-004` | Ambiguous identity must go to manual resolution. | Wrong links are worse than temporary review work. |
| `D-005` | Historical backfill and live ingest share one normalization path. | No dual truths. |
| `D-006` | Gmail wins tie-breaks over Salesforce for the same outbound email. | Stronger transport identifiers. |
| `D-007` | Settings is required before Inbox is production-ready. | Routing, access, timezone, and knowledge config must be app-owned. |
| `D-008` | Notion-backed AI knowledge uses background sync/cache with no approval gate. | Simpler, less approval-heavy workflow. |
| `D-009` | AI never sends automatically. | Human review is mandatory. |
| `D-010` | Internal notes are in the first restart Inbox release. | Lightweight collaboration is core. |
| `D-011` | Owners and tags are out of the first restart Inbox release. | Avoids unnecessary first-release complexity. |
| `D-012` | Inbox uses `New` and `Opened`, with `Starred` as a separate follow-up flag and unresolved layered on top. | Simpler Gmail-familiar operator model. |
| `D-013` | Gmail remains the one-to-one email transport after cutover. | Locked operational topology. |
| `D-014` | Email Campaigns ship before SMS Campaigns. | Trust milestone order is fixed. |
| `D-015` | Campaign content and review state stay product-owned. | Provider is delivery, not authoring truth. |
| `D-016` | Final cutover uses a short read-only delta window with explicit approval or rollback. | Visible and reversible migration. |
| `D-017` | Security is a standing stage gate. | No end-only security review. |
| `D-018` | Hosting choice is operational context, not product architecture. | Runtime should not distort product design. |
| `D-020` | Stack is locked to Next.js App Router, React 19, TS strict, Supabase Postgres, Drizzle, Graphile Worker, Zod, Tailwind, Node 24+, `pnpm`, `turbo`. | Keeps implementation disciplined. |
| `D-021` | Repo shape is locked to web + worker + shared packages. | Prevents architecture drift. |
| `D-022` | Build Web Apps is limited to approved web and UI surfaces. | UI acceleration without system-design drift. |
| `D-023` | Curated Vercel React / Next rules are mandatory. | Performance and maintainability are part of the build. |
| `D-024` | CI must enforce boundary, performance, verification, and security gates. | Guardrails must be enforceable. |

## Change Rule

Before changing any locked decision:

1. update the canon
2. update the affected task bundle
3. only then implement the change

## Read Next

- repo and frontend constraints: [`engineering-core.md`](./engineering-core.md)
- legacy conflict lookup: [`../03-reference/reference-legacy-conflicts.md`](../03-reference/reference-legacy-conflicts.md)
