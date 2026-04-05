# Stage 1 Acceptance

**Role:** concise launch-scope acceptance and current-state note for completed Stage 1 backend work
**Audience:** implementers, reviewers, and operators validating the narrowed Stage 1 target  
**When to read:** when checking what Stage 1 and Stage 1B completed, what evidence backed that call, and what still remains outside launch scope

## Current state

Stage 1 launch-scope backend work is complete for **Gmail + Salesforce**, and the Stage `1B` trust pass is complete.

That recorded state includes these outcomes:

- launch-scope historical backfill completed for Gmail and Salesforce
- Gmail + Salesforce historical and live paths converged through the same normalization path
- parity and cutover checkpoints were green for the validated launch-scope pass
- representative Salesforce-anchored contact proofs were used to confirm merged history, projection explainability, and review overlays
- replay, rebuild, parity, cutover-support, and audit evidence hardening are part of the trusted Stage 1 backend surface
- later deferred-provider validation can proceed without reopening the launch-scope Gmail + Salesforce baseline

## What Stage 1 complete means for launch scope

Stage 1 is complete for launch scope when the backend is operationally ready for **Gmail + Salesforce only** under the single normalization path.

Acceptance is anchored to these truths:

- historical Gmail `.mbox` backfill and live Gmail polling both feed the same normalization path
- historical Salesforce extracts and live Salesforce updates both feed the same normalization path
- Gmail and Salesforce events can land in one volunteer timeline anchored by `Contact.Id`
- `Contact.Volunteer_ID_Plain__c` is preserved as the canonical volunteer ID value without replacing `Contact.Id` as the primary anchor
- ambiguous email or phone matches open explicit review instead of silently linking
- replay, rebuild, parity, and cutover-support jobs remain safe to rerun

## Launch-scope providers

Required for Stage 1 launch completion:

- Gmail
- Salesforce

Deferred for launch completion, while keeping the generic architecture intact:

- SimpleTexting
- Mailchimp

## What remains after Stage 1B

- Stage 1 remains backend-first; later user-facing stages still include Settings/Admin, Inbox, AI, and Campaigns under the locked stage order in [docs/01-core/delivery-core.md](./01-core/delivery-core.md) and [docs/01-core/product-core.md](./01-core/product-core.md)
- deferred-provider backend validation now moves to Stage `1C`, with the final four-provider confidence pass in Stage `1D`
- residual launch-scope notes should be treated as non-blocking cleanup unless they reopen locked mappings, invalidate representative-contact proofs, or break replay, parity, cutover, or audit trust

## Locked launch-scope mappings

Gmail:

- historical backfill comes from exported `.mbox` files for the selected project inboxes needed to reconstruct volunteer history
- live sync is narrowed to `volunteers@...`, which sends and receives as the project inbox aliases
- both historical `.mbox` records and live Gmail API records continue through the same normalization path

Salesforce:

- launch-scope objects are `Contact`, `Expedition_Members__c`, and `Task`
- `Task` is the only first-scope Salesforce communication source and becomes auto-message timeline evidence
- lifecycle events come only from:
  - `Expedition_Members__c.CreatedDate`
  - `Expedition_Members__c.Date_Training_Sent__c`
  - `Expedition_Members__c.Date_Training_Completed__c`
  - `Expedition_Members__c.Date_First_Sample_Collected__c`

## Acceptance proof in repo

Launch-scope acceptance is backed by these test areas:

- [apps/worker/test/stage1-launch-scope.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/apps/worker/test/stage1-launch-scope.test.ts)
  proves historical Gmail `.mbox` + Salesforce records land in one volunteer timeline and that live Gmail + live Salesforce still converge through the same worker path
- [apps/worker/test/stage1-gmail-mbox-import.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/apps/worker/test/stage1-gmail-mbox-import.test.ts)
  proves the historical Gmail `.mbox` import path is replay-safe and records a succeeded Gmail historical sync state
- [packages/integrations/test/stage1-gmail-mbox.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/packages/integrations/test/stage1-gmail-mbox.test.ts)
  proves exported `.mbox` messages produce the expected Gmail provider-close record shape and converge with live Gmail records at the mapping contract
- [packages/integrations/test/stage1-mappers.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/packages/integrations/test/stage1-mappers.test.ts)
  proves Salesforce `Task` becomes auto-message canonical communication events and the four locked expedition-member date fields map to the canonical lifecycle events
- [packages/integrations/test/stage1-gmail-capture-service.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/packages/integrations/test/stage1-gmail-capture-service.test.ts)
  proves Gmail capture-service auth, payload validation, live `volunteers@...` mailbox behavior, and explicit rejection of historical Gmail API backfill in launch scope
- [packages/integrations/test/stage1-salesforce-capture-service.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/packages/integrations/test/stage1-salesforce-capture-service.test.ts)
  proves Salesforce capture-service auth, payload validation, launch-scope object coverage, and provider-close response shape
- [packages/db/test/stage1-normalization.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/packages/db/test/stage1-normalization.test.ts)
  proves ambiguous matches open review, Gmail-vs-Salesforce tie-break handling stays explicit, and projection semantics remain replay-safe
- [apps/worker/test/stage1-orchestration.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/apps/worker/test/stage1-orchestration.test.ts)
  proves replay, rebuild, parity, cutover-support, and failure handling remain safe and explicit
- [apps/worker/test/stage1-ops.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/apps/worker/test/stage1-ops.test.ts)
  proves the launch-scope validation helpers can build enqueue payloads with Gmail + Salesforce defaults and inspect stored validation evidence

## Historical validation inputs

The completed launch-scope validation depended on these runtime and operator inputs. Keep them available when re-running the pass or debugging regressions:

- database access for the worker runtime
- Gmail capture-port configuration for live `volunteers@...` sync
- Salesforce capture-port configuration
- exported `.mbox` files for the historical Gmail inboxes selected for launch-scope validation
- capture-service configuration for the `volunteers@...` live Gmail account plus project inbox aliases
- Salesforce capture-service decisions for CDC-compatible `Contact` and `Expedition_Members__c` freshness, plus delta polling for `Task`
- deployment of the separate Gmail and Salesforce capture services documented in [docs/stage-1-capture-services.md](./stage-1-capture-services.md)
- operator execution of the validation runbook in [docs/stage-1-validation-runbook.md](./stage-1-validation-runbook.md)

## Re-running the launch-scope validation workflow

Use this order when re-running the historical validation pass or investigating a regression:

1. run `pnpm ops:worker:check-config`
2. boot the worker with launch-scope Gmail + Salesforce env
3. run a small historical Gmail `.mbox` import plus a small Salesforce historical batch
4. inspect a known volunteer by Salesforce Contact ID
5. enqueue small live Gmail and Salesforce batches
6. inspect sync state, replay, rebuild, parity, and cutover evidence

The detailed operator steps and evidence checklist live in [docs/stage-1-validation-runbook.md](./stage-1-validation-runbook.md).

## Still intentionally deferred after Stage 1B

- SimpleTexting launch activation
- Mailchimp launch activation
- Inbox UI and operator actions
- settings, auth, and admin surfaces
- webhook product endpoints
- full cutover controller logic
- Stage 2+ product behavior
