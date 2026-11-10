import { describe, expect, it } from "vitest";

import {
  applyResidenceStateCriteria,
  filterAudienceByResidenceState,
  readEffectiveResidenceStates,
  summarizeResidenceStates,
} from "../src/residence-state-filter.js";

function member(frozenEmail: string) {
  return { frozenEmail };
}

describe("residence-state audience filtering", () => {
  it("passes through the original members when no states are selected", () => {
    const members = [member("a@example.org"), member("b@example.org")];

    expect(filterAudienceByResidenceState({
      members,
      states: [],
      lookup: new Map<string, "MT">([["a@example.org", "MT"]]),
    })).toEqual({
      members,
      excludedNoStateOnFile: 0,
      excludedOtherState: 0,
    });
  });

  it("keeps members in one or more selected states in their input order", () => {
    const members = [
      member("mt@example.org"),
      member("id@example.org"),
      member("or@example.org"),
    ];
    const lookup = new Map([
      ["mt@example.org", "MT" as const],
      ["id@example.org", "ID" as const],
      ["or@example.org", "OR" as const],
    ]);

    expect(filterAudienceByResidenceState({ members, states: ["MT"], lookup })).toEqual({
      members: [members[0]],
      excludedNoStateOnFile: 0,
      excludedOtherState: 2,
    });
    expect(filterAudienceByResidenceState({ members, states: ["ID", "MT"], lookup }).members).toEqual([
      members[0], members[1],
    ]);
  });

  it("counts missing and null snapshot entries as no state on file", () => {
    const members = [member("missing@example.org"), member("null@example.org")];

    expect(filterAudienceByResidenceState({
      members,
      states: ["MT"],
      lookup: new Map([["null@example.org", null]]),
    })).toEqual({
      members: [],
      excludedNoStateOnFile: 2,
      excludedOtherState: 0,
    });
  });

  it("normalizes member email before consulting the state lookup", () => {
    expect(filterAudienceByResidenceState({
      members: [member(" MT@EXAMPLE.ORG ")],
      states: ["MT"],
      lookup: new Map<string, "MT">([["mt@example.org", "MT"]]),
    }).members).toEqual([member(" MT@EXAMPLE.ORG ")]);
  });

  it("summarizes unique normalized emails with a stable count/code ordering", () => {
    expect(summarizeResidenceStates({
      members: [
        member("one@example.org"),
        member(" ONE@example.org "),
        member("two@example.org"),
        member("three@example.org"),
        member("four@example.org"),
        member("missing@example.org"),
      ],
      lookup: new Map([
        ["one@example.org", "MT" as const],
        ["two@example.org", "ID" as const],
        ["three@example.org", "MT" as const],
        ["four@example.org", "AZ" as const],
      ]),
    })).toEqual({
      byState: [
        { code: "MT", count: 2 },
        { code: "AZ", count: 1 },
        { code: "ID", count: 1 },
      ],
      noStateOnFile: 1,
      total: 6,
    });
  });
});

describe("run state criteria", () => {
  it("uses states only for whole-group modes", () => {
    expect(readEffectiveResidenceStates({ states: ["OR"] })).toEqual(["OR"]);
    for (const initialFilter of ["project_status", "all_approved", "all_available"] as const) {
      expect(readEffectiveResidenceStates({ initialFilter, states: ["OR"] })).toEqual(["OR"]);
    }
    for (const initialFilter of ["specific", "csv_upload", "salesforce_lists"] as const) {
      expect(readEffectiveResidenceStates({ initialFilter, states: ["OR"] })).toEqual([]);
    }
    expect(readEffectiveResidenceStates({ initialFilter: "project_status" })).toEqual([]);
  });

  it("narrows by the looked-up states and skips the lookup when there are none", async () => {
    const members = [member("OR@example.org"), member("wa@example.org"), member("none@example.org")];
    const requested: string[][] = [];
    const source = {
      findByEmails: (emails: readonly string[]) => {
        requested.push([...emails]);
        return Promise.resolve(new Map([["or@example.org", "OR" as const], ["wa@example.org", "WA" as const]]));
      },
    };

    const narrowed = await applyResidenceStateCriteria({ members, criteria: { states: ["OR"] }, source });
    expect(narrowed).toEqual({ members: [members[0]], excludedNoStateOnFile: 1, excludedOtherState: 1 });
    expect(requested).toEqual([["or@example.org", "wa@example.org", "none@example.org"]]);

    const untouched = await applyResidenceStateCriteria({ members, criteria: { initialFilter: "specific", states: ["OR"] }, source });
    expect(untouched.members).toBe(members);
    expect(requested).toHaveLength(1);
  });

  it("refuses to run a state filter without a lookup", async () => {
    await expect(
      applyResidenceStateCriteria({ members: [member("a@example.org")], criteria: { states: ["OR"] }, source: undefined }),
    ).rejects.toThrow("filtered by state");
    await expect(
      applyResidenceStateCriteria({ members: [member("a@example.org")], criteria: {}, source: undefined }),
    ).resolves.toMatchObject({ excludedNoStateOnFile: 0 });
  });
});
