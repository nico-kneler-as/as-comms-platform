import { describe, expect, it } from "vitest";

import { mapContactMembershipRow } from "../src/mappers.js";

describe("contact membership mappers", () => {
  it("carries salesforceMembershipId when present", () => {
    const row = {
      id: "cm1",
      contactId: "c1",
      projectId: "p1",
      expeditionId: null,
      role: null,
      status: "active",
      salesforceMembershipId: "a15VK00000AUcRtYAL",
      source: "salesforce" as const,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    };

    const record = mapContactMembershipRow(row);

    expect(record.salesforceMembershipId).toBe("a15VK00000AUcRtYAL");
  });

  it("omits salesforceMembershipId when null for legacy rows", () => {
    const row = {
      id: "cm1",
      contactId: "c1",
      projectId: "p1",
      expeditionId: null,
      role: null,
      status: "active",
      salesforceMembershipId: null,
      source: "salesforce" as const,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    };

    const record = mapContactMembershipRow(row);

    expect(record.salesforceMembershipId).toBeUndefined();
  });
});
