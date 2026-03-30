# Build Web Apps Scope

This repo keeps `Build Web Apps` on a tight write leash during Stage 0 and later frontend work.

## Allowed write scope

- `apps/web`
- `packages/ui`
- App Router route and page composition
- client interaction code
- loading and Suspense boundaries
- accessibility work
- visual polish that stays inside approved web/UI surfaces

## Forbidden write scope

- root toolchain files
- CI workflows
- DB schema or migrations
- canonical data model decisions
- worker architecture
- provider adapter design
- contracts architecture changes beyond already-approved Stage 0 surfaces
- canonical docs in `docs/01-core` and `docs/02-bundles`

## Stage 0 interpretation

- `apps/web` may import only `@as-comms/contracts`, `@as-comms/domain`, and `@as-comms/ui`.
- `packages/ui` stays reusable and must not import DB or integrations code.
- Background or long-running work belongs in `apps/worker`, never in web request lifecycles.
- If a frontend task needs a new data model, worker design, provider contract, or cross-package architectural change, stop and update canon before coding.
