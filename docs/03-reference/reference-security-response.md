# Reference Security Response

**Role:** compact incident-response and secret-rotation guide for launch  
**Audience:** operators and implementers handling credentials, auth abuse, or suspicious access  
**When to read:** when rotating a secret, containing an auth event, or checking recent security evidence  
**Authority:** reference-only; implementation truth lives in the current checked-out code and `docs/01-core/*`

## Scope

- This is the minimum response playbook for launch, not a full security policy manual.
- Assume secrets live in Railway environment variables unless a row below says the upstream system must rotate first.
- Railway variable edits stage changes; redeploy the affected service to apply them.

## Secret Inventory

| Secret                     | Primary service(s)                          | Where it lives                      | Rotation note                                                             |
| -------------------------- | ------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| `AUTH_SECRET`              | `web`                                       | Railway service variables           | Rotating invalidates existing Auth.js JWT sessions.                       |
| `AUTH_GOOGLE_SECRET`       | `web`                                       | Railway service variables           | Generate a new Google OAuth client secret first, then update Railway.     |
| `DATABASE_URL`             | `web`, `worker`                             | Railway reference/service variables | If Railway Postgres credentials change, redeploy every dependent service. |
| `WORKER_DATABASE_URL`      | `worker`                                    | Railway service variables           | Rotate with `DATABASE_URL` if the worker uses its own connection string.  |
| `GMAIL_CAPTURE_TOKEN`      | `worker`, `gmail-capture`                   | Railway service variables           | Must match on both sides of the service-to-service call.                  |
| `SALESFORCE_CAPTURE_TOKEN` | `worker`, `salesforce-capture`              | Railway service variables           | Must match on both sides of the service-to-service call.                  |
| `INBOX_REVALIDATE_TOKEN`   | `worker`, `web`                             | Railway service variables           | Internal-only shared secret for inbox revalidation calls.                 |
| `MAILCHIMP_CAPTURE_TOKEN`  | future `worker` + Mailchimp capture service | Railway service variables           | Deferred until Mailchimp capture resumes.                                 |
| `SENDGRID_API_KEY`         | future campaigns service                    | Railway service variables           | Deferred until Campaigns Email lands.                                     |
| `ANTHROPIC_API_KEY`        | `web`                                       | Railway service variables           | Powers Stage 4 AI drafting in the web service only.                       |

Current provider-facing secrets that also need the same treatment:

- Gmail capture OAuth credentials in `gmail-capture`: `GMAIL_GOOGLE_OAUTH_CLIENT_SECRET`, `GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN`
- Salesforce capture credentials in `salesforce-capture`: `SALESFORCE_CLIENT_ID`, `SALESFORCE_JWT_PRIVATE_KEY`

## Railway Rotation Commands

Use Railway CLI global flags to target the right service and environment:

```bash
railway variables set KEY='new-value' -s <service> -e production
railway redeploy -s <service> -e production -y
```

Examples:

```bash
railway variables set AUTH_SECRET='new-auth-secret' -s web -e production
railway redeploy -s web -e production -y

railway variables set AUTH_GOOGLE_SECRET='new-google-secret' -s web -e production
railway redeploy -s web -e production -y

railway variables set GMAIL_CAPTURE_TOKEN='new-shared-token' -s worker -e production
railway variables set GMAIL_CAPTURE_TOKEN='new-shared-token' -s gmail-capture -e production
railway redeploy -s worker -e production -y
railway redeploy -s gmail-capture -e production -y

railway variables set SALESFORCE_CAPTURE_TOKEN='new-shared-token' -s worker -e production
railway variables set SALESFORCE_CAPTURE_TOKEN='new-shared-token' -s salesforce-capture -e production
railway redeploy -s worker -e production -y
railway redeploy -s salesforce-capture -e production -y

railway variables set INBOX_REVALIDATE_TOKEN='new-revalidate-token' -s worker -e production
railway variables set INBOX_REVALIDATE_TOKEN='new-revalidate-token' -s web -e production
railway redeploy -s worker -e production -y
railway redeploy -s web -e production -y
```

Database note:

- Railway’s database view documents password regeneration in the database Credentials tab. Rotate the database password there first, then redeploy every service that consumes the derived `DATABASE_URL` or `WORKER_DATABASE_URL`.
- If you are storing a literal connection string instead of a Railway reference variable, pipe the new value from your shell or secret manager:

```bash
printf '%s' "$NEW_DATABASE_URL" | railway variables set DATABASE_URL --stdin -s web -e production
railway redeploy -s web -e production -y
```

Restart vs redeploy:

- Use `railway redeploy` after any variable change. Railway docs call redeploy the path used to apply environment variable changes.
- Use `railway restart` only when the secret value did not change in Railway and you just need to recycle a stuck process.

## Incident Flags And First Three Steps

### Suspected credential leak

1. Identify the leaked secret and the services that consume it.
2. Rotate the upstream credential first if there is one (`AUTH_GOOGLE_SECRET`, Gmail OAuth, Salesforce JWT), then update Railway and redeploy the affected services.
3. Run the audit query below for the last 24 hours and review application logs around the suspected exposure window.

### Brute-force signal from the rate limiter

1. Pull recent `rate_limit_exceeded` events and confirm the route, IP, and time window.
2. If the events target `/api/auth/*`, verify whether the same IP also reached a successful operator session; if yes, escalate as possible account compromise.
3. If the volume persists, rotate the impacted shared secret (for example `AUTH_SECRET` or a capture token) only if there is evidence it may have been guessed or exposed; otherwise keep monitoring and block at the edge if infrastructure controls are available.

### Unauthorized operator sign-in

1. Deactivate the user from the Access section of `/settings` immediately, or update the user row directly if the UI is unavailable.
2. Rotate `AUTH_SECRET` to invalidate current JWT-backed sessions, then redeploy `web`.
3. If the Google account itself is suspect, revoke/rotate the Google OAuth client secret, confirm the Workspace account status, and review recent audit evidence plus platform logs.

## Audit Query Pattern

Use the app database connection to pull recent read-audit and abuse events:

```bash
psql "$DATABASE_URL" -c "
select
  occurred_at,
  actor_type,
  actor_id,
  action,
  entity_type,
  entity_id,
  result,
  policy_code,
  metadata_json
from audit_policy_evidence
where occurred_at >= now() - interval '24 hours'
  and (
    action in (
      'contact.timeline.read',
      'settings.users.read',
      'auth.request.rate_limited',
      'dev_auth.request.rate_limited',
      'inbox.follow_up.rate_limited'
    )
    or metadata_json->>'reason' = 'rate_limit_exceeded'
  )
order by occurred_at desc
limit 200;
"
```

Fast filters operators can add in a pinch:

- `and actor_id = 'user:…'` for a specific operator
- `and entity_id = 'contact:…'` for a single volunteer record
- `and metadata_json->>'identifier' = '203.0.113.5'` for a single IP
