# Stage 1 Worker Runtime

This note is operational only. It describes the minimum worker/runtime wiring that is executable at the end of Stage 1.

## Required env

Worker boot:

- `WORKER_BOOT_MODE=run`
- `DATABASE_URL` or `WORKER_DATABASE_URL`
- `WORKER_CONCURRENCY` optional, defaults to `1`

Provider capture ports:

- `GMAIL_CAPTURE_BASE_URL`
- `GMAIL_CAPTURE_TOKEN`
- `SALESFORCE_CAPTURE_BASE_URL`
- `SALESFORCE_CAPTURE_TOKEN`
- `SIMPLETEXTING_CAPTURE_BASE_URL`
- `SIMPLETEXTING_CAPTURE_TOKEN`
- `MAILCHIMP_CAPTURE_BASE_URL`
- `MAILCHIMP_CAPTURE_TOKEN`

If worker boot is enabled and any required provider capture env is missing, the runtime fails closed at startup.

## Capture-port shape

Each provider capture port is an env-gated HTTP client at the integrations boundary.

- request body: the Stage 1 job payload for that provider/mode
- response body:

```json
{
  "records": [],
  "nextCursor": null,
  "checkpoint": null
}
```

`records` must already be in the provider-close record shapes used by the Stage 1 mapping layer. The domain layer never receives raw provider SDK payloads.

Paths used by the runtime:

- Gmail: `POST /historical`, `POST /live`
- Salesforce: `POST /historical`, `POST /live`
- SimpleTexting: `POST /historical`, `POST /live`
- Mailchimp: `POST /historical`, `POST /transition`

## Executable Stage 1 task names

- `stage1.gmail.capture.historical`
- `stage1.gmail.capture.live`
- `stage1.salesforce.capture.historical`
- `stage1.salesforce.capture.live`
- `stage1.simpletexting.capture.historical`
- `stage1.simpletexting.capture.live`
- `stage1.mailchimp.capture.historical`
- `stage1.mailchimp.capture.transition`
- `stage1.replay.batch`
- `stage1.projection.rebuild`
- `stage1.parity.check`
- `stage1.cutover.checkpoint`

These task names all execute through the same path:

`capture -> provider-close mapping -> normalized DTOs -> normalization service -> persistence/projections`

## Sync-state closure in Stage 1

The sync-state model now distinguishes:

- provider-scoped jobs with `scope = "provider"` and a real provider value
- orchestration-scoped jobs with `scope = "orchestration"` and `provider = null`

The model also persists:

- `freshnessP95Seconds`
- `freshnessP99Seconds`

That is the minimum additional state needed for current cutover-readiness checks.

## Intentionally deferred

- live provider SDK/webhook handling inside the product app
- full capture scheduling/cutover controller logic
- later-stage settings/admin/auth surfaces
- Inbox UI or operator actions
- Stage 2+ product behavior
