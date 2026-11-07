import { describe, expect, it } from "vitest";

import {
  evaluateSubscriptionPermissions,
  runCheckSfSubscriptionPermissions,
} from "../src/ops/check-sf-subscription-permissions.js";

const fields = [
  "Email__c",
  "Contact__c",
  "Record_Creation_Source__c",
  "Adventure_Scientists_General_Newsletter__c",
  "PNW_Forest_Monitoring__c",
  "Beech_and_Butternut__c",
  "Tracking_Whitebark_Pine__c",
  "Coral_Reef_Expansion__c",
  "Monitoring_Killer_Whales_Project__c",
  "Oregon_Shores_Newsletter__c",
  "Unsubscribed_from_all__c",
  "Unsubscribed_at__c",
  "Email_Bounced__c",
].map((name) => ({
  name,
  createable: true,
  updateable: true,
  externalId: name === "Email__c",
  caseSensitive: name === "Email__c",
}));

describe("check-sf-subscription-permissions", () => {
  it("reports all-pass checks plus the expected case-sensitivity warning", () => {
    const checks = evaluateSubscriptionPermissions({
      esp: { createable: true, updateable: true, deletable: false, fields },
      members: {
        updateable: true,
        deletable: false,
        fields: [{ name: "Status__c", updateable: true }],
      },
      projects: {
        fields: [
          {
            name: "Subscription_Box__c",
            updateable: false,
            picklistValues: [
              "PNW Forest Monitoring",
              "Beech and Butternut",
              "Tracking Whitebark Pine",
              "Coral Reef Expansion",
              "Monitoring Killer Whales Project",
            ].map((value) => ({ value, active: true })),
          },
        ],
      },
    });
    expect(checks.filter((check) => check.severity === "FAIL")).toEqual([]);
    expect(
      checks.some(
        (check) =>
          check.severity === "WARN" && check.label.includes("case-sensitive"),
      ),
    ).toBe(true);
  });

  it("refuses unsafe probes before making fetch calls", async () => {
    const fetchImplementation = (() =>
      Promise.reject(new Error("should not fetch"))) as typeof fetch;
    await expect(
      runCheckSfSubscriptionPermissions({
        args: ["--write-probe"],
        env: {},
        fetchImplementation,
      }),
    ).rejects.toThrow("requires --email");
    await expect(
      runCheckSfSubscriptionPermissions({
        args: ["--write-probe", "--email", "real@example.org"],
        env: {},
        fetchImplementation,
      }),
    ).rejects.toThrow("with a + address");
  });
});
