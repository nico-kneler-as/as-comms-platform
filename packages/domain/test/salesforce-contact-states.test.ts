import { describe, expect, it } from "vitest";

import type { SalesforceContactStateRow } from "@as-comms/contracts";

import { buildSalesforceContactStateRows } from "../src/index.js";

function row(input: Partial<SalesforceContactStateRow> = {}): SalesforceContactStateRow {
  return {
    salesforceContactId: "003-default",
    email: "person@example.org",
    rawState: "Montana",
    hasOptedOutOfEmail: false,
    lastModifiedAt: "2026-11-06T12:00:00.000Z",
    ...input,
  };
}

describe("buildSalesforceContactStateRows", () => {
  it("normalizes emails and states, drops blank emails, and sorts stored records", () => {
    const result = buildSalesforceContactStateRows([
      row({ email: " Zed@Example.org ", rawState: "Bali" }),
      row({ email: " ", salesforceContactId: "003-invalid" }),
      row({ email: " Alpha@Example.org ", rawState: " Montana " }),
    ]);

    expect(result.records).toEqual([
      expect.objectContaining({ normalizedEmail: "alpha@example.org", stateCode: "MT", rawState: "Montana" }),
      expect.objectContaining({ normalizedEmail: "zed@example.org", stateCode: null, rawState: "Bali" }),
    ]);
    expect(result.stats).toEqual({
      inputRows: 3, droppedInvalidEmail: 1, duplicatesCollapsed: 0,
      withStateCode: 1, withoutStateCode: 1, withOptOut: 0,
    });
  });

  it("keeps the newest contact for an email and the lowest ID on a timestamp tie", () => {
    const result = buildSalesforceContactStateRows([
      row({ salesforceContactId: "003-z", rawState: "Idaho" }),
      row({ salesforceContactId: "003-y", rawState: "Montana", lastModifiedAt: "2026-11-06T13:00:00.000Z" }),
      row({ salesforceContactId: "003-a", rawState: "Washington", lastModifiedAt: "2026-11-06T13:00:00.000Z" }),
    ]);

    expect(result.records).toEqual([
      expect.objectContaining({ salesforceContactId: "003-a", stateCode: "WA" }),
    ]);
    expect(result.stats.duplicatesCollapsed).toBe(2);
  });

  it("keeps the newest state while OR-ing Salesforce opt-outs across duplicates", () => {
    const result = buildSalesforceContactStateRows([
      row({ salesforceContactId: "003-old", rawState: "Montana", hasOptedOutOfEmail: true }),
      row({ salesforceContactId: "003-new", rawState: "Idaho", hasOptedOutOfEmail: false, lastModifiedAt: "2026-11-06T13:00:00.000Z" }),
    ]);

    expect(result.records).toEqual([
      expect.objectContaining({
        salesforceContactId: "003-new",
        stateCode: "ID",
        hasOptedOutOfEmail: true,
      }),
    ]);
    expect(result.stats.withOptOut).toBe(1);
  });

  it("keeps contacts with no state as stateCode null", () => {
    const result = buildSalesforceContactStateRows([row({ rawState: null })]);

    expect(result.records).toEqual([
      expect.objectContaining({ rawState: null, stateCode: null }),
    ]);
    expect(result.stats.withoutStateCode).toBe(1);
  });
});
