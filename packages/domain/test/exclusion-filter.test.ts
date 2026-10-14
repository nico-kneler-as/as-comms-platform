import { describe, expect, it } from "vitest";

import type { CampaignRunRecord } from "@as-comms/contracts";

import {
  createExclusionFilter,
  type ExclusionFilter,
} from "../src/exclusion-filter.js";
import type { AudienceMember } from "../src/campaign-types.js";

function buildRun(
  kind: "project" | "newsletter",
  input: {
    readonly launchType?: CampaignRunRecord["launchType"];
    readonly projectId?: string | null;
    readonly initialFilter?: "csv_upload";
  } = {},
): CampaignRunRecord {
  const projectId =
    input.projectId === undefined
      ? kind === "project"
        ? "project-a"
        : null
      : input.projectId;

  return {
    id: `run-${kind}`,
    workspace: "volunteers",
    kind,
    launchType: input.launchType ?? "normal_email",
    state: "scheduled",
    projectId,
    name: null,
    fromEmail: null,
    fromName: null,
    replyToEmail: null,
    subjectTemplate: null,
    subjectTemplateB: null,
    abTestEnabled: false,
    bodyHtmlTemplate: null,
    bodyDesignJson: null,
    bodyTextTemplate: null,
    preheader: null,
    audienceCriteria: {
      projectId,
      projectIds: projectId === null ? [] : [projectId],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
      ...(input.initialFilter === undefined
        ? {}
        : { initialFilter: input.initialFilter }),
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
  contactId: string | null,
  projectId = "project-a",
): AudienceMember {
  return {
    contactId,
    newsletterSubscriberId: null,
    frozenEmail: `${contactId ?? "subscriber"}@example.org`,
    frozenFirstName: "Test",
    frozenProjectName: "Project A",
    frozenProjectId: projectId,
    frozenAliasEmail: "project-a@example.org",
  };
}

function createFilter(input: {
  run: CampaignRunRecord;
  suppressedEmails?: readonly string[];
  newsletterSuppressedEmails?: readonly string[];
  optedOutScopes?: ReadonlySet<string>;
}): ExclusionFilter {
  const suppressed = new Set(input.suppressedEmails ?? []);
  const newsletterSuppressed = new Set(input.newsletterSuppressedEmails ?? []);
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
      newsletterSuppressions: {
        isSuppressed: (email) => Promise.resolve(newsletterSuppressed.has(email)),
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

  it.each(["unsubscribed", "cleaned", "platform_optout"])(
    "excludes newsletter-suppressed newsletter recipients (%s)",
    async () => {
      const filter = createFilter({
        run: buildRun("newsletter"),
        newsletterSuppressedEmails: ["subscriber@example.org"],
      });

      await expect(
        filter.applyExclusions(
          [
            {
              ...buildMember(null),
              newsletterSubscriberId: "subscriber-1",
              frozenEmail: "  SUBSCRIBER@EXAMPLE.ORG  ",
            },
          ],
          "run-newsletter",
          new Date("2026-05-15T12:00:00.000Z"),
        ),
      ).resolves.toMatchObject({
        excluded: [
          {
            newsletterSubscriberId: "subscriber-1",
            reason: "opted_out_newsletter",
          },
        ],
      });
    },
  );

  it("excludes newsletter-suppressed project-less CSV email recipients", async () => {
    const filter = createFilter({
      run: buildRun("project", {
        projectId: null,
        initialFilter: "csv_upload",
      }),
      newsletterSuppressedEmails: ["uploaded@example.org"],
    });

    await expect(
      filter.applyExclusions(
        [{ ...buildMember(null), frozenEmail: "uploaded@example.org" }],
        "run-project",
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      excluded: [{ reason: "opted_out_newsletter" }],
    });
  });

  it("keeps newsletter-suppressed project members eligible", async () => {
    const filter = createFilter({
      run: buildRun("project"),
      newsletterSuppressedEmails: ["contact-1@example.org"],
    });

    await expect(
      filter.applyExclusions(
        [buildMember("contact-1")],
        "run-project",
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      eligible: [{ contactId: "contact-1" }],
    });
  });

  it("does not apply newsletter suppression to SMS runs", async () => {
    const filter = createFilter({
      run: buildRun("newsletter", { launchType: "sms" }),
      newsletterSuppressedEmails: ["contact-1@example.org"],
    });

    await expect(
      filter.applyExclusions(
        [buildMember("contact-1")],
        "run-newsletter",
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      eligible: [{ contactId: "contact-1" }],
    });
  });

  it("keeps suppression-list exclusions ahead of newsletter suppression", async () => {
    const filter = createFilter({
      run: buildRun("newsletter"),
      suppressedEmails: ["subscriber@example.org"],
      newsletterSuppressedEmails: ["subscriber@example.org"],
    });

    await expect(
      filter.applyExclusions(
        [{ ...buildMember(null), frozenEmail: "subscriber@example.org" }],
        "run-newsletter",
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      excluded: [{ reason: "suppressed" }],
    });
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
