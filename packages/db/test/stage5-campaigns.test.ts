import { afterEach, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";
import type {
  CreateDraftInput,
} from "@as-comms/contracts";

import {
  createStage5RepositoryBundle,
  type Stage5RepositoryBundle,
} from "../src/index.js";
import {
  audienceSnapshots,
  contactConsent,
  mailchimpCampaignActivityDetails,
  projectDimensions,
  sourceEvidenceLog,
} from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

type Stage1Context = Awaited<ReturnType<typeof createTestStage1Context>>;

function buildAudienceCriteria(): CreateDraftInput["audienceCriteria"] {
  return {
    projectId: "project-1",
    projectIds: ["project-1"],
    statuses: ["Waitlist"],
    contactIds: [],
    expeditionIds: ["expedition-1"],
    lastActivityWindow: "last_90_days",
    hasReplied: "either",
    hasClicked: "no",
  };
}

function buildDraftInput(
  overrides: Partial<CreateDraftInput> = {},
): CreateDraftInput {
  return {
    id: "run-1",
    kind: "project",
    launchType: "normal_email",
    projectId: "project-1",
    name: null,
    fromEmail: null,
    fromName: null,
    replyToEmail: null,
    subjectTemplate: null,
    bodyHtmlTemplate: null,
    bodyDesignJson: null,
    bodyTextTemplate: null,
    preheader: null,
    audienceCriteria: buildAudienceCriteria(),
    audienceSize: null,
    createdByUserId: null,
    lastEditedByUserId: null,
    ...overrides,
  };
}

async function seedProject(context: Stage1Context, projectId = "project-1") {
  await context.repositories.projectDimensions.upsert({
    projectId,
    projectName: "Test Project",
    projectAlias: "test-project",
    connectedToProjectId: null,
    source: "manual",
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiAutoSyncSchedule: "never",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedInputHash: null,
  });
}

async function seedContact(context: Stage1Context, contactId = "contact-1") {
  await context.repositories.contacts.upsert({
    id: contactId,
    salesforceContactId: null,
    displayName: "Volunteer One",
    primaryEmail: `${contactId}@example.org`,
    primaryPhone: null,
    createdAt: "2026-05-15T12:00:00.000Z",
    updatedAt: "2026-05-15T12:00:00.000Z",
  });
}

async function seedMailchimpActivity(
  context: Stage1Context,
  input: {
    readonly sourceEvidenceId: string;
    readonly providerRecordId: string;
    readonly campaignId: string;
    readonly campaignName: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  },
) {
  await context.db.insert(sourceEvidenceLog).values({
    id: input.sourceEvidenceId,
    provider: "mailchimp",
    providerRecordType: "campaign_activity",
    providerRecordId: input.providerRecordId,
    receivedAt: input.createdAt,
    occurredAt: input.createdAt,
    payloadRef: `payloads/mailchimp/${input.providerRecordId}.json`,
    idempotencyKey: `mailchimp:${input.providerRecordId}`,
    checksum: `checksum:${input.providerRecordId}`,
    createdAt: input.createdAt,
  });

  await context.db.insert(mailchimpCampaignActivityDetails).values({
    sourceEvidenceId: input.sourceEvidenceId,
    providerRecordId: input.providerRecordId,
    activityType: "sent",
    campaignId: input.campaignId,
    audienceId: "aud-1",
    memberId: "member-1",
    campaignName: input.campaignName,
    snippet: "Mailchimp activity",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}

describe("Stage 5 campaigns repositories", () => {
  const contexts: Stage1Context[] = [];

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
  });

  it("inserts and reads the new Stage 5 tables through their repositories", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const campaigns = createStage5RepositoryBundle(context.db);

    await seedProject(context);
    await seedContact(context);

    const created = await campaigns.campaignRuns.create(
      buildDraftInput({
        id: "run-insert-read",
        fromEmail: "forest@adventurescientists.org",
        fromName: "Adventure Scientists",
        replyToEmail: "forest@adventurescientists.org",
        subjectTemplate: "Field update",
        bodyHtmlTemplate: "<p>Hello</p>",
        bodyTextTemplate: "Hello",
        preheader: "Important field update",
        audienceSize: 1,
      }),
    );
    const fetched = await campaigns.campaignRuns.findById(created.id);

    await campaigns.audienceSnapshots.bulkInsert(created.id, [
      {
        id: "snapshot-insert-read",
        contactId: "contact-1",
        frozenEmail: "contact-1@example.org",
        frozenFirstName: "Volunteer",
        frozenProjectName: "Test Project",
        frozenProjectId: "project-1",
        frozenAliasEmail: "forest@adventurescientists.org",
        unsubscribeToken: "token-insert-read",
        deliveryStatus: "pending",
        providerMessageId: "pm-insert-read",
      },
    ]);
    const snapshots = await campaigns.audienceSnapshots.listForRun(created.id);
    const byToken = await campaigns.audienceSnapshots.findByUnsubscribeToken(
      "token-insert-read",
    );
    const byProviderMessage =
      await campaigns.audienceSnapshots.findByProviderMessageId(
        "pm-insert-read",
      );

    await campaigns.contactConsent.recordOptOut(
      "contact-1",
      { type: "project", id: "project-1" },
      "admin_action",
      created.id,
    );
    const consentRows = await campaigns.contactConsent.listForContact("contact-1");

    const suppressedBefore = await campaigns.suppressionList.isSuppressed(
      "contact-1@example.org",
      new Date("2026-05-15T12:00:00.000Z"),
    );
    await campaigns.suppressionList.upsertFromBounce(
      "Contact-1@example.org",
      "hard_bounce",
      "provider-event-1",
      new Date("2026-05-15T12:05:00.000Z"),
    );
    const suppressedAfter = await campaigns.suppressionList.isSuppressed(
      "contact-1@example.org",
      new Date("2026-05-15T12:06:00.000Z"),
    );
    const suppressionRows = await campaigns.suppressionList.listAll();

    const orgSettingsBefore = await campaigns.orgSettings.read();
    const orgSettingsAfter = await campaigns.orgSettings.update({
      physicalAddressLine1: "123 Main St",
      physicalCity: "Bozeman",
      physicalState: "MT",
      physicalZip: "59715",
    });

    expect(fetched).toEqual(created);
    expect(snapshots).toHaveLength(1);
    expect(byToken?.id).toBe("snapshot-insert-read");
    expect(byProviderMessage?.id).toBe("snapshot-insert-read");
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0]?.scopeType).toBe("project");
    expect(suppressedBefore).toBe(false);
    expect(suppressedAfter).toBe(true);
    expect(suppressionRows[0]?.normalizedEmail).toBe("contact-1@example.org");
    expect(orgSettingsBefore.id).toBe("singleton");
    expect(orgSettingsAfter.physicalAddressLine1).toBe("123 Main St");
    expect(orgSettingsAfter.physicalCity).toBe("Bozeman");
    expect(orgSettingsAfter.physicalState).toBe("MT");
    expect(orgSettingsAfter.physicalZip).toBe("59715");
  });

  it("round-trips bodyDesignJson for html_email campaign runs", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const campaigns = createStage5RepositoryBundle(context.db);

    await seedProject(context);

    const bodyDesignJson = {
      rows: [
        {
          cells: [
            {
              contents: [
                {
                  type: "text",
                  values: { text: "hello" },
                },
              ],
            },
          ],
        },
      ],
    };

    const created = await campaigns.campaignRuns.create(
      buildDraftInput({
        id: "run-html-design-json",
        launchType: "html_email",
        bodyHtmlTemplate: "<p>hello</p>",
        bodyDesignJson,
        bodyTextTemplate: "hello",
      }),
    );
    const fetched = await campaigns.campaignRuns.findById(created.id);

    expect(created.bodyDesignJson).toEqual(bodyDesignJson);
    expect(fetched?.bodyDesignJson).toEqual(bodyDesignJson);
  });

  it("round-trips null bodyDesignJson for normal_email campaign runs", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const campaigns = createStage5RepositoryBundle(context.db);

    await seedProject(context);

    const created = await campaigns.campaignRuns.create(
      buildDraftInput({
        id: "run-normal-null-design-json",
        launchType: "normal_email",
        bodyDesignJson: null,
      }),
    );
    const fetched = await campaigns.campaignRuns.findById(created.id);

    expect(created.bodyDesignJson).toBeNull();
    expect(fetched?.bodyDesignJson).toBeNull();
  });

  it("enforces the audience snapshot run/contact uniqueness constraint", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const campaigns = createStage5RepositoryBundle(context.db);

    await seedProject(context);
    await seedContact(context);

    const run = await campaigns.campaignRuns.create(
      buildDraftInput({ id: "run-unique-constraint" }),
    );

    await context.db.insert(audienceSnapshots).values({
      id: "snapshot-unique-1",
      campaignRunId: run.id,
      contactId: "contact-1",
      frozenEmail: "contact-1@example.org",
      frozenFirstName: "Volunteer",
      frozenProjectName: "Test Project",
      frozenProjectId: "project-1",
      frozenAliasEmail: "forest@adventurescientists.org",
      unsubscribeToken: "token-unique-1",
      deliveryStatus: "pending",
      createdAt: new Date("2026-05-15T12:00:00.000Z"),
    });

    await expect(
      context.db.insert(audienceSnapshots).values({
        id: "snapshot-unique-2",
        campaignRunId: run.id,
        contactId: "contact-1",
        frozenEmail: "contact-1@example.org",
        frozenFirstName: "Volunteer",
        frozenProjectName: "Test Project",
        frozenProjectId: "project-1",
        frozenAliasEmail: "forest@adventurescientists.org",
        unsubscribeToken: "token-unique-2",
        deliveryStatus: "pending",
        createdAt: new Date("2026-05-15T12:01:00.000Z"),
      }),
    ).rejects.toThrow();
  });

  it("enforces the contact consent scope check constraint", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);

    await seedContact(context);

    await expect(
      context.db.insert(contactConsent).values({
        id: "consent-invalid-project-scope",
        contactId: "contact-1",
        scopeType: "project",
        scopeId: null,
        source: "admin_action",
        sourceRunId: null,
        optedOutAt: new Date("2026-05-15T12:00:00.000Z"),
        createdAt: new Date("2026-05-15T12:00:00.000Z"),
      }),
    ).rejects.toThrow();

    await expect(
      context.db.insert(contactConsent).values({
        id: "consent-invalid-newsletter-scope",
        contactId: "contact-1",
        scopeType: "newsletter",
        scopeId: "project-1",
        source: "admin_action",
        sourceRunId: null,
        optedOutAt: new Date("2026-05-15T12:01:00.000Z"),
        createdAt: new Date("2026-05-15T12:01:00.000Z"),
      }),
    ).rejects.toThrow();
  });

  it("treats project and all-scope opt-outs correctly", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const campaigns = createStage5RepositoryBundle(context.db);

    await seedContact(context);

    // `recordOptOut` stamps `optedOutAt` with `new Date()`. To make the
    // `optedOutAt <= at` query check meaningful regardless of when the test
    // runs, query at a timestamp comfortably after any recorded opt-out.
    const futureAt = () => new Date(Date.now() + 60_000);

    const beforeAnyOptOut = await campaigns.contactConsent.isOptedOut(
      "contact-1",
      { type: "project", id: "project-1" },
      futureAt(),
    );

    await campaigns.contactConsent.recordOptOut(
      "contact-1",
      { type: "project", id: "project-1" },
      "recipient_click",
    );
    const scopedProjectOptOut = await campaigns.contactConsent.isOptedOut(
      "contact-1",
      { type: "project", id: "project-1" },
      futureAt(),
    );
    const unrelatedNewsletterOptOut = await campaigns.contactConsent.isOptedOut(
      "contact-1",
      { type: "newsletter" },
      futureAt(),
    );

    await campaigns.contactConsent.recordOptOut(
      "contact-1",
      { type: "all" },
      "admin_action",
    );
    const allScopeProjectOptOut = await campaigns.contactConsent.isOptedOut(
      "contact-1",
      { type: "project", id: "project-99" },
      futureAt(),
    );
    const allScopeNewsletterOptOut = await campaigns.contactConsent.isOptedOut(
      "contact-1",
      { type: "newsletter" },
      futureAt(),
    );

    expect(beforeAnyOptOut).toBe(false);
    expect(scopedProjectOptOut).toBe(true);
    expect(unrelatedNewsletterOptOut).toBe(false);
    expect(allScopeProjectOptOut).toBe(true);
    expect(allScopeNewsletterOptOut).toBe(true);
  });

  it("returns a unified projection across Postmark and Mailchimp-backed runs", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const campaigns = createStage5RepositoryBundle(context.db);

    await seedProject(context);

    await campaigns.campaignRuns.create(
      buildDraftInput({
        id: "postmark-run-1",
        subjectTemplate: "Project dispatch",
      }),
    );

    await seedMailchimpActivity(context, {
      sourceEvidenceId: "sev-mailchimp-1",
      providerRecordId: "mailchimp-activity-1",
      campaignId: "mailchimp-run-1",
      campaignName: "Historical Newsletter",
      createdAt: new Date("2026-05-10T09:00:00.000Z"),
      updatedAt: new Date("2026-05-10T09:30:00.000Z"),
    });
    await seedMailchimpActivity(context, {
      sourceEvidenceId: "sev-mailchimp-2",
      providerRecordId: "mailchimp-activity-2",
      campaignId: "mailchimp-run-1",
      campaignName: "Historical Newsletter",
      createdAt: new Date("2026-05-10T09:15:00.000Z"),
      updatedAt: new Date("2026-05-10T10:00:00.000Z"),
    });

    const rows = await campaigns.campaignRunProjection.listRecent({ limit: 10 });
    const postmarkRuns = await campaigns.campaignRuns.listByIds([
      "postmark-run-1",
      "missing-run",
    ]);
    const postmarkRow = rows.find((row) => row.provider === "postmark");
    const mailchimpRow = rows.find((row) => row.provider === "mailchimp");
    const mailchimpDetail = await campaigns.campaignRunProjection.getDetail(
      "mailchimp-run-1",
      "mailchimp",
    );

    expect(postmarkRow).toMatchObject({
      runId: "postmark-run-1",
      provider: "postmark",
      kind: "project",
      launchType: "normal_email",
      state: "draft",
    });
    expect(postmarkRuns).toHaveLength(1);
    expect(postmarkRuns[0]?.id).toBe("postmark-run-1");
    expect(mailchimpRow).toMatchObject({
      runId: "mailchimp-run-1",
      provider: "mailchimp",
      kind: "newsletter",
      launchType: "html_email",
      state: "complete",
      subject: "Historical Newsletter",
    });
    expect(mailchimpDetail?.startedAt).toBe("2026-05-10T09:00:00.000Z");
    expect(mailchimpDetail?.completedAt).toBe("2026-05-10T09:15:00.000Z");
    expect(mailchimpDetail?.updatedAt).toBe("2026-05-10T10:00:00.000Z");
  });

  it("filters and counts the unified projection consistently", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const campaigns = createStage5RepositoryBundle(context.db);

    await seedProject(context, "project-1");
    await context.repositories.projectDimensions.upsert({
      projectId: "project-2",
      projectName: "Whales",
      projectAlias: "whales",
      connectedToProjectId: null,
      source: "manual",
      isActive: true,
      aiKnowledgeUrl: null,
      aiKnowledgeSyncedAt: null,
      aiKnowledgeSources: [],
      aiOperatingContext: "",
      aiAutoSyncSchedule: "never",
      aiOptimizedSynthesizedAt: null,
      aiOptimizedInputHash: null,
    });

    await campaigns.campaignRuns.create(
      buildDraftInput({
        id: "run-filter-1",
        subjectTemplate: "Forests draft",
      }),
    );
    await campaigns.campaignRuns.create(
      buildDraftInput({
        id: "run-filter-2",
        projectId: "project-2",
        subjectTemplate: "Whales send",
      }),
    );
    await campaigns.campaignRuns.transitionState(
      "run-filter-2",
      "draft",
      "scheduled",
      {
        scheduledAt: "2026-05-16T09:00:00.000Z",
      },
    );

    await seedMailchimpActivity(context, {
      sourceEvidenceId: "sev-mailchimp-filter-1",
      providerRecordId: "mailchimp-filter-1",
      campaignId: "mailchimp-filter-run",
      campaignName: "Archive newsletter",
      createdAt: new Date("2026-05-01T09:00:00.000Z"),
      updatedAt: new Date("2026-05-01T10:00:00.000Z"),
    });

    const scheduledRows = await campaigns.campaignRunProjection.listRecent({
      states: ["scheduled"],
    });
    const projectRows = await campaigns.campaignRunProjection.listRecent({
      projectIds: ["project-2"],
    });
    const searchRows = await campaigns.campaignRunProjection.listRecent({
      searchQuery: "archive",
    });
    const scheduledCount = await campaigns.campaignRunProjection.count({
      states: ["scheduled"],
    });
    const projectCount = await campaigns.campaignRunProjection.count({
      projectIds: ["project-2"],
    });
    const countsByState = await campaigns.campaignRunProjection.countByState();
    const projectCountsByState =
      await campaigns.campaignRunProjection.countByState({
        projectIds: ["project-2"],
      });

    expect(scheduledRows).toHaveLength(1);
    expect(scheduledRows[0]?.runId).toBe("run-filter-2");
    expect(projectRows).toHaveLength(1);
    expect(projectRows[0]?.projectId).toBe("project-2");
    expect(searchRows).toHaveLength(1);
    expect(searchRows[0]?.provider).toBe("mailchimp");
    expect(scheduledCount).toBe(1);
    expect(projectCount).toBe(1);
    expect(countsByState.draft).toBe(1);
    expect(countsByState.scheduled).toBe(1);
    expect(countsByState.complete).toBe(1);
    expect(projectCountsByState.scheduled).toBe(1);
    expect(projectCountsByState.draft ?? 0).toBe(0);
  });

  it("allows draft to scheduled but rejects draft to sending directly", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const campaigns: Stage5RepositoryBundle = createStage5RepositoryBundle(
      context.db,
    );

    await seedProject(context);

    const scheduledRun = await campaigns.campaignRuns.create(
      buildDraftInput({ id: "run-schedule-ok" }),
    );
    const directSendRun = await campaigns.campaignRuns.create(
      buildDraftInput({ id: "run-schedule-fail" }),
    );

    const transitioned = await campaigns.campaignRuns.transitionState(
      scheduledRun.id,
      "draft",
      "scheduled",
      {
        scheduledAt: "2026-05-16T09:00:00.000Z",
      },
    );

    await expect(
      campaigns.campaignRuns.transitionState(
        directSendRun.id,
        "draft",
        "sending",
      ),
    ).rejects.toThrow(/draft -> sending/i);

    expect(transitioned.state).toBe("scheduled");
    expect(transitioned.scheduledAt).toBe("2026-05-16T09:00:00.000Z");
  });

  it("updates draft content in place", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const campaigns = createStage5RepositoryBundle(context.db);

    await seedProject(context);

    // The `last_edited_by_user_id` FK requires a real users row.
    const editorUserCreatedAt = new Date("2026-05-01T12:00:00.000Z");
    await context.settings.users.upsert({
      id: "user-99",
      name: "Editor",
      email: "editor@example.org",
      emailVerified: editorUserCreatedAt,
      image: null,
      role: "operator",
      deactivatedAt: null,
      createdAt: editorUserCreatedAt,
      updatedAt: editorUserCreatedAt,
    });

    const created = await campaigns.campaignRuns.create(
      buildDraftInput({
        id: "run-update-draft",
        subjectTemplate: "Before",
      }),
    );

    const updated = await campaigns.campaignRuns.updateDraft(created.id, {
      subjectTemplate: "After",
      fromEmail: "forest@adventurescientists.org",
      lastEditedByUserId: "user-99",
    });

    expect(updated.subjectTemplate).toBe("After");
    expect(updated.fromEmail).toBe("forest@adventurescientists.org");
    expect(updated.lastEditedByUserId).toBe("user-99");
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
  });

  it("adds the postmark sender status column to project_dimensions", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);

    const columnResult: unknown = await context.db.execute(sql<{
      readonly columnName: string;
      readonly columnDefault: string | null;
      readonly isNullable: "YES" | "NO";
    }>`
      select
        column_name as "columnName",
        column_default as "columnDefault",
        is_nullable as "isNullable"
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'project_dimensions'
        and column_name = 'postmark_sender_status'
    `);
    const rows = Array.isArray(columnResult)
      ? columnResult
      : (
          columnResult as {
            readonly rows: readonly {
              readonly columnName: string;
              readonly columnDefault: string | null;
              readonly isNullable: "YES" | "NO";
            }[];
          }
        ).rows;

    await context.db.insert(projectDimensions).values({
      projectId: "project-column-check",
      projectName: "Column Check",
      projectAlias: "column-check",
      postmarkSenderStatus: "verified",
      isActive: false,
      connectedToProjectId: null,
      aiKnowledgeUrl: null,
      aiKnowledgeSyncedAt: null,
      aiKnowledgeSources: [],
      aiOperatingContext: "",
      aiAutoSyncSchedule: "never",
      aiOptimizedSynthesizedAt: null,
      aiOptimizedInputHash: null,
      source: "manual",
      createdAt: new Date("2026-05-15T12:00:00.000Z"),
      updatedAt: new Date("2026-05-15T12:00:00.000Z"),
    });

    expect(rows).toEqual([
      {
        columnName: "postmark_sender_status",
        columnDefault: "'unverified'::text",
        isNullable: "NO",
      },
    ]);
  });
});
