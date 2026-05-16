# Runbook: Campaign send is stuck

**Severity:** S1  
**Average time to recover:** ~10 minutes  
**Last verified:** 2026-05-15

## Symptom

A campaign run is stuck in `scheduled` or `sending`, the audience snapshot table
still has `delivery_status = 'pending'` rows, and recipients stop advancing
even though the worker service is healthy.

## Likely causes (in order of probability)

1. **A `campaign-send` batch failed before Postmark accepted it** and the worker
   exited early, leaving the untouched batch in `pending`.

2. **The run was intentionally cancelled mid-flight** and the remaining rows are
   correctly still `pending`. Verify `campaign_runs.state = 'cancelled'` before
   attempting recovery.

3. **The scheduled Graphile job never re-fired after a deploy/restart** and the
   run is frozen but idle.

4. **Postmark credentials are missing or invalid in the worker runtime** so the
   send task can freeze but never flush a batch.

## Recovery

1. **Confirm the run state.** Inspect the run in the DB or run-detail page.
   If the state is `cancelled`, stop here: pending rows are expected.

2. **Check worker logs** for recent `campaign-send` failures. Look for batch
   exceptions, missing `POSTMARK_SERVER_TOKEN`, or repeated recipient failures.

3. **Requeue the pending send job** from the repo root:

   ```bash
   pnpm ops:worker:reprocess-pending-campaign-sends
   ```

   Optional: add `--limit=1` when recovering a single recent run.

4. **Watch the worker logs** for the new `campaign-send` execution and confirm
   `audience_snapshots.delivery_status` advances from `pending` to `sent`,
   `failed`, or `suppressed_at_send`.

5. **If Postmark credentials are missing,** fix the worker env first, then run
   the reprocess command again. Do not keep requeueing a run against a broken
   worker config.

## If recovery fails

Alert `nico@adventurescientists.org`. Include:
- The affected `campaign_run.id`
- Whether the run is `scheduled`, `sending`, or `cancelled`
- The count of remaining `pending` audience snapshots
- The last 50 worker log lines around the failed `campaign-send` batch

## Related

- [`apps/worker/src/jobs/campaign-send/index.ts`](../../apps/worker/src/jobs/campaign-send/index.ts)
- [`packages/domain/src/campaign-send-orchestrator.ts`](../../packages/domain/src/campaign-send-orchestrator.ts)
- [`apps/worker/src/ops/cli.ts`](../../apps/worker/src/ops/cli.ts)
- [`docs/runbooks/worker-queue-stuck.md`](./worker-queue-stuck.md)
