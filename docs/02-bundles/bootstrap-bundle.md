# Bootstrap Bundle

**Role:** task packet for new-repo bootstrap and Stage 0  
**Audience:** implementers creating the restart repo  
**When to read:** before any code is generated in the new repo  
**Authority:** derivative bundle; core truth lives in `01-core/*`

## Purpose

Bootstrap the new restart repo so product work starts on locked boundaries instead of inventing them during implementation.

## Required Reading

1. [`../00-index.md`](../00-index.md)
2. [`../01-core/engineering-core.md`](../01-core/engineering-core.md)
3. [`../01-core/interfaces-core.md`](../01-core/interfaces-core.md)
4. [`../01-core/delivery-core.md`](../01-core/delivery-core.md)
5. [`../01-core/decision-core.md`](../01-core/decision-core.md)

## Locked

- New repo, not donor repo
- locked stack and repo shape
- Stage 0 must pass before Stage 1 starts
- Build Web Apps is not allowed to design the system

## Required Output

- `pnpm` + `turbo` workspace
- `apps/web`, `apps/worker`, `packages/contracts`, `packages/db`, `packages/domain`, `packages/integrations`, `packages/ui`
- baseline toolchain, root scripts, and CI shape from the delivery and engineering core
- documented Build Web Apps scope

## Allowed / Not Allowed

| Allowed | Not allowed |
| --- | --- |
| repo scaffolding | product behavior implementation beyond bootstrap skeletons |
| CI and quality gate setup | DB schema invention without Stage 1 data work |
| package boundary enforcement | frontend-only generation before boundaries are locked |
| auth/session scaffold setup | skipping Stage 0 checks to rush product screens |

## Acceptance

- skeleton repo passes baseline lint, typecheck, build, unit, boundary, verification, and security checks
- package boundaries are enforceable, not merely documented
- Build Web Apps write scope is documented before first frontend task

## Common Failure Modes

- starting with screens before the worker, contracts, and boundaries exist
- letting `apps/web` reach directly into DB or integrations
- treating CI as follow-up instead of part of bootstrap

## Read Next

- after Stage 0: [`data-foundation-bundle.md`](./data-foundation-bundle.md)
- testing isolation reference: [`../03-reference/reference-testing-mocks.md`](../03-reference/reference-testing-mocks.md)
- deep repo details if needed: [`../03-reference/reference-donor-reuse.md`](../03-reference/reference-donor-reuse.md)
