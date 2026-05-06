# act101 Inbox Health Follow-Up - 2026-05-06

## Branch

`codex/inbox-qa-health-followup`

Use this branch for the current fixes and audit notes. A new worktree is not needed unless a separate agent needs to work on unrelated files at the same time.

## Goal Workflow Note

The requested `/goal` skill did not surface as a readable local `SKILL.md` or callable tool in this session. I followed the same goal-style loop manually: anchor on canon, finish the proposed fixes, run verification, fix new failures, and record residual risk.

## Skills Used

- `act101:change-impact`
- `act101:boundary-analysis`
- `act101:code-review`
- `act101:health-check`

The docs tree remained the implementation authority. Inbox semantics were checked against `docs/00-index.md`, `docs/02-bundles/inbox-bundle.md`, and the required core docs.

## Current Fixes On Branch

- Settings integrations crash: `packages/db/src/repositories.ts` now converts raw SQL timestamp inputs to ISO strings and casts as `::timestamptz`.
- Inbox cursor predicates: the same raw Date encoding trap is fixed for inbox pagination predicates.
- Narrow inbox layout: `/inbox` shows a full-width list below `lg`; `/inbox/[contactId]` shows a full-width detail workspace below `lg`.
- Freshness poller pressure: `InboxFreshnessPoller` now skips overlapping polls and avoids repeated `router.refresh()` calls until server props update.
- Inbox list fan-out: canonical event and audit evidence reads are now batched through repository methods instead of per-contact `Promise.all` calls.
- Message formatting trust: preview/body parsing, MIME cleanup, quoted-reply trimming, signature stripping, and direction-preview extraction now live in `apps/web/app/inbox/_lib/message-formatting.ts` instead of the giant selector file.
- Build reliability: root layout no longer uses `next/font/google`, so production builds do not require live access to Google Fonts.

## Change Impact Summary

act101 impact analysis found the expected blast radius:

- `apps/web/app/inbox/_lib/selectors.ts` is consumed by inbox list/detail pages, freshness/list/timeline API routes, and inbox selector/read-audit tests.
- `apps/web/app/inbox/_components/inbox-freshness-poller.tsx` affects shell/detail rendering and the existing freshness unit test.
- `packages/domain/src/repositories.ts` affects normalization, persistence, timeline, notes, settings repository contracts, and domain tests.
- `packages/db/src/repositories.ts` is under-reported by act101 because package exports hide some dependents, but it is the concrete implementation for the new repository contract methods and timestamp fixes.

Practical implication: tomorrow's agent should treat selector, domain repository, and db repository changes as one unit. Do not land only the web selector patch without the repository interface and db implementation changes.

## Boundary Analysis

No dependency cycles were detected in the scoped inbox/domain/db scan.

The strongest structural finding is that `apps/web/app/inbox/_lib/selectors.ts` is doing too much: list reads, cursoring, contact hydration, preview/body formatting, timeline shaping, project context, detail reads, and freshness calculation all live in one file.

Extraction status:

1. Done: message preview/body helpers were extracted into `apps/web/app/inbox/_lib/message-formatting.ts`.
2. Still optional: extract inbox list ordering/cursor helpers into a narrow module, such as `inbox-list-ordering.ts`.
3. Still optional: extract list read-model assembly from `readInboxListCacheData` after the batch-read behavior is stable in CI.
4. Still optional: extract detail/timeline read-model assembly after more message-formatting fixtures are green in CI.

This order protects queue truth and message truth before cosmetic or broad decomposition work.

## Health Check Findings

High-signal findings:

- `apps/web/app/inbox/_lib/selectors.ts` remains the largest inbox trust hotspot.
- `InboxList`, `InboxDetail`, `InboxComposerDetailPane`, composer recipient pickers, and timeline bubble/detail components are complex enough that future UI changes should be small and screenshot-tested.
- Domain normalization still has high-complexity functions, especially around duplicate collapse, identity decisions, inbox projection rebuild, and canonical event application. That is Stage 1 trust territory; avoid opportunistic refactors unless backed by focused tests.
- DB repository factories are large. The new batch reads are the right kind of tactical performance fix, but a later repository-slice split would improve maintainability.
- After extraction, act101 still flags `isLikelyPreviewNoise`, `stripSignature`, and `resolvePreferredMessagePreview` as complex. That is acceptable for this branch because the complexity is now isolated in a pure module with targeted tests, instead of mixed into queue and detail selection.

Tool caveats:

- `analyze_type_completeness`, `analyze_inconsistencies`, and `analyze_surface` returned little useful data for this TypeScript/Next shape.
- `analyze_patterns` produced some test-file false positives; use it directionally, not as an issue list.

## Code Review Result

act101 diagnostics did not report errors or warnings for the reviewed inbox, db, and domain files. LSP availability was limited, so TypeScript verification remains the stronger signal.

The actionable code-review findings from the QA pass were addressed:

- responsive inbox shell collapse
- overlapping freshness poller reload pressure
- inbox list per-contact DB fan-out
- message-formatting concentration inside `selectors.ts`
- build-time Google Fonts network dependency

## Tests Added

- `apps/web/tests/unit/inbox-message-formatting.test.ts`
  Covers quoted-printable cleanup, MIME stripping, structured provider previews, paragraph restoration, quoted-reply trimming, signature stripping, and preferred preview resolution.
- `apps/web/tests/unit/inbox-freshness.test.ts`
  Adds component-level coverage that overlapping polls are deduped and refresh pressure pauses until server props update.
- `apps/web/tests/unit/inbox-selectors.test.ts`
  Adds selector integration coverage proving inbox list loads canonical events and audit evidence through batch repository calls.

## Residual Risk

1. Vitest could not start in this local environment because Rollup's native optional package fails macOS library validation with `ERR_DLOPEN_FAILED`. The test files are written and typechecked, but the test runner itself is blocked until dependencies are reinstalled or the native package signature issue is repaired.
2. Browser/dev-server QA could not run in this session because `next dev` cannot bind a local port under the current sandbox (`listen EPERM`). The prior 600px browser QA from this branch remains valid for the responsive shell fix, and the production build now passes.
3. Next also reports the local `@next/swc-darwin-arm64` native package signature problem, but it successfully falls back and completes `next build`. A clean dependency reinstall should remove both the Rollup and SWC signature warnings.

## Verification Already Performed

Passed:

- `pnpm typecheck`
- `pnpm --filter @as-comms/web lint`
- `pnpm --filter @as-comms/db build`
- `pnpm --filter @as-comms/web build`
- `pnpm boundaries`
- `pnpm security`
- `pnpm verify`
- `pnpm exec prettier --check ...` on changed tracked files and review docs
- `pnpm --filter @as-comms/web typecheck`
- `git diff --check`
- Browser QA at 600px for `/inbox` and a selected contact detail route
- act101 diagnostics on `apps/web/app/inbox/_lib` and `apps/web/app/layout.tsx` returned no errors/warnings, with LSP availability caveats

Blocked:

- `pnpm --filter @as-comms/web test:unit -- inbox-message-formatting.test.ts inbox-freshness.test.ts inbox-selectors.test.ts` failed before running tests because Rollup's native optional package failed to load with a code-signature / `ERR_DLOPEN_FAILED` error.
- `next dev` browser QA failed before serving because the sandbox disallowed listening on local ports (`listen EPERM`).
