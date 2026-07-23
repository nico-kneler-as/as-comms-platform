# Runbook: SMS broadcast send is stuck

**Severity:** S1  
**Average time to recover:** ~10 minutes  
**Last verified:** 2026-07-23

## Symptom

An SMS broadcast run stays in `scheduled` or `sending`, or the run detail page shows queued recipients not advancing to `sent`, `delivered`, `failed`, or `suppressed`.

## Likely causes (in order of probability)

1. **`worker` is down or wedged** — the `sms-broadcast-send` job never ran or stopped mid-run. Verify: Railway → `worker` logs for recent `sms-broadcast-send` activity.
2. **Twilio SMS provider is not configured in the worker** — the job starts but fails immediately. Verify: `worker` logs show `SMS disabled` or `Twilio SMS provider is not configured.`
3. **All remaining recipients are blocked by consent** — rows move to `suppressed` instead of `sent`, which can look like a stalled run if you only watch totals. Verify run detail / DB `sms_messages.send_status`.

## Recovery

1. **Check the `worker` service.** If Railway shows it stopped or crash-looping, restart it and wait 2 minutes.
2. **Check logs for `sms-broadcast-send`.** If the job failed on config, fix the worker env before retrying anything.
3. **Re-open the run detail page.** Confirm whether queued rows are actually becoming `suppressed`; if so, the send path is working and consent is the blocker.
4. **If the run is still `sending` with untouched queued rows after the worker is healthy,** wait for the next reconcile cycle, then re-check logs. The job key is `sms-broadcast-send:<runId>`.

## If recovery fails

Alert `nico@adventurescientists.org`. Include:

- The `campaign_run.id`
- Whether the run is `scheduled` or `sending`
- A count by `sms_messages.send_status`
- The last 50 lines from Railway `worker` logs around the stuck run

## Related

- [index.ts](../../apps/worker/src/jobs/sms-broadcast-send/index.ts)
- [server.ts](../../apps/sms-capture/src/server.ts)
- [campaign-send-stuck.md](./campaign-send-stuck.md)
