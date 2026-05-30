# Runbook: Backfill Gmail canonical event audience

**Severity:** planned maintenance
**Average time to recover:** depends on row count; validate on staging first
**Last verified:** 2026-05-30 against current worktree

## When to run

Run this once after PRD #482 fan-out writer changes are deployed.
It backfills `canonical_event_audience` for historical Gmail canonical events
that predate the live writer.

## Dry-run first

1. Run the worker command without `--execute`.
2. Review the per-row JSON output and final summary JSON.
3. Confirm skipped rows are expected.
4. Repeat on staging with `--execute`.
5. Only then run production with `--execute`.

## Command

```bash
pnpm --filter @as-comms/worker ops:backfill-canonical-event-audience --since=2026-01-01T00:00:00.000Z --until=2026-05-30T23:59:59.999Z --limit=5000
```

Add `--execute` only after the dry-run summary looks correct.

## Expected skips

- `no_gmail_detail`: the canonical event exists but its
  `gmail_message_details` row is missing.
- `no_header_emails`: the Gmail detail row exists but all of
  `from_emails / to_emails / cc_emails / bcc_emails` are empty. This is
  expected for pre-0065 historical captures that have not been re-imported.

## Related

- **Code paths:**
  - [backfill-canonical-event-audience.ts](../../apps/worker/src/ops/backfill-canonical-event-audience.ts) — one-time worker command
  - [normalization.ts](../../packages/domain/src/normalization.ts) — shared `applyCanonicalEventAudience` logic used by live ingest and the backfill
  - [canonical-event-audience.ts](../../packages/domain/src/canonical-event-audience.ts) — pure audience resolver
- **Schema:**
  - [0064_canonical_event_audience.sql](../../packages/db/drizzle/0064_canonical_event_audience.sql)
  - [0065_gmail_message_audience_headers.sql](../../packages/db/drizzle/0065_gmail_message_audience_headers.sql)
