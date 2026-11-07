import { describe, expect, it, vi } from "vitest";

import {
  createSalesforceCaptureService,
  SalesforceQueryError,
} from "../src/index.js";

const config = {
  bearerToken: "token",
  loginUrl: "https://login.example.test",
  clientId: "client",
  username: "worker@example.test",
  jwtPrivateKey: "key",
  contactCaptureMode: "delta_polling" as const,
  membershipCaptureMode: "delta_polling" as const,
};

describe("Salesforce subscription-preference capture", () => {
  it("uses queryAll including deleted, formats since, normalizes rows and drops incomplete records", async () => {
    const queryAllIncludingDeleted = vi.fn().mockResolvedValue([
      {
        Id: "esp-1",
        Email__c: " Person@Example.Org ",
        LastModifiedDate: "2026-11-07T12:00:00.000Z",
        Adventure_Scientists_General_Newsletter__c: null,
        PNW_Forest_Monitoring__c: true,
        IsDeleted: false,
        LastModifiedBy: { Username: "staff@example.org" },
      },
      {
        Id: "esp-2",
        Email__c: null,
        LastModifiedDate: "2026-11-07T12:00:00.000Z",
      },
    ]);
    const service = createSalesforceCaptureService(config, {
      apiClient: { queryAll: vi.fn(), queryAllIncludingDeleted },
      now: () => new Date("2026-11-07T13:00:00.000Z"),
    });
    await expect(
      service.captureSubscriptionPreferences({
        version: 1,
        since: "2026-11-07T12:00:00.456Z",
      }),
    ).resolves.toMatchObject({
      droppedRows: 1,
      rows: [
        {
          email: "person@example.org",
          generalNewsletter: false,
          isDeleted: false,
          projectBoxes: { "PNW Forest Monitoring": true },
        },
      ],
    });
    expect(queryAllIncludingDeleted).toHaveBeenCalledWith(
      expect.stringContaining("LastModifiedDate >= 2026-11-07T12:00:00Z"),
    );
    expect(queryAllIncludingDeleted).toHaveBeenCalledWith(
      expect.stringContaining("PNW_Forest_Monitoring__c"),
    );
  });

  it("returns a 400 for a malformed since value", async () => {
    const service = createSalesforceCaptureService(config, {
      apiClient: { queryAll: vi.fn(), queryAllIncludingDeleted: vi.fn() },
    });
    const response = await service.handleHttpRequest({
      method: "POST",
      path: "/subscription-preferences",
      headers: { authorization: "Bearer token" },
      bodyText: JSON.stringify({ version: 1, since: "not-a-date" }),
    });
    expect(response.status).toBe(400);
  });

  it("normalizes null LastModifiedBy and omits the WHERE clause for a baseline", async () => {
    const queryAllIncludingDeleted = vi.fn().mockResolvedValue([
      {
        Id: "esp-1",
        Email__c: "person@example.org",
        LastModifiedDate: "2026-11-07T12:00:00.000Z",
        LastModifiedBy: null,
        Adventure_Scientists_General_Newsletter__c: null,
      },
    ]);
    const service = createSalesforceCaptureService(config, {
      apiClient: { queryAll: vi.fn(), queryAllIncludingDeleted },
    });
    await expect(
      service.captureSubscriptionPreferences({ version: 1, since: null }),
    ).resolves.toMatchObject({
      rows: [{ generalNewsletter: false, lastModifiedByUsername: null }],
    });
    expect(queryAllIncludingDeleted.mock.calls[0]?.[0]).not.toContain("WHERE");
  });

  it.each([
    [
      new SalesforceQueryError(401, "INVALID_SESSION_ID", "expired"),
      401,
      "salesforce_access_error",
    ],
    [new Error("network"), 502, "salesforce_capture_failed"],
  ])("maps capture failures", async (error, status, code) => {
    const service = createSalesforceCaptureService(config, {
      apiClient: {
        queryAll: vi.fn(),
        queryAllIncludingDeleted: vi.fn().mockRejectedValue(error),
      },
    });
    const response = await service.handleHttpRequest({
      method: "POST",
      path: "/subscription-preferences",
      headers: { authorization: "Bearer token" },
      bodyText: JSON.stringify({ version: 1, since: null }),
    });
    expect(response.status).toBe(status);
    expect(JSON.parse(response.body)).toMatchObject({ error: code });
  });
});
