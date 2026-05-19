# Runbook: Gmail capture has stopped — inbox feels stale

**Severity:** S1
**Average time to recover:** ~10 minutes
**Last verified:** 2026-05-02 against commit ac85d7b

## Symptom

The inbox hasn't received a new email in an unusually long time (more than
an hour during business hours), or you received an alert email with subject
`[AS Comms] gmail integration degraded — needs_attention` or `disconnected`.

## Likely causes (in order of probability)

1. **Worker is not running** — the Railway `worker` service has crashed or
   been manually stopped. Verify: open Railway dashboard → `worker` service →
   check "Active" status and recent logs.

2. **Gmail OAuth token expired or revoked** — the refresh token for
   `volunteers@adventurescientists.org` is no longer valid. Verify:
   Settings → Integrations in the app. Gmail status will show
   `needs_attention` or `disconnected` with an auth error in the detail
   field.

3. **Gmail capture service is down** — the `gmail-capture` Railway service
   is unhealthy. The worker polls it via `GMAIL_CAPTURE_BASE_URL`. Verify:
   Railway dashboard → `gmail-capture` service → check logs for boot errors.

4. **Gmail API rate limit** — temporary 429 from Google. Usually
   self-resolves within an hour. Verify: worker logs for
   `"consecutive_failure_count"` approaching 5.

## Recovery

1. **Check the worker.** Open Railway → `worker` service. If it shows as
   crashed or stopped, click **Restart**. Watch logs for
   `"sync_state.stale_running.reconcile.completed"`. Allow 2 minutes to
   stabilize.

2. **Check integration health in the UI.** Navigate to
   Settings → Integrations. If Gmail shows `needs_attention` or
   `disconnected`, click **Check now**. Read the `detail` field — it will
   name the specific error (auth failure, network timeout, etc.).

3. **If the error is an auth failure,** the OAuth refresh token has likely
   been revoked. Contact the architect (`nico@adventurescientists.org`) —
   re-issuing the token requires Google OAuth consent flow access and is not
   an operator-level operation.

4. **If the gmail-capture service is down,** open Railway → `gmail-capture`
   → restart. Confirm `GET /health` returns 200 in logs before proceeding.

5. **Confirm recovery.** Wait 5 minutes and check the inbox for new
   messages. The worker polls Gmail on the interval set by
   `GMAIL_LIVE_POLL_INTERVAL_SECONDS` (default varies per deploy config).

## If recovery fails

Alert `nico@adventurescientists.org`. Include:
- The exact status shown in Settings → Integrations.
- The last 50 lines from the Railway `worker` service log.
- Time the stale feeling was first noticed.

## Related

- **Code paths:**
  - [email.ts](../../apps/worker/src/jobs/integration-health/email.ts) — alert email sender; fires when status flips
  - [integration-health.ts](../../apps/web/src/server/settings/integration-health.ts) — polls capture service `/health`, updates DB record
  - [settings-records.ts](../../packages/contracts/src/settings-records.ts) — status enum: `healthy` / `needs_attention` / `disconnected`
  - [tables.ts](../../packages/db/src/schema/tables.ts) — `consecutive_failure_count` and `dead_letter_count` on `sync_state`
- **Other runbooks:** [worker-queue-stuck.md](./worker-queue-stuck.md), [morning-ops-checks.md](./morning-ops-checks.md)
- **Recent incidents:** PR #200 (2026-04) — dead-letter SF live_ingest after 5 consecutive failures; same pattern applies to Gmail
