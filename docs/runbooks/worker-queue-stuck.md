# Runbook: Worker queue is stuck — jobs not advancing

**Severity:** S1
**Average time to recover:** ~10 minutes
**Last verified:** 2026-05-02 against commit ac85d7b

## Symptom

The inbox is not updating despite Gmail and Salesforce capture being healthy.
The Railway `worker` service is running but logs show no recent
`reconcile.completed` events, or the same event type repeats with
`"made no progress"` errors. You may see stale `heartbeat_at` timestamps in
the `sync_state` table (requires DB access).

## Likely causes (in order of probability)

1. **Graphile Worker task queue deadlocked or backlogged** — the underlying
   job queue (graphile-worker) has stuck tasks. Verify: Railway `worker`
   logs for repeated failures on the same task name without progress.

2. **`sync_state` row stuck in `running` status** — a previous worker
   instance crashed mid-job and left a row with `status = 'running'` and a
   stale `heartbeat_at`. The stale-running reconciler normally clears these,
   but if the reconciler itself is stuck, nothing advances. Verify: check
   Railway logs for `"sync_state.stale_running.reconcile.errors"` with
   `"swept": 0`.

3. **Worker has crashed and Railway auto-restart is failing** — the service
   is crash-looping. Verify: Railway → `worker` → Deployments tab shows
   repeated restarts.

4. **Dead-letter threshold reached for a provider** — after 5 consecutive
   failures, the `sync_state` row transitions to `quarantined`. No further
   jobs run for that scope/provider combination until manually cleared.
   Verify: Railway `worker` logs for `"disposition":"dead_letter"` events.

## Recovery

1. **Check the worker service.** Railway → `worker` → Logs. Scan the last
   5 minutes. Look for panic, OOM, or repeated identical errors.

2. **If the worker is crash-looping,** click **Restart** in Railway. Watch
   logs for a clean boot with the orchestration service initializing.

3. **If you see `"swept": 0` on the stale-running reconciler,** the worker
   needs a restart to release the stuck lease. Click **Restart**. The lease
   expiry threshold is set by `leaseThresholdMs` in worker config — after a
   restart, stale rows are cleaned up automatically on the next reconciler
   poll.

4. **If you see `"disposition":"dead_letter"` for a specific scope,** the
   provider has been quarantined after 5 consecutive failures. This requires
   investigation before clearing — alert the architect. Do **not** attempt
   to manually UPDATE the `sync_state` row.

5. **Confirm recovery.** After restart, wait 3–5 minutes and look for
   `"reconcile.completed"` log lines with non-zero `scanned` counts.

## If recovery fails

Alert `nico@adventurescientists.org`. Include:
- The last 50 lines of Railway `worker` logs.
- The task name (job type) that appears stuck.
- Whether Gmail or Salesforce capture services are healthy.
- Whether the issue started after a recent deploy.

## Related

- **Code paths:**
  - [reconcile-stale-running.ts](../../apps/worker/src/jobs/reconcile-stale-running.ts) — sweeps `sync_state` rows with stale `heartbeat_at`
  - [reconcile-identity-queue.ts](../../apps/worker/src/jobs/reconcile-identity-queue.ts) — identity queue reconciler; throws if no progress + errors
  - [tables.ts](../../packages/db/src/schema/tables.ts) — `sync_state` table: `status`, `consecutive_failure_count`, `lease_owner`, `heartbeat_at`, `dead_letter_count`
  - [stage1-taxonomy.ts](../../packages/contracts/src/stage1-taxonomy.ts) — sync status enum: `pending / running / succeeded / failed / quarantined / cancelled`
  - [service.ts](../../apps/worker/src/orchestration/service.ts) — dead-letter disposition logic (5 retries → `dead_letter`)
- **Other runbooks:** [gmail-capture-stopped.md](./gmail-capture-stopped.md), [salesforce-capture-stopped.md](./salesforce-capture-stopped.md), [morning-ops-checks.md](./morning-ops-checks.md)
- **Recent incidents:** PR #206 (2026-04) — Mailchimp lease/heartbeat fix + stale-running sweeper; PR #212 (2026-04) — carry `consecutive_failure_count` across cron polls
