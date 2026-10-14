import { describe, expect, it } from "vitest";

import { composeAudience } from "../src/compose-audience.js";
import type { AudienceMember } from "../src/campaign-types.js";

function member(email: string): AudienceMember {
  return {
    contactId: null, newsletterSubscriberId: null, frozenEmail: email,
    frozenFirstName: null, frozenProjectName: null, frozenProjectId: null,
    frozenAliasEmail: null,
  };
}

describe("composeAudience", () => {
  it("keeps base order when no include or exclusions are configured", () => {
    expect(composeAudience({ base: [member("a@example.org"), member("b@example.org")], includeEmails: null, exclusions: [] }).members.map((row) => row.frozenEmail)).toEqual(["a@example.org", "b@example.org"]);
  });

  it("narrows to included base members without adding emails that are not in base", () => {
    const result = composeAudience({ base: [member("a@example.org"), member("b@example.org")], includeEmails: new Set(["b@example.org", "outside@example.org"]), exclusions: [] });
    expect(result.members.map((row) => row.frozenEmail)).toEqual(["b@example.org"]);
  });

  it("normalizes whitespace/case, de-duplicates base members, and gives overlapping exclusions to the first reason", () => {
    const result = composeAudience({
      base: [member(" A@Example.org "), member("a@example.org"), member("b@example.org"), member("c@example.org")],
      includeEmails: new Set(["a@example.org", " B@EXAMPLE.ORG ", "c@example.org"]),
      exclusions: [
        { reason: "salesforce_list:insiders", emails: new Set([" b@example.org ", "c@example.org"]) },
        { reason: "uploaded_exclusions", emails: new Set(["C@EXAMPLE.ORG"]) },
      ],
    });
    expect(result.members.map((row) => row.frozenEmail)).toEqual([" A@Example.org "]);
    expect(result.excludedByReason).toEqual({ "salesforce_list:insiders": 2 });
  });

  it("handles empty sets", () => {
    expect(composeAudience({ base: [], includeEmails: new Set(), exclusions: [{ reason: "uploaded_exclusions", emails: new Set() }] })).toEqual({ members: [], excludedByReason: {} });
  });
});
