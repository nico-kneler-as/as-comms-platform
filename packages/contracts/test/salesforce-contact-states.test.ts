import { describe, expect, it } from "vitest";

import { salesforceContactStatesSnapshotSchema } from "../src/index.js";

describe("salesforce contact-state contracts", () => {
  it("parses a contact-state snapshot", () => {
    expect(salesforceContactStatesSnapshotSchema.parse({
      rows: [{
        salesforceContactId: "003-contact",
        email: "person@example.org",
        rawState: "Montana",
        lastModifiedAt: "2026-11-06T12:00:00.000Z",
      }],
      capturedAt: "2026-11-06T12:01:00.000Z",
    }).rows).toHaveLength(1);
  });

  it("requires the capture timestamp", () => {
    expect(() => salesforceContactStatesSnapshotSchema.parse({ rows: [] })).toThrow();
  });
});
