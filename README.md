# AS Comms Platform

Internal volunteer communications platform for Adventure Scientists. Backend-first rebuild of an agent-assisted operator inbox that unifies Gmail + Salesforce + SMS + Mailchimp into a single canonical timeline per volunteer.

The platform is running on Railway under a single admin account. Stage 5A (Email Broadcasts, project-scope, Markdown composer) shipped mid-May (#418-#436) and cleared operator validation on 2026-06-08. Since then: the Stage 5C HTML composer carve-out (Unlayer editor, `kind='project'` only, plus R2-hosted broadcast media library, HTML upload sub-mode, and org senders) shipped 2026-06-09 (D-050, PRD #536); the SMS 1:1 platform went LIVE on 2026-07-01 after A2P 10DLC approval; and both SMS Broadcasts (PRD #589) and Newsletter migration off Mailchimp (PRD #584) are in flight. Stage 6 (Workflows replacing Salesforce Auto-Emails) remains undefined roadmap intent.

## Stages shipped

| Stage | Status | Surface |
|---|---|---|
| 0 — Engineering foundation | ✓ shipped | pnpm + turbo monorepo, Next.js App Router, Drizzle, Graphile Worker, strict TS, Vitest, Playwright, boundary + security gates |
| 1 — Data foundation | ✓ shipped | canonical event ledger, source-evidence log, identity resolution, Gmail + Salesforce capture services |
| 1B — Trust pass | ✓ shipped | launch-scope backfills, representative-contact proofs, parity/cutover/replay hardening |
| 2 — Settings / Admin | ✓ shipped | Auth.js v5 + Google SSO + JWT sessions, Projects / Team / Integrations, integration-health cron, **self-serve activation wizard**, **connected-projects host/sub rollup** |
| 3 — Inbox read surface | ✓ shipped | mixed-list contact inbox, follow-up flag, unresolved overlay, **unified search bar** (contacts + conversations), **AS / External row chips**, **unread blue dot + count**, project filter (excludes connected subs), keyboard shortcuts, optimistic UI |
| 3.5 — Composer | ✓ shipped | Gmail send client, per-alias signature, durable send action + pending-outbounds reconciliation, inline draft pane + recipient picker + optimistic timeline, **Pin Note**, **"Write a message"** collapsed bar, **Forward action**, SMS surface |
| 4 — AI drafting | ✓ shipped | Claude Sonnet 4.6 drafts; three-layer grounding; **multi-source AI Knowledge registry** (Notion + web URLs per project, merged into one cached doc); **auto-sync schedule** (`Never` / `Daily` / `Weekly`); **skip-if-unchanged** hashing; **threshold-triggered re-synthesis** after ≥5 "Send and save for AI" flags; **alias-host-hop fallback** so connected sub-projects inherit AI Knowledge from their host |
| V — Validation gate (Inbox + Composer + AI) | ✓ validated (2026-06-08) | real operator use of Inbox + Composer + AI in production; ran in parallel with Stage 5A code merges |
| 5A — Email Broadcasts (project-scope, Markdown) | ✓ shipped + validated | Markdown composer shipped #418-#436; operator validation cleared 2026-06-08. Postmark transport, audience builder + frozen snapshot, send orchestrator + merge renderer, run detail + metric tiles + cancel + 30-day finalization, public unsubscribe page + per-recipient tokens (3 scopes), broadcasts list with Mailchimp UNION projection, 6-step wizard, trusted-admin gate. See `D-045`, `D-046`. |
| 5C HTML composer (project scope, Unlayer) | ✓ shipped (2026-06-09) | Unlayer drag-and-drop HTML editor for `kind='project'` broadcasts shipped via PRD #536 (PRs #537-#540). Companion capabilities: broadcast media library on Cloudflare R2 (PRD #567), HTML upload sub-mode for pasted-in HTML (PRD #568), org senders in composer + sender-gated audience modes (PRD #577), AS-branded default template + export-design button, signature suppression on HTML emails. See `D-050`. |
| 5B — SMS 1:1 (Composer) | ✓ LIVE (2026-07-01) | A2P 10DLC port approval cleared; SMS 1:1 platform launched. Composer SMS tab defaults for phone-registered contacts, sender auto-select, MMS gated with "not available yet" tooltip. |
| 5B — SMS Broadcasts | 🟡 in flight | Wizard authoring, preview, send, opt-out footer, merge tokens, freeze planner, worker send shipped across PRD #589 Bricks 1-5 (PRs #590-#613). Consent reconciliation from Salesforce `Text_Opt_In__c` + `Phone_Number__c` capture (Bricks 1b-1, 1b-2). First production sends imminent. |
| 5C — Newsletter migration + Mailchimp decommission | 🟡 in flight | `newsletter_subscribers` + `newsletter_suppressions` store (PRD #584 Brick 1); Mailchimp CSV import (Brick 2); `all_available` audience mode + generalized send ledger (Brick 3); newsletter unsubscribe write-back + configurable broadcast stream + subdomain sender (Brick 4). Mailchimp decommission gated on real production use of the new newsletter path. See `D-051`. |
| 6 — Workflows (replace Salesforce Auto-Emails) | ⏳ roadmap intent | no product definition yet — deliberately undefined until Stage 5C newsletter migration completes (`D-046`) |

**Active phase:** Stage 5B SMS Broadcasts + Stage 5C Newsletter migration in flight. Stage 5A cleared operator validation 2026-06-08; the Stage 5C HTML composer carved out and shipped 2026-06-09 (`D-050`, PRD #536) with the broadcast media library on Cloudflare R2 (PRD #567), HTML upload sub-mode (PRD #568), and org senders (PRD #577, `D-052`). SMS 1:1 platform LIVE 2026-07-01 after A2P 10DLC approval. SMS Broadcasts (PRD #589) and Newsletter migration off Mailchimp (PRD #584) are landing brick-by-brick; the newsletter audience is a dedicated store (`newsletter_subscribers`), separate from `contacts`, per `D-051`. Also since May: ops alerts via a single sender module (`D-047`, PRD #444); email timeline bubble side-rendering rule (`D-049`); composer drafts (PRD #553); Gmail read/reply sync for New→Opened (PRD #565); Drive attachment chips (PRD #517); AI Polish mode moved to Composer toolbar; Salesforce weekly reconciliation cron with 5% delete cap (PRD #544).

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
- Deployed on Railway (web + worker + 4 capture services + Postgres)

External services in use: **Anthropic Claude Sonnet 4.6** (AI Draft + synthesis), **Notion** (AI Knowledge source pages + synthesized output), **Twilio** (SMS), **Salesforce** (volunteer + expedition system of record), **Gmail** (one-to-one email transport).

See `docs/01-core/decision-core.md` (D-020) for the authoritative stack canon.

## Workspace layout

```text
apps/web                        # Next.js app: inbox + settings + auth + composer
apps/worker                     # Graphile Worker: ingest + ops + synthesis + cron polls
apps/gmail-capture              # Gmail live poller (1-min cadence)
apps/salesforce-capture         # Salesforce live poller (5-min cadence)
apps/sms-capture                # Twilio inbound webhook handler (launch pending)
apps/mailchimp-capture          # Mailchimp historical/transition capture (sunsetting)
packages/contracts              # Shared Zod schemas + event taxonomy
packages/db                     # Drizzle schema, migrations, mappers, repositories, in-process migrator
packages/domain                 # Normalization, persistence, dedup, identity resolution
packages/integrations           # Provider capture modules (gmail, salesforce, simpletexting, mailchimp, notion, anthropic, ai-knowledge sources)
packages/ui                     # Shared web UI primitives
docs/01-core                    # Agent-first canon (decisions, product, data, engineering)
docs/02-bundles                 # Stage-level spec bundles
docs/04-implementation-specs    # Detailed impl specs for locked decisions
docs/runbooks                   # Failure-mode runbooks (gmail-capture-stopped, ai-draft-failed, ai-knowledge-sync-failed, etc.)
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
pnpm dev:sms-capture

# Worker ops (read packages/worker/src/ops/cli.ts for the full list)
pnpm ops:worker:check-config
pnpm ops:worker:import-gmail-mbox -- --mbox-path ... --captured-mailbox ...
pnpm ops:worker:inspect -- contact --salesforce-contact-id 003-stage1
pnpm ops:worker:synthesize-project-knowledge -- --project-id <id>
pnpm ops:worker:backfill-salesforce-communication-details -- --dry-run
pnpm ops:worker:backfill-content-fingerprint -- --dry-run
pnpm ops:worker:dedup-historical-ledger -- --dry-run
pnpm ops:worker:reconcile-identity-queue -- --dry-run
pnpm ops:worker:reclassify-sf-direction -- --dry-run
pnpm ops:worker:reconcile-stale-canonical -- --dry-run
pnpm ops:worker:reconcile-capture-gaps -- --dry-run

# SMS launch ops (consent backfill + sender seed, see #402)
pnpm ops:worker:backfill-sms-consent -- --dry-run
pnpm ops:worker:seed-sms-senders -- --dry-run

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
- **D-032** Stage 4 AI is human-in-the-loop drafting with strict grounding order and one LLM call by default; memory captured only from human-approved sent replies.
- **D-033 / D-034** Salesforce comms ingest excludes non-volunteer contacts.
- **D-035** Stage 2 auth session strategy is JWT, not database-backed.
- **D-036** `project_dimensions.is_active` is admin-owned.
- **D-037** (superseded twice) → see D-043 below for the current AI Knowledge architecture.
- **D-038** Integration health is a polled projection, not live-on-demand.
- **D-040** Inbox server pages are `force-dynamic`; server actions and ops scripts do not invalidate any tags.
- **D-041** (2026-05-07) Staff-originated email delivered to the monitored Gmail inbox is inbound one-to-one attention; the `AS` green chip surfaces it.
- **D-042** (2026-05-07) Phone↔contact is many-to-many through `contact_identities` of `kind='phone'`; multi-candidate matches anchor to the most-recent-active contact and open an `identity_resolution_queue` case. Supersedes PRD #277 Shape A.
- **D-043** (2026-05-10) AI Knowledge is an n-source registry (`ai_knowledge_sources`) merged by the synthesis worker into one cached doc. Three loops keep it current: per-project `ai_auto_sync_schedule` (`'never' | 'daily' | 'weekly'`) driven by an hourly cron; skip-if-unchanged hash compare short-circuits the LLM call; threshold trigger (≥5 approved-for-AI rows since last synthesis) enqueues re-synthesis automatically. Operators self-serve activation via the Settings wizard. "Send and save for AI" IS the Tier-3 approval — no separate review UI.
- **D-044** (2026-05-10) Two or more Salesforce projects can share an alias + AI Knowledge via host/sub `connected_to_project_id`; subs inherit from host, Inbox filter excludes subs, deactivating a host cascades to subs in one transaction.
- **2026-04-21 Stage 4 framing decisions:** Provider is **Anthropic Claude Sonnet 4.6** (Anthropic-only; the earlier OpenAI embedding plan was decisively closed in the 2026-04-27 architecture collapse). Soft cost cap of $20/day org-wide via `AI_DAILY_CAP_USD` (warn, never block). Composer response envelope uses typed warning codes (`provider_timeout`, `over_budget`, `grounding_empty`, etc.) — over-budget and empty-grounding downgrade or warn, never block drafting.

## Deployment (Railway)

All services run in the Railway `zucchini-balance` project, `production` environment:

- `as-comms-platform` — web service (Next.js)
- `worker` — Graphile Worker (ingest + ops + AI synthesis + cron polls)
- `gmail-capture` — Gmail polling (1-min)
- `salesforce-capture` — Salesforce polling (5-min)
- `sms-capture` — Twilio inbound webhook handler (deployment pending SMS launch)
- `mailchimp-capture` — Mailchimp transition capture (sunsetting after Stage 5A)
- `Postgres` — managed Postgres

Railway **auto-deploys on push to `main`**. Capture services poll on their own cadence; worker picks up their records via the ingest endpoint and runs the hourly `poll-ai-knowledge-auto-sync` + daily `reconcile-capture-gaps` cron tasks.

**Migrations run in-process at worker bootstrap** (`packages/db/src/migrator.ts`, invoked from `apps/worker/src/runtime.ts` per issue #286). The earlier P0 gap — Railway's `preDeployCommand` silently no-op'ing — is resolved. Schema changes deploy with the matching code; no manual `psql` step required.

## Recent progress (May 2026)

A representative slice of what's shipped since the April 2026 audit:

- **AI Knowledge architecture rebuilt (PRD #366, locked as D-043)** — n-source registry, synthesis orchestrator (worker job + ops CLI), Settings wizard + project detail UI, hourly auto-sync cron with skip-if-unchanged, threshold-triggered re-synthesis from "Send and save for AI". Anthropic timeout bumped to 180s for synthesis (#387). PR series: #367, #371, #372, #373, #376, #377, #387, #399, #400.
- **Connected projects (locked as D-044)** — `connected_to_project_id` self-FK + chain-prevention trigger + active-alias CHECK relaxation; wizard step + project detail card + cascade deactivation; Settings nesting + Inbox filter exclusion; alias-host-hop AI Knowledge fallback so connected subs inherit from the host at draft time. PRs: #384, #388, #389, #405.
- **Unified Inbox search (PR #379)** — single header search bar with two-section results (contacts + conversations). Replaces the dedicated `/inbox/all-contacts` route shipped briefly in #374.
- **Inbox + Composer polish** — Pin Note, "Write a message" rename, `AS` green chip for staff-origin conversations, inline-signature image hiding, unread count in list header title (#401), unread blue dot on list rows (#404), Forward action in Composer (#405), net-new compose no longer drafts as a reply (#403), structured fetch-error logs. PRs: #348, #350, #353, #363, #375, #378, #381, #386, #401, #403, #404, #405.
- **Phone identity model (locked as D-042, PR #354)** — inbound SMS routing reads `contact_identities` of `kind='phone'`; multi-candidate matches open an `identity_resolution_queue` case instead of routing nondeterministically.
- **Staff-origin Gmail (locked as D-041, PR #348)** — staff/admin email to monitored inboxes counts as inbound attention.
- **Settings polish** — `Access` → `Team` rename, integrations page layout, Anthropic live status, live re-sync feedback, actionable Notion access errors, stale-banner suppression pre-first-synthesis, tab panel content leak fix, wizard AI Knowledge URL + label per row. PRs: #351, #378, #382, #385, #399, #400.
- **SMS launch prep (D-042)** — consent backfill + `sms_senders` seed scripts merged (#402); Twilio A2P 10DLC port from SimpleTexting completed 2026-05-11; `apps/sms-capture` deployment pending the launch window.
- **Pre-launch security hardening** — `timingSafeEqual` on shared-secret comparisons, attachment audit, secret-pattern scans (#396); `getClientIp` trust-order fix for Railway's spoofable `x-forwarded-for` (#398).
- **Runbook coverage** — new `ai-knowledge-sync-failed.md` runbook (#393); existing runbooks unchanged.

For the human-facing version of "what changed and why," see the Notion docs:
- [Volunteer Communications Platform (front page)](https://www.notion.so/3368a9129211800f9cfcc08c44a1c0a1)
- [Operator Guide](https://www.notion.so/3558a912921181f49f7be2a7f8ec3103)
- [AI Drafting](https://www.notion.so/3558a912921181c980f7c2311686c536)
- [Technical Overview](https://www.notion.so/3558a912921181b8bb72edd69b62b978)
- [Stage progression](https://www.notion.so/3398a91292118044a6a5efa46ba85b38)

Interactive system map (post-deploy): https://as-comms-platform-production.up.railway.app/flow

## Operator workflow

At 1–3 active operators handling ~20–80 inbound/day, the inbox is a shared mixed list — no assignee partitioning. Daily workflow: unread-first triage, unified search bar for phone-call lookups, project filter for campaign context. See `docs/02-bundles/inbox-bundle.md` for the full spec.

## April 2026 correctness audit (historical)

A broad ingestion/display correctness audit against 22 representative contacts surfaced several systemic issues that shipped fixes on 2026-04-21:

- **D-027 identity resolution** (PR #73) — implements the spec'd "unmatched email auto-creates canonical contact" path. ~10,000 previously-stuck review cases cleared via `reconcile-identity-queue` ops script.
- **SF Task direction parsing** (PR #74) — 1,245 inbound rows previously mislabeled as outbound now correctly typed; subject arrows stripped.
- **Gmail body untruncation** (PR #74) — removed the 2,000-char hard cap; tightened quoted-reply regex.
- **Cross-provider + intra-Gmail dedup** (PRs #71, #75) — content-fingerprint fallback for missing `rfc822_message_id`; collapses cohort-wide SF Flow double-fire pattern.
- **Reconcile script redesign** (PR #76) — reconstructs canonical events from stored DB rows instead of re-parsing mbox files.

Prod ops run 2026-04-21: 1,245 inbound rows reclassified + 1,528 stuck queue cases cleared + 2,402 content fingerprints populated + 54 stale projection rows refreshed.

See `.audit-ingestion-2026-04-21/SUMMARY.md` for the full audit and prioritized fix list.

## Memory / agent context

Architect + reviewer agents working on this repo should auto-load from `~/.claude/projects/-Users-nicolas-Downloads-AS-Comms-Platform/memory/`. Load-bearing entries:

- `project_overview.md`, `project_stage_sequence.md`
- `project_docs_authority.md` (canon wins on contradictions; bundles + impl-specs derive from it)
- `feedback_role.md` (collaboration mode: architect + reviewer, not primary coder)
- `feedback_codex_coordination.md`, `feedback_codex_model_effort.md`, `feedback_codex_concurrency_and_token_strategy.md`
- `feedback_stage4_guardrails_2026_04_24.md`
- `project_shared_alias_pattern_forests_2026_05_07.md` (the production case behind D-044)
- `project_sms_launch_state_2026_05_07.md` (SMS launch state and ops the architect runs)

## Project discipline

- Feature branches + PRs — never edit `main` directly.
- Canon first, code second — for architecture decisions, update `docs/01-core/decision-core.md` + `decision-log.md` before building.
- Don't amend published commits; create new commits.
- Destructive prod ops need per-session user sign-off each time; earlier approvals do not carry across sessions.

---

## Deeper references

- `docs/01-core/` — canon (decisions, product, data, engineering, delivery, interfaces)
- `docs/02-bundles/` — stage spec bundles (inbox-bundle.md, settings-bundle.md, ai-bundle.md, etc.)
- `docs/04-implementation-specs/` — detailed impl specs per decision
- `docs/runbooks/` — failure-mode runbooks
- `docs/stage-1-runtime.md`, `docs/stage-1-capture-services.md`, `docs/stage-1-acceptance.md`, `docs/stage-1-validation-runbook.md`
- `docs/03-reference/` — Salesforce mapping, legacy-conflict lookup
