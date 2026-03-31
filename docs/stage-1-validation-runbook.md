# Stage 1 Validation Runbook

**Role:** operator runbook for controlled Stage 1 Gmail + Salesforce validation  
**Audience:** engineers or operators validating the narrowed launch-scope backend against sandbox or non-production inputs  
**When to read:** before the first real-runtime validation run

## Purpose

This runbook validates the Gmail + Salesforce Stage 1 backend without starting later product stages.

It is intentionally worker- and DB-oriented. There is no UI dependency in this workflow.

## Preconditions

- use non-production or tightly controlled provider data
- do not commit secrets or `.env` files
- point the worker at a validation database
- configure and boot the Gmail live capture service and the Salesforce capture service only
- leave SimpleTexting and Mailchimp unset unless you are intentionally testing deferred providers outside launch scope
- review [docs/stage-1-capture-services.md](./stage-1-capture-services.md) before the first live validation run

## Required env summary

Minimum launch-scope env:

- `WORKER_BOOT_MODE=run`
- `DATABASE_URL` or `WORKER_DATABASE_URL`
- `GMAIL_CAPTURE_BASE_URL`
- `GMAIL_CAPTURE_TOKEN`
- `GMAIL_LIVE_ACCOUNT`
- `GMAIL_PROJECT_INBOX_ALIASES`
- `SALESFORCE_CAPTURE_BASE_URL`
- `SALESFORCE_CAPTURE_TOKEN`
- `SALESFORCE_CONTACT_CAPTURE_MODE`
- `SALESFORCE_MEMBERSHIP_CAPTURE_MODE`

Capture-service env is separate from worker env. Use [docs/stage-1-capture-services.md](./stage-1-capture-services.md) for the Gmail and Salesforce service-side variables.

Historical Gmail `.mbox` backfill inputs are provided at command time, not through worker env:

- `--mbox-path`
- `--captured-mailbox`
- optional `--project-inbox-alias`

## 0. Start the capture services

Run the launch-scope services in separate shells or Railway services:

```bash
pnpm dev:gmail-capture
pnpm dev:salesforce-capture
```

Expected result:

- both services boot without env errors
- `GET /health` returns `200`
- the worker bearer tokens match the capture-service bearer tokens

Recommended optional knobs:

- `WORKER_CONCURRENCY`
- `GMAIL_LIVE_POLL_INTERVAL_SECONDS`
- `SALESFORCE_TASK_POLL_INTERVAL_SECONDS`

## 1. Preflight config

Run:

```bash
pnpm ops:worker:check-config
```

Expected result:

- the command prints a JSON summary
- Gmail historical backfill mode is `mbox_import`
- Gmail live account is the `volunteers@...` address
- project inbox aliases are present
- Salesforce capture modes are explicit
- Gmail and Salesforce capture base URLs point at the separate capture services
- deferred providers show as not configured unless you intentionally enabled them

If this fails, fix env first. Do not start the worker.

## 2. Start the worker

Run:

```bash
WORKER_BOOT_MODE=run pnpm dev:worker
```

Expected result:

- the worker starts without config errors
- the startup message confirms Gmail + Salesforce launch-scope execution through the single normalization path

## 3. Historical validation

### Gmail historical backfill

Run a small Gmail historical import from an exported `.mbox` file:

```bash
pnpm ops:worker:import-gmail-mbox -- \
  --mbox-path /absolute/path/project-antarctica.mbox \
  --captured-mailbox project-antarctica@example.org \
  --limit 25
```

Use `--project-inbox-alias` when the historical mailbox context should resolve to a specific project alias that is not obvious from the message headers.

### Salesforce historical capture

Run a small Salesforce historical batch for `Contact`, `Expedition_Members__c`, and `Task` data:

```bash
pnpm ops:worker:enqueue -- salesforce-historical \
  --window-start 2026-01-01T00:00:00.000Z \
  --window-end 2026-01-02T00:00:00.000Z \
  --max-records 25
```

### Inspect one volunteer

Inspect a known Salesforce-anchored volunteer:

```bash
pnpm ops:worker:inspect -- contact --salesforce-contact-id 003-stage1
```

Acceptance checks:

- contact resolves by `Contact.Id`
- `Contact.Volunteer_ID_Plain__c` is present as a `volunteer_id_plain` identity, not the primary anchor
- canonical events from Gmail and Salesforce appear under the same contact
- timeline rows are ordered deterministically
- inbox row exists only when Inbox-driving events exist
- open identity or routing review cases are explicit when ambiguity exists

## 4. Live validation

### Gmail live polling on `volunteers@...`

Run:

```bash
pnpm ops:worker:enqueue -- gmail-live \
  --window-start 2026-01-02T00:00:00.000Z \
  --window-end 2026-01-02T00:05:00.000Z
```

Operational checks:

- live capture is sourcing the `volunteers@...` account
- provider-close records preserve alias context where the project inbox alias differs from the captured mailbox
- new inbound or outbound Gmail activity lands in canonical history through the same normalization path as historical `.mbox` imports

Inspect sync freshness:

```bash
pnpm ops:worker:inspect -- sync --provider gmail --job-type live_ingest
```

### Salesforce live update path

Run:

```bash
pnpm ops:worker:enqueue -- salesforce-live \
  --window-start 2026-01-02T00:00:00.000Z \
  --window-end 2026-01-02T00:05:00.000Z
```

Operational checks:

- `Contact` and `Expedition_Members__c` updates remain compatible with CDC-backed capture services where available
- `Task` is the only communication source entering as Salesforce communication evidence
- lifecycle events come only from the four locked `Expedition_Members__c` fields

Inspect sync freshness:

```bash
pnpm ops:worker:inspect -- sync --provider salesforce --job-type live_ingest
```

## 5. Replay and rebuild safety

Replay a known provider record if needed:

```bash
pnpm ops:worker:enqueue -- replay \
  --provider gmail \
  --mode historical \
  --items message:gmail-message-1
```

Rebuild projections for one contact:

```bash
pnpm ops:worker:enqueue -- projection-rebuild \
  --projection all \
  --contact-ids contact:salesforce:003-stage1
```

Acceptance checks:

- replay does not create duplicate canonical events
- rebuild recreates timeline and inbox state from canonical durable data
- inspect output after rebuild still matches the expected volunteer history

## 6. Parity and cutover-support evidence

Run a parity snapshot:

```bash
pnpm ops:worker:enqueue -- parity-check \
  --providers gmail,salesforce \
  --sample-contact-ids contact:salesforce:003-stage1
```

Inspect the parity checkpoint audit record:

```bash
pnpm ops:worker:inspect -- audit \
  --entity-type parity_checkpoint \
  --entity-id stage1:parity:checkpoint:...
```

Run a cutover checkpoint:

```bash
pnpm ops:worker:enqueue -- cutover-checkpoint --providers gmail,salesforce
```

Inspect the cutover audit record:

```bash
pnpm ops:worker:inspect -- audit \
  --entity-type cutover_checkpoint \
  --entity-id stage1:cutover:checkpoint:...
```

Acceptance checks:

- parity outputs are understandable without hidden auto-resolution
- cutover-support discrepancies are explicit and actionable
- freshness, historical coverage, and live coverage blockers are visible in stored evidence

## 7. Source-evidence and review inspection

Inspect a specific source record:

```bash
pnpm ops:worker:inspect -- source-evidence \
  --provider gmail \
  --provider-record-type message \
  --provider-record-id gmail-message-1
```

What to verify:

- source evidence exists once per idempotent record
- source evidence aligns with canonical events and projections
- repeated `.mbox` imports do not create duplicate canonical events
- ambiguous email or phone matches open review rather than creating silent links

## Launch-scope acceptance checklist

Mark Stage 1 ready for controlled validation only when all of these are true:

- historical Gmail + Salesforce records converge into one volunteer timeline
- live Gmail + live Salesforce records use the same normalization path
- Salesforce `Task` appears as auto-message communication evidence
- only the four locked expedition-member milestone fields generate lifecycle events
- ambiguous matches open review instead of auto-linking
- replay and rebuild remain safe
- parity and cutover-support outputs are understandable and actionable

## Still external to this repo

These are not missing code if they are still outstanding:

- deployment of the separate Gmail and Salesforce capture services
- capture-service access to sandbox Gmail and Salesforce data
- selection of the Gmail historical mailbox set
- real alias configuration for the live `volunteers@...` account
- CDC-capable upstream configuration for Salesforce `Contact` and `Expedition_Members__c`, if used
- validation database provisioning and cleanup procedures
