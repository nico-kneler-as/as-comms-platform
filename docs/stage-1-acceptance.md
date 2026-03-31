# Stage 1 Acceptance

**Role:** concise launch-scope acceptance note for Stage 1 backend completion  
**Audience:** implementers, reviewers, and operators validating the narrowed Stage 1 target  
**When to read:** when deciding whether Stage 1 is complete for the initial operational backend launch

## What Stage 1 complete means now

Stage 1 is complete for launch scope when the backend is operationally ready for **Gmail + Salesforce only** under the single normalization path.

That means:

- historical Gmail backfill and live Gmail polling both feed the same normalization path
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

## Locked launch-scope mappings

Gmail:

- historical backfill covers the project inbox mailbox set needed to reconstruct volunteer history
- live sync is narrowed to `volunteers@...`, which sends and receives as the project inbox aliases
- both historical and live Gmail records continue through the same normalization path

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
  proves historical Gmail + Salesforce records land in one volunteer timeline and that live Gmail + live Salesforce still converge through the same worker path
- [packages/integrations/test/stage1-mappers.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/packages/integrations/test/stage1-mappers.test.ts)
  proves Salesforce `Task` becomes auto-message canonical communication events and the four locked expedition-member date fields map to the canonical lifecycle events
- [packages/db/test/stage1-normalization.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/packages/db/test/stage1-normalization.test.ts)
  proves ambiguous matches open review, Gmail-vs-Salesforce tie-break handling stays explicit, and projection semantics remain replay-safe
- [apps/worker/test/stage1-orchestration.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/apps/worker/test/stage1-orchestration.test.ts)
  proves replay, rebuild, parity, cutover-support, and failure handling remain safe and explicit
- [apps/worker/test/stage1-ops.test.ts](/Users/nicolas/Downloads/AS%20Comms%20Platform/apps/worker/test/stage1-ops.test.ts)
  proves the launch-scope validation helpers can build enqueue payloads with Gmail + Salesforce defaults and inspect stored validation evidence

## Runtime and env still needed for real validation

Repo completion is not the same as live-provider validation. Real sandbox or production-like validation still needs:

- database access for the worker runtime
- Gmail capture-port configuration
- Salesforce capture-port configuration
- capture-service configuration for the Gmail historical mailbox set
- capture-service configuration for the `volunteers@...` live Gmail account plus project inbox aliases
- Salesforce capture-service decisions for CDC-compatible `Contact` and `Expedition_Members__c` freshness, plus delta polling for `Task`
- operator execution of the validation runbook in [docs/stage-1-validation-runbook.md](./stage-1-validation-runbook.md)

## Human validation workflow

Use this order:

1. run `pnpm ops:worker:check-config`
2. boot the worker with launch-scope Gmail + Salesforce env
3. enqueue small historical Gmail and Salesforce batches
4. inspect a known volunteer by Salesforce Contact ID
5. enqueue small live Gmail and Salesforce batches
6. inspect sync state, replay, rebuild, parity, and cutover evidence

The detailed operator steps and evidence checklist live in [docs/stage-1-validation-runbook.md](./stage-1-validation-runbook.md).

## Intentionally deferred

- SimpleTexting launch activation
- Mailchimp launch activation
- Inbox UI and operator actions
- settings, auth, and admin surfaces
- webhook product endpoints
- full cutover controller logic
- Stage 2+ product behavior
