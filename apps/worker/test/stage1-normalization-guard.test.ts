import { describe, expect, it } from "vitest";

import { createTestWorkerContext } from "./helpers.js";

describe("Stage 1 normalization contact graph safeguards", () => {
  it("rejects Salesforce-anchored contacts without memberships while still allowing non-Salesforce contacts", async () => {
    const context = await createTestWorkerContext();

    try {
      await expect(
        context.normalization.upsertNormalizedContactGraph({
          contact: {
            id: "contact:salesforce:003-non-volunteer",
            salesforceContactId: "003-non-volunteer",
            displayName: "Non Volunteer Contact",
            primaryEmail: "donor@example.org",
            primaryPhone: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          },
          identities: [
            {
              id: "identity:contact:salesforce:003-non-volunteer:salesforce",
              contactId: "contact:salesforce:003-non-volunteer",
              kind: "salesforce_contact_id",
              normalizedValue: "003-non-volunteer",
              isPrimary: true,
              source: "salesforce",
              verifiedAt: "2026-01-01T00:00:00.000Z"
            }
          ],
          memberships: []
        })
      ).rejects.toThrow(
        "Salesforce contact 003-non-volunteer is missing expedition memberships and cannot be upserted into the Stage 1 volunteer contact graph."
      );

      const nonSalesforceResult =
        await context.normalization.upsertNormalizedContactGraph({
          contact: {
            id: "contact:email:external-partner@example.org",
            salesforceContactId: null,
            displayName: "External Partner",
            primaryEmail: "external-partner@example.org",
            primaryPhone: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          },
          identities: [
            {
              id: "identity:contact:email:external-partner@example.org:email",
              contactId: "contact:email:external-partner@example.org",
              kind: "email",
              normalizedValue: "external-partner@example.org",
              isPrimary: true,
              source: "gmail",
              verifiedAt: "2026-01-01T00:00:00.000Z"
            }
          ],
          memberships: []
        });

      expect(nonSalesforceResult.contact.id).toBe(
        "contact:email:external-partner@example.org"
      );
      await expect(context.repositories.contacts.listAll()).resolves.toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });
});
