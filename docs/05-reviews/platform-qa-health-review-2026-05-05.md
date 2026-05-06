# Platform QA And Health Review - 2026-05-05

## Scope

Reviewed the current checkout after the recent high-change PR run, using the docs tree as the implementation authority and focusing on:

- Settings > Integrations crash
- Inbox queue/message trust
- message formatting risks
- loading, reloading, and connection stability
- hotspots found by act101 code-review and health-check

Primary docs read first:

- `docs/00-index.md`
- `docs/02-bundles/inbox-bundle.md`
- `docs/01-core/product-core.md`
- `docs/01-core/system-core.md`
- `docs/01-core/data-core.md`
- `docs/01-core/interfaces-core.md`
- `docs/01-core/frontend-patterns.md`

## Fixed During Review

### P0 - Settings > Integrations crashed on active SMS usage

Location: `packages/db/src/repositories.ts`

The Integrations page was failing with a Postgres query error from `getActiveUsageSnapshot`. The query compared `sms_messages.created_at` to a JavaScript `Date` inside a raw Drizzle SQL template. In this runtime, raw templates do not apply the timestamp column encoder, so the postgres driver received a `Date` object where it expected a string/buffer.

Fix applied:

- Convert `input.monthStart` to ISO with `toISOString()`
- Cast explicitly as `::timestamptz` in the raw SQL template

Verification:

- Browser verified `/settings/integrations` renders after the patch
- `pnpm --filter @as-comms/db typecheck`
- `pnpm --filter @as-comms/db build`
- `pnpm --filter @as-comms/web typecheck`

### P1 - Same timestamp encoding trap existed in inbox pagination

Location: `packages/db/src/repositories.ts`

`buildInboxCursorPredicate` compared projection timestamp columns against `new Date(...)` values inside raw SQL. This is the same Date-in-raw-SQL class of failure as the integrations crash and would likely show up as broken load-more/search/sent pagination against Postgres.

Fix applied:

- Convert cursor timestamps to ISO once
- Compare against explicit `::timestamptz` casts

Verification:

- `pnpm --filter @as-comms/db typecheck`
- `pnpm --filter @as-comms/db build`
- `pnpm --filter @as-comms/web typecheck`

## Stop-Ship / High Priority Findings

### P1 - Inbox is unreadable at narrow desktop/tablet widths

Location: `apps/web/app/inbox/_components/inbox-shell.tsx`, `apps/web/app/inbox/_components/inbox-list.tsx`, `apps/web/app/_lib/design-tokens-v2.ts`

Browser QA at the in-app browser width showed the list and workspace remain side-by-side. The list has a fixed `w-[22rem]` and the workspace is squeezed into a very narrow column. The welcome/detail pane text wraps into nearly one word per line and the page gets a horizontal scrollbar.

Recommended fix:

- Add a responsive inbox shell mode below a deliberate breakpoint.
- Either show list-only until a contact is selected, or route to detail-only with a visible back button.
- Keep the locked contact-centric semantics; this is only presentation/navigation.
- Add browser coverage for widths around 390, 600, 768, and 1280.

### P1 - Inbox/detail reloads can saturate DB connections

Locations:

- `packages/db/src/client.ts`
- `apps/web/src/server/stage1-runtime.ts`
- `apps/web/app/inbox/_lib/selectors.ts`
- `apps/web/app/inbox/_components/inbox-freshness-poller.tsx`

During browser QA and server restarts, the app hit `sorry, too many clients already` from Postgres while rendering inbox/detail routes. The default DB pool max is 20 per web runtime, and a single inbox list read fans out into multiple `Promise.all` batches, including per-contact canonical event and audit queries. The UI also mounts pollers in shell and detail that can call `router.refresh()`.

Recommended fix:

- Lower or environment-scope local/dev `DB_POOL_MAX` immediately; document the expected production value per service.
- Collapse the inbox list N+1 reads for canonical events/audit into batch repository calls.
- Add an in-flight guard to the freshness poller so it does not launch overlapping freshness requests or repeated `router.refresh()` calls while a refresh is already pending.
- Load-test `/inbox`, `/inbox/[contactId]`, and `/api/inbox/freshness` with two tabs open.

### P1 - Building db while Next dev is running can temporarily break imports

Location: `packages/db/package.json` exports `dist/index.js`; runtime imports `@as-comms/db`

While `pnpm --filter @as-comms/db build` was running, `clean-dist.mjs` removed `dist/index.js` and the active Next dev server briefly failed importing `@as-comms/db`. This is mostly a dev workflow issue, but it can make QA look flaky and creates false negatives.

Recommended fix:

- Do not rebuild `@as-comms/db` while the web dev server is serving traffic.
- Consider an atomic build output strategy or a dev import path that reads source through the monorepo toolchain.

## Message Formatting Risk

### P1 - Message formatting logic is heavily concentrated in one selector file

Location: `apps/web/app/inbox/_lib/selectors.ts`

The selector file owns queue reads, cursoring, contact hydration, message body normalization, signature stripping, quoted-reply trimming, HTML/entity decoding, preview selection, and view-model shaping. It already has many targeted tests, which is good, but its size and coupling make formatting regressions likely when queue logic changes.

Recommended fix:

- Extract message/body normalization into a small module with pure functions and fixtures.
- Keep selector tests for integration behavior, but move formatting edge cases to narrow fixture tests.
- Add real anonymized fixtures for the recurring bugs: flattened Salesforce bodies, Gmail HTML bodies, quoted-printable, signatures, replies beginning with "Thanks,", and campaign snippets.

## act101 Health Snapshot

The act101 broad scan found the following hotspots worth assigning before more feature work:

- `apps/web/app/inbox/_lib/selectors.ts`: very large, high coupling, core queue/message formatting risk.
- `apps/web/app/settings/actions.ts`: large settings mutation surface; low cohesion by scan.
- `packages/domain/src/normalization.ts`: high complexity around Stage 1 normalization/rebuild functions.
- `apps/worker/src/orchestration/service.ts`: high complexity orchestration path.
- `packages/integrations/src/providers/gmail-body.ts`: parsing-heavy, medium test-gap risk.
- `packages/integrations/src/capture-services/mailchimp.ts`: large capture surface with nested flow.

Test-gap scan was noisy because it included non-source files, but it consistently pointed at contract/provider/integration surfaces that are foundational for Stage 1 trust: `stage1-taxonomy`, capture shared/provider types, Gmail OAuth/body parsing, Salesforce/Mailchimp capture, worker orchestration types, and projection seed/config.

## Verification Notes

Passed:

- `pnpm --filter @as-comms/db typecheck`
- `pnpm --filter @as-comms/db build`
- `pnpm --filter @as-comms/web typecheck`
- Browser render check for `/settings/integrations` after the fix

Blocked:

- Targeted web unit tests could not run in this environment because Rollup's optional native dependency failed to load with `ERR_DLOPEN_FAILED` / code-signature errors. Re-run targeted vitest after reinstalling dependencies or repairing the native optional package.

## Suggested Fix Order For Tomorrow

1. Ship the DB timestamp patch and rerun the targeted settings/inbox pagination tests in a clean dependency environment.
2. Fix the narrow-width inbox shell behavior and verify screenshots at mobile, narrow desktop, and full desktop widths.
3. Add in-flight/backoff behavior to `InboxFreshnessPoller` and reduce duplicate refresh pressure.
4. Batch the inbox list per-contact canonical/audit reads to reduce connection pressure.
5. Extract message formatting helpers from `selectors.ts` behind pure tests with real anonymized fixtures.

## 2026-05-06 Follow-Up Patch

Implemented items 1-4 above:

- DB timestamp patch remains in place for integrations usage and inbox cursor predicates.
- Narrow-width inbox shell now shows the queue full-width on `/inbox` and the selected contact workspace full-width on `/inbox/[contactId]`.
- `InboxFreshnessPoller` now skips overlapping polls and waits for refreshed server props before scheduling another refresh.
- Inbox list canonical-event and audit reads now use repository batch methods instead of per-contact `Promise.all` fan-out.

Browser QA at 600px verified the list and detail routes no longer squeeze the detail pane or create document-level horizontal overflow.

## 2026-05-06 Overnight Completion

Completed the remaining proposed fix and one build reliability issue:

- Extracted Inbox message formatting into `apps/web/app/inbox/_lib/message-formatting.ts`.
- Added targeted message-formatting fixtures for MIME cleanup, quoted-printable decoding, structured provider previews, quoted-reply trimming, signature stripping, and preferred preview resolution.
- Added poller coverage for request/refresh dedupe.
- Added selector coverage proving inbox list canonical-event and audit reads use batch repository calls.
- Removed the `next/font/google` build-time dependency so `next build` no longer needs live Google Fonts access.

Verification passed:

- `pnpm typecheck`
- `pnpm --filter @as-comms/web lint`
- `pnpm --filter @as-comms/db build`
- `pnpm --filter @as-comms/web build`
- `pnpm boundaries`
- `pnpm security`
- `pnpm verify`
- `git diff --check`
- Prettier check for changed tracked files and review docs

Blocked locally:

- Vitest could not start because Rollup's native optional package fails macOS library validation with `ERR_DLOPEN_FAILED`.
- `next dev` browser QA could not start because the current sandbox disallows listening on local ports (`listen EPERM`).
