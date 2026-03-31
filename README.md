# AS Comms Platform

Stage 0 scaffolds the engineering foundation for a fresh rebuild of the AS Comms Platform. Stage 1 now adds the canonical data foundation, provider-close ingest path, worker orchestration, and operational cutover support without starting later product stages. The narrowed launch-scope backend target is Gmail + Salesforce only.

## Locked Stage 0 stack

- Node 24+
- `pnpm` workspaces + `turbo`
- Next.js App Router + React 19
- TypeScript strict
- Supabase Postgres + Drizzle
- Graphile Worker
- Zod
- Tailwind CSS
- Vitest
- Playwright

## Workspace layout

```text
apps/web
apps/worker
packages/contracts
packages/db
packages/domain
packages/integrations
packages/ui
```

## First-time setup

Install dependencies, then run the baseline verification suite.

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm verify
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:e2e
pnpm boundaries
pnpm security
```

## Common commands

```bash
pnpm dev
pnpm dev:web
WORKER_BOOT_MODE=run DATABASE_URL=postgres://... pnpm dev:worker
pnpm dev:gmail-capture
pnpm dev:salesforce-capture
pnpm ops:worker:check-config
pnpm ops:worker:enqueue -- gmail-historical --window-start 2026-01-01T00:00:00.000Z --window-end 2026-01-02T00:00:00.000Z
pnpm ops:worker:inspect -- contact --salesforce-contact-id 003-stage1
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:e2e
pnpm boundaries
pnpm security
pnpm verify
```

## Stage 1 worker runtime

The worker now boots the Stage 1 task list end to end through the single normalization path. For launch-scope acceptance, Gmail + Salesforce are the required providers; SimpleTexting and Mailchimp remain deferred. See [docs/stage-1-runtime.md](./docs/stage-1-runtime.md) for worker/runtime details, [docs/stage-1-capture-services.md](./docs/stage-1-capture-services.md) for the external Gmail and Salesforce capture services, and [docs/stage-1-acceptance.md](./docs/stage-1-acceptance.md) for the narrowed completion criteria.

## Stage 1 validation

Use the worker-side ops commands for controlled validation:

- `pnpm ops:worker:check-config`
- `pnpm ops:worker:enqueue -- ...`
- `pnpm ops:worker:inspect -- ...`

See [docs/stage-1-validation-runbook.md](./docs/stage-1-validation-runbook.md) for the operator flow and evidence checklist. Start the new Gmail and Salesforce capture services first; the worker still consumes only provider-close HTTP batches.

## What exists now

- `apps/web` contains a minimal App Router shell plus `/health`, `/api/health`, and `/api/readiness`.
- `apps/worker` contains the Stage 0 no-op task plus Stage 1 capture, replay, rebuild, parity, and cutover-support task wiring.
- `packages/contracts` contains Stage 0 readiness contracts and the Stage 1 data, normalization, and worker job contracts.
- `packages/db` contains Drizzle schema, migrations, row mappers, and repository implementations for the Stage 1 durable model.
- `packages/domain` contains the provider-agnostic normalization and persistence application layer.
- `packages/integrations` contains provider-close mapping and capture-port modules for Stage 1 Gmail and Salesforce launch-scope ingest, while preserving deferred SimpleTexting and Mailchimp paths in the generic architecture.
- `packages/ui` contains reusable web UI primitives only.

## What is still intentionally deferred

- No Inbox UI, settings/admin/auth, campaigns UI, or notes UX
- No product-app webhook endpoints
- No later-stage workflow engine, AI state, or Stage 2+ behavior
- No web-to-DB or web-to-provider direct imports

See [docs/build-web-apps-scope.md](./docs/build-web-apps-scope.md), [docs/stage-0-summary.md](./docs/stage-0-summary.md), [docs/stage-0-open-questions.md](./docs/stage-0-open-questions.md), [docs/stage-1-runtime.md](./docs/stage-1-runtime.md), [docs/stage-1-capture-services.md](./docs/stage-1-capture-services.md), [docs/stage-1-acceptance.md](./docs/stage-1-acceptance.md), and [docs/stage-1-validation-runbook.md](./docs/stage-1-validation-runbook.md) for the current boundaries and operational notes.
