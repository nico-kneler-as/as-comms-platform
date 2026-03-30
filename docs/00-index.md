# Docs Index

**Role:** agent-first implementation canon index  
**Audience:** AI agents first, humans second  
**When to read:** always; first file before any implementation task  
**Authority:** authoritative for implementation work routed through `docs/*`; deeper donor evidence stays in the linked reference docs

## Summary

- This `docs/` folder is the preferred implementation handoff for Codex-style work.
- It is optimized for retrieval and execution, not narrative completeness.
- Default working set per task should be `4-7` docs.
- Reference docs remain available for deeper donor evidence and lower-frequency lookups.

## Authority Order

1. docs in `docs/`
2. linked reference docs in `docs/03-reference`
3. linked donor/full evidence pointed to by those reference docs
4. donor code and legacy planning artifacts elsewhere in the repo

If the compact canon and deeper donor evidence differ, use the compact canon for implementation unless a linked reference explicitly says to fall back to the fuller source.

## Doc Taxonomy

| Layer | Path | Purpose | Read frequency |
| --- | --- | --- | --- |
| Index | `00-index.md` | package map and task routing | always |
| Core canon | `01-core/*` | product, system, data, interfaces, frontend, engineering, delivery, decisions | almost always |
| Task bundles | `02-bundles/*` | task-scoped working packets | per task |
| Reference | `03-reference/*` | compact lookup and donor pointers | only when needed |
| Implementation specs | `04-implementation-specs/*` | stage-scoped execution narrowing after canon is read | only when beginning implementation for that stage |

## Core Canon

Read these in order for any non-trivial task:

1. [`01-core/product-core.md`](./01-core/product-core.md)
2. [`01-core/system-core.md`](./01-core/system-core.md)
3. [`01-core/data-core.md`](./01-core/data-core.md)
4. [`01-core/interfaces-core.md`](./01-core/interfaces-core.md)
5. [`01-core/engineering-core.md`](./01-core/engineering-core.md)
6. [`01-core/frontend-patterns.md`](./01-core/frontend-patterns.md)
7. [`01-core/delivery-core.md`](./01-core/delivery-core.md)
8. [`01-core/decision-core.md`](./01-core/decision-core.md)

## Task Bundle Table

| Task | Start here | Typical total reading set |
| --- | --- | --- |
| New repo bootstrap | [`bootstrap-bundle.md`](./02-bundles/bootstrap-bundle.md) | `00-index` + `engineering-core` + `interfaces-core` + `delivery-core` + `decision-core` + bundle |
| Data foundation | [`data-foundation-bundle.md`](./02-bundles/data-foundation-bundle.md) | `00-index` + `product-core` + `system-core` + `data-core` + `interfaces-core` + `delivery-core` + bundle + relevant docs in [`04-implementation-specs`](./04-implementation-specs/README.md) |
| Settings/admin | [`settings-bundle.md`](./02-bundles/settings-bundle.md) | `00-index` + `product-core` + `system-core` + `engineering-core` + `frontend-patterns` + bundle |
| Inbox | [`inbox-bundle.md`](./02-bundles/inbox-bundle.md) | `00-index` + `product-core` + `system-core` + `data-core` + `interfaces-core` + `frontend-patterns` + bundle |
| AI | [`ai-bundle.md`](./02-bundles/ai-bundle.md) | `00-index` + `product-core` + `system-core` + `data-core` + `frontend-patterns` + bundle |
| Campaigns | [`campaigns-bundle.md`](./02-bundles/campaigns-bundle.md) | `00-index` + `product-core` + `system-core` + `data-core` + `interfaces-core` + `frontend-patterns` + bundle |
| Verification/security | [`verification-security-bundle.md`](./02-bundles/verification-security-bundle.md) | `00-index` + `delivery-core` + `decision-core` + `reference-testing-mocks` + bundle |

## Quick Rules

- Do not read the whole donor package by default.
- Open only the bundle for the task you are doing.
- Open `03-reference/*` only when the bundle tells you to.
- Open `04-implementation-specs/*` only after the relevant bundle and core canon are already read.
- Treat `Build Web Apps` as a frontend execution tool, not a system designer.
- If implementation needs a new product, stack, repo, or security decision, stop and update the canon first.

## Read Next

- If bootstrapping the new repo: [`02-bundles/bootstrap-bundle.md`](./02-bundles/bootstrap-bundle.md)
- If starting Stage 1 data implementation after reading the bundle: [`04-implementation-specs/README.md`](./04-implementation-specs/README.md)
- If implementing product behavior: open the matching file under [`02-bundles`](./02-bundles)
