import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  BroadcastLinkClickRecordInput,
  BroadcastOpenRecordInput,
  CreateDraftInput,
} from "@as-comms/contracts";

import { readRunEngagementBreakdown } from "../../app/broadcasts/_lib/run-recipients";
import {
  createStage1WebTestRuntime,
  insertBroadcastLinkClickForTests,
  insertBroadcastOpenForTests,
  type Stage1WebTestRuntime,
} from "../../src/server/stage1-runtime.test-support";

function buildAudienceCriteria(
  projectId = "project-1",
): CreateDraftInput["audienceCriteria"] {
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
  audienceSize = 3,
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
    audienceSize,
    createdByUserId: null,
    lastEditedByUserId: null,
  };
}

async function seedProject(
  runtime: Stage1WebTestRuntime,
  projectId = "project-1",
) {
  await runtime.context.repositories.projectDimensions.upsert({
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

async function seedContact(runtime: Stage1WebTestRuntime, contactId: string) {
  await runtime.context.repositories.contacts.upsert({
    id: contactId,
    salesforceContactId: null,
    displayName: contactId,
    primaryEmail: `${contactId}@example.org`,
    primaryPhone: null,
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-10T12:00:00.000Z",
  });
}

function buildOpenRecord(
  overrides: Partial<BroadcastOpenRecordInput> &
    Pick<BroadcastOpenRecordInput, "id" | "idempotencyKey">,
): BroadcastOpenRecordInput {
  const { id, idempotencyKey, ...rest } = overrides;

  return {
    campaignRunId: "run-human-bot",
    audienceSnapshotId: "snapshot-contact-1",
    contactId: "contact-1",
    openedAt: "2026-07-10T13:00:00.000Z",
    userAgent: null,
    platform: "Desktop",
    client: null,
    os: null,
    geo: null,
    createdAt: "2026-07-10T13:00:00.000Z",
    ...rest,
    id,
    idempotencyKey,
  };
}

function buildLinkClickRecord(
  overrides: Partial<BroadcastLinkClickRecordInput> &
    Pick<BroadcastLinkClickRecordInput, "id" | "idempotencyKey">,
): BroadcastLinkClickRecordInput {
  const { id, idempotencyKey, ...rest } = overrides;

  return {
    campaignRunId: "run-human-bot",
    audienceSnapshotId: "snapshot-contact-1",
    contactId: "contact-1",
    originalLink: "https://example.org/a",
    clickedAt: "2026-07-10T13:00:00.000Z",
    userAgent: null,
    platform: "Desktop",
    client: null,
    os: null,
    geo: null,
    createdAt: "2026-07-10T13:00:00.000Z",
    ...rest,
    id,
    idempotencyKey,
  };
}

describe("readRunEngagementBreakdown", () => {
  let runtime: Stage1WebTestRuntime;

  beforeEach(async () => {
    runtime = await createStage1WebTestRuntime();

    await seedProject(runtime, "project-1");
    await seedContact(runtime, "contact-1");
    await seedContact(runtime, "contact-2");

    const { campaigns } = runtime.runtime;

    await campaigns.campaignRuns.create(buildDraftInput("run-human-bot"));
    await campaigns.campaignRuns.create(buildDraftInput("run-legacy", "project-1", 1));

    await campaigns.audienceSnapshots.bulkInsert("run-human-bot", [
      {
        id: "snapshot-contact-1",
        contactId: "contact-1",
        newsletterSubscriberId: null,
        frozenEmail: "contact-1@example.org",
        frozenFirstName: "Contact One",
        frozenProjectName: "Project project-1",
        frozenProjectId: "project-1",
        frozenAliasEmail: "project@example.org",
        unsubscribeToken: "token-contact-1",
        deliveryStatus: "sent",
        providerMessageId: "pm-contact-1",
      },
      {
        id: "snapshot-contact-2",
        contactId: "contact-2",
        newsletterSubscriberId: null,
        frozenEmail: "contact-2@example.org",
        frozenFirstName: "Contact Two",
        frozenProjectName: "Project project-1",
        frozenProjectId: "project-1",
        frozenAliasEmail: "project@example.org",
        unsubscribeToken: "token-contact-2",
        deliveryStatus: "sent",
        providerMessageId: "pm-contact-2",
      },
      {
        id: "snapshot-anon-1",
        contactId: null,
        newsletterSubscriberId: null,
        frozenEmail: "anon@example.org",
        frozenFirstName: "Anonymous",
        frozenProjectName: "Project project-1",
        frozenProjectId: "project-1",
        frozenAliasEmail: "project@example.org",
        unsubscribeToken: "token-anon-1",
        deliveryStatus: "sent",
        providerMessageId: "pm-anon-1",
      },
    ]);

    await campaigns.audienceSnapshots.bulkInsert("run-legacy", [
      {
        id: "legacy-snapshot-1",
        contactId: null,
        newsletterSubscriberId: null,
        frozenEmail: "legacy@example.org",
        frozenFirstName: "Legacy",
        frozenProjectName: "Project project-1",
        frozenProjectId: "project-1",
        frozenAliasEmail: "project@example.org",
        unsubscribeToken: "token-legacy-1",
        deliveryStatus: "sent",
        providerMessageId: "pm-legacy-1",
        openedAt: "2026-07-10T12:55:00.000Z",
        clickedAt: "2026-07-10T12:56:00.000Z",
      },
    ]);
  });

  afterEach(async () => {
    await runtime.dispose();
  });

  it("partitions distinct human and bot recipients for opens and clicks", async () => {
    await insertBroadcastOpenForTests(
      runtime,
      buildOpenRecord({
        id: "open-contact-1-bot",
        idempotencyKey: "open-contact-1-bot",
        isBot: true,
        botReason: "fast_activity",
      }),
    );
    await insertBroadcastOpenForTests(
      runtime,
      buildOpenRecord({
        id: "open-contact-1-human",
        idempotencyKey: "open-contact-1-human",
        openedAt: "2026-07-10T13:01:00.000Z",
        createdAt: "2026-07-10T13:01:00.000Z",
      }),
    );
    await insertBroadcastOpenForTests(
      runtime,
      buildOpenRecord({
        id: "open-contact-2-bot",
        idempotencyKey: "open-contact-2-bot",
        audienceSnapshotId: "snapshot-contact-2",
        contactId: "contact-2",
        openedAt: "2026-07-10T13:02:00.000Z",
        createdAt: "2026-07-10T13:02:00.000Z",
        isBot: true,
        botReason: "machine_user_agent",
      }),
    );
    await insertBroadcastOpenForTests(
      runtime,
      buildOpenRecord({
        id: "open-anon-human",
        idempotencyKey: "open-anon-human",
        audienceSnapshotId: "snapshot-anon-1",
        contactId: null,
        openedAt: "2026-07-10T13:03:00.000Z",
        createdAt: "2026-07-10T13:03:00.000Z",
      }),
    );

    await insertBroadcastLinkClickForTests(
      runtime,
      buildLinkClickRecord({
        id: "click-contact-1-human",
        idempotencyKey: "click-contact-1-human",
      }),
    );
    await insertBroadcastLinkClickForTests(
      runtime,
      buildLinkClickRecord({
        id: "click-contact-1-bot",
        idempotencyKey: "click-contact-1-bot",
        clickedAt: "2026-07-10T13:01:00.000Z",
        createdAt: "2026-07-10T13:01:00.000Z",
        isBot: true,
        botReason: "fast_activity",
      }),
    );
    await insertBroadcastLinkClickForTests(
      runtime,
      buildLinkClickRecord({
        id: "click-contact-2-bot",
        idempotencyKey: "click-contact-2-bot",
        audienceSnapshotId: "snapshot-contact-2",
        contactId: "contact-2",
        originalLink: "https://example.org/b",
        clickedAt: "2026-07-10T13:02:00.000Z",
        createdAt: "2026-07-10T13:02:00.000Z",
        isBot: true,
        botReason: "machine_user_agent",
      }),
    );
    await insertBroadcastLinkClickForTests(
      runtime,
      buildLinkClickRecord({
        id: "click-anon-human",
        idempotencyKey: "click-anon-human",
        audienceSnapshotId: "snapshot-anon-1",
        contactId: null,
        clickedAt: "2026-07-10T13:03:00.000Z",
        createdAt: "2026-07-10T13:03:00.000Z",
      }),
    );

    await expect(readRunEngagementBreakdown("run-human-bot")).resolves.toEqual({
      opens: {
        human: 2,
        bot: 1,
        hasEventData: true,
      },
      clicks: {
        human: 2,
        bot: 1,
        hasEventData: true,
      },
    });
  });

  it("returns empty breakdowns when no event rows exist for a run", async () => {
    await expect(readRunEngagementBreakdown("run-legacy")).resolves.toEqual({
      opens: {
        human: 0,
        bot: 0,
        hasEventData: false,
      },
      clicks: {
        human: 0,
        bot: 0,
        hasEventData: false,
      },
    });
  });
});
