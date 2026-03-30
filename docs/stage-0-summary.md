# Stage 0 Summary

## What was scaffolded

- `pnpm` workspace and `turbo` task graph
- strict TypeScript base config
- Next.js App Router web shell in `apps/web`
- Graphile Worker runtime skeleton in `apps/worker`
- Stage 0-only `contracts`, `db`, `domain`, `integrations`, and `ui` packages
- executable boundary, security, and verification scripts
- Vitest and Playwright configs
- GitHub Actions CI workflow for baseline Stage 0 checks

## Tool choices

These were not locked by canon, so Stage 0 uses the lightest pragmatic options that still enforce boundaries:

- ESLint flat config plus Prettier for lint/format tooling
- repo-local Node boundary checker to fail fast on forbidden workspace imports
- repo-local security check that scans for secrets, blocks server-only env usage in client-visible code, and runs `pnpm audit` when package installs are available
- Tailwind CSS v3 for a boring, stable baseline in the web/UI surface

## How boundaries are enforced

- `scripts/boundary-check.mjs` rejects cross-package relative imports.
- `scripts/boundary-check.mjs` restricts `apps/web` to `@as-comms/contracts`, `@as-comms/domain`, and `@as-comms/ui`.
- `scripts/boundary-check.mjs` restricts `packages/domain` to `@as-comms/contracts`.
- `scripts/boundary-check.mjs` keeps `packages/ui` and `packages/contracts` free of internal workspace dependencies.
- `scripts/verify-stage0.mjs` validates the locked repo shape, required docs, root scripts, Stage 0 DB schema restraint, and CI command coverage.

## What was intentionally left for later stages

- canonical business schema and migrations
- repository implementations and durable Stage 1 entities
- provider adapters, ingest, replay, projections, or cutover logic
- auth flows, role UX, and auditable admin mutations
- Inbox, timeline, notes, AI, and campaign product behavior

## Install note

The current sandbox had no npm-registry access, so the repository was wired but not dependency-installed. The first networked `pnpm install` should generate `pnpm-lock.yaml`, install the locked stack, and enable the full lint/typecheck/build/test flow.
