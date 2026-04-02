# Post-Stage-1 Backend Validation Roadmap

**Role:** forward-looking backend validation roadmap after Stage 1 launch-scope acceptance  
**Audience:** implementers and operators planning the next backend-only validation passes  
**When to read:** after Stage 1 acceptance is met and before reopening Stage 1 backend validation work  
**Authority:** execution-order note under the current canon; it does not replace [docs/stage-1-acceptance.md](./stage-1-acceptance.md) or [docs/stage-1-validation-runbook.md](./stage-1-validation-runbook.md)

## Purpose

- keep Stage 1 launch-scope acceptance and runbook as the historical record for the narrowed Gmail + Salesforce pass
- define the next backend-only validation milestones without widening Stage 1 into a larger retrospective scope
- keep follow-on validation aligned with the fixed stage order in [docs/01-core/delivery-core.md](./01-core/delivery-core.md)

These `1B`, `1C`, and `1D` labels are follow-on validation milestones inside Stage 1 delivery closure. They are not new product stages and they do not replace the locked stage order in the delivery canon.

## Why Stage 1 Is Considered Complete

For roadmap purposes, treat Stage 1 backend validation as complete because the narrowed launch-scope goals are now met:

- Gmail and Salesforce historical and live paths have been validated under the single normalization path
- Gmail live passed end to end, including persisted source evidence and alias-preserving live capture on `volunteers@adventurescientists.org`
- Salesforce live passed in Railway production with a succeeded provider-scoped `live_ingest` sync-state result
- replay, rebuild, parity, and cutover-support paths remain part of the validated backend surface

See [docs/stage-1-acceptance.md](./stage-1-acceptance.md), [docs/stage-1-runtime.md](./stage-1-runtime.md), and [docs/stage-1-validation-runbook.md](./stage-1-validation-runbook.md) for the launch-scope definitions and historical validation sequence.

## Recommended Execution Order

1. complete Stage `1B` first to tighten trust in the current Gmail + Salesforce story and projection surface
2. complete Stage `1C` next to validate deferred Stage 1 providers without widening into frontend or product-stage work
3. complete Stage `1D` last as the final backend confidence pass across all four providers before broader product work resumes

## Stage 1B

### Purpose

Prove that one Salesforce-anchored contact can be explained cleanly across Gmail + Salesforce canonical history, projections, and review overlays before adding more providers.

### Scope

- one-contact merged story across Gmail + Salesforce
- timeline projection explainability and deterministic ordering
- Inbox `New` and `Opened` semantics
- unresolved and review-overlay visibility
- replay and rebuild trust for the inspected contact set

### Non-goals

- no new provider activation
- no frontend or operator-UX work
- no Gmail alias redesign or Salesforce mapping expansion
- no speculative changes to Inbox semantics beyond the current canon

### Exit Criteria

- at least one representative Salesforce-anchored contact is inspected end to end
- Gmail and Salesforce canonical events can be traced back to source evidence and forward to timeline and Inbox projections
- `New` and `Opened` behavior matches [docs/01-core/decision-core.md](./01-core/decision-core.md) and [docs/04-implementation-specs/stage-1-projection-rules.md](./04-implementation-specs/stage-1-projection-rules.md)
- unresolved identity or routing state is visible as an explicit overlay, not hidden in projection output
- replay and projection rebuild reproduce the same visible result without duplicate canonical events or unexplained drift

### Evidence That Counts As Success

- `ops:inspect -- contact` output for the representative contact set
- `ops:inspect -- source-evidence` spot checks for Gmail and Salesforce records that appear in the merged story
- replay and projection-rebuild results for the same contact set
- short written evidence showing why the visible timeline and Inbox rows are explainable from canonical state

## Stage 1C

### Purpose

Validate the deferred Stage 1 backend paths for SimpleTexting and Mailchimp without widening into frontend, campaigns-product, or operator workflow work.

### Scope

- provider runtime and capture-port validation for SimpleTexting and Mailchimp
- worker preflight, enqueue, sync-state inspection, and persisted-evidence checks
- `capture -> provider-close mapping -> normalized DTOs -> normalization service -> persistence/projections`
- provider-specific edge cases already locked in the Stage 1 ingest canon

### Non-goals

- no frontend validation
- no campaign authoring, approval, or product-webhook work
- no Gmail or Salesforce redesign or broad revalidation unless a direct duplicate-collapse or routing dependency is exposed
- no widening beyond the Stage 1 event taxonomy and provider ingest matrix

### Exit Criteria

- SimpleTexting backend validation proves historical and live one-to-one SMS/MMS plus compliance events through the shared normalization path
- Mailchimp backend validation proves historical and transition-period campaign ingest through the shared normalization path
- provider-specific tie-break and review rules remain intact:
  - SimpleTexting stays primary for official SMS transport and compliance events
  - Mailchimp campaign events stay distinct from one-to-one email events
  - ambiguous email or phone matches open review instead of silently linking
- provider-scoped sync state is succeeded, empty-but-explicit, or otherwise clearly non-failed for the validated job windows
- source evidence, canonical events, and projections stay replay-safe for representative provider records

### Evidence That Counts As Success

- worker preflight output showing the additional provider configuration is loaded cleanly
- provider health and runtime logs without auth or boot failures
- enqueue and sync inspection results for:
  - `stage1.simpletexting.capture.historical`
  - `stage1.simpletexting.capture.live`
  - `stage1.mailchimp.capture.historical`
  - `stage1.mailchimp.capture.transition`
- contact or source-evidence inspections proving representative SimpleTexting and Mailchimp records persisted through the expected backend path

## Stage 1D

### Purpose

Run one final cross-provider backend confidence pass in the same style as Stage 1B, but now including Gmail, Salesforce, SimpleTexting, and Mailchimp together.

### Scope

- one-contact or small-contact-set merged story across all validated Stage 1 providers
- timeline explainability across one-to-one email, one-to-one SMS, lifecycle, and campaign-event history
- Inbox bucket semantics and unresolved overlays with all four providers enabled
- replay, rebuild, parity, and cutover-support trust after the deferred providers are added

### Non-goals

- no frontend or operator tooling work
- no new provider onboarding beyond Gmail, Salesforce, SimpleTexting, and Mailchimp
- no Stage 2, Inbox-stage, or Campaigns-stage product expansion

### Exit Criteria

- representative merged stories are explainable across Gmail, Salesforce, SimpleTexting, and Mailchimp evidence
- Inbox behavior still follows the locked projection rules:
  - one-to-one email and SMS can drive Inbox rows
  - lifecycle and `campaign.email.*` events remain timeline-only where canon says they should
- unresolved and review overlays remain explicit and auditable
- replay and rebuild remain deterministic for multi-provider contacts
- parity and cutover-support outputs remain understandable and actionable after all four providers are in scope

### Evidence That Counts As Success

- contact inspections for representative multi-provider contacts
- source-evidence spot checks from all four providers
- replay, rebuild, parity, and cutover-support audit evidence for the final validated sample set
- sync-state summaries showing the expected provider windows completed without hidden failures

## Stop Conditions

Do not call any of these follow-on stages complete if:

- validation depends on frontend interpretation instead of backend evidence
- a provider needs a new mapping family or taxonomy not already allowed by the canon
- replay or rebuild changes visible results without an explicit, understood cause
- unresolved review state is hidden instead of surfaced in inspectable evidence
- known defects are summarized as roadmap progress instead of being recorded as defects
