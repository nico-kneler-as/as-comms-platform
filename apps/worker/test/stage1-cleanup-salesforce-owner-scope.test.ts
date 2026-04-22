import { describe, expect, it } from "vitest";

import {
  planSalesforceOwnerScopeCleanup,
  type SalesforceOwnerScopeCleanupCandidate,
} from "../src/ops/cleanup-salesforce-owner-scope.js";

describe("cleanup-salesforce-owner-scope planning", () => {
  it("removes only positively resolved non-Nim Admin Salesforce email rows", () => {
    const candidates: SalesforceOwnerScopeCleanupCandidate[] = [
      {
        canonicalEventId: "evt:nim-admin",
        contactId: "contact:1",
        sourceEvidenceId: "sev:nim-admin",
        providerRecordId: "00T-nim-admin",
        subject: "Application received",
      },
      {
        canonicalEventId: "evt:human-owner",
        contactId: "contact:2",
        sourceEvidenceId: "sev:human-owner",
        providerRecordId: "00T-human-owner",
        subject: "Re: Let’s meet!",
      },
      {
        canonicalEventId: "evt:unresolved",
        contactId: "contact:3",
        sourceEvidenceId: "sev:unresolved",
        providerRecordId: "00T-unresolved",
        subject: "Historical task",
      },
    ];

    const plan = planSalesforceOwnerScopeCleanup({
      candidates,
      ownerUsernameByTaskId: new Map([
        ["00T-nim-admin", "admin+1@adventurescientists.org"],
        ["00T-human-owner", "ricky@adventurescientists.org"],
      ]),
    });

    expect(plan).toMatchObject({
      scannedCount: 3,
      resolvedCount: 2,
      keepCount: 1,
      removeCount: 1,
      unresolvedCount: 1,
      affectedContactIds: ["contact:2"],
      unresolvedProviderRecordIds: ["00T-unresolved"],
    });
    expect(plan.changes).toEqual([
      expect.objectContaining({
        canonicalEventId: "evt:human-owner",
        contactId: "contact:2",
        providerRecordId: "00T-human-owner",
        ownerUsername: "ricky@adventurescientists.org",
        removalReason: "non_nim_admin_owner",
      }),
    ]);
  });

  it("can explicitly include unresolved Salesforce email rows for removal", () => {
    const candidates: SalesforceOwnerScopeCleanupCandidate[] = [
      {
        canonicalEventId: "evt:nim-admin",
        contactId: "contact:1",
        sourceEvidenceId: "sev:nim-admin",
        providerRecordId: "00T-nim-admin",
        subject: "Application received",
      },
      {
        canonicalEventId: "evt:unresolved",
        contactId: "contact:3",
        sourceEvidenceId: "sev:unresolved",
        providerRecordId: "00T-unresolved",
        subject: "Historical task",
      },
    ];

    const plan = planSalesforceOwnerScopeCleanup({
      candidates,
      ownerUsernameByTaskId: new Map([
        ["00T-nim-admin", "admin+1@adventurescientists.org"],
      ]),
      includeUnresolved: true,
    });

    expect(plan).toMatchObject({
      scannedCount: 2,
      resolvedCount: 1,
      keepCount: 1,
      removeCount: 1,
      unresolvedCount: 1,
      affectedContactIds: ["contact:3"],
      unresolvedProviderRecordIds: ["00T-unresolved"],
    });
    expect(plan.changes).toEqual([
      expect.objectContaining({
        canonicalEventId: "evt:unresolved",
        contactId: "contact:3",
        providerRecordId: "00T-unresolved",
        ownerUsername: null,
        removalReason: "unresolved_owner",
      }),
    ]);
  });
});
