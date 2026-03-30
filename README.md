# AS Comms Platform

Stage 0 scaffolds the engineering foundation for a fresh rebuild of the AS Comms Platform. It intentionally stops at repo shape, package boundaries, CI, verification, and minimal operational surfaces.

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

This sandbox could not download packages from the npm registry, so the repository is wired for `pnpm` but still needs a first networked install to create `pnpm-lock.yaml` and `node_modules`.

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
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:e2e
pnpm boundaries
pnpm security
pnpm verify
```

## What exists in Stage 0

- `apps/web` contains a minimal App Router shell plus `/health`, `/api/health`, and `/api/readiness`.
- `apps/worker` contains a safe Graphile Worker boot path with a no-op job only.
- `packages/contracts` contains Stage 0 health/readiness and no-op job contracts only.
- `packages/db` contains Drizzle connection wiring and no business schema.
- `packages/domain` contains a boundary-safe readiness evaluator only.
- `packages/integrations` contains provider placeholders only.
- `packages/ui` contains reusable web UI primitives only.

## What Stage 0 does not do

- No business tables or business migrations
- No Inbox, timeline, campaigns, or notes behavior
- No provider ingest, webhook, replay, or cutover logic
- No auth flow or role-management UX
- No web-to-DB or web-to-provider direct imports

See [docs/build-web-apps-scope.md](./docs/build-web-apps-scope.md), [docs/stage-0-summary.md](./docs/stage-0-summary.md), and [docs/stage-0-open-questions.md](./docs/stage-0-open-questions.md) for the Stage 0 boundaries and intentional deferrals.
