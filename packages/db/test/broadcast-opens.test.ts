import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  BroadcastOpenRecordInput,
  CreateDraftInput,
} from "@as-comms/contracts";

import {
  createStage5RepositoryBundle,
  type Stage5RepositoryBundle,
} from "../src/index.js";
import {
  insertBroadcastOpen,
  listBroadcastOpensForRun,
} from "../src/broadcast-opens-repository.js";
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
    audienceSize: 1,
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

function buildOpenRecord(
  overrides: Partial<BroadcastOpenRecordInput> &
    Pick<BroadcastOpenRecordInput, "id" | "idempotencyKey">,
): BroadcastOpenRecordInput {
  const { id, idempotencyKey, ...rest } = overrides;

  return {
    campaignRunId: "run-1",
    audienceSnapshotId: "snapshot-contact",
    contactId: "contact-1",
    openedAt: "2026-07-01T13:00:00.000Z",
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

describe("broadcast opens repository", () => {
  let context: TestStage1Context;
  let campaigns: Stage5RepositoryBundle;

  beforeEach(async () => {
    context = await createTestStage1Context();
    campaigns = createStage5RepositoryBundle(context.db);

    await seedProject(context, "project-1");
    await seedContact(context, "contact-1");
    await campaigns.campaignRuns.create(buildDraftInput("run-1"));
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
    ]);
  });

  afterEach(async () => {
    await context.dispose();
  });

  it("inserts idempotently and round-trips explicit bot classification", async () => {
    await expect(
      insertBroadcastOpen(
        context.db,
        buildOpenRecord({
          id: "open-1",
          idempotencyKey: "dedupe-open-1",
          isBot: true,
          botReason: "machine_user_agent",
        }),
      ),
    ).resolves.toBe(true);
    await expect(
      insertBroadcastOpen(
        context.db,
        buildOpenRecord({
          id: "open-1-replay",
          idempotencyKey: "dedupe-open-1",
        }),
      ),
    ).resolves.toBe(false);

    await expect(
      listBroadcastOpensForRun(context.db, "run-1"),
    ).resolves.toEqual([
      {
        id: "open-1",
        campaignRunId: "run-1",
        audienceSnapshotId: "snapshot-contact",
        contactId: "contact-1",
        openedAt: "2026-07-01T13:00:00.000Z",
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
        botReason: "machine_user_agent",
        idempotencyKey: "dedupe-open-1",
        createdAt: "2026-07-01T13:00:00.000Z",
      },
    ]);
  });

  it("defaults to human classification when bot fields are omitted", async () => {
    await expect(
      insertBroadcastOpen(
        context.db,
        buildOpenRecord({
          id: "open-2",
          idempotencyKey: "dedupe-open-2",
        }),
      ),
    ).resolves.toBe(true);

    await expect(
      listBroadcastOpensForRun(context.db, "run-1"),
    ).resolves.toEqual([
      {
        id: "open-2",
        campaignRunId: "run-1",
        audienceSnapshotId: "snapshot-contact",
        contactId: "contact-1",
        openedAt: "2026-07-01T13:00:00.000Z",
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
        isBot: false,
        botReason: null,
        idempotencyKey: "dedupe-open-2",
        createdAt: "2026-07-01T13:00:00.000Z",
      },
    ]);
  });
});
