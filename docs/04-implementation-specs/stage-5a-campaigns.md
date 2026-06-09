# Stage 5A Email Broadcasts — Implementation Spec

**Role:** load-bearing constraint scaffolding for the Stage 5A build (historical "Phase A → C" naming preserved below; see mapping note)  
**Audience:** Codex briefs + reviewing engineers + future agents picking up Stage 5A / 5B / 5C work  
**When to read:** before writing any Stage 5A / 5C code; after PRD [#412](https://github.com/nico-kneler-as/as-comms-platform/issues/412) and `02-bundles/campaigns-bundle.md`  
**Authority:** implementation-spec layer under the core canon; `01-core/*` + `D-045` + `D-046` win on contradictions  
**Decides:** module-to-package placement, naming, reuse vs new, migration ordering, brief dependency graph  
**Does not decide:** product behavior (PRD) or visual design (design brief at `docs/design-briefs/stage-5a-campaigns.md`)

> **Naming note (2026-05-19, `D-046`):** this spec was authored when Stage 5A bundled four phases (A / B / C / D=5B). The terminology was restructured into discrete stages on 2026-05-19. **Map old → new while reading:** "Phase A" → **Stage 5A** (Email Broadcasts, project-scope, shipped); "Phase B" + "Phase C" → **Stage 5C** (HTML composer shipped 2026-06-09 per PRD #536; newsletter migration + Mailchimp decommission remain deferred Stage 5C work); "Phase D / 5B" → **Stage 5B** (SMS, gated on A2P 10DLC approval, independent of email work); "Stage 6 (Reporting)" → **Stage 6 (Workflows replacing Salesforce Auto-Emails, undefined roadmap intent)**. The Phase A schema and code described below are accurate to what shipped; the Phase B/C plans below feed into Stage 5C work whenever it's dispatched.

## Summary

- Stage 5A shipped the Composer-as-editor + project sends. The Unlayer HTML composer shipped 2026-06-09 as a Stage 5C carve-out per PRD #536. Newsletter migration + Mailchimp decommission remain Stage 5C work, gated on real operator use of HTML broadcasts in production.
- Provider is **Postmark Basic** (10K tier for Phase A/B, 50K for Phase C). Not SendGrid. Not Marketing Campaigns.
- Eight deep modules in `packages/domain` driven by Server Actions in `apps/web` and a worker orchestrator in `apps/worker`.
- Five new tables in `packages/db`; one of them (`campaign_run_projection`) is a UNION view over Postmark runs + existing `mailchimp_campaign_activity_details`.
- Webhook ingest lives in a single `apps/web/app/api/webhooks/postmark/route.ts` handler with HMAC verification — mirrors the `apps/sms-capture/src/server.ts` pattern.
- No code merges to `main` until the `V` validation gate is signed off (per `D-031`). This spec, the design brief, and canon updates may land independently.

## Locked dependencies

- PRD: [412](https://github.com/nico-kneler-as/as-comms-platform/issues/412)
- Decision: `D-045` (this spec); locks Postmark + the Phase A → C phasing
- Inherited canon: `P-02` (Inbox contact-centric), `P-05` (broadcasts share identity + timeline), `D-014`, `D-015`, `D-027`, `D-029`, `D-031`, `D-040` (force-dynamic), `D-041`, `D-042`, `D-044`
- Design brief: [stage-5a-campaigns.md](../design-briefs/stage-5a-campaigns.md)

## Module placement

Eight deep modules + their package homes. Repo shape is locked (`D-021`); these mappings cannot drift.

| Module | Package | File | Why this package |
|---|---|---|---|
| AudienceResolver | `packages/domain` | `src/broadcasts/audience-resolver.ts` | Pure business rules over canonical contact + membership + identity; reads via repos, no provider imports |
| ExclusionFilter | `packages/domain` | `src/broadcasts/exclusion-filter.ts` | Consults ConsentLedger + SuppressionManager; pure decision function |
| MergeRenderer | `packages/domain` | `src/broadcasts/merge-renderer.ts` | Pure HTML/text rendering + token validation; no I/O |
| ConsentLedger | `packages/domain` | extends existing `src/consent.ts` | Reuse the existing ConsentRecord shape; add `scope` discriminator |
| SuppressionManager | `packages/domain` | `src/broadcasts/suppression.ts` | Pure decision over suppression rows; webhook event mapper kept here |
| CampaignSendOrchestrator | `apps/worker` | `src/jobs/campaign-send/orchestrator.ts` + `index.ts` | Worker-owned per `engineering-core.md` job rules; structure mirrors `synthesize-project-knowledge/` |
| PostmarkClient | `packages/integrations` | `src/providers/postmark.ts` | Provider adapter package; sibling to twilio/notion/anthropic |
| CampaignRunProjection | `packages/db` | extension of `src/repositories.ts` + `src/schema/views.ts` (new) | Read model via SQL UNION; lives next to existing repositories |

## Reuse map — leverage vs new

### Leverage existing

| Need | Existing module to reuse | Notes |
|---|---|---|
| Consent storage shape | `packages/domain/src/consent.ts` (`ConsentRecord`) | Extend with `scope: 'project' | 'newsletter' | 'all'` + nullable `scopeId`. Existing SMS consent stays unchanged; broadcasts layer on. |
| Email body composition surface | `apps/web/app/inbox/_components/composer-editor-surface.tsx` + `composer-toolbar.tsx` + `composer-html.ts` + `composer-shared.ts` | Phase A Markdown compose is a thin wrapper around these. Do NOT fork. |
| HMAC webhook handler | `apps/sms-capture/src/server.ts` (Twilio inbound) + `apps/web/app/api/internal/revalidate/route.ts` shared-secret pattern | Postmark webhook follows the same `timingSafeEqual` pattern (per `project_pr218_sf_capture_regression_2026_04_30.md`, never use `===` for shared-secret comparisons). |
| Worker job structure | `apps/worker/src/jobs/synthesize-project-knowledge/` (`index.ts` + `orchestrator.ts`) | Direct template for `campaign-send/`. |
| Polled-projection cron pattern | `apps/worker/src/jobs/integration-health/` | Direct template for `poll-postmark-sender-status` cron. |
| Provider client + Zod webhook schema | `packages/integrations/src/providers/twilio.ts` (exports schemas) | Direct template for `postmark.ts`. |
| Inbox-like server page caching | `apps/web/app/inbox/layout.tsx` `export const dynamic = 'force-dynamic'` | Apply to `apps/web/app/broadcasts/layout.tsx` per `D-040`. No `revalidateTag` calls. |
| Project filter dropdown | Existing inbox project filter (excludes connected subs per `D-044`) | **Audience builder uses a DIFFERENT picker** — host + subs as equal-rank. Do not blindly reuse the Inbox filter component; build a sibling picker in `apps/web/app/broadcasts/_components/`. |
| Activation wizard step pattern | `apps/web/app/settings/_components/activation-wizard/` | Direct template for the 5-step broadcast create wizard's left rail + step navigation. |
| Composer canonical modal test pattern | `apps/web/app/inbox/_components/__tests__/composer-canonical-modal.test.tsx` | When testing the broadcast wizard modal, mirror this pattern — and heed the gotchas in `project_composer_canonical_modal_test_gotchas.md`. |
| Canonical event taxonomy | `packages/contracts/src/stage1-taxonomy.ts` — `campaign.email.sent/opened/clicked/unsubscribed`, channel `campaign_email`, `communication_message_kind='campaign'` | Already present. Phase A adds `campaign.email.delivered` + `campaign.email.bounced` + `campaign.email.complained` only if not already there (verify in Brief A1). |
| Mailchimp historical data | `mailchimp_campaign_activity_details`, `mailchimp_campaign_tail_state` | Read-only during Phase A/B. Basis for the UNION view in `CampaignRunProjection`. Do not modify schema. |
| Identity rules + canonical contact creation | `packages/domain/src/contact-resolution.ts` `ensureCanonicalContactForEmail` | Audience builder reads canonical contacts; no resolver changes needed. |

### Build new (Phase A only)

| New artifact | Package | Brief |
|---|---|---|
| `campaign_runs` table | `packages/db/src/schema/tables.ts` | A1 |
| `audience_snapshots` table | `packages/db/src/schema/tables.ts` | A1 |
| `contact_consent` table (extends existing `consent_records`? see decision below) | `packages/db/src/schema/tables.ts` | A1 |
| `suppression_list` table | `packages/db/src/schema/tables.ts` | A1 |
| `campaign_run_projection` SQL view | `packages/db/src/schema/views.ts` (new file) + migration | A1 |
| `postmark_sender_status` column on `project_aliases` (or wherever aliases live — verify in A1) | `packages/db/src/schema/tables.ts` | A1 |
| `org_settings` single-row table | `packages/db/src/schema/tables.ts` | A1 |
| Stage 5 Zod contracts | `packages/contracts/src/stage5-campaigns.ts` (new file) | A1 |
| PostmarkClient | `packages/integrations/src/providers/postmark.ts` | A2 |
| `apps/web/app/api/webhooks/postmark/route.ts` | `apps/web` | A2 |
| `apps/worker/src/jobs/campaign-send/` | `apps/worker` | A3 |
| `apps/worker/src/jobs/poll-postmark-sender-status/` cron | `apps/worker` | A2 |
| `apps/web/app/broadcasts/` route tree | `apps/web` | A4-A6, A8 |
| `apps/web/app/u/[token]/` public unsubscribe route | `apps/web` | A7 |

### Decision: `contact_consent` table vs extending `consent_records`

The existing `consent_records` table is phone-keyed and SMS-specific (STOP/HELP/UNSTOP per `D-042`). The broadcasts consent model is email-keyed with a 3-scope discriminator (project / newsletter / all).

**Decision: new `contact_consent` table.** Reasons:
- Different key (email vs phone) means different unique constraints and indexes
- Different lifecycle (recipient click on per-recipient unsubscribe token vs Twilio compliance event)
- Mixing them complicates the `canSendTo` function and the audit log
- The `packages/domain/src/consent.ts` `canSendTo` helper stays SMS-only; broadcasts gets its own `isConsentedFor` function in `consent.ts` alongside

Both tables follow the same ConsentRecord-like shape (subject + status + source + timestamps) so the audit pattern stays uniform.

## Anti-patterns to avoid (scar tissue from memory)

| Don't | Why | Memory reference |
|---|---|---|
| Add a 5th invalidation signal for worker-driven writes | `D-040` resolved this by going `force-dynamic` everywhere; broadcast read pages MUST follow | `feedback_merge_and_railway_authority.md` + `D-040` |
| Stack a 6th dedup layer when handling Postmark events that overlap Mailchimp historical | The dedup architecture already has 5 layers; consolidate via Message-ID + content fingerprint, do not extend | `project_dedup_architecture_debt.md` |
| Auto-link ambiguous identity in the audience builder | `D-004` + `D-027`: unmatched email auto-creates a canonical contact; only true ambiguity opens review | `project_email_only_contact_dupe_pattern.md` |
| Use `z.string().min(1).nullable()` on Postmark response fields | Providers return `""` and `null` interchangeably; one empty string poison-pills the whole batch with a 400 | `project_zod_provider_response_empty_strings.md` |
| Use dotted Graphile cron task names (e.g., `postmark.sender.status.poll`) | Crashes worker boot with "Invalid command specification in line N" | `project_graphile_cron_task_naming.md` |
| Move `@as-comms/domain/phone` or `/sms-segments` to root domain export | Subpath imports dodge `node:crypto`; root re-exports break the web build | `project_domain_subpath_imports_node_crypto.md` |
| Forget to seed FK parents in PGlite integration tests | Tests touching `audience_snapshots` or `campaign_messages` need explicit `campaign_runs` + `contacts` seed | `project_pglite_fk_seed_gotcha.md` |
| Use `===` on shared-secret comparisons in the Postmark webhook | Timing-attack surface; use `timingSafeEqual` from `node:crypto` | `feedback_stage4_guardrails_2026_04_24.md` + `project_pr218_sf_capture_regression_2026_04_30.md` (security hardening) |
| Add new lucide icons to a tested component without updating the vi.mock allowlist | Tests break silently | `project_lucide_mock_gotcha.md` |
| Use `z.preprocess` non-idempotently in composed Zod schemas | Outer-schema parse re-invokes inner preprocess on already-parsed value | `project_zod_preprocess_double_parse_gotcha.md` |
| Skip pre-install + validate-before-done in Codex dispatch | Codex inlines workarounds for newly-added deps and ships broken | `feedback_codex_pre_install_and_validate.md` |

## Schema + migration ordering (Brief A1)

One migration file per table is the existing pattern (see migrations 0029, 0054, 0055, 0056). Ordering:

1. `0057_campaign_runs.sql` — core run table with state machine + frozen content + JSONB audience_criteria
2. `0058_audience_snapshots.sql` — per-recipient frozen rows with unique `unsubscribe_token` and delivery state machine
3. `0059_contact_consent.sql` — 3-scope consent with `(contact_id, scope_type, scope_id)` unique constraint
4. `0060_suppression_list.sql` — email-keyed global suppression with reason enum
5. `0061_org_settings.sql` — single-row table with `id` CHECK constraint forcing one row
6. `0062_postmark_sender_status.sql` — column addition to existing aliases storage
7. `0063_campaign_run_projection.sql` — `CREATE VIEW` UNION over `campaign_runs` + derived from `mailchimp_campaign_activity_details`

Brief A1 must verify the existing aliases table location before writing migration 0062. Do not assume; the project_dimensions row has alias columns but per-alias rows may live elsewhere — Codex inspects first.

**Postgres-forbidden-in-tx note:** if any of these migrations need statements that can't run inside a transaction (large index builds, etc.), use the `-- migrate:no-transaction` directive at the top of the file per `project_migrator_directives_2026_05_03.md`.

## Naming conventions

| Concept | Convention | Examples |
|---|---|---|
| New canonical event types (if needed) | `campaign.email.{kind}` | Existing: `sent/opened/clicked/unsubscribed`. Adding `delivered/bounced/complained` if not present. |
| Worker job names | hyphenated, kebab-case | `campaign-send`, `poll-postmark-sender-status`, `campaign-events-tail-finalize` |
| Server Action exports | `verbNoun` | `createCampaignDraft`, `scheduleCampaign`, `cancelCampaign`, `recordUnsubscribe` |
| Zod schema exports | `nounSchema` + `Noun` type | `campaignRunSchema` + `CampaignRun` |
| Drizzle table exports | camelCase singular | `campaignRuns` (table) but `campaign_runs` (SQL name) |
| Suppression reasons | snake_case strings in enum | `hard_bounce`, `soft_bounce_strike3`, `complaint`, `manual` |
| Cache tags (if revalidation ever needed) | `campaigns`, `campaign:{runId}` | Already in `frontend-patterns.md`. Not used in Phase A per `D-040`. |
| Webhook secret env var | `POSTMARK_WEBHOOK_SECRET` | Mirror `TWILIO_AUTH_TOKEN` naming |
| Server token env var | `POSTMARK_SERVER_TOKEN` | Mirror existing provider tokens |

## Web app surface

```text
apps/web/app/broadcasts/
├── layout.tsx                          # export const dynamic = 'force-dynamic'  (D-040)
├── page.tsx                            # Broadcasts list (Brief A4 + A8)
├── new/
│   └── page.tsx                        # 5-step create wizard (Briefs A4, A5)
├── [runId]/
│   ├── page.tsx                        # Run detail (Brief A6)
│   └── _components/
│       └── cancel-confirmation.tsx
├── _components/
│   ├── campaign-row.tsx                # list-page row
│   ├── audience-builder.tsx            # Brief A4 main surface
│   ├── audience-filter-pane.tsx
│   ├── audience-preview.tsx
│   ├── compose-pane.tsx                # wraps composer-editor-surface (reuse)
│   ├── compose-preview-pane.tsx        # live preview w/ sample-contact rotation
│   ├── review-screen.tsx               # Step 5 frozen review
│   ├── run-detail-metrics.tsx          # 4x2 metric tiles
│   ├── run-detail-recipients.tsx
│   └── run-detail-replies-rail.tsx
├── actions.ts                          # Server Actions (admin-gated)
└── error.tsx + loading.tsx
apps/web/app/u/[token]/
└── page.tsx                            # Public unsubscribe (Brief A7) — server-renders happy path, NO auth, works without JS
apps/web/app/api/webhooks/postmark/
└── route.ts                            # Brief A2 — HMAC-verified ingest
apps/web/app/settings/projects/[id]/_components/
└── sender-verification.tsx             # Brief A2 — sender-verification UI (added to existing settings tree)
apps/web/app/settings/organization/   # may already exist; Brief A1 adds the org_settings form
```

**Layout rules:** every page under `/broadcasts` and the `/u/[token]` route set `export const dynamic = 'force-dynamic'`. No `revalidateTag` calls anywhere in the broadcasts feature.

**Server Action admin gate:** every mutation in `apps/web/app/broadcasts/actions.ts` that transitions a run state (schedule, cancel, delete) calls a shared `assertAdmin()` helper. Drafting (create/edit/test-send) does not. Per the PRD: everyone is admin today; the gate is future-active.

## Worker surface

```text
apps/worker/src/jobs/
├── campaign-send/                      # Brief A3
│   ├── index.ts                        # Graphile task registration
│   └── orchestrator.ts                 # freeze → exclude → batch-push → record
├── poll-postmark-sender-status/        # Brief A2 — cron, 5-min cadence (matches D-038)
│   ├── index.ts
│   └── poll.ts
└── campaign-events-tail-finalize/      # Brief A6 — daily cron, transitions complete → finalized after 30d
    ├── index.ts
    └── finalize.ts
```

**Graphile cron task names** registered in `apps/worker/src/runtime.ts`:
- `poll-postmark-sender-status` — every 5 minutes
- `campaign-events-tail-finalize` — daily at 03:00 UTC

Hyphens, not dots. (Memory: `project_graphile_cron_task_naming.md`.)

## Webhook surface (Brief A2)

`apps/web/app/api/webhooks/postmark/route.ts`:

1. `POST` only
2. HMAC verification: `crypto.timingSafeEqual(receivedSig, computeHmacSha256(rawBody, env.POSTMARK_WEBHOOK_SECRET))`. Never `===`.
3. Parse with Zod schema from `packages/integrations/src/providers/postmark.ts`. Use coercing nullable for any Postmark field that may be empty string vs null.
4. Map Postmark event types → our canonical event types via a lookup table in `packages/integrations/src/providers/postmark.ts`:
   - `Delivery` → `campaign.email.delivered`
   - `Bounce` (HardBounce/SpamComplaint/etc.) → `campaign.email.bounced` + suppression event
   - `SpamComplaint` → `campaign.email.complained` + suppression event
   - `Open` → `campaign.email.opened`
   - `Click` → `campaign.email.clicked`
   - `SubscriptionChange` → `campaign.email.unsubscribed` + consent ledger entry
5. Write to `source_evidence_log` first (immutable provider-close), then enqueue a worker job to normalize into `canonical_event_ledger` + update `audience_snapshots.delivery_status` + populate ConsentLedger / SuppressionManager.
6. Always return 200 if the signature is valid, even on processing failure (Postmark retries non-2xx). Failures get queued in a dead-letter for ops investigation.

Webhook idempotency: Postmark events carry a `MessageID` we use as natural idempotency key. Duplicate events no-op.

## Cross-package contract surface

New Zod file: `packages/contracts/src/stage5-campaigns.ts`. Exports:

```text
launchTypeValues = ['normal_email','html_email','sms']        # Phase A only enables normal_email
launchTypeSchema
campaignKindValues = ['newsletter','project']
campaignKindSchema
campaignRunStateValues = ['draft','scheduled','sending','complete','finalized','cancelled']
campaignRunStateSchema
consentScopeTypeValues = ['project','newsletter','all']
consentScopeTypeSchema
suppressionReasonValues = ['hard_bounce','soft_bounce_strike3','complaint','manual']
suppressionReasonSchema
postmarkSenderStatusValues = ['unverified','pending','verified','rejected']
postmarkSenderStatusSchema

campaignRunSchema                                             # the run row contract
audienceSnapshotRowSchema                                     # per-recipient frozen row
audienceCriteriaSchema                                        # the JSONB filter snapshot
mergeContextSchema                                            # { firstName, projectName, aliasEmail }
campaignSendRequestSchema                                     # worker job payload
postmarkWebhookEventSchema                                    # all event variants discriminated by RecordType
unsubscribeRequestSchema                                      # public unsubscribe page input

# Re-exports from stage1-taxonomy for convenience inside campaigns code
canonicalEventTypeSchema (campaign.* subset)
```

Add `'./stage5-campaigns.js'` to the package barrel export. Do NOT export broadcast types from stage1 files.

## Test guardrails

- PGlite integration tests for repository code (per the existing `packages/db/test/` pattern). Seed `contacts` + `project_dimensions` + `campaign_runs` BEFORE touching `audience_snapshots` or `contact_consent` (FK parents).
- Unit tests for pure-decision modules (ExclusionFilter, MergeRenderer, SuppressionManager, AudienceResolver) with fixture-driven inputs and no DB.
- Webhook handler tests use real Postmark event fixtures (saved JSON) — at least one fixture per event type.
- CampaignRunProjection integration test asserts the UNION shape against a seeded mix of `campaign_runs` rows + `mailchimp_campaign_activity_details` rows — both must surface identically.
- Skip dedicated test suites for PostmarkClient (thin wrapper, verified at webhook integration boundary) and CampaignSendOrchestrator (verified via end-to-end worker-job test).
- Any new lucide icon added to a tested component → update the matching `vi.mock` allowlist.

## Phase A brief dependency graph

```text
A1 (schema)
   ├──► A2 (Postmark client + webhook + sender verification)
   │       └──► A6 (run detail metrics tiles read from audience_snapshots updated by A2's webhook)
   │       └──► A8 (UNION projection depends on A1 view + A2 webhook-fed runs)
   ├──► A3 (orchestrator: freezes audience, calls Postmark via A2, writes audience_snapshots)
   ├──► A7 (consent ledger + unsubscribe pages)
   └──► A4 (audience builder reads A1 contracts)
           └──► A5 (compose reuses A4's frozen-criteria + audience preview)
                   └──► A6 (review screen + scheduled-state surfacing)
```

**Critical path:** A1 → A2 → A3. The others can fan out in parallel once A1 + A2's schema/clients are stable.

**Recommended Codex dispatch order:**
1. A1 (GPT-5.4 High — cross-package, schema, SF picklist inspection)
2. A2 (GPT-5.4 Medium — provider client + webhook; lots of fixture work)
3. A3 (GPT-5.4 High — worker orchestrator + cancellation + idempotency are correctness-critical)
4. A4 + A7 in parallel (GPT-5.4 Medium — independent surfaces once A1 lands)
5. A5 (GPT-5.4 Medium — depends on A4)
6. A6 + A8 in parallel (GPT-5.4 Medium — read-side surfaces)

Each brief includes: `pnpm install --force` warm-up, validate-before-done (`pnpm typecheck && pnpm lint`), and per `feedback_codex_concurrency_and_token_strategy.md` drop `test:unit` from dispatch validation (CI is authoritative).

## Pre-merge canon updates required

Before Brief A1 merges to `main`, these doc updates must be in place. Recommendation: ship as a single docs-only PR alongside this implementation spec.

1. **New decision-log entry** dated 2026-05-15 — "Stage 5A delivery provider is Postmark; broadcast architecture locked (D-045)"
2. **`docs/01-core/decision-core.md`** — add `D-045` row pointing to the decision-log entry
3. **`docs/01-core/system-core.md`** — replace SendGrid line with Postmark in both "Source-Of-Truth Precedence" → "Provider truth" and the "Highest-Risk Trust Boundaries" if mentioned
4. **`docs/03-reference/reference-services.md`** — replace the SendGrid row with a Postmark row; SendGrid removed from the Service Summary table
5. **`docs/02-bundles/campaigns-bundle.md`** — replace "SendGrid is the Email delivery provider" line; add Phase A/B/C phasing model to the "Locked" section
6. **`README.md`** external services list — replace SendGrid with Postmark
7. **`docs/runbooks/mailchimp-decommission.md`** — add a one-line cross-reference to PRD #412 + this spec, plus a note that the runbook applies after Phase C newsletter migration

## Validation gate dependency

Per `D-031`, none of the Phase A code in `apps/` or `packages/` merges to `main` until the `V` validation gate is signed off. This spec, the design brief, and the canon updates are **not** code and may land independently. Codex briefs themselves may be drafted and reviewed in parallel; their **merge** is gated.

## Cost trajectory reminder

- Phase A/B (~5K emails/mo project sends): Postmark Basic 10K tier ≈ **$240/yr**
- Phase C onward (~48K emails/mo total after newsletter migration): Postmark Basic 50K tier ≈ **$660/yr**
- Mailchimp current: ~$4,000/yr — fully decommissioned at Phase C completion
- Net annual savings at full migration: ~$3,340/yr

## Read next

- the PRD that this spec implements: [412](https://github.com/nico-kneler-as/as-comms-platform/issues/412)
- the canon updates required before code merges: [decision-log.md](../01-core/decision-log.md) (D-045 entry)
- the design brief this spec pairs with: [stage-5a-campaigns.md](../design-briefs/stage-5a-campaigns.md)
- the Mailchimp decommission runbook that Phase C executes: [mailchimp-decommission.md](../runbooks/mailchimp-decommission.md)
