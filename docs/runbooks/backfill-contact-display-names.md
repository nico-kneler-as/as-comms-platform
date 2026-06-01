# Backfill Contact Display Names

## When to run

- Run once after the `contacts.display_name` backfill PR lands.
- Re-run ad hoc if the Inbox search Contacts section still shows bare emails for active non-Salesforce contacts.

## How to run

- Start with a dry run:

```bash
pnpm --filter @as-comms/worker exec tsx src/ops/backfill-contact-display-names.ts
```

- Narrow the scan window if needed:

```bash
pnpm --filter @as-comms/worker exec tsx src/ops/backfill-contact-display-names.ts --since=2024-01-01T00:00:00Z --until=2026-06-01T00:00:00Z --limit=5000
```

- After checking the JSON logs and summary, run the real update:

```bash
pnpm --filter @as-comms/worker exec tsx src/ops/backfill-contact-display-names.ts --execute
```

## What to expect

- Dry-run is the default. Nothing is written unless `--execute` is present.
- The command emits one JSON log line per changed or skipped candidate, then a summary JSON object.
- MVP-scale expectation is a few hundred candidates, with roughly 50-80% resolving to a usable display name from historical Gmail headers.

## Notes

- The candidate set is limited to contacts whose `display_name` is effectively unset for this workflow: null or equal to `primary_email`.
- The job only backfills from stored Gmail headers and does not overwrite real existing display names.
