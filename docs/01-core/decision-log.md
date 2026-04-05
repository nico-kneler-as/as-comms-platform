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
