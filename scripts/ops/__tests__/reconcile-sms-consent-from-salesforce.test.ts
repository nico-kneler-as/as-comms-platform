import { describe, expect, it } from "vitest";

import {
  VOLUNTEER_APPLICATION_BACKFILL_NOTE,
  normalizeSfId18to15,
  parseSalesforceOptInContactIds,
  parseSalesforceOptInRows,
  shouldScrubLatestBackfillConsent,
} from "../reconcile-sms-consent-from-salesforce-helpers.js";

describe("reconcile-sms-consent-from-salesforce helpers", () => {
  it("parses quoted Salesforce CSV rows and deduplicates contact IDs by Contact ID column", () => {
    const csvText = [
      '"Full Name","Expedition Members Names","Email","Contact ID","Expedition Members ID","Email"',
      '"Alex Example","Expedition One","alex@example.com","003VK000001K8X7","EM-1","alex@example.com"',
      '"Alex Example","Expedition Two","alex@example.com","003VK000001K8X7","EM-2","alex@example.com"',
      '"Blair, Example","Expedition Three","blair@example.com","003VK000001K8Y8","EM-3","blair@example.com"',
    ].join("\n");

    expect(parseSalesforceOptInContactIds(csvText)).toEqual([
      "003VK000001K8X7",
      "003VK000001K8Y8",
    ]);
  });

  it("extracts a phone column when present and keeps a non-empty phone across duplicate contact rows", () => {
    const csvText = [
      '"Full Name","Contact ID","Mobile Phone","Email"',
      '"Alex Example","003VK000001K8X7","","alex@example.com"',
      '"Alex Example","003VK000001K8X7","(406) 555-0142","alex@example.com"',
      '"Blair Example","003VK000001K8Y8","406-555-0177","blair@example.com"',
    ].join("\n");

    expect(parseSalesforceOptInRows(csvText)).toEqual([
      { contactId15: "003VK000001K8X7", rawPhone: "(406) 555-0142" },
      { contactId15: "003VK000001K8Y8", rawPhone: "406-555-0177" },
    ]);
  });

  it("returns null phones when the export has no phone column (older report)", () => {
    const csvText = [
      '"Full Name","Expedition Members Names","Email","Contact ID","Expedition Members ID","Email"',
      '"Alex Example","Expedition One","alex@example.com","003VK000001K8X7","EM-1","alex@example.com"',
    ].join("\n");

    expect(parseSalesforceOptInRows(csvText)).toEqual([
      { contactId15: "003VK000001K8X7", rawPhone: null },
    ]);
  });

  it("throws when the export has no Contact ID column", () => {
    const csvText = ['"Full Name","Email"', '"Alex","alex@example.com"'].join(
      "\n",
    );

    expect(() => parseSalesforceOptInRows(csvText)).toThrow(/Contact ID/u);
  });

  it("normalizes 18-character Salesforce IDs down to 15 characters", () => {
    expect(normalizeSfId18to15("003VK000001K8X7AAB")).toBe("003VK000001K8X7");
    expect(normalizeSfId18to15("003VK000001K8X7")).toBe("003VK000001K8X7");
  });

  it("only scrubs latest backfill consent rows that are not in the Salesforce opt-in set", () => {
    expect(
      shouldScrubLatestBackfillConsent({
        latestConsent: {
          status: "opted_in",
          source: "volunteer_application_form",
          notes: VOLUNTEER_APPLICATION_BACKFILL_NOTE,
        },
        isInSalesforceOptInSet: false,
      }),
    ).toBe(true);

    expect(
      shouldScrubLatestBackfillConsent({
        latestConsent: {
          status: "opted_in",
          source: "sms_reply_yes",
          notes: VOLUNTEER_APPLICATION_BACKFILL_NOTE,
        },
        isInSalesforceOptInSet: false,
      }),
    ).toBe(false);

    expect(
      shouldScrubLatestBackfillConsent({
        latestConsent: {
          status: "opted_in",
          source: "operator_attestation",
          notes: VOLUNTEER_APPLICATION_BACKFILL_NOTE,
        },
        isInSalesforceOptInSet: false,
      }),
    ).toBe(false);

    expect(
      shouldScrubLatestBackfillConsent({
        latestConsent: {
          status: "opted_in",
          source: "salesforce_field",
          notes: VOLUNTEER_APPLICATION_BACKFILL_NOTE,
        },
        isInSalesforceOptInSet: false,
      }),
    ).toBe(false);

    expect(
      shouldScrubLatestBackfillConsent({
        latestConsent: {
          status: "opted_in",
          source: "volunteer_application_form",
          notes: VOLUNTEER_APPLICATION_BACKFILL_NOTE,
        },
        isInSalesforceOptInSet: true,
      }),
    ).toBe(false);
  });
});
