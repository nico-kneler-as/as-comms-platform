# AS Comms Trust And Safety Review - 2026-04-24

## Executive Summary

I tailored the attached broad security skill into an AS Comms-specific trust and safety runbook, then ran it against the current checkout. The strongest launch-readiness controls are already present: Auth.js sessions, server-side role checks, CI gates, security headers, the repo security script, ignored `.env*` files, sanitized composer HTML, and human-in-the-loop AI drafting.

I found and fixed four concrete pre-launch risks during the review:

- local mailbox exports under `mbox files/` were not ignored by git
- Gmail and Salesforce capture services accepted unbounded request bodies
- Salesforce capture errors returned diagnostic internals and logged request bodies/stacks
- capture-service bearer token checks used direct string equality

Remaining recommendations are medium-priority hardening: protect or reduce readiness details, decide whether the AI spend cap is meant to be soft or hard, verify capture-service network isolation, and plan a stricter nonce-based CSP / HSTS rollout.

## Stop-Ship Findings

None remain open from this pass.

## Fixed During Review

### TSR-001 - Local mailbox exports could be staged accidentally

Severity: High, fixed.

Location: `.gitignore:17`; local files under `mbox files/`.

Evidence: four local `.mbox` files were untracked and not ignored. They are mailbox exports and likely contain volunteer/staff communication history.

Impact: accidental staging or copying into an artifact would expose sensitive communication data.

Fix applied: added `mbox files/` to `.gitignore`.

Recommended follow-up: store mailbox exports outside the repo or in encrypted storage, and delete local copies once imports/parity evidence no longer needs them.

### TSR-002 - Capture services accepted unbounded request bodies

Severity: High, fixed.

Locations:

- `apps/gmail-capture/src/index.ts:46`, `apps/gmail-capture/src/index.ts:157`
- `apps/salesforce-capture/src/index.ts:60`, `apps/salesforce-capture/src/index.ts:244`

Evidence: both services previously buffered request bodies without a max size before passing them to capture handlers.

Impact: a public or misrouted capture service could be abused for memory pressure before auth/schema handling completes.

Fix applied: both services now reject bodies over 1 MB with `413` and do not invoke the capture handler.

### TSR-003 - Salesforce capture error path exposed diagnostics

Severity: High, fixed.

Location: `apps/salesforce-capture/src/index.ts:320`, `apps/salesforce-capture/src/index.ts:415`.

Evidence: the prior test contract expected a 500 body containing error class/message, and logs containing request body plus stack. That is unsafe for provider payloads and communication evidence.

Impact: unexpected errors could put provider details, request bodies, or stack traces into logs and client-visible responses.

Fix applied: the service now returns a generic `internal_error` with a correlation `requestId`, and logs only route, method, event, error name, timestamp, and request ID.

### TSR-004 - Bearer token comparison used direct string equality

Severity: Medium, fixed.

Location: `packages/integrations/src/capture-services/shared.ts:77`.

Evidence: capture services compared the authorization header to the expected bearer value with direct equality.

Impact: small timing side channel on an internal token check; low exploitability if services are network-isolated, but cheap to harden.

Fix applied: switched to `timingSafeEqual` for equal-length bearer strings.

## Medium Priority

### TSR-005 - Public readiness reveals deployment configuration state

Location: `apps/web/src/server/readiness.ts:17`.

Evidence: readiness reports booleans for `DATABASE_URL` / worker configuration. Health is fine as a public liveness check, but readiness is operational posture.

Recommended fix: keep `/api/health` public and protect `/api/readiness` behind an internal token, admin session, or platform-only routing; alternatively return only a generic status publicly.

### TSR-006 - CSP and HSTS need a launch-domain decision

Location: `apps/web/next.config.ts:7`.

Evidence: production CSP still allows `'unsafe-inline'`, and HSTS includes `preload`.

Recommended fix: plan a nonce/hash CSP path for App Router scripts. Before launch, confirm HSTS preload is intentional for the final custom domain and not being applied casually to preview/internal domains.

### TSR-007 - AI daily cap is currently warning-only

Location: `apps/web/src/server/ai/draft-generator.ts:221`.

Evidence: model usage is recorded first; crossing the daily cap adds a warning but does not block the call.

Recommended fix: either rename/document this as a soft budget signal, or enforce a hard pre-call budget check if the team wants financial safety to be a launch gate.

### TSR-008 - Capture service exposure depends on deployment isolation

Locations: `apps/gmail-capture/railway.json`, `apps/salesforce-capture/railway.json`.

Evidence: the services listen on `0.0.0.0` by default and are bearer-token protected. That can be acceptable if Railway networking keeps them internal, but the repo cannot prove that by itself.

Recommended fix: verify Railway service exposure and private-network routing before publishing. Add a deployment note or check that public ingress is disabled for capture services unless explicitly intended.

## Positive Controls

- `pnpm security` passes and includes dependency audit plus secret/client-env checks.
- CI runs lint, typecheck, build, unit tests, Playwright smoke, boundary check, security check, and verification gate.
- `.env` and `.env.*` are ignored; only `.env.example` is tracked.
- Inbox/list/timeline API routes call `requireApiSession`; Settings mutations call `resolveAdminSession`.
- Dev auth/header bypasses are guarded by `NODE_ENV !== "production"` or production 404/403 behavior.
- Composer HTML is centralized through an allowlist sanitizer and tests cover script/style stripping.
- AI drafting is human-in-the-loop and does not auto-send.
- Drizzle SQL scan showed parameterized template use, not string-built SQL.

## Verification Commands

- `pnpm --filter @as-comms/salesforce-capture test:unit` - passed
- `pnpm --filter @as-comms/gmail-capture test:unit` - passed
- `pnpm --filter @as-comms/salesforce-capture typecheck` - passed
- `pnpm --filter @as-comms/gmail-capture typecheck` - passed
- `pnpm --filter @as-comms/salesforce-capture lint` - passed
- `pnpm --filter @as-comms/gmail-capture lint` - passed
- `pnpm --filter @as-comms/integrations typecheck` - passed
- `pnpm --filter @as-comms/integrations lint` - passed
- `pnpm --filter @as-comms/integrations test:unit` - passed
- `pnpm security` - passed

Note: a one-off `prettier --write` command included `.gitignore` and exited non-zero because Prettier cannot infer a parser for that file; the supported TS/MD files in that command were formatted.

## Proposed Modifications

1. Protect or reduce `/api/readiness`.
2. Confirm Railway private networking for capture services and document expected public/private ingress.
3. Decide whether `AI_DAILY_CAP_USD` is a hard launch control or a soft warning.
4. Plan stricter CSP with nonces/hashes and decide HSTS preload only after final domain approval.
5. Extend `scripts/security-check.mjs` to flag unignored sensitive artifact directories, unsafe diagnostic response patterns, and unbounded `readRequestBody` helpers.
