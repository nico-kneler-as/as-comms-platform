# Stage 1 Capture Services

**Role:** operator note for the external capture services and daily capture-gap recovery  
**Audience:** engineers deploying or validating the backend on Railway or another non-production runtime  
**When to read:** before wiring real capture-service URLs into the worker, or when operating capture-gap recovery

## Purpose

The worker never talks to provider SDKs directly. It consumes provider-close HTTP batches from separate capture services, and it uses a worker-side `.mbox` import path for historical Gmail backfill.

Four capture services are deployed:

| Service | Shape | Status |
| --- | --- | --- |
| Gmail capture | worker-pulled `POST /live` + `POST /historical` | live |
| Salesforce capture | worker-pulled `POST /live` + `POST /historical` | live |
| Mailchimp capture | worker-pulled `POST /transition` + `POST /historical` | live through the Postmark cutover (Stage 5C per `D-046`) |
| SMS capture | provider-pushed Twilio webhooks | live since 2026-07-01 |

SimpleTexting was never adopted and is retired from scope. Twilio is the SMS transport.

Note the shape difference: Gmail, Salesforce and Mailchimp capture are **pulled** by the worker on a schedule, so they have base URLs and bearer tokens the worker must hold. SMS capture is **pushed** by Twilio to webhook endpoints, so the worker holds no base URL for it and a public ingress is required.

## Shared contract

Each capture service exposes bearer-token-protected HTTP endpoints where that provider/mode is served through HTTP:

- `POST /live`
- `POST /historical`

The worker sends the existing Stage 1 provider job payloads and expects this response shape whenever it is talking to a capture service:

```json
{
  "records": [],
  "nextCursor": null,
  "checkpoint": null
}
```

`records` must already be in the provider-close shapes consumed by `packages/integrations`.

## Shared auth setup

The worker and capture services must share bearer tokens per provider:

- worker `GMAIL_CAPTURE_TOKEN` must match Gmail capture service `GMAIL_CAPTURE_TOKEN`
- worker `SALESFORCE_CAPTURE_TOKEN` must match Salesforce capture service `SALESFORCE_CAPTURE_TOKEN`
- worker `MAILCHIMP_CAPTURE_TOKEN` must match Mailchimp capture service `MAILCHIMP_CAPTURE_TOKEN`

If either token pair does not match, the capture service returns `401 unauthorized`.

## Gmail capture service

Launch-scope behavior:

- live polling only on `GMAIL_LIVE_ACCOUNT`
- alias context preserved through `GMAIL_PROJECT_INBOX_ALIASES`
- output records match the existing Stage 1 Gmail provider-close record shape
- launch-scope historical backfill does **not** use the Gmail capture service
- `POST /historical` is retained only to fail closed with an explicit “use the worker .mbox import path” error
- historical Gmail backfill now comes from exported `.mbox` files passed through the worker ops import command

Required env:

- `GMAIL_CAPTURE_TOKEN`
- `GMAIL_LIVE_ACCOUNT`
- `GMAIL_PROJECT_INBOX_ALIASES`
- `GMAIL_GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`
- `GMAIL_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

Optional env:

- `GMAIL_GOOGLE_TOKEN_URI`
  - defaults to `https://oauth2.googleapis.com/token`
- `GMAIL_CAPTURE_TIMEOUT_MS`
  - defaults to `15000`
- `HOST`
  - defaults to `0.0.0.0`
- `PORT`
  - defaults to `3001`

Operational notes:

- `GMAIL_LIVE_ACCOUNT` must be the `volunteers@...` mailbox used for launch-scope live sync
- `GMAIL_PROJECT_INBOX_ALIASES` is the comma-separated alias/project-inbox set represented by the live account
- the service preserves both `capturedMailbox` and `projectInboxAlias` where needed
- launch-scope completion no longer requires Gmail API access or service-account impersonation for historical project inboxes
- historical Gmail `.mbox` import requires:
  - an exported `.mbox` file
  - a `capturedMailbox` value representing the historical mailbox context
  - the worker Gmail env needed to interpret `volunteers@...` and alias context

Example historical Gmail import:

```bash
pnpm ops:worker:import-gmail-mbox -- \
  --mbox-path /absolute/path/project-antarctica.mbox \
  --captured-mailbox project-antarctica@example.org
```

## Salesforce capture service

Launch-scope behavior:

- only `Contact`, `Expedition_Members__c`, and `Task`
- `Task` is the only launch-scope communication source
- volunteer-linked Salesforce email Tasks are captured only when owned by `Nim Admin` (`admin+1@adventurescientists.org`)
- lifecycle events come only from:
  - `CreatedDate`
  - `Date_Training_Sent__c`
  - `Date_Training_Completed__c`
  - `Date_First_Sample_Collected__c`
- output records match the existing Stage 1 Salesforce provider-close record shape

Required env:

- `SALESFORCE_CAPTURE_TOKEN`
- `SALESFORCE_LOGIN_URL`
- `SALESFORCE_CLIENT_ID`
- `SALESFORCE_USERNAME`
- `SALESFORCE_JWT_PRIVATE_KEY`
- `SALESFORCE_CONTACT_CAPTURE_MODE`
- `SALESFORCE_MEMBERSHIP_CAPTURE_MODE`

Optional env:

- `SALESFORCE_JWT_EXPIRATION_SECONDS`
  - defaults to `180`
- `SALESFORCE_API_VERSION`
  - defaults to `61.0`
- `SALESFORCE_EXPEDITION_MEMBER_OBJECT`
  - defaults to `Expedition_Members__c`
- `SALESFORCE_EXPEDITION_MEMBER_CONTACT_FIELD`
  - defaults to `Contact__c`
- `SALESFORCE_EXPEDITION_MEMBER_PROJECT_FIELD`
  - defaults to `Project__c`
- `SALESFORCE_EXPEDITION_MEMBER_EXPEDITION_FIELD`
  - defaults to `Expedition__c`
- `SALESFORCE_EXPEDITION_MEMBER_ROLE_FIELD`
  - defaults to `Role__c`
- `SALESFORCE_EXPEDITION_MEMBER_STATUS_FIELD`
  - defaults to `Status__c`
- `SALESFORCE_TASK_CONTACT_FIELD`
  - defaults to `WhoId`
- `SALESFORCE_TASK_CHANNEL_FIELD`
  - defaults to `TaskSubtype`
- `SALESFORCE_TASK_EMAIL_CHANNEL_VALUES`
  - defaults to `Email`
- `SALESFORCE_TASK_SMS_CHANNEL_VALUES`
  - defaults to `SMS,Text`
- `SALESFORCE_TASK_SNIPPET_FIELD`
  - defaults to `Description`
- `SALESFORCE_TASK_OCCURRED_AT_FIELD`
  - defaults to `CreatedDate`
- `SALESFORCE_TASK_CROSS_PROVIDER_KEY_FIELD`
  - optional
- `SALESFORCE_CAPTURE_TIMEOUT_MS`
  - defaults to `15000`
- `HOST`
  - defaults to `0.0.0.0`
- `PORT`
  - defaults to `3002`

Operational notes:

- `Contact.Id` remains the primary identity anchor in downstream normalization
- `Volunteer_ID_Plain__c` is passed through as the canonical volunteer ID value, not the primary join key
- authentication uses Salesforce OAuth 2.0 JWT bearer flow with `SALESFORCE_CLIENT_ID` as `iss`, `SALESFORCE_USERNAME` as `sub`, and the origin of `SALESFORCE_LOGIN_URL` as `aud`
- `SALESFORCE_CONTACT_CAPTURE_MODE` and `SALESFORCE_MEMBERSHIP_CAPTURE_MODE` may be `delta_polling` or `cdc_compatible`
- in this repo, `cdc_compatible` means the capture service contract stays compatible with a CDC-fed upstream source, but the worker still receives the same provider-close live batch shape

## Mailchimp capture service

Current behavior:

- `POST /transition` captures campaign activity from the saved transition cursor
- `POST /historical` supports explicit historical campaign capture
- `GET /health` is included in integration-health polling
- output records match the existing Mailchimp campaign-activity provider-close record shape

Required env:

- `MAILCHIMP_CAPTURE_TOKEN`
- `MAILCHIMP_API_KEY`

Optional env:

- `MAILCHIMP_CAPTURE_BEARER_TOKEN` — backward-compatible alias for `MAILCHIMP_CAPTURE_TOKEN`
- `HOST` — defaults to `0.0.0.0`
- `PORT` — defaults to `3003`
- `LOG_LEVEL` — defaults to `info`

Operational notes:

- transition capture must honor the saved `windowStart` cursor so stale windows resume without skipping campaigns
- campaign freshness is checked through integration health and the transition scheduler, not through the Gmail/Salesforce live-window recovery path
- Mailchimp campaign events may appear in the timeline but must not drive Inbox bucket changes

## SMS capture service

Unlike the other three, this service is **pushed to** by Twilio rather than pulled by the worker. It therefore needs public ingress, and the worker holds no `*_CAPTURE_BASE_URL` for it.

Endpoints:

- `POST /webhooks/inbound` — inbound SMS
- `POST /webhooks/status` — delivery-status callbacks
- `POST /webhooks/opt-out` — consent revocation events

Required env:

- `DATABASE_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_MESSAGING_SERVICE_SID_OR_FROM_NUMBER`

Optional env:

- `WEBHOOK_PATHS` — override the default webhook path set
- `MAX_REQUEST_BODY_BYTES` — request body cap

Operational notes:

- Salesforce `Text_Opt_In__c` is the source of truth for SMS consent; webhook opt-out events are reconciled against it rather than treated as standalone truth
- inbound routing reads `contact_identities` of `kind='phone'`, per `D-042`; `contacts.primary_phone` is a denormalized cache, not the routing source

## Capture-gap recovery

A daily `reconcile-capture-gaps` job closes windows that failed or were quarantined rather than leaving them for someone to notice.

Enqueue manually with:

```bash
psql "$DATABASE_URL" -c "select graphile_worker.add_job('reconcile-capture-gaps', '{}'::json);"
```

Behavior:

- scans recent failed or quarantined `live_ingest` windows in `sync_state`
- windows already covered by a later successful capture count as covered and are not replayed
- uncovered Gmail and Salesforce windows enqueue bounded live capture recovery jobs
- Mailchimp campaign freshness recovery schedules `poll-mailchimp-transition-scheduler`
- writes `audit_policy_evidence` with `policy_code = 'stage1.capture_gap.recovery'` and scanned / covered / scheduled / skipped / error counts
- never enqueues an email or SMS send-path job
- SMS is not covered: Twilio pushes, so there is no pull window to reconcile

## Railway layout

Recommended services:

1. `worker`
2. `gmail-capture`
3. `salesforce-capture`
4. `mailchimp-capture`
5. `sms-capture`

Recommended build and start commands:

- worker build: `pnpm --filter @as-comms/worker build`
- worker start: `WORKER_BOOT_MODE=run pnpm --filter @as-comms/worker start`
- Gmail capture build: `pnpm --filter @as-comms/gmail-capture build`
- Gmail capture start: `pnpm --filter @as-comms/gmail-capture start`
- Salesforce capture build: `pnpm --filter @as-comms/salesforce-capture build`
- Salesforce capture start: `pnpm --filter @as-comms/salesforce-capture start`
- Mailchimp capture build: `pnpm --filter @as-comms/mailchimp-capture build`
- Mailchimp capture start: `pnpm --filter @as-comms/mailchimp-capture start`
- SMS capture build: `pnpm --filter @as-comms/sms-capture build`
- SMS capture start: `pnpm --filter @as-comms/sms-capture start`

`salesforce-capture` carries its own `railway.json` with a dependency-inclusive build; a build command set in the Railway dashboard **overrides** it, so leave the dashboard field empty for that service.

Wire the worker service to the service URLs:

- `GMAIL_CAPTURE_BASE_URL=https://<gmail-capture-service>`
- `SALESFORCE_CAPTURE_BASE_URL=https://<salesforce-capture-service>`
- `MAILCHIMP_CAPTURE_BASE_URL=https://<mailchimp-capture-service>`

Pulled capture services stay on private networking — the worker reaches them over Railway's internal network, and enabling public networking on them widens the attack surface for no gain. `sms-capture` is the exception: Twilio must reach it from outside, so it needs a public domain.

## Validation readiness

You are ready to run controlled Stage 1 validation when:

- all four capture services boot with valid env
- every `/health` endpoint returns `200`
- `pnpm ops:worker:check-config` succeeds
- the worker points at the capture service base URLs
- Gmail historical `.mbox` import succeeds
- Gmail live and Salesforce historical/live enqueue commands succeed

## Intentionally deferred

- product-webhook endpoints
- moving provider SDK logic into the worker
- any second ingest or normalization path
