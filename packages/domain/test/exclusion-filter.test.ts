import { describe, expect, it } from "vitest";

import type { CampaignRunRecord } from "@as-comms/contracts";

import {
  createExclusionFilter,
  type ExclusionFilter,
} from "../src/exclusion-filter.js";
import type { AudienceMember } from "../src/campaign-types.js";

function buildRun(kind: "project" | "newsletter"): CampaignRunRecord {
  return {
    id: `run-${kind}`,
    kind,
    launchType: "normal_email",
    state: "scheduled",
    projectId: kind === "project" ? "project-a" : null,
    name: null,
    fromEmail: null,
    fromName: null,
    replyToEmail: null,
    subjectTemplate: null,
    bodyHtmlTemplate: null,
    bodyTextTemplate: null,
    preheader: null,
    audienceCriteria: {
      projectId: kind === "project" ? "project-a" : null,
      projectIds: kind === "project" ? ["project-a"] : [],
      statuses: [],
      contactIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    finalizedAt: null,
    cancelledAt: null,
    cancelledReason: null,
    createdByUserId: null,
    lastEditedByUserId: null,
    createdAt: "2026-05-15T12:00:00.000Z",
    updatedAt: "2026-05-15T12:00:00.000Z",
  };
}

function buildMember(
  contactId: string,
  projectId = "project-a",
): AudienceMember {
  return {
    contactId,
    newsletterSubscriberId: null,
    frozenEmail: `${contactId}@example.org`,
    frozenFirstName: "Test",
    frozenProjectName: "Project A",
    frozenProjectId: projectId,
    frozenAliasEmail: "project-a@example.org",
  };
}

function createFilter(input: {
  run: CampaignRunRecord;
  suppressedEmails?: readonly string[];
  optedOutScopes?: ReadonlySet<string>;
}): ExclusionFilter {
  const suppressed = new Set(input.suppressedEmails ?? []);
  const optedOutScopes = input.optedOutScopes ?? new Set<string>();

  return createExclusionFilter({
    repositories: {
      campaignRuns: {
        findById: () => Promise.resolve(input.run),
      },
      contactConsent: {
        isOptedOut: (contactId, scope) =>
          Promise.resolve(
            optedOutScopes.has(`${contactId}:${scope.type}:${scope.id ?? "*"}`),
          ),
      },
      suppressionList: {
        isSuppressed: (email) => Promise.resolve(suppressed.has(email)),
      },
    },
  });
}

describe("createExclusionFilter", () => {
  it("excludes suppression list matches", async () => {
    const filter = createFilter({
      run: buildRun("project"),
      suppressedEmails: ["contact-1@example.org"],
    });

    const result = await filter.applyExclusions(
      [buildMember("contact-1")],
      "run-project",
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(result.eligible).toEqual([]);
    expect(result.excluded).toMatchObject([
      { contactId: "contact-1", reason: "suppressed" },
    ]);
  });

  it("applies project-scoped opt outs only to the matching project", async () => {
    const filter = createFilter({
      run: buildRun("project"),
      optedOutScopes: new Set([
        "contact-1:project:project-a",
        "contact-1:project:project-b",
      ]),
    });

    const result = await filter.applyExclusions(
      [buildMember("contact-1", "project-a"), buildMember("contact-2", "project-a")],
      "run-project",
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(result.excluded).toMatchObject([
      { contactId: "contact-1", reason: "opted_out_project" },
    ]);
    expect(result.eligible).toMatchObject([{ contactId: "contact-2" }]);
  });

  it("applies newsletter opt outs only to newsletter campaigns", async () => {
    const newsletterFilter = createFilter({
      run: buildRun("newsletter"),
      optedOutScopes: new Set(["contact-1:newsletter:*"]),
    });
    const projectFilter = createFilter({
      run: buildRun("project"),
      optedOutScopes: new Set(["contact-1:newsletter:*"]),
    });

    await expect(
      newsletterFilter.applyExclusions(
        [buildMember("contact-1")],
        "run-newsletter",
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      excluded: [{ contactId: "contact-1", reason: "opted_out_newsletter" }],
    });
    await expect(
      projectFilter.applyExclusions(
        [buildMember("contact-1")],
        "run-project",
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      eligible: [{ contactId: "contact-1" }],
    });
  });

  it("applies all-scope opt outs to every campaign kind", async () => {
    const filter = createFilter({
      run: buildRun("project"),
      optedOutScopes: new Set(["contact-1:all:*"]),
    });

    const result = await filter.applyExclusions(
      [buildMember("contact-1")],
      "run-project",
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(result.excluded).toMatchObject([
      { contactId: "contact-1", reason: "opted_out_all" },
    ]);
  });

  it("records the correct exclusion reasons across the stack", async () => {
    const filter = createFilter({
      run: buildRun("project"),
      suppressedEmails: ["suppressed@example.org"],
      optedOutScopes: new Set([
        "all:all:*",
        "project:project:project-a",
      ]),
    });

    const result = await filter.applyExclusions(
      [
        {
          ...buildMember("suppressed"),
          frozenEmail: "suppressed@example.org",
        },
        buildMember("all"),
        buildMember("project"),
      ],
      "run-project",
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(result.excluded.map((member) => member.reason)).toEqual([
      "suppressed",
      "opted_out_all",
      "opted_out_project",
    ]);
  });

  it("skips contact-consent checks for newsletter subscribers without contact ids", async () => {
    const newsletterFilter = createFilter({
      run: buildRun("newsletter"),
      optedOutScopes: new Set(["contact-1:newsletter:*"]),
    });

    await expect(
      newsletterFilter.applyExclusions(
        [
          {
            ...buildMember("contact-ignored"),
            contactId: null,
            newsletterSubscriberId: "subscriber-1",
            frozenEmail: "subscriber@example.org",
          },
        ],
        "run-newsletter",
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      eligible: [{ newsletterSubscriberId: "subscriber-1" }],
    });
  });
});
