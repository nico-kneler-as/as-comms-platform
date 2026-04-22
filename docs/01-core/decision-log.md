# Decision Log

**Role:** lightweight repo-local decision history and supersession log  
**Audience:** implementers, reviewers, and operators  
**When to read:** when a task may reopen a locked choice, when stage-scoped decisions need historical context, or when current work may conflict with prior canon  
**Authority:** durable decision record; [decision-core.md](./decision-core.md) remains the compact locked summary for day-to-day implementation

## How To Use This Log

- add a new entry instead of rewriting older decisions in place
- use `locked` for current canon that should not change without a canon update
- use `active` for the current delivery posture or in-force guidance that may later be superseded
- use `superseded` for searchable history that should no longer drive implementation
- keep titles short and searchable
- include related docs, code, or test references when they make the decision easier to preserve

## Entry Template

### YYYY-MM-DD - Short decision title

- Status: `locked | active | superseded`
- Decision: one concise statement of the decision
- Why: why the decision was made
- Impact: what later work must preserve or treat as out of scope
- Related refs: useful docs, code, tests, or PRs

## Seeded Stage 1 Entries

These entries were recorded on `2026-04-05` from the current repo canon and the completed Stage `1B` state. Earlier exact historical decision dates were not reconstructed in this pass.

### 2026-04-05 - Stage 1 launch scope is Gmail plus Salesforce

- Status: `locked`
- Decision: Stage 1 launch completion is narrowed to Gmail plus Salesforce only. SimpleTexting and Mailchimp remain deferred follow-on validation inside Stage 1, not launch-scope blockers.
- Why: the project needed a trusted backend-first launch surface without widening Stage 1 into later product work or four-provider validation at once.
- Impact: acceptance, runtime, and validation for completed Stage 1 are judged against Gmail and Salesforce only; deferred-provider work proceeds in Stage `1C` and Stage `1D`.
- Related refs: [../stage-1-acceptance.md](../stage-1-acceptance.md), [../stage-1-runtime.md](../stage-1-runtime.md), [../stage-1-post-validation-roadmap.md](../stage-1-post-validation-roadmap.md), [../04-implementation-specs/stage-1-provider-ingest-matrix.md](../04-implementation-specs/stage-1-provider-ingest-matrix.md)

### 2026-04-05 - Historical and live ingest share one normalization path

- Status: `locked`
- Decision: historical backfill and live ingest must converge into one normalization path instead of separate historical and live truths.
- Why: replay safety, explainability, and cutover trust depend on one durable path from provider-close evidence into canonical state.
- Impact: new providers and replays must reuse the same normalization surface; fixes should not introduce special-case historical pipelines.
- Related refs: [decision-core.md](./decision-core.md), [../stage-1-acceptance.md](../stage-1-acceptance.md), [../stage-1-runtime.md](../stage-1-runtime.md), [../04-implementation-specs/stage-1-provider-ingest-matrix.md](../04-implementation-specs/stage-1-provider-ingest-matrix.md)

### 2026-04-05 - Salesforce Contact.Id is the primary identity anchor

- Status: `locked`
- Decision: Salesforce `Contact.Id` is the strongest canonical identity anchor when it is present.
- Why: it is the most stable cross-channel person identifier in the launch scope and keeps merged history anchored to one durable contact record.
- Impact: weaker email or phone evidence must not override a Salesforce contact anchor; identity conflicts stay explicit.
- Related refs: [decision-core.md](./decision-core.md), [../03-reference/reference-salesforce-mapping.md](../03-reference/reference-salesforce-mapping.md), [../04-implementation-specs/stage-1-provider-ingest-matrix.md](../04-implementation-specs/stage-1-provider-ingest-matrix.md), [../04-implementation-specs/stage-1-review-queue-reason-codes.md](../04-implementation-specs/stage-1-review-queue-reason-codes.md)

### 2026-04-05 - Ambiguous identity opens review instead of silent linking

- Status: `locked`
- Decision: when identity cannot be resolved safely, the record must open review or quarantine instead of being silently linked.
- Why: wrong links are harder to unwind than temporary manual review, especially once replay and projections are involved.
- Impact: future provider work must preserve explicit review surfaces and must not auto-fan ambiguous Gmail, Salesforce, SMS, or campaign evidence across multiple contacts.
- Related refs: [decision-core.md](./decision-core.md), [../stage-1-acceptance.md](../stage-1-acceptance.md), [../04-implementation-specs/stage-1-review-queue-reason-codes.md](../04-implementation-specs/stage-1-review-queue-reason-codes.md), [../04-implementation-specs/stage-1-provider-ingest-matrix.md](../04-implementation-specs/stage-1-provider-ingest-matrix.md)

### 2026-04-05 - Gmail wins duplicate collapse for overlapping outbound one-to-one email

- Status: `locked`
- Decision: when Gmail and Salesforce describe the same outbound one-to-one email, Gmail is the canonical duplicate-collapse winner and Salesforce remains supporting provenance.
- Why: Gmail carries the stronger transport-level identifiers for the actual email event.
- Impact: duplicate-collapse, replay, and projection work must preserve Gmail as the winner for this overlap case; adding more providers must not weaken that rule.
- Related refs: [decision-core.md](./decision-core.md), [../04-implementation-specs/stage-1-provider-ingest-matrix.md](../04-implementation-specs/stage-1-provider-ingest-matrix.md), [../04-implementation-specs/stage-1-event-taxonomy.md](../04-implementation-specs/stage-1-event-taxonomy.md), [../../packages/db/test/stage1-normalization.test.ts](../../packages/db/test/stage1-normalization.test.ts)

### 2026-04-05 - Salesforce Task is the launch-scope outbound communication metadata source

- Status: `locked`
- Decision: Salesforce `Task` is the only launch-scope Salesforce communication source and is treated as outbound communication metadata and supporting timeline evidence.
- Why: it covers the tested first-scope communication metadata without widening launch scope into additional Salesforce event families.
- Impact: future work should not infer broader Salesforce communication coverage for Stage 1 unless the canon is updated first.
- Related refs: [../stage-1-acceptance.md](../stage-1-acceptance.md), [../stage-1-runtime.md](../stage-1-runtime.md), [../03-reference/reference-salesforce-mapping.md](../03-reference/reference-salesforce-mapping.md), [../04-implementation-specs/stage-1-provider-ingest-matrix.md](../04-implementation-specs/stage-1-provider-ingest-matrix.md)

### 2026-04-05 - Salesforce lifecycle scope is locked to four expedition-member dates

- Status: `locked`
- Decision: the launch-scope Salesforce lifecycle milestone set is limited to `CreatedDate`, `Date_Training_Sent__c`, `Date_Training_Completed__c`, and `Date_First_Sample_Collected__c` from `Expedition_Members__c`.
- Why: the Stage 1 lifecycle surface needed a minimal, explainable, and tested milestone set rather than a broad field-by-field rebuild.
- Impact: later work should treat additional lifecycle families as out of scope unless the canon is explicitly expanded.
- Related refs: [../stage-1-acceptance.md](../stage-1-acceptance.md), [../stage-1-runtime.md](../stage-1-runtime.md), [../04-implementation-specs/stage-1-provider-ingest-matrix.md](../04-implementation-specs/stage-1-provider-ingest-matrix.md), [../../packages/integrations/test/stage1-mappers.test.ts](../../packages/integrations/test/stage1-mappers.test.ts)

### 2026-04-05 - Stage 1 truth is backend evidence and projections, not the final Inbox product surface

- Status: `locked`
- Decision: Stage 1 closes on trusted backend evidence, canonical events, projections, and cutover tooling; the final user-facing Inbox experience comes in later stages.
- Why: the stage order is intentionally backend-first so trust in identity, history, and replay exists before user-facing workflow surfaces are built on top.
- Impact: Stage 1 completion and regressions should be judged from inspectable backend state and projection behavior, not from missing or incomplete Inbox UI.
- Related refs: [product-core.md](./product-core.md), [../stage-1-acceptance.md](../stage-1-acceptance.md), [../04-implementation-specs/stage-1-projection-rules.md](../04-implementation-specs/stage-1-projection-rules.md), [../stage-1-post-validation-roadmap.md](../stage-1-post-validation-roadmap.md)

### 2026-04-05 - Stage 1B trust pass is complete and deferred-provider work can proceed

- Status: `active`
- Decision: treat Stage `1B` as complete. Gmail plus Salesforce launch-scope backfills, representative-contact proofs, parity and cutover checks, and replay and audit hardening are part of the trusted baseline now.
- Why: the work is complete in practice, merged into `main`, and no longer represents an open prerequisite for deferred-provider validation.
- Impact: Stage `1C` and Stage `1D` can proceed without reopening the launch-scope Gmail plus Salesforce baseline. Residual launch-scope notes are non-blocking cleanup unless they reopen locked mappings, representative-contact explainability, or replay, parity, cutover, or audit trust.
- Related refs: [../stage-1-acceptance.md](../stage-1-acceptance.md), [../stage-1-post-validation-roadmap.md](../stage-1-post-validation-roadmap.md), [../../apps/worker/test/stage1-launch-scope.test.ts](../../apps/worker/test/stage1-launch-scope.test.ts), [../../apps/worker/test/stage1-orchestration.test.ts](../../apps/worker/test/stage1-orchestration.test.ts)

### 2026-04-18 - Composer is its own stage between Inbox and AI

- Status: `locked`
- Decision: the send/reply Composer is a distinct product stage, sequenced after Stage 3 Inbox read-surface and before Stage 4 AI drafts. Composer scope covers replies, net-new sends to existing Salesforce-anchored contacts, and net-new sends to arbitrary external emails (non-volunteer partners). Alias selection defaults to the alias that received the last inbound. Composer UI must show the outbound message optimistically while the real provider send runs in the background.
- Why: Inbox and Composer are large enough to deserve separate stages; AI drafts presuppose a working Composer; the app is the team's center of comms, so Composer must support more than just replies to existing inbox threads.
- Impact: the canonical stage map in product-core and delivery-core reflects the insertion between Stage 3 and Stage 4. A new `docs/02-bundles/composer-bundle.md` is authored when Composer build begins. Composer depends on Stage 2 auth; AI drafts depend on Composer.
- Related refs: [product-core.md](./product-core.md), [delivery-core.md](./delivery-core.md)

### 2026-04-18 - Non-Salesforce contacts are first-class, not an unresolved review case

- Status: `locked`
- Decision: missing Salesforce Contact ID is a normal canonical-contact state (`salesforceContactId=null`), not an unresolved review case. `identity_missing_anchor` is narrowed to fire only when source evidence is too ambiguous or conflicting to produce a safe new canonical contact — a plain unmatched email produces a new canonical contact anchored by normalized email instead. Genuine ambiguity (`identity_multi_candidate`, `identity_conflict`, `identity_anchor_mismatch`, `duplicate_collapse_conflict`, `replay_checksum_mismatch`) still opens review.
- Why: AS operators need to reply to external partners and non-volunteer contacts without pre-clearing identity cases. The previous `identity_missing_anchor` behavior combined with "identity cases with no chosen contact do not create a synthetic Inbox row" would have hidden partner emails from the inbox entirely, breaking the product's "team comms hub" intent.
- Impact: Stage 1 normalization auto-creates a canonical contact on first inbound from an unknown email (source=provider) and on operator-initiated compose to a typed email (source=operator). Projections mark non-SF contacts with a soft non-overlay indicator, not `hasUnresolved=true`. Merging a non-SF contact with a later SF anchor is out of immediate scope.
- Related refs: [data-core.md](./data-core.md), [../04-implementation-specs/stage-1-review-queue-reason-codes.md](../04-implementation-specs/stage-1-review-queue-reason-codes.md)

### 2026-04-18 - Routing review triggers only for Salesforce-anchored contacts

- Status: `locked`
- Decision: `routing_missing_membership`, `routing_multiple_memberships`, and `routing_context_conflict` review cases only open for contacts where `salesforceContactId IS NOT NULL`. External-partner and non-volunteer contacts have no project context by definition and therefore are not eligible for routing review.
- Why: without this narrowing, every partner email would trigger a perpetual routing-missing-membership case that operators cannot resolve.
- Impact: Stage 1 normalization routing logic skips non-SF contacts entirely. `hasUnresolved=true` overlays in the inbox projection reflect this narrower set.
- Related refs: [../04-implementation-specs/stage-1-review-queue-reason-codes.md](../04-implementation-specs/stage-1-review-queue-reason-codes.md)

### 2026-04-18 - Stage 2 Settings locked to Auth.js v5, two flat roles, and trusted-header dev bypass

- Status: `locked`
- Decision: Stage 2 Settings/Admin uses Auth.js v5 (NextAuth) with a Google OAuth provider and a Drizzle session adapter, 30-day rolling cookie sessions, two flat roles (`admin`, `operator`), and a trusted-header dev bypass (`x-dev-operator: <email>`) gated on `NODE_ENV !== 'production'` and seeded by a dev-only `/api/dev-auth?email=X` cookie route. MVP surfaces: Auth, Project inbox aliases, Users/roles admin (must-ship); Org settings and Integration health (ship-thin, read-only); Knowledge config deferred to Stage 4; Routing rules out of scope.
- Why: Google SSO + server-owned sessions already locked in [settings-bundle.md](../02-bundles/settings-bundle.md); Auth.js v5 is the canonical Next.js App Router pattern; two flat roles is enough for a 1–3 operator team; trusted-header dev bypass matches the bundle's "header auth is dev/internal only" line. Composer depends on real auth, so Stage 2 must land before Composer.
- Impact: the Stage 2 Codex thread must not pick a different auth library, introduce a permissions matrix, or change the dev bypass shape without reopening this decision. Project-inbox aliases move from `GMAIL_PROJECT_INBOX_ALIASES` env var to a `project_aliases` DB table with admin CRUD; worker reads DB first, env as fallback during cutover.
- Related refs: [../02-bundles/settings-bundle.md](../02-bundles/settings-bundle.md), [../../scripts/verify-stage0.mjs](../../scripts/verify-stage0.mjs)

### 2026-04-18 - Internal notes are stored separate from the canonical event ledger

- Status: `locked`
- Decision: internal notes use their own storage (`manualNoteDetails` plus the associated notes table) and are unioned into the timeline projection at read time. Notes do NOT occupy rows in `canonical_event_ledger`. Notes are team-visible (no private notes), plain text, author-stamped, editable and deletable by the author, and rendered inline with canonical timeline entries.
- Why: the ledger's semantic promise is "immutable provider-close evidence normalized into canonical events." Notes are operator-authored, editable, and have no source evidence — they do not belong in the ledger.
- Impact: timeline projection queries union notes from the notes table. Note writes go through a Server Action with `audit_policy_evidence` entries. Notes never mutate bucket state, `needsFollowUp`, or `hasUnresolved`.
- Related refs: [data-core.md](./data-core.md), [interfaces-core.md](./interfaces-core.md), [../02-bundles/inbox-bundle.md](../02-bundles/inbox-bundle.md)

### 2026-04-18 - Reminders are MVP-mock, not backend-persisted

- Status: `active`
- Decision: reminder state in the Inbox detail pane remains client-session-only for the MVP. No `contact_reminders` table, no Server Action, no cross-session or cross-operator visibility. The UI continues to render the reminder popover and badge, but reminder data does not survive reload.
- Why: durable cross-operator reminders would expand scope (new table, notifications, firing semantics) without clear operator demand at 1–3 operator scale.
- Impact: do not build a `contact_reminders` table or Server Action during Stage 3, Stage 2, or the Composer stage. Revisit post-launch when active notifications become a real need.
- Related refs: [../02-bundles/inbox-bundle.md](../02-bundles/inbox-bundle.md)

### 2026-04-18 - Campaigns deferred until post-launch validation of Inbox + Composer + AI

- Status: `active`
- Decision: Stage 5A Email Campaigns and Stage 5B SMS Campaigns are out of the MVP. A validation gate is inserted between Stage 4 AI and Stage 5A — Campaigns resume only after the Inbox + Composer + AI surfaces are validated in production operator use.
- Why: Campaigns is a large subproduct on its own; layering it on before the foundational surfaces are battle-tested risks focus and quality drift.
- Impact: do not add campaign-authoring tables, audience-builder schemas, or SendGrid integration until the validation gate clears. Existing Stage 1 `campaign.email.*` canonical events (Mailchimp transition ingest) remain valid timeline evidence; they do not drive any product UI beyond the timeline entries already built. `D-014` (Email before SMS) still applies when Campaigns eventually resumes.
- Related refs: [product-core.md](./product-core.md), [delivery-core.md](./delivery-core.md)

### 2026-04-20 - Settings is a single-page surface with Projects, Access, Integrations

- Status: `active`
- Decision: `/settings` renders as one page with three stacked sections — Projects, Access, Integrations — rather than a multi-page `/settings/*` layout with a left sidebar. The UI scaffold ships ahead of persistence wiring: data is mocked in `apps/web/app/settings/_lib/mock-data.ts` and every mutation is a stubbed Server Action in `apps/web/app/settings/actions.ts` returning an FP-07 `UiSuccess` envelope. The sole preserved live behaviour is the `settings.users.read` sensitive-read audit. Role label in the UI is `admin | internal_user`; the existing DB enum `user_role` (`admin | operator`) is untouched. Reconciliation happens at the persistence-wiring boundary: either migrate the enum to `admin | internal_user` or map `internal_user` → `operator` at the repository layer. UI labels stay `internal_user` per product.
- Why: single-page Settings matches the operator scale (1–3 teammates, low config surface) and avoids a sidebar that would dominate a mostly-read screen. Shipping the UI shell before persistence lets product validate the visual contract and flow before Stage 2 back-end work continues.
- Impact: do not re-introduce `/settings/aliases`, `/settings/users`, `/settings/organization`, or `/settings/integrations` as standalone routes or a left settings sidebar. Any new settings surface joins the single page as a new stacked section. When wiring real persistence, resolve the role-label divergence at the repository boundary rather than leaking `operator` into the UI. Supersedes the Stage 2 brief language that assumed a multi-page structure; the `admin | operator` memory note is preserved for historical context but the UI canon is now `admin | internal_user`.
- Related refs: [../02-bundles/settings-bundle.md](../02-bundles/settings-bundle.md), [apps/web/app/settings/page.tsx](../../apps/web/app/settings/page.tsx), [apps/web/app/settings/\_lib/mock-data.ts](../../apps/web/app/settings/_lib/mock-data.ts), [apps/web/app/settings/actions.ts](../../apps/web/app/settings/actions.ts), [PR #55](https://github.com/nico-kneler-as/as-comms-platform/pull/55)

### 2026-04-18 - Stage 4 AI drafting pipeline, grounding order, and runtime shape locked

- Status: `locked` (provider line superseded 2026-04-21 — see "Stage 4 AI product decisions locked for provider, cost, context, memory, and failure-mode envelope" entry)
- Decision: Stage 4 AI is a human-in-the-loop drafting assistant (no auto-send) with strict grounding order (general instructions → project-specific instructions → approved knowledge → current conversation/contact/project context → reusable approved-reply memory). Implementation is a single backend orchestration service (not a separate microservice) with internal modules for classification, retrieval, response-mode decision, draft generation, validation, explainability, and memory capture. One LLM call by default; a second only for reprompt or hard cases. Deterministic fallback required. Reusable memory is captured only from human-approved sent replies. Visible grounding is a product contract. Cost ~10–15¢/response is acceptable.
- Why: establishes the Stage 4 product shape ahead of Composer build so Composer can reserve a clean `draft:generate` integration surface. Matches Fin-like product discipline without Fin-like runtime complexity.
- Impact: a new `docs/04-implementation-specs/stage-4-ai-pipeline.md` codifies the full pipeline contract. Notion-backed knowledge uses background sync/cache per `D-008` (no approval gate). AI never sends automatically per `D-009`. Composer Server Actions include a `draft:generate` endpoint whose payload matches the grounding-bundle contract.
- Related refs: [product-core.md](./product-core.md), [decision-core.md](./decision-core.md), [../04-implementation-specs/stage-4-ai-pipeline.md](../04-implementation-specs/stage-4-ai-pipeline.md)

### 2026-04-19 - Salesforce comms ingest excludes non-volunteer contacts

- Status: `locked`
- Decision: Salesforce is not a comms source for non-volunteer contacts. Tasks whose target is a non-volunteer (no `Expedition_Member__c` relationship) must not produce canonical events via the Salesforce capture path. Non-volunteer correspondence flows through Gmail only.
- Why: operators triage volunteer-related replies; non-volunteer CRM Tasks are administrative records that would pollute the inbox with no reply loop. The product rule is "the inbox is for volunteer comms"; Gmail covers partner and external-contact correspondence.
- Impact: Salesforce capture pipelines must apply a volunteer-gate at both the Contact level and the Task level. Gmail ingestion is unaffected — non-volunteer emails still flow normally. Volunteer status changes are picked up at the next contact-snapshot sync; a freshly-added volunteer's historical Tasks backfill via replay.
- Related refs: [decision-core.md](./decision-core.md), [../04-implementation-specs/stage-1-provider-ingest-matrix.md](../04-implementation-specs/stage-1-provider-ingest-matrix.md), [../03-reference/reference-salesforce-mapping.md](../03-reference/reference-salesforce-mapping.md), [PR #40](https://github.com/nico-kneler-as/as-comms-platform/pull/40), [PR #53](https://github.com/nico-kneler-as/as-comms-platform/pull/53)

### 2026-04-19 - Salesforce Task capture filters WhoIds to volunteer-linked contacts

- Status: `locked`
- Decision: the Salesforce Task capture query filters Tasks at the provider boundary so only Tasks whose `WhoId` resolves to a volunteer (a Contact with an `Expedition_Member__c` record) are ingested. The filter is on `WhoId` linkage, not on subject heuristics — `classifySalesforceTaskMessageKind` still handles automated-vs-one-to-one classification after the volunteer gate.
- Why: implements D-033 at the ingestion boundary. Filtering at capture (not at normalization) means non-volunteer Task evidence never enters `sourceEvidenceLog`, keeping storage, replay, and audit surfaces narrower. Downstream normalization code does not need to re-apply the filter.
- Impact: Salesforce capture must maintain the volunteer-gate as capture query evolves. If the WhoId is null (Task not linked to a Contact), the Task is excluded — non-volunteer Tasks without WhoId resolution are not surfaced. Volunteer-snapshot freshness becomes part of the Salesforce capture contract.
- Related refs: [decision-core.md](./decision-core.md), [../04-implementation-specs/stage-1-provider-ingest-matrix.md](../04-implementation-specs/stage-1-provider-ingest-matrix.md), [../../packages/integrations/src/providers/salesforce.ts](../../packages/integrations/src/providers/salesforce.ts), [PR #53](https://github.com/nico-kneler-as/as-comms-platform/pull/53)

### 2026-04-22 - Salesforce volunteer email Task ingest is limited to Nim Admin-owned automations

- Status: `locked`
- Decision: within the existing volunteer-gated Salesforce Task capture, email-like Tasks are ingested only when the owner is `Nim Admin` (`Owner.Username = admin+1@adventurescientists.org`). Other volunteer-linked Salesforce email Tasks are excluded at the capture boundary rather than being ingested and reclassified later.
- Why: production Salesforce review showed the wanted volunteer automations consistently come from `Nim Admin`, while the volunteer-linked non-`Nim Admin` Task emails are CRM-tracked human conversations, partner/project-management mail, recruiting mail, donor receipts, and other non-product comms that pollute inbox trust.
- Impact: the Salesforce capture query must preserve the volunteer gate from D-034 and add the Nim Admin owner gate for email-like Tasks. `classifySalesforceTaskMessageKind` should treat Nim Admin-owned Tasks as `auto`, prefer explicit owner truth over subject heuristics when owner metadata is present, and keep the legacy subject-only fallback for historical rows that persisted without owner metadata. Gmail remains the source of truth for human one-to-one email history.
- Related refs: [decision-core.md](./decision-core.md), [../02-bundles/data-foundation-bundle.md](../02-bundles/data-foundation-bundle.md), [../04-implementation-specs/stage-1-provider-ingest-matrix.md](../04-implementation-specs/stage-1-provider-ingest-matrix.md), [../stage-1-capture-services.md](../stage-1-capture-services.md)

### 2026-04-19 - Stage 2 Auth session strategy is JWT, not database-backed

- Status: `locked`
- Decision: Auth.js v5 session strategy is JWT (stateless cookie sessions), not a database-adapter session. Session data lives in the signed cookie; there is no `sessions` table. User-identity lookups during sign-in still hit the `users` table via the Drizzle adapter.
- Why: the app's protected-route middleware runs in Edge Runtime, which cannot open a Postgres connection and therefore cannot decode database-backed sessions. JWT sessions decode in Edge Runtime via a shared secret, removing the need for a Node/Edge runtime split in middleware. This was a mid-flight change during Stage 2 auth integration (initial implementation used a DB adapter before the Edge Runtime limitation surfaced).
- Impact: D-025 remains the higher-order canon (Auth.js v5, Google provider, two flat roles, dev bypass). This entry narrows the session-strategy dimension specifically. Future auth work must not reintroduce DB sessions without reopening this decision — any Edge Runtime workaround must either preserve JWT or propose a replacement that demonstrably works in the middleware path.
- Related refs: [decision-core.md](./decision-core.md), [../02-bundles/settings-bundle.md](../02-bundles/settings-bundle.md), [../../apps/web/auth.ts](../../apps/web/auth.ts), [../../apps/web/middleware.ts](../../apps/web/middleware.ts), [PR #38](https://github.com/nico-kneler-as/as-comms-platform/pull/38)

### 2026-04-20 - project_dimensions.is_active is admin-owned, not Salesforce-derived

- Status: `locked`
- Decision: `project_dimensions.is_active` is a boolean column owned by admins via the Settings UI. It is NOT derived from Salesforce project state, membership counts, or recent activity. Admins toggle it directly through Settings; the toggle emits an audit entry.
- Why: deriving active state from Salesforce or membership churn couples local admin intent to external state changes and introduces round-trip delays. Admin-owned is simpler and matches the operator mental model — "active means we're currently working this project" — which is independent of whatever SF reports.
- Impact: projections and queries that scope to active projects must read `project_dimensions.is_active` directly. Do not infer active state from memberships, SF flags, or recent events. Admin mutation handlers must emit `audit_policy_evidence` entries for `is_active` transitions. Automated state changes (e.g., cascading toggles) require a canon reopening.
- Related refs: [decision-core.md](./decision-core.md), [../02-bundles/settings-bundle.md](../02-bundles/settings-bundle.md), [../../packages/db/src/schema/tables.ts](../../packages/db/src/schema/tables.ts), [PR #59](https://github.com/nico-kneler-as/as-comms-platform/pull/59), [PR #66](https://github.com/nico-kneler-as/as-comms-platform/pull/66)

### 2026-04-20 - Project AI knowledge is a single URL on project_dimensions with an activation gate

- Status: `superseded` (2026-04-21 — discovery-based sync replaces per-project URL; see "Project AI knowledge is discovered by Notion Project ID match, not by per-project URL" entry)
- Decision: each project has a single `ai_knowledge_url` column (plus `ai_knowledge_synced_at`) on `project_dimensions`. Multiple knowledge sources per project are out of MVP scope. A project can only transition to `is_active = true` when both preconditions hold: at least one project email alias exists AND `ai_knowledge_url IS NOT NULL`.
- Why: one URL per project matches the current operator workflow (one Notion page per project). Storing it on the dimension row avoids a join and a lifecycle question that a separate table would introduce. The activation gate ensures an active project has enough grounding context for Stage 4 AI to produce usable drafts — without both emails and knowledge, AI cannot ground.
- Impact: Stage 4 AI knowledge retrieval reads `project_dimensions.ai_knowledge_url` directly. If future product scope needs multiple knowledge sources per project (e.g., Notion + a shared doc), this canon must be reopened first. Admin mutations that flip `is_active` to `true` must enforce both preconditions server-side, not just in the UI.
- Related refs: [decision-core.md](./decision-core.md), [../02-bundles/settings-bundle.md](../02-bundles/settings-bundle.md), [../../packages/db/src/schema/tables.ts](../../packages/db/src/schema/tables.ts), [PR #59](https://github.com/nico-kneler-as/as-comms-platform/pull/59), [PR #66](https://github.com/nico-kneler-as/as-comms-platform/pull/66)

### 2026-04-20 - Integration health is a polled projection, not live-on-demand

- Status: `locked`
- Decision: integration health is surfaced via an `integration_health` table written by a 5-minute worker cron (same cadence pattern as live polling). The Settings UI reads the table for status; it does NOT probe `/health` endpoints live on page render. Each capture service (`gmail-capture`, `salesforce-capture`) exposes a `/health` endpoint that the worker cron is the sole consumer of.
- Why: live-on-demand probes from the Settings UI would introduce variable latency, hammer capture services under page refreshes, and conflate "UI responsiveness" with "capture service availability." Projection-based health means Settings loads instantly and the worker owns the health-check rate. Mirrors the architecture already used for Gmail (1-min poll) and Salesforce (5-min poll).
- Impact: capture services must expose `/health` with a stable contract. The worker cron cadence cannot exceed 5 minutes without reopening this decision. Settings UI treats the projection as authoritative; an in-UI manual "refresh" action must enqueue a worker check or await the next cron tick — it must not probe capture services directly. Services that don't yet have a `/health` endpoint surface as `not_configured` in the projection.
- Related refs: [decision-core.md](./decision-core.md), [../02-bundles/settings-bundle.md](../02-bundles/settings-bundle.md), [../../apps/worker/src/integration-health](../../apps/worker/src/integration-health), [PR #59](https://github.com/nico-kneler-as/as-comms-platform/pull/59), [PR #60](https://github.com/nico-kneler-as/as-comms-platform/pull/60)

### 2026-04-21 - Project AI knowledge is discovered by Notion Project ID match, not by per-project URL

- Status: `locked`
- Decision: Stage 4 AI knowledge for a project is sourced from a row in the Notion "Project Training" database whose `Project ID` text property equals `project_dimensions.project_id`. A background sync job walks the database every 15 minutes and caches page bodies into a new `ai_knowledge_entries` table. The `ai_knowledge_url` column on `project_dimensions` is kept as a non-authoritative drill-through link but no longer drives activation or sync. Activation gate becomes `emails ≥ 1 AND ai_knowledge_synced_at IS NOT NULL`. Rows sync regardless of the Notion row's `Ready for AI` or `Training Status` fields (those are deprecated per `D-008`, which forbids approval gates on Notion-backed knowledge).
- Why: per-project URL wiring is manual and error-prone; Notion already carries the `Project ID` property we can match against. One canonical location (the Notion Project Training database) for all projects simplifies admin workflow and makes discovery automatic. The `ai_knowledge_synced_at` column is already present on `project_dimensions` and is the authoritative "we have something cached" signal.
- Impact: supersedes the 2026-04-20 D-037 entry. Settings UI "AI knowledge URL" input becomes optional / cosmetic — repurpose as a read-only "Notion link" that surfaces the synced row's URL, or remove entirely in a later pass. Admin-mutation enforcement for `is_active` flips from `ai_knowledge_url IS NOT NULL` to `ai_knowledge_synced_at IS NOT NULL`. The Notion sync job (per brief `.codex-stage4-notion-knowledge-sync-2026-04-21.md`) is the first Stage 4 code to ship and has no dependency on Composer.
- Related refs: [decision-core.md](./decision-core.md), [../02-bundles/settings-bundle.md](../02-bundles/settings-bundle.md), [../04-implementation-specs/stage-4-ai-pipeline.md](../04-implementation-specs/stage-4-ai-pipeline.md), `../../.codex-stage4-notion-knowledge-sync-2026-04-21.md`

### 2026-04-21 - Stage 4 AI product decisions locked for provider, cost, context, memory, and failure-mode envelope

- Status: `locked`
- Decision: Anthropic (Claude Sonnet 4.6) is the Stage 4 draft-generation provider; OpenAI `text-embedding-3-small` is the embedding provider for tier-5 memory similarity (dual-vendor accepted for MVP). Cost cap is a soft warn at $20/day org-wide via an `AI_DAILY_CAP_USD` env var; not a hard block. Tier-4 context is bounded to the last 20 canonical events for the contact OR 90 days (whichever is smaller), each event body truncated to ~500 characters, target inbound included in full, no inline images / attachments. Tier-5 memory capture masks names / emails / phones to `{NAME}` / `{EMAIL}` / `{PHONE}` placeholders, skips TTL, and dedups at cosine similarity > 0.95 within the same project. Composer response envelope is `{draft, mode, grounding[], warnings[], cost_estimate_usd, provider_status, draftId}`; failures collapse into `deterministic_fallback` with a typed `warnings[0].code` drawn from `{provider_timeout, provider_rate_limited, over_budget, validation_blocked, grounding_empty, notion_stale}`. Over-budget falls back rather than blocks; empty-grounding still drafts with a `grounding_empty` warning; Notion-stale never blocks.
- Why: Anthropic was picked for product fit with our grounding-anchor prompt style and prompt-cache friendliness when the grounding bundle repeats across a thread. OpenAI's embedding API is cheap and boring for the narrow memory-similarity job. A soft cost cap at 1-3 operator scale is a safety net, not a throttle; a hard block would more likely frustrate operators than prevent spend. Context bounds prevent prompt bloat without sacrificing relevance because tier-5 memory carries the old-pattern signal that truncated tier-4 would otherwise lose. Memory masking prevents cross-contact name bleed while preserving technical grounding. Envelope unification lets Composer render every failure path uniformly — the operator always sees a labeled draft or labeled non-draft.
- Impact: supersedes the "OpenAI is the model provider" line in the 2026-04-18 Stage 4 entry and the corresponding text in `docs/04-implementation-specs/stage-4-ai-pipeline.md`. Downstream briefs (retrieval + prompt building, memory capture) must reference these limits. Composer `draft:generate` contract must match the response-envelope shape. All dollar amounts and cap values are MVP defaults — revisit once real usage data is available.
- Related refs: [decision-core.md](./decision-core.md), [../04-implementation-specs/stage-4-ai-pipeline.md](../04-implementation-specs/stage-4-ai-pipeline.md), `../../.codex-stage4-notion-knowledge-sync-2026-04-21.md`
