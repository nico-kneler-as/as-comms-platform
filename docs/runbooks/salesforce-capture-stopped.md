# Runbook: Salesforce capture has stopped — contact data feels stale

**Severity:** S1
**Average time to recover:** ~10 minutes
**Last verified:** 2026-05-02 against commit ac85d7b

## Symptom

Contact records in the inbox look outdated (wrong name, missing membership,
stale project), or you received an alert email with subject
`[AS Comms] salesforce integration degraded — needs_attention` or
`disconnected`. New SF Tasks created by operators are not appearing in the
inbox within the expected poll window.

## Likely causes (in order of probability)

1. **Worker is not running** — Railway `worker` service crashed. Verify:
   Railway dashboard → `worker` → check active status and logs.

2. **Salesforce JWT auth expired** — the SF capture service authenticates
   via a JWT private key (`SALESFORCE_JWT_PRIVATE_KEY`). If the Connected
   App certificate was rotated or revoked in Salesforce, capture will fail.
   Verify: Settings → Integrations → Salesforce status shows
   `needs_attention` or `disconnected`; click **Check now**.

3. **`salesforce-capture` service is down** — the `salesforce-capture`
   Railway service is not responding. Verify: Railway dashboard →
   `salesforce-capture` → check logs for boot errors or auth failures.

4. **Salesforce API governor limits** — temporary throttling from SF.
   Usually self-resolves. Verify: worker logs for `ProviderCaptureError`
   and `consecutive_failure_count` approaching 5.

## Recovery

1. **Check the worker.** Railway → `worker`. If crashed, restart it. Watch
   logs for `"identity_queue.reconcile.completed"` or SF-related events.

2. **Check integration health.** Settings → Integrations → Salesforce.
   Click **Check now**. Read the `detail` field for the specific error.

3. **If the error is a JWT/auth failure,** contact the architect —
   replacing the SF Connected App certificate is not an operator operation.

4. **If the `salesforce-capture` service is down,** restart it in Railway.
   Confirm it logs a successful SF login before returning to the worker.

5. **Confirm recovery.** After 5 minutes, check whether a new SF Task or
   contact update appears in the inbox. SF capture polls on the interval set
   by `SALESFORCE_TASK_POLL_INTERVAL_SECONDS`.

## If recovery fails

Alert `nico@adventurescientists.org`. Include:
- Status shown in Settings → Integrations (exact text of the detail field).
- Last 50 lines from Railway `worker` and `salesforce-capture` logs.
- Whether any SF Tasks were created in Salesforce recently that should have appeared.

## Related

- **Code paths:**
  - [email.ts](../../apps/worker/src/jobs/integration-health/email.ts) — alert email; fires on status flip
  - [integration-health.ts](../../apps/web/src/server/settings/integration-health.ts) — health poll and DB update
  - [settings-records.ts](../../packages/contracts/src/settings-records.ts) — status enum
  - [tables.ts](../../packages/db/src/schema/tables.ts) — `consecutive_failure_count`, `dead_letter_count`
- **Other runbooks:** [worker-queue-stuck.md](./worker-queue-stuck.md), [morning-ops-checks.md](./morning-ops-checks.md)
- **Recent incidents:** PR #211 (2026-04) — SF capture blocked by provider text cap; PR #216 (2026-04) — dimensions/memberships FK ordering; PR #243 (2026-05) — null membership task routing
