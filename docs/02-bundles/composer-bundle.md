# Composer Bundle

**Role:** task packet for Stage 3.5 Composer work  
**Audience:** implementers working on reply, forward, send, or optimistic outbound flows  
**When to read:** before Inbox send/reply UX, Gmail send wiring, SMS send wiring, or AI draft-in-composer work  
**Authority:** derivative bundle; core truth lives in `01-core/*`  
**Last reviewed:** 2026-07-23

## Purpose

Add the shared send surface between Inbox read-only work and Stage 4 AI.

## Required Reading

1. [00-index.md](../00-index.md)
2. [product-core.md](../01-core/product-core.md)
3. [system-core.md](../01-core/system-core.md)
4. [data-core.md](../01-core/data-core.md)
5. [engineering-core.md](../01-core/engineering-core.md)
6. [frontend-patterns.md](../01-core/frontend-patterns.md)
7. [delivery-core.md](../01-core/delivery-core.md)
8. [decision-core.md](../01-core/decision-core.md)

## Locked

- Composer is its own stage (`3.5`), separate from Inbox read surfaces and Stage 4 AI
- the detail-pane reply pill, the canonical modal composer, and forward all drive one shared composer state machine
- email send uses one shared Gmail OAuth transport plus project send-as aliases from `project_aliases`; alias choice controls signature and project AI context
- forward is email-only and opens the same modal with forwarded subject/body context prefilled
- optimistic outbound UI is real product behavior: the client injects a pending timeline entry immediately, then removes it after a matching server entry appears
- `pending_composer_outbounds` is the durable send ledger for email only. Rows insert as `pending`; successful Gmail send marks them `confirmed` with `reconciledEventId=null`; later capture reconciliation fills the canonical event link; failures mark `failed`; the sweep job moves older `pending` rows to `orphaned`; `superseded` is internal replacement state
- do not document an extra client self-heal timer loop as shipped behavior; current `main` uses send-time `router.refresh()` plus optimistic/server-entry matching, not the unmerged 10s/15s/2min loop
- AI draft-in-composer is review-only: `Draft with AI` or prompt-fill produces a reviewable draft; operators may reprompt, approve, or discard before it touches the editor
- the AI review preview caps at `40vh`; the intent textarea autosizes between 2 and 6 rows
- alias signatures render from the selected alias template with operator-name substitution; per-message signature override is allowed and resettable
- attachments are email-only; sends require live file content in memory, so files added before a refresh must be reattached
- SMS send is in scope: it uses active SMS senders, enforces consent, limits body length to 320 encoded characters, and does not reuse the email attachment model

## Required Interfaces / Concepts

- reply surface from Inbox detail
- canonical modal composer with email + SMS tabs
- forward action with quoted original context
- send-as alias picker and per-alias signature handling
- optimistic outbound timeline entry state
- durable pending-outbound ledger and capture reconciliation
- AI draft window with review, reprompt, approve, discard
- SMS consent gate and sender picker
- attachment intake, removal, and send-time validation

## Allowed / Not Allowed

| Allowed                                         | Not allowed                                           |
| ----------------------------------------------- | ----------------------------------------------------- |
| one shared composer model for reply/new/forward | separate reply-only and net-new send stacks           |
| optimistic send plus durable reconciliation     | fire-and-forget sends with no durable audit trail     |
| alias-scoped signatures and AI context          | mailbox-specific one-off logic outside alias settings |
| review-only AI drafting in the composer         | AI auto-send or hidden draft insertion                |

## Acceptance

- reply sends preserve `threadId` and `inReplyToRfc822` when available
- forward sends preserve the quoted original context and infer a sensible default alias when one of ours was on the message
- successful email sends write a durable pending-outbound row, show an optimistic timeline entry immediately, and later reconcile to the captured canonical event
- failed and orphaned outbound states remain visible in the timeline until replaced or superseded
- AI draft review stays separate from final send; preview, reprompt, and approve/discard flows behave the same in email and SMS where AI is allowed
- alias signature reset restores the selected alias default, not a blank message footer
- SMS send blocks on missing consent, missing sender, or body length overflow

## Common Failure Modes

- treating Composer as just a reply textbox instead of the shared comms hub
- documenting pending-outbound lifecycle states that do not exist on `main`
- coupling AI draft state directly to send
- assuming attachments survive a refresh without reattach

## Reference Links

- composer actions: [actions.ts](../../apps/web/app/inbox/actions.ts)
- alias + sender data: [composer-data.ts](../../apps/web/app/inbox/_lib/composer-data.ts)
- forward context builder: [composer-forward.ts](../../apps/web/app/inbox/_lib/composer-forward.ts)
- send hook: [use-composer-submit.ts](../../apps/web/app/inbox/_hooks/use-composer-submit.ts)
- pending-outbound reconciliation: [normalization.ts](../../packages/domain/src/normalization.ts)
