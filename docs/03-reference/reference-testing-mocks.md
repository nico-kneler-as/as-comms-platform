# Reference Testing Mocks

**Role:** compact testing-isolation reference for repo-wide unit, integration, and E2E work  
**Audience:** implementers writing Vitest or Playwright coverage for web, worker, or integrations  
**When to read:** when creating adapter tests, worker tests, UI tests, or CI-safe fixtures  
**Authority:** reference-only; core truth lives in `01-core/engineering-core.md` and `01-core/frontend-patterns.md`

## Summary

- Dependency injection through adapter interfaces is the default testing strategy.
- Unit and integration tests use fakes or stubs, not live provider APIs.
- Playwright uses seeded app state or a seeded test backend.
- CI never hits real Salesforce, Gmail, or SimpleTexting APIs.

## Default Pattern

| Layer | Standard approach |
| --- | --- |
| provider adapters | define interfaces in shared contracts or domain boundaries |
| unit tests | inject fake adapters directly |
| worker tests | construct worker services with fake adapters and in-memory/test DB dependencies |
| web integration tests | hit local Route Handlers or Server Actions backed by fake adapters |
| Playwright | run against seeded local/test environment with fake or test-only provider implementations |

## Example Adapter Pattern

```ts
export interface SalesforceAdapter {
  upsertContact(payload: SalesforceContactUpsert): Promise<{ contactId: string }>;
  fetchMemberships(contactId: string): Promise<SalesforceMembership[]>;
}

export class FakeSalesforceAdapter implements SalesforceAdapter {
  constructor(private readonly fixtures: FakeSalesforceFixtures) {}

  async upsertContact(payload: SalesforceContactUpsert) {
    return { contactId: this.fixtures.contactIds[payload.email] ?? "sf-test-1" };
  }

  async fetchMemberships(contactId: string) {
    return this.fixtures.memberships[contactId] ?? [];
  }
}
```

## Provider Fake Conventions

| Provider | Fake pattern |
| --- | --- |
| Salesforce | deterministic IDs, memberships, and routing outcomes from fixtures |
| Gmail | deterministic message/thread fixtures and send-result stubs without remote transport |
| SimpleTexting | deterministic inbound/outbound message fixtures, compliance events, and delivery outcomes |

## Compact Provider Examples

```ts
export class FakeGmailAdapter implements GmailAdapter {
  constructor(private readonly fixtures: FakeGmailFixtures) {}

  async listMessages(contactId: string) {
    return this.fixtures.messagesByContact[contactId] ?? [];
  }

  async sendMessage(input: GmailSendInput) {
    return { providerMessageId: input.draftId ?? "gmail-test-1" };
  }
}

export class FakeSimpleTextingAdapter implements SimpleTextingAdapter {
  constructor(private readonly fixtures: FakeSimpleTextingFixtures) {}

  async listMessages(contactId: string) {
    return this.fixtures.messagesByContact[contactId] ?? [];
  }

  async sendMessage(input: SimpleTextingSendInput) {
    return { providerMessageId: input.idempotencyKey ?? "st-test-1" };
  }
}
```

## Worker Injection Pattern

```ts
const workerDeps = {
  salesforce: new FakeSalesforceAdapter(fixtures.salesforce),
  gmail: new FakeGmailAdapter(fixtures.gmail),
  simpleTexting: new FakeSimpleTextingAdapter(fixtures.simpleTexting),
  db: testDb,
  clock: fakeClock,
};

const service = buildWorkerServices(workerDeps);
```

## UI And E2E Wiring Pattern

- Seed canonical contacts, projections, and review queues through test helpers or seed scripts.
- Prefer fake adapters behind the same app container the UI uses.
- Use Playwright against local or preview environments configured for test adapters only.
- Use network-layer mocking only for browser-only edges that cannot reasonably be injected lower in the stack.

## Allowed / Not Allowed

| Allowed | Not allowed |
| --- | --- |
| fake adapters and deterministic fixtures | live provider credentials in CI |
| seeded local/test environments for Playwright | E2E tests that depend on external provider availability |
| one shared fixture vocabulary across worker and UI tests | mocking different provider behavior in every test file |
| selective network mocking as a secondary technique | treating MSW or fetch interception as the primary isolation layer |

## Common Failure Modes

- testing worker logic by stubbing HTTP calls instead of injecting adapters
- allowing Playwright to depend on real provider sandboxes
- using fixtures that cannot represent duplicate delivery, retries, or ambiguity cases
- letting fake adapters drift from the locked contract names in `interfaces-core.md`

## Deep References

- engineering rules: [`../01-core/engineering-core.md`](../01-core/engineering-core.md)
- web mutation and error rules: [`../01-core/frontend-patterns.md`](../01-core/frontend-patterns.md)
- donor/full testing context: [`../../restart-prd/quality-gates.md`](../../restart-prd/quality-gates.md)
