# Runbook: Decommission Mailchimp transition ingest after SendGrid cutover

**Severity:** S2  
**Average time to recover:** planned change window + 30-day tail drain  
**Last verified:** 2026-05-03 against commit af11e396

## Purpose

Retire the temporary Mailchimp live-ingest path once native SendGrid campaign
sending is fully trusted. This removes scheduler activity and the dedicated
`mailchimp-capture` service without deleting canonical history.

## Preconditions

1. SendGrid native campaign sending is fully validated in production.
2. Operators have confirmed no active Mailchimp campaign sends remain scheduled.
3. The fallback path is understood: re-enable transition ingest only if
   SendGrid issues require a temporary rollback.
4. The historical Mailchimp data already needed by Stage 1 has been captured.

## Sequence

### 1. Freeze new transition scheduling

1. In Railway, open the `worker` service environment.
2. Set `MAILCHIMP_TRANSITION_ENABLED=false`.
3. Redeploy or restart the `worker` service.
4. Verify worker logs contain `event="mailchimp.scheduler.disabled"`.
5. Verify no new `stage1.mailchimp.capture.transition` jobs are being created
   after the restart.

### 2. Confirm Mailchimp authoring is idle

1. Confirm with operations that no Mailchimp campaign sends remain scheduled.
2. Confirm with the architect that SendGrid is now the only active campaign
   send path.
3. If any Mailchimp campaign is still scheduled, stop here. Do not disable the
   ingest tail early.

### 3. Drain the activity tail

1. Identify the last Mailchimp campaign send timestamp.
2. Wait 30 full days from that send timestamp.
3. During that window, leave the `mailchimp-capture` service running.
4. The tail period allows open and click activity to settle before shutdown.

### 4. Verify the queue is empty

1. Check the Graphile Worker queue for residual
   `stage1.mailchimp.capture.transition` jobs.
2. Expected result: zero runnable, zero pending, zero retrying rows for that
   job name.
3. If any jobs remain, investigate before continuing:
   - stale scheduler deploy
   - worker restart did not pick up the disabled flag
   - manually enqueued test jobs still present

### 5. Verify the final sync surface

1. Open Settings → Integrations.
2. Before shutdown, confirm the Mailchimp tile still shows the latest
   successful sync information.
3. After decommission, the tile is expected to auto-hide once both of these are
   true:
   - `MAILCHIMP_CAPTURE_BASE_URL` is unset
   - there has been no Mailchimp activity for 60 days

### 6. Shut down the capture service

1. In Railway, open the `mailchimp-capture` service.
2. Stop the service.
3. Delete the service once the stop is confirmed.
4. Record the delete time in the change log or deployment notes.

### 7. Remove secrets and endpoints

Remove these environment variables after the service is stopped:

- On `worker`:
  - `MAILCHIMP_CAPTURE_BASE_URL`
  - `MAILCHIMP_CAPTURE_TOKEN`
  - `MAILCHIMP_TRANSITION_ENABLED`
- On `mailchimp-capture`:
  - `MAILCHIMP_API_KEY`
  - `MAILCHIMP_CAPTURE_TOKEN`

If the `mailchimp-capture` service is deleted first, still document the removed
variables in the change notes.

### 8. Database cleanup stance

Do not delete Mailchimp history tables as part of decommission.

Keep:

- `mailchimp_campaign_activity_details`
- `mailchimp_campaign_tail_state`
- all Mailchimp canonical events in `canonical_event_ledger`
- all linked source evidence in `source_evidence_log`

Rationale:

- Stage 1 data-core principles keep canonical history forever.
- The Mailchimp transition path is cheap to leave available for forensic
  investigation.
- Removing historical evidence now would reduce trust and make later audits
  harder.

### 9. Code cleanup stance

Do not remove the Mailchimp provider mapping, capture port, or ops commands in
this decommission step.

Leave in place:

- `packages/integrations/src/providers/mailchimp.ts`
- historical backfill ops commands
- worker orchestration support

If code cleanup is desired later, open a separate cleanup PR after the cutover
has been stable for a while.

## Verification checklist

1. `MAILCHIMP_TRANSITION_ENABLED` is absent or false on the `worker` service.
2. Worker logs confirm the Mailchimp scheduler is disabled.
3. No pending `stage1.mailchimp.capture.transition` jobs remain.
4. The `mailchimp-capture` Railway service is stopped and deleted.
5. `MAILCHIMP_API_KEY` and `MAILCHIMP_CAPTURE_TOKEN` are removed from the
   relevant services.
6. Settings → Integrations no longer shows the Mailchimp tile after 60 days of
   inactivity with `MAILCHIMP_CAPTURE_BASE_URL` removed.
7. Historical Mailchimp canonical events still appear in volunteer timelines.

## Rollback

If SendGrid issues require a temporary fallback:

1. Restore the `mailchimp-capture` service.
2. Restore `MAILCHIMP_API_KEY` on `mailchimp-capture`.
3. Restore `MAILCHIMP_CAPTURE_TOKEN` on both `worker` and
   `mailchimp-capture`.
4. Restore `MAILCHIMP_CAPTURE_BASE_URL` on `worker`.
5. Set `MAILCHIMP_TRANSITION_ENABLED=true` on `worker`.
6. Restart `worker`.
7. Confirm new `stage1.mailchimp.capture.transition` jobs resume and the
   Settings tile returns to a connected or stale state.

## Related

- [stage-1-provider-ingest-matrix.md](../04-implementation-specs/stage-1-provider-ingest-matrix.md)
- [campaigns-bundle.md](../02-bundles/campaigns-bundle.md)
- [worker-queue-stuck.md](./worker-queue-stuck.md)
