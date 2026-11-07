import { describe, expect, it, vi } from "vitest";

import { createSalesforceProjectBoxesSyncTask } from "../src/jobs/salesforce-project-boxes-sync.js";

describe("salesforce-project-boxes-sync", () => {
  it("replaces the snapshot and logs non-PII counts", async () => {
    const replaceProjectSubscriptionBoxes = vi.fn().mockResolvedValue({
      updated: 1,
      cleared: 2,
      unknownProjectIds: ["missing"],
    });
    const logger = { info: vi.fn(), error: vi.fn() };
    const task = createSalesforceProjectBoxesSyncTask({
      capture: {
        captureProjectSubscriptionBoxes: vi.fn().mockResolvedValue({
          rows: [
            { projectId: "known", subscriptionBox: "PNW Forest Monitoring" },
            { projectId: "unknown-box", subscriptionBox: "Unexpected Box" },
          ],
          capturedAt: "2026-11-07T12:00:00.000Z",
        }),
      },
      repository: { replaceProjectSubscriptionBoxes },
      logger,
    });

    await task({ version: 1 }, {} as never);

    expect(replaceProjectSubscriptionBoxes).toHaveBeenCalledWith(
      expect.any(Array),
      new Date("2026-11-07T12:00:00.000Z"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('unknown_box_values":1'),
    );
  });

  it("logs a truncated error and rethrows", async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const task = createSalesforceProjectBoxesSyncTask({
      capture: {
        captureProjectSubscriptionBoxes: vi
          .fn()
          .mockRejectedValue(new Error("x".repeat(600))),
      },
      repository: { replaceProjectSubscriptionBoxes: vi.fn() },
      logger,
    });
    await expect(task({ version: 1 }, {} as never)).rejects.toThrow();
    expect(logger.error.mock.calls[0]?.[0]).toContain("…");
  });
});
