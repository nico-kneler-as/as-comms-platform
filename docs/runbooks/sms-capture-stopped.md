# Runbook: SMS capture has stopped

**Severity:** S1  
**Average time to recover:** ~10 minutes  
**Last verified:** 2026-07-23

## Symptom

Inbound SMS replies are missing, or delivery state on recent SMS sends stays stale even though Twilio shows activity.

## Likely causes (in order of probability)

1. **`sms-capture` Railway service is down** — inbound Twilio webhooks and status callbacks both terminate there. Verify: Railway → `sms-capture` → Logs / Active status.
2. **Twilio signature or webhook config drifted** — signed requests to `/webhooks/inbound` or `/webhooks/status` are being rejected. Verify: `sms-capture` logs show `invalid_signature` or no recent webhook traffic.
3. **Database or Twilio env vars are broken on `sms-capture`** — boot succeeds, but webhook handling fails. Verify: Railway `sms-capture` logs for `DATABASE_URL`, `TWILIO_ACCOUNT_SID`, or `TWILIO_AUTH_TOKEN` errors.

## Recovery

1. **Check `sms-capture`.** In Railway, confirm the `sms-capture` service is running. If stopped or crash-looping, restart it and watch for a clean boot.
2. **Check recent webhook traffic.** In Railway logs, look for hits to `/webhooks/inbound`, `/webhooks/status`, or `/webhooks/opt-out`. If none appear, inspect the Twilio Messaging Service webhook URLs.
3. **If signatures are failing,** confirm the Twilio service still points at the current `sms-capture` URL and that `TWILIO_AUTH_TOKEN` matches the Twilio account used by the Messaging Service.
4. **Confirm delivery-state recovery.** Recent `sms_messages.send_status` values should start advancing again (`sent` / `delivered` / `failed` / `undelivered` / `suppressed`).

## If recovery fails

Alert `nico@adventurescientists.org`. Include:

- Time the missing inbound or stale delivery state was first noticed.
- The last 50 lines from Railway `sms-capture` logs.
- The affected phone number or `twilio_message_sid`, if known.

## Related

- [server.ts](../../apps/sms-capture/src/server.ts)
- [sms-broadcast-send-stuck.md](./sms-broadcast-send-stuck.md)
