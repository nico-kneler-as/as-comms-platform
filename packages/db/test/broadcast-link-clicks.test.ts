import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  BroadcastLinkClickRecordInput,
  CreateDraftInput,
} from "@as-comms/contracts";

import {
  createStage5RepositoryBundle,
  newsletterSubscribers,
  type Stage5RepositoryBundle,
} from "../src/index.js";
import {
  aggregateBroadcastLinkClicksByRunId,
  insertBroadcastLinkClick,
  listBroadcastLinkClicksForRun,
} from "../src/broadcast-link-clicks-repository.js";
import { createTestStage1Context, type TestStage1Context } from "./helpers.js";

function buildAudienceCriteria(projectId = "project-1"): CreateDraftInput["audienceCriteria"] {
  return {
    projectId,
    projectIds: [projectId],
    statuses: [],
    contactIds: [],
    newsletterSubscriberIds: [],
    expeditionIds: [],
    lastActivityWindow: "all_time",
    hasReplied: "either",
    hasClicked: "either",
  };
}

function buildDraftInput(
  id: string,
  projectId = "project-1",
): CreateDraftInput {
  return {
    id,
    kind: "project",
    launchType: "normal_email",
    projectId,
    name: null,
    fromEmail: "project@example.org",
    fromName: "Adventure Scientists",
    replyToEmail: "project@example.org",
    subjectTemplate: "Subject",
    bodyHtmlTemplate: "<p>Hello</p>",
    bodyTextTemplate: "Hello",
    bodyDesignJson: null,
    preheader: null,
    audienceCriteria: buildAudienceCriteria(projectId),
    audienceSize: 3,
    createdByUserId: null,
    lastEditedByUserId: null,
  };
}

async function seedProject(context: TestStage1Context, projectId = "project-1") {
  await context.repositories.projectDimensions.upsert({
    projectId,
    projectName: `Project ${projectId}`,
    projectAlias: `alias-${projectId}`,
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

async function seedContact(context: TestStage1Context, contactId: string) {
  await context.repositories.contacts.upsert({
    id: contactId,
    salesforceContactId: null,
    displayName: contactId,
    primaryEmail: `${contactId}@example.org`,
    primaryPhone: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
  });
}

async function seedNewsletterSubscriber(
  context: TestStage1Context,
  id: string,
  email: string,
) {
  await context.db.insert(newsletterSubscribers).values({
    id,
    email,
    firstName: "Subscriber",
    lastName: null,
    status: "subscribed",
    memberRating: null,
    optinTime: null,
    optinIp: null,
    confirmTime: null,
    confirmIp: null,
    lastChangedAt: null,
    interests: null,
    tags: null,
    source: "mailchimp_import",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
  });
}

function buildLinkClickRecord(
  overrides: Partial<BroadcastLinkClickRecordInput> &
    Pick<BroadcastLinkClickRecordInput, "id" | "idempotencyKey">,
): BroadcastLinkClickRecordInput {
  const { id, idempotencyKey, ...rest } = overrides;

  return {
    campaignRunId: "run-1",
    audienceSnapshotId: "snapshot-contact",
    contactId: "contact-1",
    originalLink: "https://example.org/a",
    clickedAt: "2026-07-01T13:00:00.000Z",
    userAgent: "Mozilla/5.0",
    platform: "Desktop",
    client: {
      Name: "Chrome 137",
      Company: "Google",
      Family: "Chrome",
    },
    os: {
      Name: "macOS 15",
      Company: "Apple",
      Family: "macOS",
    },
    geo: {
      CountryISOCode: "US",
      Country: "United States",
      RegionISOCode: "MT",
      Region: "Montana",
      City: "Bozeman",
      Zip: "59715",
      Coords: "45.6770,-111.0429",
      IP: "203.0.113.7",
    },
    createdAt: "2026-07-01T13:00:00.000Z",
    ...rest,
    id,
    idempotencyKey,
  };
}

describe("broadcast link clicks repository", () => {
  let context: TestStage1Context;
  let campaigns: Stage5RepositoryBundle;

  beforeEach(async () => {
    context = await createTestStage1Context();
    campaigns = createStage5RepositoryBundle(context.db);

    await seedProject(context, "project-1");
    await seedProject(context, "project-2");
    await seedContact(context, "contact-1");
    await seedContact(context, "contact-2");
    await seedNewsletterSubscriber(
      context,
      "11111111-1111-1111-1111-111111111111",
      "newsletter-1@example.org",
    );
    await seedNewsletterSubscriber(
      context,
      "22222222-2222-2222-2222-222222222222",
      "newsletter-2@example.org",
    );

    await campaigns.campaignRuns.create(buildDraftInput("run-1"));
    await campaigns.campaignRuns.create(buildDraftInput("run-2", "project-2"));

    await campaigns.audienceSnapshots.bulkInsert("run-1", [
      {
        id: "snapshot-contact",
        contactId: "contact-1",
        newsletterSubscriberId: null,
        frozenEmail: "contact-1@example.org",
        frozenFirstName: "Contact",
        frozenProjectName: "Project project-1",
        frozenProjectId: "project-1",
        frozenAliasEmail: "project@example.org",
        unsubscribeToken: "token-contact",
        deliveryStatus: "sent",
        providerMessageId: "pm-contact",
      },
      {
        id: "snapshot-newsletter-1",
        contactId: null,
        newsletterSubscriberId: "11111111-1111-1111-1111-111111111111",
        frozenEmail: "newsletter-1@example.org",
        frozenFirstName: "Newsletter One",
        frozenProjectName: "Project project-1",
        frozenProjectId: "project-1",
        frozenAliasEmail: "project@example.org",
        unsubscribeToken: "token-newsletter-1",
        deliveryStatus: "sent",
        providerMessageId: "pm-newsletter-1",
      },
      {
        id: "snapshot-newsletter-2",
        contactId: null,
        newsletterSubscriberId: "22222222-2222-2222-2222-222222222222",
        frozenEmail: "newsletter-2@example.org",
        frozenFirstName: "Newsletter Two",
        frozenProjectName: "Project project-1",
        frozenProjectId: "project-1",
        frozenAliasEmail: "project@example.org",
        unsubscribeToken: "token-newsletter-2",
        deliveryStatus: "sent",
        providerMessageId: "pm-newsletter-2",
      },
    ]);

    await campaigns.audienceSnapshots.bulkInsert("run-2", [
      {
        id: "snapshot-other-run",
        contactId: "contact-2",
        newsletterSubscriberId: null,
        frozenEmail: "contact-2@example.org",
        frozenFirstName: "Other Run",
        frozenProjectName: "Project project-2",
        frozenProjectId: "project-2",
        frozenAliasEmail: "project@example.org",
        unsubscribeToken: "token-other-run",
        deliveryStatus: "sent",
        providerMessageId: "pm-other-run",
      },
    ]);
  });

  afterEach(async () => {
    await context.dispose();
  });

  it("inserts idempotently and aggregates totals plus unique clickers by run", async () => {
    await expect(
      insertBroadcastLinkClick(
        context.db,
        buildLinkClickRecord({
          id: "click-1",
          idempotencyKey: "dedupe-1",
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      insertBroadcastLinkClick(
        context.db,
        buildLinkClickRecord({
          id: "click-1-replay",
          idempotencyKey: "dedupe-1",
        }),
      ),
    ).resolves.toBe(false);

    await insertBroadcastLinkClick(
      context.db,
      buildLinkClickRecord({
        id: "click-2",
        idempotencyKey: "dedupe-2",
        clickedAt: "2026-07-01T13:01:00.000Z",
        isBot: true,
        botReason: "fast_activity",
      }),
    );
    await insertBroadcastLinkClick(
      context.db,
      buildLinkClickRecord({
        id: "click-3",
        idempotencyKey: "dedupe-3",
        audienceSnapshotId: "snapshot-newsletter-1",
        contactId: null,
        clickedAt: "2026-07-01T13:02:00.000Z",
      }),
    );
    await insertBroadcastLinkClick(
      context.db,
      buildLinkClickRecord({
        id: "click-4",
        idempotencyKey: "dedupe-4",
        audienceSnapshotId: "snapshot-newsletter-1",
        contactId: null,
        clickedAt: "2026-07-01T13:03:00.000Z",
        isBot: true,
        botReason: "machine_user_agent",
      }),
    );
    await insertBroadcastLinkClick(
      context.db,
      buildLinkClickRecord({
        id: "click-5",
        idempotencyKey: "dedupe-5",
        audienceSnapshotId: "snapshot-newsletter-2",
        contactId: null,
        clickedAt: "2026-07-01T13:04:00.000Z",
      }),
    );
    await insertBroadcastLinkClick(
      context.db,
      buildLinkClickRecord({
        id: "click-6",
        idempotencyKey: "dedupe-6",
        originalLink: "https://example.org/b",
        clickedAt: "2026-07-01T13:05:00.000Z",
        isBot: true,
        botReason: "fast_activity",
      }),
    );
    await insertBroadcastLinkClick(
      context.db,
      buildLinkClickRecord({
        id: "click-7",
        idempotencyKey: "dedupe-7",
        campaignRunId: "run-2",
        audienceSnapshotId: "snapshot-other-run",
        contactId: "contact-2",
        clickedAt: "2026-07-01T13:06:00.000Z",
      }),
    );

    await expect(
      aggregateBroadcastLinkClicksByRunId(context.db, "run-1"),
    ).resolves.toEqual([
      {
        originalLink: "https://example.org/a",
        totalClicks: 5,
        botClicks: 2,
        uniqueClickers: 3,
      },
      {
        originalLink: "https://example.org/b",
        totalClicks: 1,
        botClicks: 1,
        uniqueClickers: 1,
      },
    ]);
  });

  it("round-trips bot-classification fields through list reads", async () => {
    await expect(
      insertBroadcastLinkClick(
        context.db,
        buildLinkClickRecord({
          id: "click-bot-1",
          idempotencyKey: "dedupe-bot-1",
          isBot: true,
          botReason: "fast_activity",
        }),
      ),
    ).resolves.toBe(true);

    await expect(
      listBroadcastLinkClicksForRun(context.db, "run-1"),
    ).resolves.toEqual([
      {
        id: "click-bot-1",
        campaignRunId: "run-1",
        audienceSnapshotId: "snapshot-contact",
        contactId: "contact-1",
        originalLink: "https://example.org/a",
        clickedAt: "2026-07-01T13:00:00.000Z",
        userAgent: "Mozilla/5.0",
        platform: "Desktop",
        client: {
          Name: "Chrome 137",
          Company: "Google",
          Family: "Chrome",
        },
        os: {
          Name: "macOS 15",
          Company: "Apple",
          Family: "macOS",
        },
        geo: {
          CountryISOCode: "US",
          Country: "United States",
          RegionISOCode: "MT",
          Region: "Montana",
          City: "Bozeman",
          Zip: "59715",
          Coords: "45.6770,-111.0429",
          IP: "203.0.113.7",
        },
        isBot: true,
        botReason: "fast_activity",
        idempotencyKey: "dedupe-bot-1",
        createdAt: "2026-07-01T13:00:00.000Z",
      },
    ]);
  });
});
