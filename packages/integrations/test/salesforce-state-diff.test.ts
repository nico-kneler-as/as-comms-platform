import { describe, expect, it } from "vitest";

import {
  diffSalesforceState,
  type SalesforceRowSnapshot,
} from "../src/capture-services/salesforce-state-diff.js";

describe("diffSalesforceState", () => {
  it("returns empty partitions when both inputs are empty", () => {
    expect(
      diffSalesforceState({
        salesforceRows: [],
        databaseIds: [],
      }),
    ).toEqual({
      presentInBoth: [],
      deletedInSalesforce: [],
      missingLocally: [],
    });
  });

  it("places all ids in presentInBoth when every db row exists in salesforce", () => {
    const salesforceRows: readonly SalesforceRowSnapshot[] = [
      { id: "001A", isDeleted: false },
      { id: "002B", isDeleted: false },
    ];

    expect(
      diffSalesforceState({
        salesforceRows,
        databaseIds: ["001A", "002B"],
      }),
    ).toEqual({
      presentInBoth: ["001A", "002B"],
      deletedInSalesforce: [],
      missingLocally: [],
    });
  });

  it("treats salesforce soft-deleted rows as deleted locally", () => {
    const salesforceRows: readonly SalesforceRowSnapshot[] = [
      { id: "001A", isDeleted: false },
      { id: "002B", isDeleted: true },
    ];

    expect(
      diffSalesforceState({
        salesforceRows,
        databaseIds: ["001A", "002B"],
      }),
    ).toEqual({
      presentInBoth: ["001A"],
      deletedInSalesforce: ["002B"],
      missingLocally: [],
    });
  });

  it("treats database ids missing from salesforce as deleted", () => {
    expect(
      diffSalesforceState({
        salesforceRows: [{ id: "001A", isDeleted: false }],
        databaseIds: ["001A", "002B"],
      }),
    ).toEqual({
      presentInBoth: ["001A"],
      deletedInSalesforce: ["002B"],
      missingLocally: [],
    });
  });

  it("reports non-deleted salesforce-only ids as missing locally", () => {
    expect(
      diffSalesforceState({
        salesforceRows: [{ id: "003C", isDeleted: false }],
        databaseIds: [],
      }),
    ).toEqual({
      presentInBoth: [],
      deletedInSalesforce: [],
      missingLocally: ["003C"],
    });
  });

  it("drops deleted salesforce-only ids silently", () => {
    expect(
      diffSalesforceState({
        salesforceRows: [{ id: "004D", isDeleted: true }],
        databaseIds: [],
      }),
    ).toEqual({
      presentInBoth: [],
      deletedInSalesforce: [],
      missingLocally: [],
    });
  });

  it("deduplicates duplicate database ids", () => {
    expect(
      diffSalesforceState({
        salesforceRows: [{ id: "001A", isDeleted: false }],
        databaseIds: ["001A", "001A", "001A"],
      }),
    ).toEqual({
      presentInBoth: ["001A"],
      deletedInSalesforce: [],
      missingLocally: [],
    });
  });

  it("uses last-write-wins for duplicate salesforce ids with conflicting delete flags", () => {
    expect(
      diffSalesforceState({
        salesforceRows: [
          { id: "001A", isDeleted: true },
          { id: "001A", isDeleted: false },
        ],
        databaseIds: ["001A"],
      }),
    ).toEqual({
      presentInBoth: ["001A"],
      deletedInSalesforce: [],
      missingLocally: [],
    });
  });

  it("sorts every output partition ascending", () => {
    expect(
      diffSalesforceState({
        salesforceRows: [
          { id: "d", isDeleted: false },
          { id: "b", isDeleted: false },
          { id: "z", isDeleted: false },
        ],
        databaseIds: ["d", "c", "b"],
      }),
    ).toEqual({
      presentInBoth: ["b", "d"],
      deletedInSalesforce: ["c"],
      missingLocally: ["z"],
    });
  });

  it("partitions a realistic mixed scenario exactly", () => {
    expect(
      diffSalesforceState({
        salesforceRows: [
          { id: "a", isDeleted: true },
          { id: "b", isDeleted: false },
          { id: "c", isDeleted: false },
          { id: "f", isDeleted: false },
          { id: "g", isDeleted: true },
        ],
        databaseIds: ["a", "b", "c", "d", "e"],
      }),
    ).toEqual({
      presentInBoth: ["b", "c"],
      deletedInSalesforce: ["a", "d", "e"],
      missingLocally: ["f"],
    });
  });
});
