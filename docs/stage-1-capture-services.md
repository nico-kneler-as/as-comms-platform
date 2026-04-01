# Stage 1 Capture Services

**Role:** launch-scope operator note for the external Gmail and Salesforce capture services  
**Audience:** engineers deploying or validating the Stage 1 backend on Railway or another non-production runtime  
**When to read:** before wiring real `GMAIL_CAPTURE_BASE_URL` or `SALESFORCE_CAPTURE_BASE_URL` values into the worker

## Purpose

The Stage 1 worker never talks to Gmail or Salesforce SDKs directly. It consumes provider-close HTTP batches from separate capture services for live Gmail and Salesforce capture, and it uses a worker-side `.mbox` import path for historical Gmail backfill.

For narrowed launch scope, the required services are:

- Gmail capture service
- Salesforce capture service

SimpleTexting and Mailchimp remain deferred for launch completion.

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

## Railway layout

Recommended services:

1. `worker`
2. `gmail-capture`
3. `salesforce-capture`

Recommended build and start commands:

- worker build: `pnpm --filter @as-comms/worker build`
- worker start: `WORKER_BOOT_MODE=run pnpm --filter @as-comms/worker start`
- Gmail capture build: `pnpm --filter @as-comms/gmail-capture build`
- Gmail capture start: `pnpm --filter @as-comms/gmail-capture start`
- Salesforce capture build: `pnpm --filter @as-comms/salesforce-capture build`
- Salesforce capture start: `pnpm --filter @as-comms/salesforce-capture start`

Wire the worker service to the service URLs:

- `GMAIL_CAPTURE_BASE_URL=https://<gmail-capture-service>`
- `SALESFORCE_CAPTURE_BASE_URL=https://<salesforce-capture-service>`

## Validation readiness

You are ready to run controlled Stage 1 validation when:

- both capture services boot with valid env
- both `/health` endpoints return `200`
- `pnpm ops:worker:check-config` succeeds
- the worker points at the capture service base URLs
- Gmail historical `.mbox` import succeeds
- Gmail live and Salesforce historical/live enqueue commands succeed

## Intentionally deferred

- SimpleTexting capture service deployment
- Mailchimp capture service deployment
- product-webhook endpoints
- moving provider SDK logic into the worker
- any second ingest or normalization path
