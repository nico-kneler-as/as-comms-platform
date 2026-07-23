# Worker Job Catalog — Current

**Role:** current live worker inventory  
**Audience:** implementers and operators checking what the worker actually runs now  
**When to read:** before changing cron schedules, adding jobs, or writing runbooks against worker behavior  
**Authority:** implementation-spec guidance grounded in the shipped worker runtime  
**Last reviewed:** 2026-07-23

## Summary

- This file is the current inventory from `buildWorkerCrontab` and `createTaskList`.
- The first two cron lines are env-derived from `GMAIL_LIVE_POLL_INTERVAL_SECONDS` and `SALESFORCE_TASK_POLL_INTERVAL_SECONDS`.
- Non-cron task types remain callable even when they are usually reached through cron fan-out.

## Live cron jobs

| Job name                              | Schedule                                                 | Purpose                                                                                        | Ops-script twin                                                                                      |
| ------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `poll-gmail-live`                     | `*/<GMAIL_LIVE_POLL_INTERVAL_SECONDS / 60> * * * *`      | Enqueue the next Gmail live capture batch.                                                     | none                                                                                                 |
| `poll-salesforce-live`                | `*/<SALESFORCE_TASK_POLL_INTERVAL_SECONDS / 60> * * * *` | Enqueue the next Salesforce live capture batch.                                                | none                                                                                                 |
| `poll-mailchimp-transition-scheduler` | `0 * * * *`                                              | Discover and enqueue transition-period Mailchimp refresh batches.                              | none                                                                                                 |
| `poll-ai-knowledge-auto-sync`         | `0 * * * *`                                              | Enqueue scheduled AI knowledge re-synthesis for active projects.                               | none                                                                                                 |
| `poll-integration-health`             | `*/5 * * * *`                                            | Poll capture-service health and update `integration_health`.                                   | none                                                                                                 |
| `poll-postmark-sender-status`         | `*/5 * * * *`                                            | Refresh Postmark sender verification state into Settings/read models.                          | none                                                                                                 |
| `campaign-events-tail-finalize`       | `0 3 * * *`                                              | Finalize older completed campaign runs after the 30-day event tail window.                     | none                                                                                                 |
| `sweep-pending-outbounds`             | `*/5 * * * *`                                            | Sweep long-lived pending composer email rows to `orphaned`.                                    | none                                                                                                 |
| `reconcile-stale-running`             | `* * * * *`                                              | Clear or alert on stuck Graphile jobs still marked running.                                    | none                                                                                                 |
| `reconcile-stranded-campaign-runs`    | `*/5 * * * *`                                            | Re-enqueue email campaign sends whose run is still `sending` but has no live job.              | [reconcile-stranded-campaign-runs.ts](../../apps/worker/src/ops/reconcile-stranded-campaign-runs.ts) |
| `reconcile-identity-queue`            | `*/15 * * * *`                                           | Re-run identity review cases against stored evidence and current data.                         | [reconcile-identity-queue.ts](../../apps/worker/src/ops/reconcile-identity-queue.ts)                 |
| `poll-inbox-read-state`               | `*/10 * * * *`                                           | Check Gmail read/out-of-inbox state for `New` rows and flip them to `Opened` when appropriate. | [poll-inbox-read-state.ts](../../apps/worker/src/ops/poll-inbox-read-state.ts)                       |
| `dedup-historical-ledger`             | `0 10 * * *`                                             | Sweep known duplicate historical canonical events and refresh affected projections.            | [dedup-historical-ledger.ts](../../apps/worker/src/ops/dedup-historical-ledger.ts)                   |
| `reconcile-capture-gaps`              | `30 10 * * *`                                            | Inspect failed/quarantined sync windows and surface replay candidates.                         | [reconcile-capture-gaps.ts](../../apps/worker/src/ops/reconcile-capture-gaps.ts)                     |
| `reconcile-routing-review-queue`      | `*/15 * * * *`                                           | Re-run routing review cases against current memberships/project context.                       | [reconcile-routing-review-queue.ts](../../apps/worker/src/ops/reconcile-routing-review-queue.ts)     |
| `reconcile-salesforce-state`          | `0 6 * * 0`                                              | Weekly Salesforce state reconciliation against current upstream records.                       | [reconcile-salesforce-state.ts](../../apps/worker/src/ops/reconcile-salesforce-state.ts)             |
| `reconcile-superseded-projections`    | `0 11 * * 0`                                             | Find projection rows still pointing at superseded canonical events and enqueue rebuilds.       | [reconcile-superseded-projections.ts](../../apps/worker/src/ops/reconcile-superseded-projections.ts) |

## Registered non-cron job types

| Job name                                  | How it is used                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `stage0.noop`                             | Stage 0 smoke/probe task.                                                                    |
| `campaign-send`                           | Email broadcast send execution, scheduled or immediate.                                      |
| `sms-broadcast-send`                      | SMS broadcast send execution, immediate enqueue from Broadcasts.                             |
| `notion-knowledge-sync`                   | Explicit Notion knowledge sync task.                                                         |
| `synthesize-project-knowledge`            | Project AI knowledge synthesis/publish task.                                                 |
| `integration-backfill-gmail`              | Recovery backfill after Gmail integration degradation.                                       |
| `stage1.gmail.capture.historical`         | Historical Gmail capture batch.                                                              |
| `stage1.gmail.capture.live`               | Live Gmail capture batch, usually enqueued by `poll-gmail-live`.                             |
| `stage1.salesforce.capture.historical`    | Historical Salesforce capture batch.                                                         |
| `stage1.salesforce.capture.live`          | Live Salesforce capture batch, usually enqueued by `poll-salesforce-live`.                   |
| `stage1.simpletexting.capture.historical` | Historical SimpleTexting capture batch.                                                      |
| `stage1.simpletexting.capture.live`       | Live SimpleTexting capture batch.                                                            |
| `stage1.mailchimp.capture.historical`     | Historical Mailchimp capture batch.                                                          |
| `stage1.mailchimp.capture.transition`     | Transition-period live Mailchimp capture batch, usually enqueued by the Mailchimp scheduler. |
| `stage1.replay.batch`                     | Canonical replay batch from stored source evidence.                                          |
| `stage1.projection.rebuild`               | Projection rebuild batch.                                                                    |
| `stage1.parity.check`                     | Parity-check batch.                                                                          |
| `stage1.cutover.checkpoint`               | Cutover checkpoint batch.                                                                    |

## Source refs

- cron builder: [runtime.ts](../../apps/worker/src/runtime.ts)
- task registration: [tasks.ts](../../apps/worker/src/tasks.ts)
- Stage 1 task fan-out: [tasks.ts](../../apps/worker/src/orchestration/tasks.ts)
- Stage 1 job names: [stage1-worker-jobs.ts](../../packages/contracts/src/stage1-worker-jobs.ts)
