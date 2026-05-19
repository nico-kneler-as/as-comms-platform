# Runbook: Composer send failed — operator clicked Send and got an error

**Severity:** S1
**Average time to recover:** ~5 minutes
**Last verified:** 2026-05-02 against commit ac85d7b

## Symptom

The operator clicked **Send** in the Composer and saw an error banner, or
the sent message never appeared in the thread. The outbound may show
`"Composer Gmail send is not configured."` in logs, or the send silently
failed with no confirmation.

## Likely causes (in order of probability)

1. **Reply to an mbox-imported thread — Invalid thread_id** — threads that
   arrived via the historical Gmail mbox import carry a stored `threadId`
   that Google no longer recognises. The composer resolves this via rfc822
   lookup; if the lookup fails or the thread is too old, Gmail returns
   `400 Invalid thread_id value`. Verify: check the `failed_detail` column
   on the `pending_composer_outbounds` row for the contact (requires DB
   access — alert architect if you cannot query).

2. **Gmail OAuth env vars missing on the web service** — the `web` Railway
   service is missing `GMAIL_LIVE_ACCOUNT`, `GMAIL_GOOGLE_OAUTH_CLIENT_ID`,
   `GMAIL_GOOGLE_OAUTH_CLIENT_SECRET`, or `GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN`.
   Verify: the error banner or server logs will contain
   `"Composer Gmail send is not configured."`.

3. **No Send-As alias configured for the project alias** — the operator is
   trying to send from a project alias (`volunteers@...`) that is not
   configured as a Gmail Send-As address on the live account. Verify:
   Settings → Integrations shows Gmail as healthy, but sends from that alias
   specifically fail.

4. **Gmail API auth error** — OAuth refresh token revoked. Same root cause
   as [gmail-capture-stopped.md](./gmail-capture-stopped.md). Verify:
   Settings → Integrations → Gmail → `disconnected`.

## Recovery

1. **Note the error text** shown in the Composer UI, then check the Railway
   `web` service logs for the matching request. Look for
   `[composer/gmail-send]` log lines.

2. **If the log says "not configured",** check that all four
   `GMAIL_GOOGLE_OAUTH_*` env vars are set on the `web` Railway service.
   If any are missing, contact the architect.

3. **If the error is `Invalid thread_id`,** the thread-id lookup via rfc822
   fallback already ran and failed. The send will fall back to header-based
   threading (In-Reply-To header only). This is expected behaviour for old
   mbox-imported threads. The email will send but may appear as a new thread
   in Gmail rather than a reply. Proceed — no operator action required.

4. **For net-new sends (not replies),** `Invalid thread_id` should not
   occur. If it does, retry once. If it fails again, alert the architect.

5. **Confirm.** After a successful send, the composer should show a
   confirmation and the outbound event should appear in the thread timeline
   within a few minutes (the worker sweeps pending outbounds every 30 minutes).

## If recovery fails

Alert `nico@adventurescientists.org`. Include:
- Exact error text from the Composer UI.
- The contact ID or thread you were trying to reply to.
- Whether this is a reply (to existing thread) or a net-new message.
- Last 20 lines of the Railway `web` service log around the time of the send.

## Related

- **Code paths:**
  - [gmail-send.ts](../../apps/web/src/server/composer/gmail-send.ts) — `sendComposerGmailMessage`; reads `GMAIL_*` env vars, resolves threadId via rfc822
  - [tables.ts](../../packages/db/src/schema/tables.ts) — `failed_detail` and `failed_reason` on `pending_composer_outbounds`
  - [sweep-pending-outbounds.ts](../../apps/worker/src/jobs/sweep-pending-outbounds.ts) — sweeps orphaned outbounds older than 30 min
- **Other runbooks:** [gmail-capture-stopped.md](./gmail-capture-stopped.md), [morning-ops-checks.md](./morning-ops-checks.md)
- **Recent incidents:** PR #227 (2026-04) — rfc822 threadId resolution for mbox-imported threads; PR #223 (2026-04) — forward Gmail send error into `failed_detail`
