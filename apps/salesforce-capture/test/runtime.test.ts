import { describe, expect, it } from "vitest";

import { readSalesforceCaptureRuntimeConfig } from "../src/index.js";

describe("Salesforce capture runtime config", () => {
  it("requires launch-scope Salesforce env for service boot", () => {
    const config = readSalesforceCaptureRuntimeConfig({
      PORT: "3012",
      SALESFORCE_CAPTURE_TOKEN: "salesforce-token",
      SALESFORCE_LOGIN_URL: "https://test.salesforce.com",
      SALESFORCE_CLIENT_ID: "client-id",
      SALESFORCE_USERNAME: "worker@example.org",
      SALESFORCE_JWT_PRIVATE_KEY:
        "-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----",
      SALESFORCE_JWT_EXPIRATION_SECONDS: "240",
      SALESFORCE_CONTACT_CAPTURE_MODE: "cdc_compatible",
      SALESFORCE_MEMBERSHIP_CAPTURE_MODE: "delta_polling"
    });

    expect(config.port).toBe(3012);
    expect(config.service.membershipObjectName).toBe("Expedition_Members__c");
    expect(config.service.taskChannelField).toBe("TaskSubtype");
    expect(config.service.jwtExpirationSeconds).toBe(240);
  });

  it("fails closed when required Salesforce capture env is missing", () => {
    expect(() =>
      readSalesforceCaptureRuntimeConfig({
        PORT: "3012",
        SALESFORCE_CAPTURE_TOKEN: "salesforce-token",
        SALESFORCE_LOGIN_URL: "https://test.salesforce.com",
        SALESFORCE_USERNAME: "worker@example.org",
        SALESFORCE_JWT_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----",
        SALESFORCE_CONTACT_CAPTURE_MODE: "cdc_compatible",
        SALESFORCE_MEMBERSHIP_CAPTURE_MODE: "delta_polling"
      })
    ).toThrow("SALESFORCE_CLIENT_ID is required.");
  });
});
