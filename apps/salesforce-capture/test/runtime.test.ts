import { describe, expect, it } from "vitest";

import { readSalesforceCaptureRuntimeConfig } from "../src/index.js";

describe("Salesforce capture runtime config", () => {
  it("requires launch-scope Salesforce env for service boot", () => {
    const config = readSalesforceCaptureRuntimeConfig({
      PORT: "3012",
      SALESFORCE_CAPTURE_TOKEN: "salesforce-token",
      SALESFORCE_LOGIN_URL: "https://test.salesforce.com",
      SALESFORCE_CLIENT_ID: "client-id",
      SALESFORCE_CLIENT_SECRET: "client-secret",
      SALESFORCE_USERNAME: "worker@example.org",
      SALESFORCE_PASSWORD: "password",
      SALESFORCE_SECURITY_TOKEN: "security-token",
      SALESFORCE_CONTACT_CAPTURE_MODE: "cdc_compatible",
      SALESFORCE_MEMBERSHIP_CAPTURE_MODE: "delta_polling"
    });

    expect(config.port).toBe(3012);
    expect(config.service.membershipObjectName).toBe("Expedition_Members__c");
    expect(config.service.taskChannelField).toBe("TaskSubtype");
  });

  it("fails closed when required Salesforce capture env is missing", () => {
    expect(() =>
      readSalesforceCaptureRuntimeConfig({
        PORT: "3012",
        SALESFORCE_CAPTURE_TOKEN: "salesforce-token",
        SALESFORCE_LOGIN_URL: "https://test.salesforce.com",
        SALESFORCE_CLIENT_SECRET: "client-secret",
        SALESFORCE_USERNAME: "worker@example.org",
        SALESFORCE_PASSWORD: "password",
        SALESFORCE_SECURITY_TOKEN: "security-token",
        SALESFORCE_CONTACT_CAPTURE_MODE: "cdc_compatible",
        SALESFORCE_MEMBERSHIP_CAPTURE_MODE: "delta_polling"
      })
    ).toThrow("SALESFORCE_CLIENT_ID is required.");
  });
});
