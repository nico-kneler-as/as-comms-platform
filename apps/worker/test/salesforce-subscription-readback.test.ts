import { describe, expect, it, vi } from "vitest";

import { createSalesforceSubscriptionReadbackTask } from "../src/jobs/salesforce-subscription-readback.js";

const row = {
  salesforceRecordId: "esp-1",
  email: "person@example.org",
  salesforceContactId: "sf-1",
  generalNewsletter: true,
  oregonShoresNewsletter: false,
  projectBoxes: {
    "PNW Forest Monitoring": false,
    "Beech and Butternut": false,
    "Tracking Whitebark Pine": false,
    "Coral Reef Expansion": false,
    "Monitoring Killer Whales Project": false,
  },
  unsubscribedFromAll: false,
  unsubscribedAt: null,
  emailBounced: false,
  recordCreationSource: null,
  isDeleted: false,
  lastModifiedAt: "2026-11-07T12:00:00.000Z",
  lastModifiedById: null,
  lastModifiedByUsername: "staff@example.org",
};

function dependencies(mode: "dry_run" | "apply") {
  return {
    mode,
    integrationUsername: "integration@example.org",
    formsUsernames: [],
    capture: {
      captureSubscriptionPreferences: vi.fn().mockResolvedValue({
        rows: [row],
        capturedAt: "2026-11-07T12:01:00.000Z",
        droppedRows: 0,
      }),
    },
    repository: {
      countMirror: vi.fn().mockResolvedValue(0),
      maxMirrorModifiedAt: vi.fn(),
      loadMirror: vi.fn().mockResolvedValue(new Map()),
      loadContacts: vi
        .fn()
        .mockResolvedValue(new Map([["esp-1", ["contact-1"]]])),
      loadProjectsByBox: vi.fn().mockResolvedValue(new Map()),
      loadPlatformState: vi.fn().mockResolvedValue({
        consentsByContact: new Map(),
        newsletterSubscribersByEmail: new Map(),
        newsletterSuppressionsByEmail: new Map(),
        suppressionEmails: new Set(),
      }),
      persistBatch: vi.fn().mockResolvedValue(undefined),
      recordSuccessfulRefresh: vi.fn().mockResolvedValue(undefined),
    },
    logger: { info: vi.fn(), error: vi.fn() },
  };
}

describe("salesforce-subscription-readback", () => {
  it("baselines without events in dry-run mode and emits PII-free counts", async () => {
    const input = dependencies("dry_run");
    await createSalesforceSubscriptionReadbackTask(input)({}, {} as never);
    expect(input.repository.persistBatch).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "dry_run", events: [] }),
    );
    expect(input.logger.info.mock.calls[0]?.[0]).not.toContain("@");
    expect(input.repository.loadContacts).not.toHaveBeenCalled();
    expect(input.repository.loadProjectsByBox).not.toHaveBeenCalled();
    expect(input.repository.loadPlatformState).not.toHaveBeenCalled();
    expect(input.repository.recordSuccessfulRefresh).toHaveBeenCalledWith(
      expect.any(Date),
    );
  });

  it("uses the five minute overlap after a baseline", async () => {
    const input = dependencies("apply");
    input.repository.countMirror.mockResolvedValue(1);
    input.repository.maxMirrorModifiedAt.mockResolvedValue(
      new Date("2026-11-07T12:00:00.000Z"),
    );
    await createSalesforceSubscriptionReadbackTask(input)({}, {} as never);
    expect(input.capture.captureSubscriptionPreferences).toHaveBeenCalledWith({
      version: 1,
      since: "2026-11-07T11:55:00.000Z",
    });
  });

  it("chunks non-baseline persistence and keeps each chunk's events", async () => {
    const input = dependencies("apply");
    input.repository.countMirror.mockResolvedValue(1);
    input.repository.maxMirrorModifiedAt.mockResolvedValue(
      new Date("2026-11-07T12:00:00.000Z"),
    );
    const rows = Array.from({ length: 450 }, (_, index) => ({
      ...row,
      salesforceRecordId: `esp-${String(index)}`,
      email: `person-${String(index)}@example.org`,
      generalNewsletter: true,
    }));
    input.capture.captureSubscriptionPreferences.mockResolvedValue({
      rows,
      capturedAt: "2026-11-07T12:01:00.000Z",
      droppedRows: 0,
    });
    input.repository.loadMirror.mockResolvedValue(new Map());
    input.repository.loadContacts.mockResolvedValue(
      new Map(rows.map((value) => [value.salesforceRecordId, ["contact-1"]])),
    );
    await createSalesforceSubscriptionReadbackTask(input)({}, {} as never);
    expect(input.capture.captureSubscriptionPreferences).toHaveBeenCalledWith({
      version: 1,
      since: "2026-11-07T11:55:00.000Z",
    });
    const batches = (
      input.repository.persistBatch.mock.calls as unknown as [
        {
          readonly mirrorUpserts: readonly { salesforceRecordId: string }[];
          readonly events: readonly { salesforceRecordId: string }[];
        },
      ][]
    ).map(([batch]) => batch);
    expect(batches.map((batch) => batch.mirrorUpserts.length)).toEqual([
      200, 200, 50,
    ]);
    for (const batch of batches) {
      const ids = new Set(
        batch.mirrorUpserts.map((value) => value.salesforceRecordId),
      );
      expect(
        batch.events.every((value) => ids.has(value.salesforceRecordId)),
      ).toBe(true);
    }
  });

  it("logs and rethrows repository failures without logging addresses", async () => {
    const input = dependencies("apply");
    input.repository.countMirror.mockRejectedValue(
      new Error("database person@example.org"),
    );
    await expect(
      createSalesforceSubscriptionReadbackTask(input)({}, {} as never),
    ).rejects.toThrow("database");
    expect(input.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("salesforce.subscription_readback.failed"),
    );
    for (const calls of [
      input.logger.info.mock.calls,
      input.logger.error.mock.calls,
    ])
      for (const [line] of calls) expect(line).not.toContain("@");
  });

  it("does not refresh the heartbeat after a failed run", async () => {
    const input = dependencies("apply");
    input.repository.persistBatch.mockRejectedValue(new Error("database"));

    await expect(
      createSalesforceSubscriptionReadbackTask(input)({}, {} as never),
    ).rejects.toThrow("database");

    expect(input.repository.recordSuccessfulRefresh).not.toHaveBeenCalled();
  });
});
