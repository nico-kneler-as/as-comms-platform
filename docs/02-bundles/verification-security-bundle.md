# Verification And Security Bundle

**Role:** task packet for phase-close verification and security work  
**Audience:** implementers closing a stage or validating a major change  
**When to read:** before calling any stage or large milestone complete  
**Authority:** derivative bundle; core truth lives in `01-core/delivery-core.md` and `01-core/decision-core.md`

## Purpose

Close work with evidence, not optimism.

## Required Reading

1. [`../00-index.md`](../00-index.md)
2. [`../01-core/delivery-core.md`](../01-core/delivery-core.md)
3. [`../01-core/decision-core.md`](../01-core/decision-core.md)

## Required Loop

1. requirement check
2. CI quality gates
3. automated verification
4. manual/UAT validation
5. contradiction review
6. security review
7. evidence and doc update

## Required Artifacts

- implementation summary
- automated verification commands and results
- manual/UAT scenarios and outcomes
- contradiction-resolution note
- security delta summary
- acceptance/evidence update

## Stop-Ship / Stop-Close Rules

Do not close work if:

- a locked requirement is still undefined
- current behavior contradicts the canon
- security stop-ship findings remain open
- proof exists only in historical notes
- known failures are hidden

## CI Expectations

- lint
- typecheck
- build
- unit tests
- integration tests where applicable
- E2E tests where applicable
- boundary checks
- performance checks where web hot paths are touched
- verification gate
- security gate

## Common Failure Modes

- treating green unit tests as sufficient proof
- skipping contradiction review because “the code works”
- forgetting to update evidence when behavior changes
- closing work while high-risk security findings are still open

## Read Next

- testing isolation reference: [`../03-reference/reference-testing-mocks.md`](../03-reference/reference-testing-mocks.md)
- full donor reference if needed: [`../03-reference/reference-legacy-conflicts.md`](../03-reference/reference-legacy-conflicts.md)
