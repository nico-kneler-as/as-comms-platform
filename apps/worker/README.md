# Worker

The worker runs the Stage 1 orchestration jobs for canonical ingest, replay, projection rebuilds, parity checks, and cutover support. In production it also owns the live polling schedule that enqueues Gmail live capture every minute and Salesforce live capture every five minutes through Graphile Worker cron.

## Railway

Provision a dedicated `worker` service in the existing Railway project. This repo is a shared `pnpm` workspace, so the service must keep access to the full repository checkout for workspace dependencies; Railway's current `railway.json` schema does not support declaring a root directory in code.

Use the checked-in [railway.json](/Users/nicolas/Downloads/AS%20Comms%20Platform/apps/worker/railway.json) config and confirm these settings in the Railway dashboard:

- service name: `worker`
- config file path: `/apps/worker/railway.json`
- build command: `pnpm install --frozen-lockfile && pnpm --filter @as-comms/worker... build`
- start command: `pnpm --filter @as-comms/worker start`
- healthcheck: none

Required env vars for the deployed worker:

- `DATABASE_URL`
- `WORKER_DATABASE_URL`
- `GMAIL_CAPTURE_BASE_URL`
- `GMAIL_CAPTURE_TOKEN`
- `GMAIL_LIVE_ACCOUNT`
- `GMAIL_PROJECT_INBOX_ALIASES`
- `GMAIL_LIVE_POLL_INTERVAL_SECONDS`
- `SALESFORCE_CAPTURE_BASE_URL`
- `SALESFORCE_CAPTURE_TOKEN`
- `SALESFORCE_CONTACT_CAPTURE_MODE`
- `SALESFORCE_MEMBERSHIP_CAPTURE_MODE`
- `SALESFORCE_TASK_POLL_INTERVAL_SECONDS`
- `WORKER_BOOT_MODE=run`

Optional env vars:

- `WORKER_CONCURRENCY`
- `INBOX_REVALIDATE_BASE_URL`
- `INBOX_REVALIDATE_TOKEN`

## Local Dev

Disable the worker runtime and its cron schedule locally by leaving `WORKER_BOOT_MODE` unset or setting `WORKER_BOOT_MODE=idle`.

Use these commands when you do want the worker running locally:

```bash
pnpm ops:worker:check-config
WORKER_BOOT_MODE=run pnpm dev:worker
```
