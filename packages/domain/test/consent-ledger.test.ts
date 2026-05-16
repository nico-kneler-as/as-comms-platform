import { describe, expect, it } from "vitest";

import type { ContactConsentRecord } from "@as-comms/contracts";

import { createConsentLedger } from "../src/consent-ledger.js";

function createHarness() {
  const records = new Map<string, ContactConsentRecord>();

  const ledger = createConsentLedger({
    repositories: {
      contactConsent: {
        recordOptOut(contactId, scope, source, sourceRunId) {
          const key = `${contactId}:${scope.type}:${scope.id ?? "*"}`;
          const existing = records.get(key);
          const optedOutAt =
            existing?.optedOutAt ?? "2026-05-15T12:00:00.000Z";
          const createdAt = existing?.createdAt ?? optedOutAt;
          records.set(key, {
            id: existing?.id ?? key,
            contactId,
            scopeType: scope.type,
            scopeId: scope.type === "project" ? (scope.id ?? null) : null,
            source,
            sourceRunId: sourceRunId ?? null,
            optedOutAt,
            createdAt,
          });
          return Promise.resolve();
        },
        listForContact(contactId) {
          return Promise.resolve([...records.values()].filter(
            (record) => record.contactId === contactId,
          ));
        },
      },
    },
  });

  return { ledger, records };
}

describe("createConsentLedger", () => {
  it("writes each scope type correctly", async () => {
    const { ledger, records } = createHarness();

    await ledger.recordOptOut({
      contactId: "contact-1",
      scope: { type: "project", id: "project-a" },
      source: "recipient_click",
      sourceRunId: "run-project",
    });
    await ledger.recordOptOut({
      contactId: "contact-1",
      scope: { type: "newsletter" },
      source: "admin_action",
    });
    await ledger.recordOptOut({
      contactId: "contact-1",
      scope: { type: "all" },
      source: "import",
    });

    expect([...records.values()]).toEqual([
      expect.objectContaining({
        contactId: "contact-1",
        scopeType: "project",
        scopeId: "project-a",
        source: "recipient_click",
        sourceRunId: "run-project",
      }),
      expect.objectContaining({
        contactId: "contact-1",
        scopeType: "newsletter",
        scopeId: null,
        source: "admin_action",
      }),
      expect.objectContaining({
        contactId: "contact-1",
        scopeType: "all",
        scopeId: null,
        source: "import",
      }),
    ]);
  });

  it("is idempotent when the same scope is recorded twice", async () => {
    const { ledger, records } = createHarness();

    await ledger.recordOptOut({
      contactId: "contact-1",
      scope: { type: "project", id: "project-a" },
      source: "recipient_click",
    });
    await ledger.recordOptOut({
      contactId: "contact-1",
      scope: { type: "project", id: "project-a" },
      source: "recipient_click",
    });

    expect(records.size).toBe(1);
    await expect(
      ledger.listForContact("contact-1"),
    ).resolves.toHaveLength(1);
  });

  it("applies scope precedence so all blocks project queries", async () => {
    const { ledger } = createHarness();

    await ledger.recordOptOut({
      contactId: "contact-1",
      scope: { type: "all" },
      source: "provider_event",
    });

    await expect(
      ledger.isConsentedFor(
        "contact-1",
        { type: "project", id: "project-a" },
        new Date("2026-05-16T00:00:00.000Z"),
      ),
    ).resolves.toBe(false);
    await expect(
      ledger.isConsentedFor(
        "contact-1",
        { type: "newsletter" },
        new Date("2026-05-16T00:00:00.000Z"),
      ),
    ).resolves.toBe(false);
  });
});
