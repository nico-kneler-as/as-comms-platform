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

### 2026-04-23 - Project activation also requires a short admin-owned alias

- Status: `locked`
- Decision: `project_dimensions.project_alias` is an admin-owned short internal label used for inbox tags and compact operator-facing labels. A project cannot transition to `is_active = true` unless `project_alias` is non-empty, at least one project inbox alias exists, and `ai_knowledge_synced_at IS NOT NULL`.
- Why: full Salesforce project names are often too long for inbox chips and compact settings surfaces. A short alias gives operators a stable concise label without renaming the canonical project title, and making it part of the activation gate ensures active projects always have usable compact labeling in the inbox.
- Impact: Settings must let admins view and edit the short alias on project detail. Inbox row tags should prefer `project_alias` when present while keeping full project names in detail views and other canonical contexts unless explicitly shortened. Cache invalidation for inbox/settings must refresh when aliases change. This narrows the Stage 2 activation gate beyond the previous `emails + ai_knowledge_synced_at` rule.
- Related refs: [decision-core.md](./decision-core.md), [../02-bundles/settings-bundle.md](../02-bundles/settings-bundle.md), [../../packages/db/src/schema/tables.ts](../../packages/db/src/schema/tables.ts), [../../apps/web/app/settings/actions.ts](../../apps/web/app/settings/actions.ts), [../../apps/web/app/inbox/_lib/selectors.ts](../../apps/web/app/inbox/_lib/selectors.ts)

### 2026-04-21 - Stage 4 AI product decisions locked for provider, cost, context, memory, and failure-mode envelope

- Status: `locked`
- Decision: Anthropic (Claude Sonnet 4.6) is the Stage 4 draft-generation provider; OpenAI `text-embedding-3-small` is the embedding provider for tier-5 memory similarity (dual-vendor accepted for MVP). Cost cap is a soft warn at $20/day org-wide via an `AI_DAILY_CAP_USD` env var; not a hard block. Tier-4 context is bounded to the last 20 canonical events for the contact OR 90 days (whichever is smaller), each event body truncated to ~500 characters, target inbound included in full, no inline images / attachments. Tier-5 memory capture masks names / emails / phones to `{NAME}` / `{EMAIL}` / `{PHONE}` placeholders, skips TTL, and dedups at cosine similarity > 0.95 within the same project. Composer response envelope is `{draft, mode, grounding[], warnings[], cost_estimate_usd, provider_status, draftId}`; failures collapse into `deterministic_fallback` with a typed `warnings[0].code` drawn from `{provider_timeout, provider_rate_limited, over_budget, validation_blocked, grounding_empty, notion_stale}`. Over-budget falls back rather than blocks; empty-grounding still drafts with a `grounding_empty` warning; Notion-stale never blocks.
- Why: Anthropic was picked for product fit with our grounding-anchor prompt style and prompt-cache friendliness when the grounding bundle repeats across a thread. OpenAI's embedding API is cheap and boring for the narrow memory-similarity job. A soft cost cap at 1-3 operator scale is a safety net, not a throttle; a hard block would more likely frustrate operators than prevent spend. Context bounds prevent prompt bloat without sacrificing relevance because tier-5 memory carries the old-pattern signal that truncated tier-4 would otherwise lose. Memory masking prevents cross-contact name bleed while preserving technical grounding. Envelope unification lets Composer render every failure path uniformly — the operator always sees a labeled draft or labeled non-draft.
- Impact: supersedes the "OpenAI is the model provider" line in the 2026-04-18 Stage 4 entry and the corresponding text in `docs/04-implementation-specs/stage-4-ai-pipeline.md`. Downstream briefs (retrieval + prompt building, memory capture) must reference these limits. Composer `draft:generate` contract must match the response-envelope shape. All dollar amounts and cap values are MVP defaults — revisit once real usage data is available.
- Related refs: [decision-core.md](./decision-core.md), [../04-implementation-specs/stage-4-ai-pipeline.md](../04-implementation-specs/stage-4-ai-pipeline.md), `../../.codex-stage4-notion-knowledge-sync-2026-04-21.md`

### 2026-04-24 - Inbox server views are rendered dynamically; no cache invalidation path

- Status: `locked`
- Decision: every inbox page (`/inbox` list, `/inbox/[contactId]` detail) uses `export const dynamic = 'force-dynamic'`. No `revalidateTag` or `revalidatePath` calls remain in inbox server actions or elsewhere in the inbox feature.
- Why: four of the five canonical-event-ledger write paths (Gmail live poller, SF live poller, Notion knowledge sync, ops scripts) run in the worker and cannot call into Next.js cache. Only user-driven server actions were invalidating, which left worker-written data invisible to the UI until an unrelated action happened to invalidate. On 2026-04-23 the Gmail draft cleanup required operators to toggle "Needs Follow-Up" before they could see the cleaned state — diagnosed as the problem class, not a bug in that cleanup. Dropping the cache is strictly cheaper than adding a fifth invalidation signal per write path.
- Impact: DB is queried on every inbox page view. At MVP scale (1–3 operators, 20–80 inbound/day) this is negligible. If operator count or query complexity ever grows ~10×, the upgrade path is event-driven invalidation: worker posts to an internal `/api/internal/revalidate` endpoint with a shared secret, that endpoint calls `revalidateTag`. The `revalidateInboxContact` helper is preserved as the integration point for that future work; its body is a no-op now.
- Related refs: [../../apps/web/app/inbox/layout.tsx](../../apps/web/app/inbox/layout.tsx), [../../apps/web/app/inbox/actions.ts](../../apps/web/app/inbox/actions.ts), [../../apps/web/src/server/inbox/revalidate.ts](../../apps/web/src/server/inbox/revalidate.ts), `.handoff-architect-2026-04-23.md`.

### 2026-05-07 - Phones are identities; ambiguous inbound SMS escalates via the identity-resolution queue

- Status: `locked`
- Decision: phone↔contact is many-to-many through `contact_identities` rows of `kind='phone'`, mirroring the email identity model. Inbound SMS routing reads `contactIdentities.listByNormalizedValue({kind:'phone', normalizedValue})` instead of `contacts.findByPrimaryPhone`. Zero candidates → create a synthetic contact + identity row and route normally (matches today's "Unknown (+1 …)" behaviour). One candidate → route to that contact, no review case. Two or more candidates → anchor the `sms_messages` and `canonical_event_ledger` rows to the most-recent-active candidate, set the canonical event's `review_state = 'needs_identity_review'`, mark the inbox projection's `has_unresolved = true`, and open an `identity_resolution_queue` case with `reason_code = 'identity_multi_candidate'` and the full candidate list. The anchor winner is computed in SQL as `ORDER BY contact_inbox_projection.last_inbound_at DESC NULLS LAST, contact_inbox_projection.last_activity_at DESC NULLS LAST, contacts.id ASC LIMIT 1`. Consent (STOP/HELP/UNSTOP) remains phone-keyed via `consent_records.phone_e164`, so opt-out on a shared number applies to every contact on it through the existing outbound consent gate. `contacts.primary_phone` is retained as a denormalized first-match cache (parallel to `contacts.primary_email`) but is no longer the routing source of truth. Resolution UI for `identity_resolution_queue` cases is deferred — for now the operator sees only the existing `UnresolvedBanner` on the anchored thread and re-files manually if the anchor was wrong.
- Why: a non-UNIQUE partial index landed on `contacts.primary_phone` during the 2026-05-03 incident remediation because real production data contained a shared org line (`9096258767` → Naomi Fraga + Lucinda McDade, California Botanic Garden). With the column non-unique, `findByPrimaryPhone` returned nondeterministically, breaking the routing assumption baked into PRD #277 Shape A. Building an "un-anchored message" path (nullable `contact_id` on `sms_messages` and `canonical_event_ledger`) was rejected as oversized given N=1 known case in production and an existing email pattern (`ensureCanonicalContactForEmail`, `CanonicalContactAmbiguityError`) that already handles the same problem cleanly without schema changes. Anchor + flag + queue case is N=1-appropriate, mirrors the locked email pattern, and adds zero new tables/enums/queue codes. The most-recent-active winner rule prefers contacts who have replied to us over contacts who have only received platform-sent communication, which is the right intuition for inbound attribution; alphabetical contact-id is the deterministic fallback when no activity differentiates candidates (which will be the common case since most shared phones are partner/family lines, who typically have no inbox activity).
- Impact: supersedes PRD #277 Shape A (`contacts.primary_phone` as the phone identity source of truth). `apps/sms-capture/src/server.ts` `handleInboundWebhook` and `handleOptOutWebhook` switch to identity-based lookup. `packages/domain/src/contact-resolution.ts` `resolveContactByPhone` mirrors the email-side `ensureCanonicalContactForEmail` semantics — including a new `CanonicalContactPhoneAmbiguityError` that the inbound webhook catches and converts to a queue case via `service.saveIdentityAmbiguityCase`. The web composer's outbound `ensureCanonicalContactForPhone` is intentionally not changed in this revision — the outbound path's "throw on multi-match" is correct for an operator-initiated send (the operator already picked a contact; ambiguity is a data hygiene flag, not a routing decision). No migration is required: production has 1 shared-phone case and `contact_identities` of `kind='phone'` is already populated by Salesforce capture (1,033 rows covering 1,032 distinct values; 0 contacts have `primary_phone` without a matching identity row). Re-adding the unique constraint is unnecessary because `contact_identities_contact_value_unique` on `(contact_id, kind, normalized_value)` already enforces uniqueness at the right grain. Hard send-time spend cap stays parked per PRD #277 ("visibility-only" monthly cap remains; no enforcement).
- Related refs: [issue #285](https://github.com/nico-kneler-as/as-comms-platform/issues/285), [PRD #277](https://github.com/nico-kneler-as/as-comms-platform/issues/277), [`packages/domain/src/normalization.ts`](../../packages/domain/src/normalization.ts) `ensureCanonicalContactForEmail` precedent, [`apps/sms-capture/src/server.ts`](../../apps/sms-capture/src/server.ts), [`packages/db/drizzle/0052_contacts_primary_phone_unique.sql`](../../packages/db/drizzle/0052_contacts_primary_phone_unique.sql), [`packages/contracts/src/stage1-taxonomy.ts`](../../packages/contracts/src/stage1-taxonomy.ts) `identityResolutionReasonCodeValues`, D-014 (Email before SMS), D-032 (review-overlay pattern), D-041 (review surfacing).

### 2026-05-07 - Staff-origin Gmail delivered to monitored inbox is inbound attention

- Status: `locked`
- Decision: Gmail messages from staff/admin addresses delivered into `volunteers@...` or a project inbox alias are Inbox-visible inbound one-to-one communication when the sender is not the monitored mailbox/project alias itself. Drafts, DSNs, forwarded-chain exclusions, and platform-sent alias mail remain excluded or outbound according to their existing rules.
- Why: operators need to know that staff/admin notices reached the shared inbox, including messages from `@adventurescientists.org` accounts such as `admin@`. Treating those as internal-only deferred records hid real incoming work, while broadening the default Inbox beyond inbound 1:1 rows would reintroduce lifecycle/campaign/outbound-only noise.
- Impact: Gmail classification must anchor staff-origin monitored-mailbox messages to the staff sender email as a non-Salesforce contact, set the canonical event direction to inbound, and let normal projection bucket semantics reset the row to `New`. Default Inbox remains scoped to rows with `lastInboundAt IS NOT NULL`; non-volunteer rows show a soft external indicator rather than an unresolved manual-link requirement.
- Related refs: [decision-core.md](./decision-core.md), [data-core.md](./data-core.md), [../02-bundles/inbox-bundle.md](../02-bundles/inbox-bundle.md), [../../packages/integrations/src/providers/gmail-record-builder.ts](../../packages/integrations/src/providers/gmail-record-builder.ts).

### 2026-04-27 - AI knowledge architecture collapses to raw Notion-page cache + approved-reply memory

- Status: `locked`
- Decision: project AI knowledge is one Notion page per project. The platform fetches the page via the existing Notion API integration (`packages/integrations/src/providers/notion.ts`), converts blocks to markdown, and caches the result in `ai_knowledge_entries` keyed on `(projectId, sourceProvider='notion')`. The retriever feeds this cached content to the prompt builder as Tier-2 grounding (`bundle.projectContext.content`). The prior multi-source/synthesis pipeline — `project_knowledge_source_links`, `project_knowledge_bootstrap_runs`, the `/settings/projects/[id]/knowledge` sub-page UI, and the synthesis-driven writes to `project_knowledge_entries` — is removed. Tier-3 reusable approved-reply memory (operator-saved sends via "Send and save for AI") is preserved and continues to populate `project_knowledge_entries` (`kind='canonical_reply', approved_for_ai=true`); the deterministic ranker `projectKnowledge.getForRetrieval` still drives Tier-3 retrieval. The composer AI-ready gate now checks cached-content presence (`hasProjectNotionContent`), not the sync timestamp.
- Why: the multi-source/synthesis path was an uncoordinated duplicate of the single-Notion-URL concept and broke PNW Biodiversity in production (project active + URL set + composer still showing "AI grounding unavailable"). Operators already maintain canonical knowledge in Notion; flattening sub-content into one Notion page is operationally cheaper than asking the platform to crawl arbitrary URLs. With Anthropic prompt caching, per-draft token cost of feeding the raw page is in the cents range at MVP scale (1–3 operators, ~20–80 inbound/day), so synthesis-as-token-optimization was premature. Dropping the synthesis layer also removes the approval UI no operator was engaging with. Approved-reply memory stays because operator-curated examples are the durable Tier-3 signal canon prescribes (D-032, 2026-04-18 grounding order step 5).
- Impact: supersedes the 2026-04-23 architecture revision note ("curated KB table + Settings tab; one-shot LLM bootstrap at activation") that lived in architect memory but never landed in canon. The 2026-04-21 line about Notion Project ID resolution still holds; URL-to-page-id resolution now lives inside the rewritten sync job. The 2026-04-21 line about OpenAI `text-embedding-3-small` + cosine similarity for tier-5 memory is decisively closed — it was never implemented; deterministic ranking in `projectKnowledge.getForRetrieval` is the canonical path. Migration `0029_ai_knowledge_architecture_collapse.sql` drops the two collapsed tables, backfills `project_dimensions.project_alias = 'PNW Biodiversity'` for PNW Bio, and adds an active-projects non-empty-alias guard. No data preservation needed (pre-prod per `project_deployment_state.md`). `apps/web/src/server/ai/prompt-builder.ts` is intentionally untouched — current draft quality is preserved.
- Related refs: [decision-core.md](./decision-core.md), [`packages/db/drizzle/0029_ai_knowledge_architecture_collapse.sql`](../../packages/db/drizzle/0029_ai_knowledge_architecture_collapse.sql), [`apps/worker/src/jobs/notion-knowledge-sync/sync.ts`](../../apps/worker/src/jobs/notion-knowledge-sync/sync.ts), `.codex-ai-knowledge-architecture-collapse-2026-04-27.md`.

### 2026-05-10 - AI Knowledge becomes a multi-source registry with operator-driven activation, auto-sync, skip-if-unchanged, and threshold-triggered re-synthesis (PRD #366)

- Status: `locked`
- Decision: per-project AI Knowledge is now an n-source registry (`ai_knowledge_sources`) of Notion pages and public web URLs that the synthesis orchestrator pulls, normalizes, and merges into one cached AI Knowledge document per project. Operators activate a project end-to-end through a Settings activation wizard (pick project → aliases → signature → AI Knowledge sources → connected projects → review) and manage sources thereafter from the project detail page; the architect-assisted "send the architect a list of URLs" path is retired. Three loops keep the document current without manual clicks: (1) **auto-sync** via `ai_auto_sync_schedule` enum on `project_dimensions` (`'never' | 'daily' | 'weekly'`, default `'never'`) driven by an hourly `poll-ai-knowledge-auto-sync` Graphile cron; (2) **skip-if-unchanged** — orchestrator computes a hash of all enabled-source content and short-circuits before the LLM call when it matches the project's stored `ai_optimized_input_hash`; (3) **threshold trigger** — `captureKnowledgeFromSend` (the "Send and save for AI" path) writes `approved_for_ai=true` and counts approved-for-AI rows since the last synthesis; once the count crosses 5 and the project has at least one enabled source, an `ai-knowledge-capture-trigger:{projectId}` job is enqueued with `skipIfHashUnchanged=false` (approved replies are the change signal even when sources didn't change). The operator's deliberate "Send and save for AI" click IS the approval signal — no separate Tier-3 review UI exists or is planned. Synthesis runs as a worker job with an ops CLI fallback.
- Why: the 2026-04-27 collapse to "one Notion page per project" was correct for shipping AI Draft but undershot operator needs at scale: real projects had multiple canonical sources (homepage + Notion FAQ + training PDF + field manual) that operators were manually reconciling into one page. Re-introducing the multi-source pipeline behind a single registry table — and pairing it with cheap change-detection (skip-if-unchanged) and approved-reply weighting — preserves the simplicity gains of the 2026-04-27 collapse while removing operator copy-paste work. Auto-sync was needed because operators forget to Resync; threshold trigger was needed because approved-reply memory is the highest-quality Tier-3 signal and only landed via "Send and save for AI" clicks that previously sat unweighted until the next manual re-synthesis. Self-serve activation via the wizard removed the architect bottleneck on every new project.
- Impact: supersedes the 2026-04-27 "raw Notion-page cache" entry — the cache shape is the same (one merged document per project, fed to Tier 2 of the prompt) but the source path is now n-of-many. Schema additions: `ai_knowledge_sources` registry (PR-A `0054`), `ai_auto_sync_schedule` enum column on `project_dimensions` (PR Phase-2 `0055`). The `notion-knowledge-sync` worker job is replaced by `synthesize-project-knowledge` (orchestrator + worker job + ops CLI). Project-activation requirements gain a fourth criterion: synthesis must have run at least once (the cached-content presence gate, `hasProjectNotionContent`, is reused unchanged). The project detail "AI Knowledge" surface is operator-managed end-to-end (add/remove sources, change schedule, click Resync, see freshness/last-synthesized-at). PR series: #367 (PR-A schema), #371 (PR-B-1 fetchers), #372 (PR-B-2 orchestrator), #373 (PR-C wizard + detail UI), #376 (Phase 2 auto-sync), #377 (Phase 3 weighting + threshold). Anthropic timeout bumped to 180s for synthesis (PR #387) since multi-source merges are larger than single-page calls. Follow-up polish: #399 (URL + label per row in the wizard), #400 (AI Knowledge table polish + tab panel content leak fix), #405 alias-host-hop fix.
- Related refs: [decision-core.md](./decision-core.md) `D-043`, PRD #366, [`packages/db/drizzle/0054_ai_knowledge_sources.sql`](../../packages/db/drizzle/0054_ai_knowledge_sources.sql), [`packages/db/drizzle/0055_ai_auto_sync_schedule.sql`](../../packages/db/drizzle/0055_ai_auto_sync_schedule.sql), [`apps/worker/src/jobs/synthesize-project-knowledge/orchestrator.ts`](../../apps/worker/src/jobs/synthesize-project-knowledge/orchestrator.ts), [`apps/web/app/settings/_components/activation-wizard/index.tsx`](../../apps/web/app/settings/_components/activation-wizard/index.tsx), [`apps/web/app/inbox/actions.ts`](../../apps/web/app/inbox/actions.ts) `captureKnowledgeFromSend`.

### 2026-05-10 - Connected projects: shared-alias rollup via host/sub `connected_to_project_id`

- Status: `locked`
- Decision: two or more Salesforce projects can share an inbox alias and AI Knowledge by marking one as the **host** and the other(s) as **connected sub-projects** via a new `project_dimensions.connected_to_project_id` column (self-referencing nullable FK). A connected sub-project does not carry its own alias or AI Knowledge — both are inherited from the host. The migration relaxes the active-alias `CHECK` to accept connected sub-projects without their own alias, adds a chain-prevention trigger (a sub cannot itself be a host), and indexes the rollup column. The Inbox project filter dropdown excludes connected sub-projects (operators see and filter by the host only); the Settings projects list nests subs visually under their host with a "Connected to {host name}" subtitle and a `CornerDownRight` glyph. Activation wizard adds an optional **Connected projects** step (after AI Knowledge, before Review) that multi-selects inactive unconnected projects to roll into the new host. Project detail (host view) shows a "Connected projects" card with a Disconnect control and an Add picker; project detail (sub view) shows a "Connected to {host}" badge and read-only alias/AI-Knowledge sections. **Deactivating a host cascades to its subs in one transaction**; the deactivate dialog lists each sub by name before confirming.
- Why: real production case — `forests@adventurescientists.org` is a single inbound alias serving Beech Leaf Disease and Butternut Canker, two distinct Salesforce projects. Without this rollup, only one of the two could be active (since the alias unique constraint prevents two active projects sharing it), losing the other project's volunteer roster from the Inbox dashboard. Building two equal-sibling projects sharing an alias was rejected as ambiguous (which one "owns" the AI Knowledge document?); the host/sub model preserves a single source of truth per alias while keeping both Salesforce projects' volunteer rosters in the same operator workspace.
- Impact: schema migration `0056_connected_to_project_id.sql` adds the column, relaxes the active-alias CHECK, and adds the chain-prevention trigger. `project_dimensions` repo gains `listConnectedProjects` and `listAvailableConnectionCandidates`; settings selectors expose `connectedProjects` (host) and `connectedToHost` (sub). Inbox project filter selector excludes rows with `connected_to_project_id IS NOT NULL`. Settings projects list selector returns a nested `{ host, connectedSubProjects }` shape; the wizard's pick-project list still gets a flat row array. PR series: #384 (data foundation + SQL-only management), #388 (wizard step + detail page + cascade), #389 (Settings list nesting + Inbox filter exclusion). Follow-up: #405 added the alias-host-hop AI Knowledge fallback for connected subs (previously deferred from the initial series); contact-rail "connected to host" display remains deferred.
- Related refs: [decision-core.md](./decision-core.md) `D-044`, [`packages/db/drizzle/0056_connected_to_project_id.sql`](../../packages/db/drizzle/0056_connected_to_project_id.sql), [`apps/web/app/settings/_components/activation-wizard/step-connected-projects.tsx`](../../apps/web/app/settings/_components/activation-wizard/step-connected-projects.tsx).
