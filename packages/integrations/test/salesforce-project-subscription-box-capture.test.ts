import { describe, expect, it, vi } from "vitest";

import { createSalesforceCaptureService } from "../src/index.js";

describe("Salesforce project subscription-box capture", () => {
  it("uses the bounded project-box SOQL and returns raw box values", async () => {
    const queryAll = vi.fn().mockResolvedValue([
      {
        Id: "a0A000000000001AAA",
        Subscription_Box__c: "PNW Forest Monitoring",
      },
      { Id: "a0A000000000002AAA", Subscription_Box__c: "Future Box" },
    ]);
    const service = createSalesforceCaptureService(
      {
        bearerToken: "capture-token",
        loginUrl: "https://login.example.test",
        clientId: "client",
        username: "worker@example.test",
        jwtPrivateKey: "key",
        contactCaptureMode: "delta_polling",
        membershipCaptureMode: "delta_polling",
      },
      {
        apiClient: { queryAll, queryAllIncludingDeleted: queryAll },
        now: () => new Date("2026-11-07T12:00:00.000Z"),
      },
    );
    await expect(service.captureProjectSubscriptionBoxes()).resolves.toEqual({
      rows: [
        {
          projectId: "a0A000000000001AAA",
          subscriptionBox: "PNW Forest Monitoring",
        },
        { projectId: "a0A000000000002AAA", subscriptionBox: "Future Box" },
      ],
      capturedAt: "2026-11-07T12:00:00.000Z",
    });
    expect(queryAll).toHaveBeenCalledWith(
      "SELECT Id, Subscription_Box__c FROM Project__c WHERE Subscription_Box__c != null",
    );
  });
});
