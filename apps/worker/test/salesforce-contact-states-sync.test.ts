import { describe, expect, it, vi } from "vitest";

import { createSalesforceContactStatesSyncTask } from "../src/jobs/salesforce-contact-states-sync.js";

const snapshot = {
  rows: [{
    salesforceContactId: "003-contact",
    email: "Person@Example.org",
    rawState: "Montana",
    hasOptedOutOfEmail: true,
    lastModifiedAt: "2026-11-06T12:00:00.000Z",
  }],
  capturedAt: "2026-11-06T12:01:00.000Z",
};

describe("salesforce-contact-states-sync", () => {
  it("stores normalized rows and logs coverage counts", async () => {
    const replaceAll = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), error: vi.fn() };
    const task = createSalesforceContactStatesSyncTask({
      capture: { captureContactStates: vi.fn().mockResolvedValue(snapshot) },
      repository: { replaceAll, findByEmails: vi.fn(), listOptedOutEmails: vi.fn(), lastSyncedAt: vi.fn(), countAll: vi.fn() },
      logger,
    });

    await task({ version: 1 }, {} as never);

    expect(replaceAll).toHaveBeenCalledWith(
      [expect.objectContaining({ normalizedEmail: "person@example.org", stateCode: "MT", hasOptedOutOfEmail: true })],
      new Date(snapshot.capturedAt),
    );
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("with_state_code"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("with_opt_out"));
  });

  it("rethrows capture failures without replacing the snapshot", async () => {
    const replaceAll = vi.fn();
    const task = createSalesforceContactStatesSyncTask({
      capture: { captureContactStates: vi.fn().mockRejectedValue(new Error("403 access denied")) },
      repository: { replaceAll, findByEmails: vi.fn(), listOptedOutEmails: vi.fn(), lastSyncedAt: vi.fn(), countAll: vi.fn() },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    await expect(task({ version: 1 }, {} as never)).rejects.toThrow("403 access denied");
    expect(replaceAll).not.toHaveBeenCalled();
  });
});
