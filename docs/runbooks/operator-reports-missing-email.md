# Runbook: Operator reports a missing email — investigation guide

**Severity:** S2
**Average time to investigate:** ~15 minutes
**Last verified:** 2026-05-02 against commit ac85d7b

## Symptom

An operator says "I got this email in Gmail but it doesn't appear in the
inbox," or a volunteer follows up on an email that the operator cannot find
in the app. This is an investigation procedure, not a recovery procedure —
the outcome determines what action to take.

## Investigation steps

Work through these in order. Stop as soon as you find the email.

### 1. Confirm the email exists in Gmail

Open `volunteers@adventurescientists.org` in Gmail directly. Confirm the
email is there. Note the sender address, approximate received time, and
subject.

If the email is **not in Gmail**: it never arrived at the mailbox. Check
with the sender or check spam. This is outside the app's scope.

### 2. Check the inbox search

In the app, use the search bar with the sender's email address or name.
Check that the **Project** filter is set to "All" (project filter regression
was a known issue — if the filter is stuck on one project, real messages
may be hidden).

### 3. Check the routing review queue

Navigate to **Settings → Routing Review** (if available) or look for a
"Review" badge in the inbox. Emails with an unknown sender address, or
emails whose SF contact could not be resolved, land in the routing review
queue before appearing in the main inbox. The email may be awaiting triage
there.

### 4. Check integration health

If Gmail capture has been degraded recently (Settings → Integrations → Gmail
shows `needs_attention` or `disconnected`), the email may not have been
ingested yet. Use [gmail-capture-stopped.md](./gmail-capture-stopped.md)
to restore capture, then wait one poll interval.

### 5. Ask the architect to check the identity queue

If the sender is a new contact not yet in Salesforce, their email lands in
the identity queue for contact resolution. This requires DB access to
inspect `identity_queue` rows. Escalate — operators cannot resolve this
without DB access.

### 6. Check for dead-lettered capture

If capture for this message was attempted and failed 5+ times, it may have
been dead-lettered in `sync_state`. This also requires DB access and
architect involvement.

## What to capture before escalating

- Sender email address and approximate received time.
- Subject line of the missing email.
- Whether the email is visible in Gmail directly.
- Any routing review cases visible in the app.
- Status of Gmail integration (from Settings → Integrations).

## If the email must appear urgently

Alert `nico@adventurescientists.org`. Do not attempt to manually insert
records into the database.

## Related

- **Code paths:**
  - [reconcile-routing-review-queue.ts](../../apps/worker/src/jobs/reconcile-routing-review-queue.ts) — routing review reconciler
  - [reconcile-identity-queue.ts](../../apps/worker/src/jobs/reconcile-identity-queue.ts) — identity queue; resolves new senders to SF contacts
  - [settings-records.ts](../../packages/contracts/src/settings-records.ts) — integration health status values
- **Other runbooks:** [gmail-capture-stopped.md](./gmail-capture-stopped.md), [worker-queue-stuck.md](./worker-queue-stuck.md), [morning-ops-checks.md](./morning-ops-checks.md)
- **Recent incidents:** PR #193 (2026-04) — identity queue stuck cases; PR #224 (2026-05) — 1,558 anchor-less queue cases fixed
