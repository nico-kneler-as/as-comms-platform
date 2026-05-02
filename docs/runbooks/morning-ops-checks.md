# Runbook: Morning ops checks — 60-second daily health glance

**Severity:** reference (preventive)
**Time to complete:** ~60 seconds
**Last verified:** 2026-05-02 against commit ac85d7b

## Purpose

Run this before triaging the inbox each morning. Catching a degraded
integration at 9 AM prevents the 11 PM Saturday emergency.

## Checklist

### 1. Check integration health (30 seconds)

Open the app → **Settings → Integrations**.

| Integration | Expected status | Action if not |
|---|---|---|
| Gmail | `healthy` | [gmail-capture-stopped.md](./gmail-capture-stopped.md) |
| Salesforce | `healthy` | [salesforce-capture-stopped.md](./salesforce-capture-stopped.md) |
| Notion | `healthy` or `not_configured` | Alert architect if `disconnected` |
| Mailchimp | `healthy` or `not_configured` | Alert architect if `disconnected` |

If any shows `needs_attention` or `disconnected`, **do not start inbox
triage** — capture may have gaps. Fix the integration first.

### 2. Check Railway worker (15 seconds)

Open Railway → `worker` service → **Logs** (last 5 minutes).

Look for at least one recent line containing `reconcile.completed`. If the
last log line is more than 10 minutes old and does not contain `completed`,
use [worker-queue-stuck.md](./worker-queue-stuck.md).

### 3. Check your alert email (15 seconds)

Scan `nico@adventurescientists.org` for any subject starting with
`[AS Comms]`. These are integration degradation alerts sent by the worker.
If you see one dated today, treat it as an active incident regardless of
what the UI shows — the UI health check has a 1-hour alert cooldown, so a
new alert means the status flipped within the last hour.

## If all checks are green

Proceed to inbox triage. The platform is healthy.

## If checks are not green

Use the linked runbook for the affected surface. Resolve before triaging —
messages captured during a degraded window may appear out of order once
capture resumes.

## Related

- **Code paths:**
  - [`apps/worker/src/jobs/integration-health/email.ts:118`](../../apps/worker/src/jobs/integration-health/email.ts) — alert email; subject format is `[AS Comms] <service> integration degraded — <status>`; 1-hour cooldown per service
  - [`packages/contracts/src/settings-records.ts:22`](../../packages/contracts/src/settings-records.ts) — status values that trigger action
- **Other runbooks:** [gmail-capture-stopped.md](./gmail-capture-stopped.md), [salesforce-capture-stopped.md](./salesforce-capture-stopped.md), [worker-queue-stuck.md](./worker-queue-stuck.md), [operator-reports-missing-email.md](./operator-reports-missing-email.md)
