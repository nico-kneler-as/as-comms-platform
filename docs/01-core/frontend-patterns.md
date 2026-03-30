# Frontend Patterns

**Role:** App Router mutation, fetching, caching, and UI error contract canon  
**Audience:** implementers touching `apps/web`, Server Actions, Route Handlers, or interactive views  
**When to read:** before building routes, forms, polling, cache invalidation, or UI error states  
**Authority:** authoritative for Next.js App Router interaction patterns in the restart repo  
**Decides:** how the web app fetches, mutates, revalidates, and exposes safe errors  
**Does not decide:** product field semantics, worker internals, or provider adapter details

## Summary

- Server Components are the default read path; Client Components are interactive islands only.
- Server Actions are the default mutation path for authenticated first-party product workflows.
- Route Handlers exist for webhooks, external/programmatic endpoints, and non-form or streaming cases.
- Inbox-like views refresh through targeted tag revalidation plus lightweight active-view polling fallback.

## Locked

| ID | Locked choice |
| --- | --- |
| `FP-01` | Server Components fetch initial page data. |
| `FP-02` | Client Components receive minimized view models, not full canonical records. |
| `FP-03` | Server Actions are the default for authenticated product mutations. |
| `FP-04` | Route Handlers handle webhooks, external/system callers, file/stream cases, and machine-facing APIs. |
| `FP-05` | Cache invalidation uses `revalidateTag` first, not full-page reloads. |
| `FP-06` | Active Inbox-like views use lightweight polling fallback to cover worker/webhook lag or missed invalidation. |
| `FP-07` | UI-facing errors use one safe envelope; provider details, secrets, and PII never go to the browser. |

## Read And Render Pattern

| Surface | Standard pattern |
| --- | --- |
| page and layout reads | Server Component fetch with parallel reads and explicit Suspense boundaries |
| interactive filters/search/sort | Client island with `startTransition` and `useDeferredValue` where derivation is expensive |
| forms and operator mutations | authenticated Server Action returning a normalized result envelope |
| webhook-driven updates | Route Handler or worker updates durable state, then triggers targeted revalidation |
| large Inbox/timeline views | paginated reads plus virtualization or `content-visibility` as needed |

## Cache Tag Contract

| Tag | Use for |
| --- | --- |
| `inbox` | top-level Inbox list shell |
| `inbox:contact:{contactId}` | row-level contact Inbox refresh |
| `timeline:contact:{contactId}` | per-contact timeline refresh |
| `settings` | settings/admin reads |
| `ai:contact:{contactId}` | grounded draft, feedback, or memory-related views |
| `campaigns` | campaign list and summary views |
| `campaign:{campaignId}` | individual campaign detail and monitoring views |

## Revalidation And Polling Pattern

- A successful Server Action must revalidate the narrowest affected tags before returning.
- A webhook or worker-triggered durable change must call a protected internal revalidation endpoint in `apps/web`, and that endpoint must call `revalidateTag` for the affected tags.
- Inbox-like client views should poll a lightweight freshness endpoint only while visible and only for the active view.
- Default polling should be modest, such as every `30-60s`, and must pause when the tab is hidden.
- Polling is a resilience fallback, not the primary consistency mechanism.

## Safe Error Envelope

```ts
type UiSuccess<T> = {
  ok: true;
  data: T;
  requestId: string;
};

type UiError = {
  ok: false;
  code: string;
  message: string;
  requestId: string;
  fieldErrors?: Record<string, string>;
  retryable?: boolean;
};
```

### Error contract rules

- `message` is safe for operator display and must not contain raw provider payloads, secrets, stack traces, or unnecessary PII.
- `code` is stable and machine-readable.
- `requestId` is always log-correlated.
- `fieldErrors` are optional and only for safe validation feedback.
- Raw provider responses and internal exception details stay server-side in logs and audit evidence.

## Mutation Result Handling

| Mutation path | Standard result |
| --- | --- |
| Server Action | returns normalized `UiSuccess` / `UiError`; do not surface raw thrown errors in the client UI |
| Route Handler | returns JSON using the same envelope shape for machine-facing or client-consumed endpoints |
| optimistic UI | allowed only for local affordances; final state must reconcile with server truth after revalidation |

## Allowed / Not Allowed

| Allowed | Not allowed |
| --- | --- |
| Server Components by default | client-side primary data fetching for canonical Inbox or timeline truth |
| thin authenticated Server Actions for first-party mutations | using Route Handlers as the default mutation surface for internal forms |
| narrow tag revalidation and active-view polling fallback | full-page reloads to reflect webhook updates |
| safe error envelopes with correlation IDs | sending stack traces, provider errors, or raw payload content to the browser |
| minimized serialized view models | passing whole canonical records into client components “for convenience” |

## Read Next

- stack and repo guardrails: [`engineering-core.md`](./engineering-core.md)
- contract surface for projections and queues: [`interfaces-core.md`](./interfaces-core.md)
- Inbox implementation packet: [`../02-bundles/inbox-bundle.md`](../02-bundles/inbox-bundle.md)
