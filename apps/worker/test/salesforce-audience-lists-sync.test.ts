import { describe, expect, it, vi } from "vitest";

import type { SalesforceAudienceListsSnapshot } from "@as-comms/contracts";

import { createSalesforceAudienceListsSyncTask } from "../src/jobs/salesforce-audience-lists-sync.js";

const validSnapshot: SalesforceAudienceListsSnapshot = {
  campaigns: [{
    id: "701-campaign", name: "Giving Tuesday", campaignType: "Email",
    campaignStatus: "Planned", isActive: true, startDate: null, endDate: null,
    createdDate: "2026-01-01T00:00:00.000Z",
    lastModifiedDate: "2026-10-14T10:00:00.000Z",
    ownerName: "Devynn", numberOfContacts: 1, numberOfLeads: 0,
  }],
  members: [{
    campaignId: "701-campaign", contactId: "003-contact", leadId: null,
    email: "member@example.org", status: "Sent",
  }],
  insiders: [],
  capturedAt: "2026-10-14T12:00:00.000Z",
};

describe("salesforce-audience-lists-sync", () => {
  it("writes a validated capture snapshot", async () => {
    const replaceSnapshot = vi.fn().mockResolvedValue(undefined);
    const task = createSalesforceAudienceListsSyncTask({
      capture: { captureAudienceLists: vi.fn().mockResolvedValue(validSnapshot) },
      repository: {
        replaceSnapshot,
        listAll: vi.fn(), emailsForLists: vi.fn(), lastSyncedAt: vi.fn(),
      },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await task({ version: 1 }, {} as never);

    expect(replaceSnapshot).toHaveBeenCalledWith(validSnapshot);
  });

  it("logs capture failures without replacing the prior snapshot", async () => {
    const replaceSnapshot = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };
    const task = createSalesforceAudienceListsSyncTask({
      capture: { captureAudienceLists: vi.fn().mockRejectedValue(new Error("403 access denied")) },
      repository: {
        replaceSnapshot,
        listAll: vi.fn(), emailsForLists: vi.fn(), lastSyncedAt: vi.fn(),
      },
      logger,
    });

    await expect(task({ version: 1 }, {} as never)).rejects.toThrow("403 access denied");
    expect(replaceSnapshot).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("sync.failed"));
  });

  it("logs response-contract failures without replacing the prior snapshot", async () => {
    const replaceSnapshot = vi.fn();
    const task = createSalesforceAudienceListsSyncTask({
      capture: { captureAudienceLists: vi.fn().mockResolvedValue({ campaigns: "not-an-array" }) },
      repository: {
        replaceSnapshot,
        listAll: vi.fn(), emailsForLists: vi.fn(), lastSyncedAt: vi.fn(),
      },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await expect(task({ version: 1 }, {} as never)).rejects.toThrow();
    expect(replaceSnapshot).not.toHaveBeenCalled();
  });
});
