import { describe, expect, it, vi } from "vitest";

import type { CampaignRunRecord } from "@as-comms/contracts";

import {
  createExclusionFilter,
  decideRecipientExclusion,
  type ExclusionFilter,
  type RecipientExclusionFacts,
  type NewsletterSuppressionRow,
  type RecipientExclusionScope,
  classifyNewsletterSuppression,
} from "../src/exclusion-filter.js";
import type { AudienceMember } from "../src/campaign-types.js";

function buildRun(
  kind: "project" | "newsletter",
  input: {
    readonly launchType?: CampaignRunRecord["launchType"];
    readonly projectId?: string | null;
    readonly initialFilter?: "csv_upload" | "salesforce_lists";
    readonly audienceListId?: string | null;
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
    audienceListId: input.audienceListId ?? null,
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
  salesforceOptedOutEmails?: ReadonlySet<string>;
  contactOptedOutEmails?: Partial<
    Readonly<Record<"all" | "newsletter", ReadonlySet<string>>>
  >;
  salesforceAllOptedOutEmails?: ReadonlySet<string>;
  listSalesforceOptedOutEmails?: () => Promise<ReadonlySet<string>>;
  listContactOptedOutEmails?: (
    scopeType: "all" | "newsletter",
    at: Date,
  ) => Promise<ReadonlySet<string>>;
  listSalesforceAllOptedOutEmails?: () => Promise<ReadonlySet<string>>;
  newsletterCleanedEmails?: readonly string[];
  newsletterSuppressionRows?: readonly NewsletterSuppressionRow[];
  ledgerAllEmails?: readonly string[];
  ledgerListEmails?: Readonly<Record<string, readonly string[]>>;
}): ExclusionFilter {
  const suppressed = new Set(input.suppressedEmails ?? []);
  // `newsletterSuppressedEmails` are Mailchimp newsletter unsubscribes.
  const createdAt = new Date("2026-10-01T00:00:00.000Z");
  const newsletterRows: NewsletterSuppressionRow[] = [
    ...(input.newsletterSuppressedEmails ?? []).map((email) => ({
      email,
      reason: "unsubscribed" as const,
      source: "mailchimp_import",
      createdAt,
    })),
    ...(input.newsletterCleanedEmails ?? []).map((email) => ({
      email,
      reason: "cleaned" as const,
      source: "mailchimp_import",
      createdAt,
    })),
    ...(input.newsletterSuppressionRows ?? []),
  ];
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
        listOptedOutEmails: input.listContactOptedOutEmails ??
          ((scopeType) =>
            Promise.resolve(input.contactOptedOutEmails?.[scopeType] ?? new Set())),
      },
      suppressionList: {
        isSuppressed: (email) => Promise.resolve(suppressed.has(email)),
      },
      newsletterSuppressions: {
        listForExclusion: () => Promise.resolve(newsletterRows),
      },
      salesforceEmailOptOuts: {
        listOptedOutEmails: input.listSalesforceOptedOutEmails ??
          (() => Promise.resolve(input.salesforceOptedOutEmails ?? new Set())),
        listUnsubscribedFromAllEmails: input.listSalesforceAllOptedOutEmails ??
          (() => Promise.resolve(input.salesforceAllOptedOutEmails ?? new Set())),
      },
      emailOptOuts: {
        listEmails: (scope) =>
          Promise.resolve(
            new Set(
              scope.type === "all"
                ? (input.ledgerAllEmails ?? [])
                : (input.ledgerListEmails?.[scope.listId] ?? []),
            ),
          ),
      },
    },
  });
}

describe("createExclusionFilter", () => {
  describe("decideRecipientExclusion", () => {
    const none: RecipientExclusionFacts = {
      suppressed: false,
      salesforceEmailOptOut: false,
      newsletterSuppression: null,
      allOptOut: false,
      projectOptOut: false,
      newsletterOptOut: false,
      listOptOut: false,
    };
    const list: RecipientExclusionScope = { type: "list", listId: "insiders" };
    const newsletter: RecipientExclusionScope = {
      type: "newsletter",
      honoursNewsletterSuppressions: true,
    };
    const project: RecipientExclusionScope = {
      type: "project",
      honoursNewsletterSuppressions: false,
    };

    it.each([
      ["a newsletter-only unsubscribe is ignored on a list send", { newsletterSuppression: "newsletter_only" }, list, null],
      ["a broad newsletter suppression is excluded on a list send", { newsletterSuppression: "broad" }, list, "opted_out_newsletter"],
      ["a newsletter-only unsubscribe is excluded on a newsletter send", { newsletterSuppression: "newsletter_only" }, newsletter, "opted_out_newsletter"],
      ["a bounced address is excluded on a list send", { newsletterSuppression: "bounced" }, list, "suppressed"],
      ["a bounced address is excluded on a newsletter send", { newsletterSuppression: "bounced" }, newsletter, "opted_out_newsletter"],
      ["an all opt-out is excluded on a list send", { allOptOut: true }, list, "opted_out_all"],
      ["an all opt-out is excluded on a project send", { allOptOut: true }, project, "opted_out_all"],
      ["leaving the list is excluded on that list's send", { listOptOut: true }, list, "opted_out_list"],
      ["a contact newsletter opt-out is ignored on a list send", { newsletterOptOut: true }, list, null],
      ["a project opt-out is ignored on a list send", { projectOptOut: true }, list, null],
      ["a Salesforce Email Opt Out is excluded on a list send", { salesforceEmailOptOut: true }, list, "opted_out_salesforce"],
      ["a suppression-list match is excluded on a list send", { suppressed: true }, list, "suppressed"],
      ["nothing known is sendable on a list send", {}, list, null],
    ] as const)("%s", (_label, partial, scope, expected) => {
      expect(
        decideRecipientExclusion(
          { ...none, ...(partial as Partial<RecipientExclusionFacts>) },
          scope,
        ),
      ).toBe(expected);
    });
  });

  describe("classifyNewsletterSuppression", () => {
    const before = new Date("2026-11-09T12:00:00.000Z");
    const after = new Date("2026-11-11T18:00:00.000Z");

    it.each([
      ["a Mailchimp unsubscribe", { reason: "unsubscribed", source: "mailchimp_import", createdAt: before }, "newsletter_only"],
      ["a Mailchimp cleaned address", { reason: "cleaned", source: "mailchimp_import", createdAt: before }, "bounced"],
      ["a newsletter page click after #763", { reason: "platform_optout", source: "recipient_click", createdAt: after }, "newsletter_only"],
      ["a page click before #763, which may have been unsubscribe-from-all", { reason: "platform_optout", source: "recipient_click", createdAt: before }, "broad"],
      ["a Postmark stream unsubscribe", { reason: "platform_optout", source: "provider_event", createdAt: after }, "broad"],
      ["a Salesforce hard opt-out", { reason: "platform_optout", source: "salesforce_hard_optout", createdAt: after }, "broad"],
    ] as const)("treats %s as %s", (_label, row, expected) => {
      expect(classifyNewsletterSuppression(row)).toBe(expected);
    });
  });

  describe("list sends (PRD #768)", () => {
    const at = new Date("2026-11-12T12:00:00.000Z");
    const listRun = buildRun("newsletter", { audienceListId: "insiders" });
    const recipient = (email: string): AudienceMember => ({
      ...buildMember(null),
      frozenProjectId: null,
      frozenEmail: email,
    });

    it("keeps newsletter-only unsubscribes and drops bounces, broad suppressions, list leavers and all opt-outs", async () => {
      const filter = createFilter({
        run: listRun,
        newsletterSuppressedEmails: ["left-newsletter@example.org"],
        newsletterCleanedEmails: ["bounced@example.org"],
        newsletterSuppressionRows: [
          {
            email: "postmark-unsubscribe@example.org",
            reason: "platform_optout",
            source: "provider_event",
            createdAt: new Date("2026-10-01T12:00:00.000Z"),
          },
        ],
        ledgerListEmails: { insiders: ["left-insiders@example.org"] },
        ledgerAllEmails: ["left-everything@example.org"],
      });

      const result = await filter.applyExclusions(
        [
          recipient("left-newsletter@example.org"),
          recipient("bounced@example.org"),
          recipient("postmark-unsubscribe@example.org"),
          recipient("left-insiders@example.org"),
          recipient("left-everything@example.org"),
        ],
        listRun.id,
        at,
      );

      expect(result.eligible.map((member) => member.frozenEmail)).toEqual([
        "left-newsletter@example.org",
      ]);
      expect(
        result.excluded.map((member) => [member.frozenEmail, member.reason]),
      ).toEqual([
        ["bounced@example.org", "suppressed"],
        ["postmark-unsubscribe@example.org", "opted_out_newsletter"],
        ["left-insiders@example.org", "opted_out_list"],
        ["left-everything@example.org", "opted_out_all"],
      ]);
    });

    it("ignores another list's leavers", async () => {
      const filter = createFilter({
        run: listRun,
        ledgerListEmails: { board: ["board-leaver@example.org"] },
      });

      await expect(
        filter.applyExclusions([recipient("board-leaver@example.org")], listRun.id, at),
      ).resolves.toMatchObject({ excluded: [] });
    });

    it("ignores a contact's newsletter opt-out", async () => {
      const filter = createFilter({
        run: listRun,
        optedOutScopes: new Set(["contact-1:newsletter:*"]),
        contactOptedOutEmails: { newsletter: new Set(["contact-1@example.org"]) },
      });

      await expect(
        filter.applyExclusions([buildMember("contact-1")], listRun.id, at),
      ).resolves.toMatchObject({ excluded: [] });
    });
  });

  it("excludes a ledger all opt-out from a newsletter send", async () => {
    const run = buildRun("newsletter");
    const filter = createFilter({
      run,
      ledgerAllEmails: ["ledger@example.org"],
    });

    await expect(
      filter.applyExclusions(
        [{ ...buildMember(null), frozenEmail: "ledger@example.org" }],
        run.id,
        new Date("2026-11-12T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ excluded: [{ reason: "opted_out_all" }] });
  });

  it("still applies contact all and project opt-outs to SMS runs", async () => {
    const run = buildRun("project", { launchType: "sms" });
    const filter = createFilter({
      run,
      optedOutScopes: new Set(["contact-1:all:*", "contact-2:project:project-a"]),
    });

    const result = await filter.applyExclusions(
      [buildMember("contact-1"), buildMember("contact-2"), buildMember("contact-3")],
      run.id,
      new Date("2026-11-12T12:00:00.000Z"),
    );

    expect(result.excluded.map((member) => [member.contactId, member.reason])).toEqual([
      ["contact-1", "opted_out_all"],
      ["contact-2", "opted_out_project"],
    ]);
    expect(result.eligible.map((member) => member.contactId)).toEqual(["contact-3"]);
  });

  it("applies project opt-outs and newsletter suppressions to a project-less CSV email send", async () => {
    const run = buildRun("project", { projectId: null, initialFilter: "csv_upload" });
    const filter = createFilter({
      run,
      optedOutScopes: new Set(["contact-1:project:project-a"]),
      newsletterSuppressedEmails: ["contact-2@example.org"],
    });

    const result = await filter.applyExclusions(
      [buildMember("contact-1"), buildMember("contact-2"), buildMember("contact-3")],
      run.id,
      new Date("2026-11-12T12:00:00.000Z"),
    );

    expect(result.excluded.map((member) => [member.contactId, member.reason])).toEqual([
      ["contact-1", "opted_out_project"],
      ["contact-2", "opted_out_newsletter"],
    ]);
  });

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

  it.each(["newsletter", "project"] as const)(
    "excludes Salesforce email opt-outs from %s email runs",
    async (kind) => {
      const filter = createFilter({
        run: buildRun(kind),
        salesforceOptedOutEmails: new Set(["person@example.org"]),
      });

      await expect(
        filter.applyExclusions(
          [{ ...buildMember("contact-1"), frozenEmail: " Person@Example.org " }],
          `run-${kind}`,
          new Date("2026-05-15T12:00:00.000Z"),
        ),
      ).resolves.toMatchObject({
        excluded: [{ reason: "opted_out_salesforce" }],
      });
    },
  );

  it("does not load or apply Salesforce email opt-outs to SMS runs", async () => {
    const listOptedOutEmails = vi.fn(() => Promise.resolve(new Set(["contact-1@example.org"])));
    const filter = createFilter({
      run: buildRun("newsletter", { launchType: "sms" }),
      listSalesforceOptedOutEmails: listOptedOutEmails,
    });

    await expect(
      filter.applyExclusions(
        [buildMember("contact-1")],
        "run-newsletter",
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ eligible: [{ contactId: "contact-1" }] });
    expect(listOptedOutEmails).not.toHaveBeenCalled();
  });

  it("loads Salesforce email opt-outs once per exclusion call", async () => {
    const listOptedOutEmails = vi.fn(() => Promise.resolve(new Set<string>()));
    const filter = createFilter({
      run: buildRun("project"),
      listSalesforceOptedOutEmails: listOptedOutEmails,
    });

    await filter.applyExclusions(
      [buildMember("contact-1"), buildMember("contact-2")],
      "run-project",
      new Date("2026-05-15T12:00:00.000Z"),
    );
    expect(listOptedOutEmails).toHaveBeenCalledTimes(1);
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

  it.each([
    {
      label: "a newsletter recipient without a contact id",
      run: buildRun("newsletter"),
      member: { ...buildMember(null), frozenEmail: "shared@example.org" },
    },
    {
      label: "a Salesforce-list recipient owned by a different contact",
      run: buildRun("project", { initialFilter: "salesforce_lists" }),
      member: { ...buildMember("recipient-contact"), frozenEmail: "shared@example.org" },
    },
    {
      label: "a project recipient owned by a different contact",
      run: buildRun("project"),
      member: { ...buildMember("recipient-contact"), frozenEmail: "shared@example.org" },
    },
  ])("excludes $label when the email has a contact all opt-out", async ({ run, member }) => {
    const filter = createFilter({
      run,
      contactOptedOutEmails: { all: new Set(["shared@example.org"]) },
    });

    await expect(
      filter.applyExclusions([member], run.id, new Date("2026-05-15T12:00:00.000Z")),
    ).resolves.toMatchObject({ excluded: [{ reason: "opted_out_all" }] });
  });

  it.each(["project", "newsletter"] as const)(
    "excludes Salesforce unsubscribed-from-all emails from %s runs",
    async (kind) => {
      const run = buildRun(kind);
      const filter = createFilter({
        run,
        salesforceAllOptedOutEmails: new Set(["mirror@example.org"]),
      });

      await expect(
        filter.applyExclusions(
          [{ ...buildMember(null), frozenEmail: "mirror@example.org" }],
          run.id,
          new Date("2026-05-15T12:00:00.000Z"),
        ),
      ).resolves.toMatchObject({ excluded: [{ reason: "opted_out_all" }] });
    },
  );

  it("applies email-owned newsletter opt-outs only to newsletter runs", async () => {
    const contactOptedOutEmails = {
      newsletter: new Set(["newsletter-only@example.org"]),
    };
    const newsletterRun = buildRun("newsletter");
    const projectRun = buildRun("project");
    const member = {
      ...buildMember(null),
      frozenEmail: "newsletter-only@example.org",
    };

    await expect(
      createFilter({ run: newsletterRun, contactOptedOutEmails }).applyExclusions(
        [member],
        newsletterRun.id,
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      excluded: [{ reason: "opted_out_newsletter" }],
    });
    await expect(
      createFilter({ run: projectRun, contactOptedOutEmails }).applyExclusions(
        [member],
        projectRun.id,
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ eligible: [{ frozenEmail: "newsletter-only@example.org" }] });
  });

  it("never applies project-scoped opt-outs by email to newsletter recipients", async () => {
    const filter = createFilter({
      run: buildRun("newsletter"),
      optedOutScopes: new Set(["other-contact:project:project-a"]),
    });

    await expect(
      filter.applyExclusions(
        [{ ...buildMember(null), frozenEmail: "shared-project@example.org" }],
        "run-newsletter",
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      eligible: [{ frozenEmail: "shared-project@example.org" }],
    });
  });

  it("does not apply a future all opt-out", async () => {
    const filter = createFilter({
      run: buildRun("project"),
      listContactOptedOutEmails: (_scopeType, at) =>
        Promise.resolve(
          at >= new Date("2026-05-16T12:00:00.000Z")
            ? new Set(["future@example.org"])
            : new Set(),
        ),
    });

    await expect(
      filter.applyExclusions(
        [{ ...buildMember(null), frozenEmail: "future@example.org" }],
        "run-project",
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ eligible: [{ frozenEmail: "future@example.org" }] });
  });

  it("normalizes all-opt-out email matches", async () => {
    const filter = createFilter({
      run: buildRun("project"),
      contactOptedOutEmails: { all: new Set([" Owner@Example.ORG "]) },
    });

    await expect(
      filter.applyExclusions(
        [{ ...buildMember(null), frozenEmail: " owner@example.org " }],
        "run-project",
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ excluded: [{ reason: "opted_out_all" }] });
  });

  it("does not load or apply the new email sets to SMS runs", async () => {
    const listContactOptedOutEmails = vi.fn(() =>
      Promise.resolve(new Set(["sms@example.org"])),
    );
    const listSalesforceAllOptedOutEmails = vi.fn(() =>
      Promise.resolve(new Set(["sms@example.org"])),
    );
    const filter = createFilter({
      run: buildRun("newsletter", { launchType: "sms" }),
      listContactOptedOutEmails,
      listSalesforceAllOptedOutEmails,
    });

    await expect(
      filter.applyExclusions(
        [{ ...buildMember(null), frozenEmail: "sms@example.org" }],
        "run-newsletter",
        new Date("2026-05-15T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ eligible: [{ frozenEmail: "sms@example.org" }] });
    expect(listContactOptedOutEmails).not.toHaveBeenCalled();
    expect(listSalesforceAllOptedOutEmails).not.toHaveBeenCalled();
  });

  it("loads each email opt-out set once for a multi-member exclusion call", async () => {
    const listContactOptedOutEmails = vi.fn(() => Promise.resolve(new Set<string>()));
    const listSalesforceAllOptedOutEmails = vi.fn(() => Promise.resolve(new Set<string>()));
    const filter = createFilter({
      run: buildRun("newsletter"),
      listContactOptedOutEmails,
      listSalesforceAllOptedOutEmails,
    });

    await filter.applyExclusions(
      [
        buildMember("contact-1"),
        buildMember("contact-2"),
        buildMember("contact-3"),
      ],
      "run-newsletter",
      new Date("2026-05-15T12:00:00.000Z"),
    );

    expect(listContactOptedOutEmails).toHaveBeenCalledTimes(2);
    expect(listContactOptedOutEmails).toHaveBeenNthCalledWith(
      1,
      "all",
      new Date("2026-05-15T12:00:00.000Z"),
    );
    expect(listContactOptedOutEmails).toHaveBeenNthCalledWith(
      2,
      "newsletter",
      new Date("2026-05-15T12:00:00.000Z"),
    );
    expect(listSalesforceAllOptedOutEmails).toHaveBeenCalledTimes(1);
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
