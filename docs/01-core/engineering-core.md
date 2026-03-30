# Engineering Core

**Role:** implementation shape and frontend/backend guardrail canon  
**Audience:** implementers touching repo shape, web app, worker, CI, or generated UI  
**When to read:** before bootstrap or any implementation that might affect architecture or boundaries  
**Authority:** authoritative for stack, repo shape, Build Web Apps limits, and required React / Next rules  
**Decides:** how the implementation is allowed to be built  
**Does not decide:** product behavior, donor evidence details, stage-specific acceptance scenarios

## Summary

- The restart is implemented in a new repo.
- The stack and repo shape are locked.
- `Build Web Apps` is allowed to accelerate frontend implementation only inside approved surfaces.
- A curated subset of the Vercel React / Next guidance is mandatory.

## Locked Stack

| ID | Locked choice |
| --- | --- |
| `ENG-01` | `Node 24+` |
| `ENG-02` | `pnpm` workspaces + `turbo` |
| `ENG-03` | `Next.js App Router` + `React 19` |
| `ENG-04` | `TypeScript` strict |
| `ENG-05` | `Supabase Postgres` + `Drizzle` |
| `ENG-06` | `Graphile Worker` |
| `ENG-07` | `Zod`, `Tailwind CSS`, `Vitest`, `Playwright` |

## Locked Repo Shape

```text
apps/web
apps/worker
packages/contracts
packages/db
packages/domain
packages/integrations
packages/ui
```

## Package Boundary Rules

| Allowed | Not allowed |
| --- | --- |
| `apps/web` reads from domain/contracts/ui | web UI importing provider SDKs or DB internals directly |
| `apps/worker` owns sync, replay, projections, cutover jobs | long-running jobs inside web request lifecycles |
| `packages/domain` owns business rules and interfaces | domain importing DB implementations or provider adapters |
| `packages/ui` owns reusable web UI | UI importing DB or integration code |

## Build Web Apps Limits

### Allowed write scope

- `apps/web`
- `packages/ui`
- route/page composition
- client interaction code
- loading and Suspense boundaries
- accessibility and visual polish

### Not allowed

- DB schema or migrations
- canonical data model decisions
- worker/job architecture
- provider adapter design
- contracts package design
- root toolchain or CI design
- canonical docs

## Required React / Next Rules

| Group | Mandatory rules |
| --- | --- |
| Waterfalls | `async-defer-await`, `async-parallel`, `async-api-routes`, `async-suspense-boundaries`, `server-parallel-fetching`, `server-cache-react` |
| Bundle | `bundle-barrel-imports`, `bundle-dynamic-imports`, `bundle-defer-third-party`, `bundle-conditional` |
| Safety / serialization | `server-auth-actions`, `server-serialization` |
| Client rerender control | `client-swr-dedup`, `rerender-derived-state-no-effect`, `rerender-move-effect-to-event`, `rerender-transitions`, `rerender-use-deferred-value`, `rerender-no-inline-components` |
| Rendering / JS | `rendering-content-visibility`, `rendering-conditional-render`, `js-index-maps`, `js-set-map-lookups`, `js-early-exit` |

## Do Not Generate

- a different frontend framework or router
- a single-process “web app does everything” runtime
- client-owned source of truth for Inbox, timeline, or campaign state
- inline component definitions inside render functions
- effect-driven derived state that can be computed during render
- full-record server-to-client serialization when a view model would do

## Read Next

- repo details and write scope: [`../03-reference/reference-donor-reuse.md`](../03-reference/reference-donor-reuse.md)
- stage order and gates: [`delivery-core.md`](./delivery-core.md)
- implementation workflow: [`../02-bundles/bootstrap-bundle.md`](../02-bundles/bootstrap-bundle.md)
