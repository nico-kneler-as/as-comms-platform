# Stage 1 Worker Runtime

This note is operational only. It describes the minimum worker/runtime wiring that is executable at the end of Stage 1.

## Launch-scope focus

- Stage 1 launch-scope acceptance is **Gmail + Salesforce only**.
- SimpleTexting and Mailchimp remain in the generic architecture, but they are deferred for initial launch completion.
- The worker still keeps one normalization path for every provider, mode, and replay path. Narrowing launch scope does not create a second ingest or normalization path.

## Required env

Worker boot:

- `WORKER_BOOT_MODE=run`
- `DATABASE_URL` or `WORKER_DATABASE_URL`
- `WORKER_CONCURRENCY` optional, defaults to `1`

Launch-scope runtime config:

- `GMAIL_HISTORICAL_MAILBOXES`
  - required
  - comma-separated mailbox set for historical Gmail backfill
  - should include every selected project inbox needed to reconstruct volunteer history
- `GMAIL_LIVE_ACCOUNT`
  - required
  - must be a `volunteers@...` address
- `GMAIL_PROJECT_INBOX_ALIASES`
  - required
  - comma-separated project inbox aliases represented by the live `volunteers@...` account
- `GMAIL_LIVE_POLL_INTERVAL_SECONDS`
  - optional, defaults to `60`
- `SALESFORCE_CONTACT_CAPTURE_MODE`
  - required
  - `delta_polling` or `cdc_compatible`
- `SALESFORCE_MEMBERSHIP_CAPTURE_MODE`
  - required
  - `delta_polling` or `cdc_compatible`
- `SALESFORCE_TASK_POLL_INTERVAL_SECONDS`
  - optional, defaults to `300`

Provider capture ports:

- `GMAIL_CAPTURE_BASE_URL`
- `GMAIL_CAPTURE_TOKEN`
- `SALESFORCE_CAPTURE_BASE_URL`
- `SALESFORCE_CAPTURE_TOKEN`
- `SIMPLETEXTING_CAPTURE_BASE_URL` optional, deferred for launch scope
- `SIMPLETEXTING_CAPTURE_TOKEN` optional, deferred for launch scope
- `MAILCHIMP_CAPTURE_BASE_URL` optional, deferred for launch scope
- `MAILCHIMP_CAPTURE_TOKEN` optional, deferred for launch scope

If worker boot is enabled and Gmail or Salesforce capture env is missing, the runtime fails closed at startup.
If SimpleTexting or Mailchimp env is omitted, their task names stay registered but fail closed with an explicit non-retryable deferred-for-launch-scope error if called.

Use the config preflight command before a sandbox run:

```bash
pnpm ops:worker:check-config
```

This prints a secret-safe summary of the validated launch-scope config and whether deferred providers are configured.

## Gmail operational model

- historical backfill must cover the project inbox mailbox set needed to reconstruct volunteer history
- live Gmail sync is narrowed to `volunteers@...`, which sends and receives on behalf of the project inbox aliases
- capture services, not the domain layer, are responsible for expanding the historical mailbox set and for preserving the live `volunteers@...` plus alias context in provider-close records
- provider-close Gmail records may carry:
  - `capturedMailbox` for the mailbox/account the capture service read from
  - `projectInboxAlias` for the project inbox alias represented by that message when different from the captured mailbox
- historical and live Gmail records must still feed the same normalization path and the same dedupe rules
- a practical launch-scope live cadence is one-minute polling using `GMAIL_LIVE_POLL_INTERVAL_SECONDS=60`

## Salesforce operational model

- launch-scope Salesforce objects are limited to:
  - `Contact`
  - `Expedition_Members__c`
  - `Task`
- `Contact.Id` remains the primary identity anchor
- `Contact.Volunteer_ID_Plain__c` is the canonical volunteer ID value, but not the primary join key
- `Contact` plus `Expedition_Members__c` are the identity and membership foundation
- `Task` is the only first-scope Salesforce communication source and is treated as auto-message timeline evidence
- first-scope lifecycle events come only from these locked `Expedition_Members__c` fields:
  - `CreatedDate`
  - `Date_Training_Sent__c`
  - `Date_Training_Completed__c`
  - `Date_First_Sample_Collected__c`

## Capture-port shape

Each provider capture port is an env-gated HTTP client at the integrations boundary.

- request body: the Stage 1 job payload for that provider/mode
- response body:

```json
{
  "records": [],
  "nextCursor": null,
  "checkpoint": null
}
```

`records` must already be in the provider-close record shapes used by the Stage 1 mapping layer. The domain layer never receives raw provider SDK payloads.

Paths used by the runtime:

- Gmail: `POST /historical`, `POST /live`
- Salesforce: `POST /historical`, `POST /live`
- SimpleTexting: `POST /historical`, `POST /live` when that provider is re-enabled later
- Mailchimp: `POST /historical`, `POST /transition` when that provider is re-enabled later

## Live freshness strategy

- Gmail live freshness is modeled as incremental polling on `volunteers@...`
- Salesforce `Contact` and `Expedition_Members__c` freshness should remain CDC-compatible where available, but the worker only requires provider-close live batches and does not force a specific upstream capture mechanism in Stage 1
- Salesforce `Task` freshness is modeled as delta polling
- in this repo, `cdc_compatible` means the capture service may source deltas from CDC-capable upstream infrastructure, but the worker still receives the same provider-close live batch shape either way
- cutover-readiness checks use the persisted Stage 1 sync-state freshness metrics; they do not imply a larger observability subsystem

## Executable Stage 1 task names

- `stage1.gmail.capture.historical`
- `stage1.gmail.capture.live`
- `stage1.salesforce.capture.historical`
- `stage1.salesforce.capture.live`
- `stage1.simpletexting.capture.historical`
- `stage1.simpletexting.capture.live`
- `stage1.mailchimp.capture.historical`
- `stage1.mailchimp.capture.transition`
- `stage1.replay.batch`
- `stage1.projection.rebuild`
- `stage1.parity.check`
- `stage1.cutover.checkpoint`

These task names all execute through the same path:

`capture -> provider-close mapping -> normalized DTOs -> normalization service -> persistence/projections`

For narrowed launch-scope acceptance, the operationally required end-to-end tasks are:

- `stage1.gmail.capture.historical`
- `stage1.gmail.capture.live`
- `stage1.salesforce.capture.historical`
- `stage1.salesforce.capture.live`
- `stage1.replay.batch`
- `stage1.projection.rebuild`
- `stage1.parity.check`
- `stage1.cutover.checkpoint`

Operator-facing enqueue and inspection commands:

```bash
pnpm ops:worker:enqueue -- gmail-historical --window-start 2026-01-01T00:00:00.000Z --window-end 2026-01-02T00:00:00.000Z --max-records 25
pnpm ops:worker:enqueue -- gmail-live --window-start 2026-01-02T00:00:00.000Z --window-end 2026-01-02T00:05:00.000Z
pnpm ops:worker:enqueue -- salesforce-historical --window-start 2026-01-01T00:00:00.000Z --window-end 2026-01-02T00:00:00.000Z --max-records 25
pnpm ops:worker:enqueue -- salesforce-live --window-start 2026-01-02T00:00:00.000Z --window-end 2026-01-02T00:05:00.000Z
pnpm ops:worker:enqueue -- projection-rebuild --projection all --contact-ids contact:salesforce:003-stage1
pnpm ops:worker:enqueue -- parity-check --providers gmail,salesforce --sample-contact-ids contact:salesforce:003-stage1
pnpm ops:worker:enqueue -- cutover-checkpoint --providers gmail,salesforce
pnpm ops:worker:inspect -- contact --salesforce-contact-id 003-stage1
pnpm ops:worker:inspect -- source-evidence --provider gmail --provider-record-type message --provider-record-id gmail-message-1
pnpm ops:worker:inspect -- sync --provider gmail --job-type live_ingest
pnpm ops:worker:inspect -- audit --entity-type parity_checkpoint --entity-id stage1:parity:checkpoint:...
```

See [docs/stage-1-validation-runbook.md](./stage-1-validation-runbook.md) for the validation sequence and evidence checklist.

## Sync-state closure in Stage 1

The sync-state model now distinguishes:

- provider-scoped jobs with `scope = "provider"` and a real provider value
- orchestration-scoped jobs with `scope = "orchestration"` and `provider = null`

The model also persists:

- `freshnessP95Seconds`
- `freshnessP99Seconds`

That is the minimum additional state needed for current cutover-readiness checks.

## Intentionally deferred

- SimpleTexting and Mailchimp launch-scope activation
- live provider SDK/webhook handling inside the product app
- full capture scheduling/cutover controller logic
- later-stage settings/admin/auth surfaces
- Inbox UI or operator actions
- Stage 2+ product behavior
