# AS Comms Platform

Internal volunteer communications platform for Adventure Scientists. Backend-first rebuild of an agent-assisted operator inbox that unifies Gmail + Salesforce + SMS + Mailchimp into a single canonical timeline per volunteer.

The platform is **pre-production** — running on Railway under a single admin account while ingestion correctness and operator workflows are hardened.

## Stages shipped

| Stage | Status | Surface |
|---|---|---|
| 0 — Engineering foundation | ✓ shipped | pnpm + turbo monorepo, Next.js App Router, Drizzle, Graphile Worker, strict TS, Vitest, Playwright, boundary + security gates |
| 1 — Data foundation | ✓ shipped | canonical event ledger, source-evidence log, identity resolution, Gmail + Salesforce capture services |
| 1B — Trust pass | ✓ shipped | launch-scope backfills, representative-contact proofs, parity/cutover/replay hardening |
| 2 — Settings / Admin | ✓ shipped | Auth.js v5 + Google SSO + JWT sessions, single-page Settings for Projects / Access / Integrations, admin mutations, 5-min integration-health cron |
| 3 — Inbox read surface | ✓ shipped | operator inbox with mixed contact list, filters, follow-up toggle, project filter, keyboard shortcuts, optimistic UI |
| 3.5 — Composer | ✓ shipped | Gmail send client, per-alias signature, durable send action + pending-outbounds reconciliation, inline draft pane + recipient picker + optimistic timeline, notes mode with author-only edit/delete |
| 4 — AI drafting assistant | in progress | Notion knowledge sync landing; draft generation pipeline + memory capture next. Provider: Anthropic Claude Sonnet 4.6 for drafts, OpenAI `text-embedding-3-small` for memory similarity |
| 5A — Email campaigns | deferred | post-validation of Inbox + Composer + AI |
| 5B — SMS campaigns | deferred | after 5A |
| 6 — Reporting | deferred | — |

Active sequence: **4 AI (Notion sync + draft pipeline) → 5 Campaigns**. Stage 3.5 Composer shipped in PRs #77, #79, #80, #82, #84 on 2026-04-21. Stage 4 Notion sync landing in #83.

## Locked stack

- Node 24+
- `pnpm` workspaces + `turbo`
- Next.js App Router + React 19
- TypeScript strict (no `any` on boundaries)
- Postgres (Railway) + Drizzle
- Graphile Worker
- Auth.js v5 with Google SSO
- Zod
- Tailwind CSS + shadcn/ui primitives
- Vitest + Playwright
- Deployed on Railway (web + worker + gmail-capture + salesforce-capture + Postgres services)

See `docs/01-core/decision-core.md` (D-020) for the authoritative stack canon.

## Workspace layout

```text
apps/web                        # Next.js app: inbox + settings + auth
apps/worker                     # Graphile Worker: ingest + ops
apps/gmail-capture              # Gmail live poller (1-min cadence)
apps/salesforce-capture         # Salesforce live poller (5-min cadence)
packages/contracts              # Shared Zod schemas + event taxonomy
packages/db                     # Drizzle schema, migrations, mappers, repositories
packages/domain                 # Normalization, persistence, dedup, identity resolution
packages/integrations           # Provider capture modules (gmail, salesforce, simpletexting, mailchimp)
packages/ui                     # Shared web UI primitives
docs/01-core                    # Agent-first canon (decisions, product, data, engineering)
docs/02-bundles                 # Stage-level spec bundles
docs/04-implementation-specs    # Detailed impl specs for locked decisions
```

## First-time setup

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm verify
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:e2e
pnpm boundaries
pnpm security
```

**macOS gotcha:** local `pnpm test:unit` may fail with a `rollup-darwin-arm64` code-signature error. Environmental, not a real test failure — CI is authoritative. If you hit it, reinstall node_modules.

## Common commands

```bash
# Dev servers
pnpm dev                                    # all apps
pnpm dev:web
WORKER_BOOT_MODE=run DATABASE_URL=postgres://... pnpm dev:worker
pnpm dev:gmail-capture
pnpm dev:salesforce-capture

# Worker ops (read packages/worker/src/ops/cli.ts for the full list)
pnpm ops:worker:check-config
pnpm ops:worker:import-gmail-mbox -- --mbox-path ... --captured-mailbox ...
pnpm ops:worker:inspect -- contact --salesforce-contact-id 003-stage1
pnpm ops:worker:backfill-salesforce-communication-details -- --dry-run
pnpm ops:worker:backfill-content-fingerprint -- --dry-run
pnpm ops:worker:dedup-historical-ledger -- --dry-run
pnpm ops:worker:reconcile-identity-queue -- --dry-run
pnpm ops:worker:reclassify-sf-direction -- --dry-run

# Gates + verification
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:e2e
pnpm boundaries          # Enforces repo-shape boundary rules from D-021
pnpm security            # Security gate (D-017)
pnpm verify              # Full Stage 0 verification suite
```

## Key architectural decisions

The `docs/01-core/decision-core.md` and `decision-log.md` are the authoritative canon. Most load-bearing decisions:

- **D-001** `restart-agent-focus` is the preferred implementation canon.
- **D-003** Salesforce `Contact.Id` is the primary identity anchor.
- **D-006** Gmail wins tie-breaks over Salesforce for the same outbound email.
- **D-020** Stack is locked (see list above).
- **D-025** Stage 2 Auth uses Auth.js v5 + Google + Drizzle; two flat roles (`admin`, `operator`); trusted-header dev bypass.
- **D-026** Composer is its own stage between Inbox (3) and AI (4).
- **D-027** Non-Salesforce contacts are first-class; unmatched emails auto-create a canonical contact with `salesforceContactId=null` instead of opening an identity review case.
- **D-028** Routing review only fires for Salesforce-anchored contacts.
- **D-032** Stage 4 AI is human-in-the-loop drafting with strict grounding order and one LLM call by default.
- **D-033 / D-034** Salesforce comms ingest excludes non-volunteer contacts.
- **D-035** Stage 2 auth session strategy is JWT, not database-backed (Edge Runtime middleware cannot decode database sessions).
- **D-036** `project_dimensions.is_active` is admin-owned.
- **D-037** (superseded 2026-04-21) → AI knowledge is discovered by matching Notion's `Project ID` property to `project_dimensions.project_id`. Activation gate is `ai_knowledge_synced_at IS NOT NULL`. The `ai_knowledge_url` column is retained as a cosmetic drill-through link.
- **D-038** Integration health is a polled projection, not live-on-demand.
- **2026-04-21 Stage 4 decisions (Q1–Q5):** Provider is **Anthropic Claude Sonnet 4.6** for drafts + OpenAI `text-embedding-3-small` for memory similarity. Soft cost cap of $20/day org-wide via `AI_DAILY_CAP_USD` (warn, never block). Tier-4 context: last 20 canonical events OR 90 days (smaller). Tier-5 memory masks PII, dedups via cosine > 0.95 within project, no TTL. Composer response envelope uses typed warning codes (`provider_timeout`, `over_budget`, `grounding_empty`, etc.) — over-budget and empty-grounding downgrade or warn, never block drafting.

## Deployment (Railway)

All services run in the Railway `zucchini-balance` project, `production` environment:

- `as-comms-platform` — web service (Next.js)
- `worker` — Graphile Worker (ingest + ops)
- `gmail-capture` — Gmail polling (1-min)
- `salesforce-capture` — Salesforce polling (5-min)
- `Postgres` — managed Postgres

Railway **auto-deploys on push to `main`**. Capture services poll on their own cadence; worker picks up their records via the ingest endpoint.

**⚠ Railway does NOT auto-run migrations on deploy.** Every schema change in `packages/db/drizzle/*.sql` needs a manual `psql` run against Railway Postgres before the matching code deploy completes, or the first query against the new column will 500. Preferred pattern:

```bash
cat packages/db/drizzle/NNNN_*.sql | railway connect Postgres
```

## Operator workflow

At 1–3 active operators handling ~20–80 inbound/day, the inbox is a shared mixed list — no assignee partitioning. Daily workflow: unread-first triage, search-by-volunteer name for phone-call lookups, project filter for campaign context. See `docs/02-bundles/inbox-bundle.md` for the full spec.

## Active correctness work (April 2026)

A broad ingestion/display correctness audit against 22 representative contacts surfaced several systemic issues that shipped fixes as of 2026-04-21:

- **D-027 identity resolution** (PR #73) — implements the spec'd "unmatched email auto-creates canonical contact" path. ~10,000 previously-stuck review cases cleared via `reconcile-identity-queue` ops script.
- **SF Task direction parsing** (PR #74) — 1,245 inbound rows previously mislabeled as outbound now correctly typed; subject arrows stripped.
- **Gmail body untruncation** (PR #74) — removed the 2,000-char hard cap; tightened quoted-reply regex that was truncating bodies on ordinary phrases like "update on placing…".
- **Cross-provider + intra-Gmail dedup** (PRs #71, #75) — content-fingerprint fallback for when `rfc822_message_id` isn't available (Salesforce side); collapses the cohort-wide SF Flow double-fire pattern.
- **Reconcile script redesign** (PR #76) — reconstructs canonical events from stored DB rows instead of re-parsing mbox files; works inside the Railway worker container without local filesystem access.

Prod ops run 2026-04-21 against these fixes: 1,245 inbound rows reclassified + 1,528 stuck queue cases cleared + 2,402 content fingerprints populated + 54 stale projection rows refreshed. Remaining projection gap of 146 contacts (pure-outbound-before-reclassify) awaits the `rebuild-inbox-projections` ops command (brief in `.audit-ingestion-2026-04-21/briefs/fix-projection-rebuild.md`).

See `.audit-ingestion-2026-04-21/SUMMARY.md` for the full audit and prioritized fix list.

## Known P0 operational gap

**Railway does not auto-run drizzle migrations on deploy**, and this has caused three separate ~15-minute prod web outages on 2026-04-21 alone (PRs #79, #80, #84). Every schema PR requires the architect to run `psql -f` manually between merge and deploy-completion. A pre-start migration runner hook on the web + worker services is a **P0 follow-up** — one Codex brief away. Without it, every future schema PR is a prod outage risk.

## Memory / agent context

Architect + reviewer agents working on this repo should auto-load from `~/.claude/projects/-Users-nicolas-Downloads-AS-Comms-Platform/memory/`. Load-bearing entries:

- `project_overview.md`, `project_stage_sequence.md`
- `project_composer_stage.md`, `project_composer_scope.md`
- `project_docs_authority.md` (canon wins on contradictions; bundles + impl-specs derive from it)
- `feedback_role.md` (collaboration mode: architect + reviewer, not primary coder)
- `feedback_codex_coordination.md`, `feedback_codex_model_effort.md` (Codex dispatch patterns)

## Project discipline

- Feature branches + PRs — never edit `main` directly.
- Canon first, code second — for architecture decisions, update `docs/01-core/decision-core.md` + `decision-log.md` before building.
- Don't amend published commits; create new commits.
- Destructive prod ops need per-session user sign-off each time; earlier approvals do not carry across sessions.

---

## Deeper references

- `docs/01-core/` — canon (decisions, product, data, engineering, delivery, interfaces)
- `docs/02-bundles/` — stage spec bundles (inbox-bundle.md, settings-bundle.md, etc.)
- `docs/04-implementation-specs/` — detailed impl specs per decision
- `docs/stage-1-runtime.md`, `docs/stage-1-capture-services.md`, `docs/stage-1-acceptance.md`, `docs/stage-1-validation-runbook.md`
- `docs/03-reference/` — Salesforce mapping, legacy-conflict lookup
