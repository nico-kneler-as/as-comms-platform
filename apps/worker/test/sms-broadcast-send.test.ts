import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStage5RepositoryBundle, smsSenders } from "@as-comms/db";

import {
  createSmsBroadcastSendTask,
} from "../src/jobs/sms-broadcast-send/index.js";
import { createTestStage1Context } from "./helpers.js";

type Stage1Context = Awaited<ReturnType<typeof createTestStage1Context>>;

function buildCampaignRunWrapper(context: Stage1Context) {
  const campaigns = createStage5RepositoryBundle(context.db);
  const transitions: { from: string; to: string }[] = [];

  return {
    campaigns,
    transitions,
    campaignRuns: {
      findById: campaigns.campaignRuns.findById.bind(campaigns.campaignRuns),
      async transitionState(
        id: string,
        from: Parameters<typeof campaigns.campaignRuns.transitionState>[1],
        to: Parameters<typeof campaigns.campaignRuns.transitionState>[2],
        fields?: Parameters<typeof campaigns.campaignRuns.transitionState>[3],
      ) {
        transitions.push({ from, to });
        return campaigns.campaignRuns.transitionState(id, from, to, fields);
      },
    },
  };
}

async function seedUser(context: Stage1Context) {
  const now = new Date("2026-07-02T12:00:00.000Z");
  await context.settings.users.upsert({
    id: "user:admin",
    name: "Admin User",
    email: "admin@example.org",
    emailVerified: now,
    image: null,
    role: "admin",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedContact(
  context: Stage1Context,
  input: {
    readonly id: string;
    readonly phoneE164: string;
  },
) {
  await context.repositories.contacts.upsert({
    id: input.id,
    salesforceContactId: null,
    displayName: input.id,
    primaryEmail: null,
    primaryPhone: input.phoneE164,
    createdAt: "2026-07-02T12:00:00.000Z",
    updatedAt: "2026-07-02T12:00:00.000Z",
  });
}

async function seedSender(context: Stage1Context) {
  await context.db.insert(smsSenders).values({
    id: "sender-1",
    phoneE164: "+14065550999",
    displayName: "Primary Sender",
    monthlyCap: null,
    isActive: true,
    createdAt: new Date("2026-07-02T12:00:00.000Z"),
    updatedAt: new Date("2026-07-02T12:00:00.000Z"),
  });
}

async function seedProject(context: Stage1Context) {
  await context.repositories.projectDimensions.upsert({
    projectId: "project-1",
    projectName: "Project Atlas",
    projectAlias: "atlas",
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

async function seedRun(
  context: Stage1Context,
  input: {
    readonly id: string;
    readonly state?: "draft" | "scheduled" | "sending";
  },
) {
  const campaigns = createStage5RepositoryBundle(context.db);
  const created = await campaigns.campaignRuns.create({
    id: input.id,
    kind: "project",
    launchType: "sms",
    projectId: "project-1",
    name: input.id,
    fromEmail: null,
    fromName: null,
    replyToEmail: null,
    subjectTemplate: null,
    bodyDesignJson: null,
    bodyHtmlTemplate: null,
    bodyTextTemplate: "Hi {{firstName}}",
    preheader: null,
    audienceCriteria: {
      projectId: null,
      projectIds: [],
      statuses: [],
      contactIds: [],
      newsletterSubscriberIds: [],
      expeditionIds: [],
      lastActivityWindow: "all_time",
      hasReplied: "either",
      hasClicked: "either",
    },
    audienceSize: null,
    createdByUserId: "user:admin",
    lastEditedByUserId: "user:admin",
  });

  if (input.state === undefined || input.state === "draft") {
    return created;
  }

  if (input.state === "scheduled") {
    return campaigns.campaignRuns.transitionState(
      created.id,
      "draft",
      "scheduled",
    );
  }

  await campaigns.campaignRuns.transitionState(created.id, "draft", "scheduled");
  return campaigns.campaignRuns.transitionState(
    created.id,
    "scheduled",
    "sending",
  );
}

async function seedConsent(
  context: Stage1Context,
  input: {
    readonly id: string;
    readonly contactId: string | null;
    readonly phoneE164: string;
    readonly status: "opted_in" | "revoked";
    readonly createdAt: string;
  },
) {
  await context.repositories.consentRecords.insert({
    id: input.id,
    contactId: input.contactId,
    phoneE164: input.phoneE164,
    status: input.status,
    source: "operator_attestation",
    sourceDetail: null,
    consentedAt:
      input.status === "opted_in" ? new Date(input.createdAt) : null,
    revokedAt: input.status === "revoked" ? new Date(input.createdAt) : null,
    recordedByUserId: "user:admin",
    notes: null,
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.createdAt),
  });
}

async function seedMessage(
  context: Stage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly runId: string;
    readonly phoneE164: string;
    readonly status: "queued" | "sent";
    readonly createdAt: string;
  },
) {
  await context.repositories.smsMessages.insert({
    id: input.id,
    twilioMessageSid: input.status === "sent" ? `SM-${input.id}` : null,
    direction: "outbound",
    contactId: input.contactId,
    phoneE164: input.phoneE164,
    senderId: "sender-1",
    broadcastRunId: input.runId,
    body: `Body ${input.id}`,
    segments: 1,
    encoding: "GSM-7",
    mediaUrls: null,
    sendStatus: input.status,
    failedReason: null,
    failedDetail: null,
    sentAt:
      input.status === "sent" ? new Date("2026-07-02T12:05:00.000Z") : null,
    receivedAt: null,
    actorId: "user:admin",
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.createdAt),
  });
}

describe("sms broadcast send task", () => {
  let context: Stage1Context | null = null;

  beforeEach(async () => {
    context = await createTestStage1Context();
    await seedUser(context);
    await seedProject(context);
    await seedSender(context);
  });

  afterEach(async () => {
    await context?.dispose();
    context = null;
  });

  it("transitions scheduled runs to complete and marks queued rows sent", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    await seedContact(context, {
      id: "contact-1",
      phoneE164: "+14065550123",
    });
    await seedRun(context, {
      id: "run-1",
      state: "scheduled",
    });
    await seedConsent(context, {
      id: "consent-1",
      contactId: "contact-1",
      phoneE164: "+14065550123",
      status: "opted_in",
      createdAt: "2026-07-02T12:01:00.000Z",
    });
    await seedMessage(context, {
      id: "message-1",
      contactId: "contact-1",
      runId: "run-1",
      phoneE164: "+14065550123",
      status: "queued",
      createdAt: "2026-07-02T12:02:00.000Z",
    });

    const provider = {
      sendSms: vi.fn().mockResolvedValue({
        messageSid: "SM-1",
        segments: 1,
      }),
    };
    const wrapper = buildCampaignRunWrapper(context);
    const task = createSmsBroadcastSendTask({
      campaignRuns: wrapper.campaignRuns,
      repositories: {
        smsMessages: context.repositories.smsMessages,
        consentRecords: context.repositories.consentRecords,
      },
      provider,
      smsEnabled: true,
      now: () => new Date("2026-07-02T12:03:00.000Z"),
    });

    await task({ runId: "run-1" }, {} as never);

    expect(provider.sendSms).toHaveBeenCalledOnce();
    expect(provider.sendSms).toHaveBeenCalledWith({
      toE164: "+14065550123",
      body: "Body message-1",
    });
    expect(wrapper.transitions).toEqual([
      { from: "scheduled", to: "sending" },
      { from: "sending", to: "complete" },
    ]);

    const updated = await context.repositories.smsMessages.findByTwilioSid("SM-1");
    expect(updated).toMatchObject({
      id: "message-1",
      sendStatus: "sent",
      twilioMessageSid: "SM-1",
    });
    const run = await wrapper.campaigns.campaignRuns.findById("run-1");
    expect(run?.state).toBe("complete");
  });

  it("suppresses rows whose consent is revoked at send time", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    await seedContact(context, {
      id: "contact-2",
      phoneE164: "+14065550124",
    });
    await seedRun(context, {
      id: "run-2",
      state: "sending",
    });
    await seedConsent(context, {
      id: "consent-2",
      contactId: "contact-2",
      phoneE164: "+14065550124",
      status: "revoked",
      createdAt: "2026-07-02T12:02:00.000Z",
    });
    await seedMessage(context, {
      id: "message-2",
      contactId: "contact-2",
      runId: "run-2",
      phoneE164: "+14065550124",
      status: "queued",
      createdAt: "2026-07-02T12:03:00.000Z",
    });

    const provider = {
      sendSms: vi.fn(),
    };
    const task = createSmsBroadcastSendTask({
      campaignRuns: buildCampaignRunWrapper(context).campaignRuns,
      repositories: {
        smsMessages: context.repositories.smsMessages,
        consentRecords: context.repositories.consentRecords,
      },
      provider,
      smsEnabled: true,
    });

    await task({ runId: "run-2" }, {} as never);

    expect(provider.sendSms).not.toHaveBeenCalled();
    const [row] = await context.repositories.smsMessages.listByBroadcastRun(
      "run-2",
      "suppressed",
    );
    expect(row).toMatchObject({
      id: "message-2",
      failedReason: "consent_revoked_at_send",
    });
  });

  it("marks provider failures failed and continues with later rows", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    await seedContact(context, {
      id: "contact-3",
      phoneE164: "+14065550125",
    });
    await seedContact(context, {
      id: "contact-4",
      phoneE164: "+14065550126",
    });
    await seedRun(context, {
      id: "run-3",
      state: "sending",
    });
    await seedConsent(context, {
      id: "consent-3",
      contactId: "contact-3",
      phoneE164: "+14065550125",
      status: "opted_in",
      createdAt: "2026-07-02T12:01:00.000Z",
    });
    await seedConsent(context, {
      id: "consent-4",
      contactId: "contact-4",
      phoneE164: "+14065550126",
      status: "opted_in",
      createdAt: "2026-07-02T12:01:30.000Z",
    });
    await seedMessage(context, {
      id: "message-3",
      contactId: "contact-3",
      runId: "run-3",
      phoneE164: "+14065550125",
      status: "queued",
      createdAt: "2026-07-02T12:02:00.000Z",
    });
    await seedMessage(context, {
      id: "message-4",
      contactId: "contact-4",
      runId: "run-3",
      phoneE164: "+14065550126",
      status: "queued",
      createdAt: "2026-07-02T12:03:00.000Z",
    });

    const provider = {
      sendSms: vi
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error("Invalid To phone number"), {
            code: 21211,
          }),
        )
        .mockResolvedValueOnce({
          messageSid: "SM-4",
          segments: 1,
        }),
    };
    const task = createSmsBroadcastSendTask({
      campaignRuns: buildCampaignRunWrapper(context).campaignRuns,
      repositories: {
        smsMessages: context.repositories.smsMessages,
        consentRecords: context.repositories.consentRecords,
      },
      provider,
      smsEnabled: true,
      now: () => new Date("2026-07-02T12:04:00.000Z"),
    });

    await task({ runId: "run-3" }, {} as never);

    const failedRows = await context.repositories.smsMessages.listByBroadcastRun(
      "run-3",
      "failed",
    );
    expect(failedRows).toHaveLength(1);
    expect(failedRows[0]).toMatchObject({
      id: "message-3",
      failedReason: "21211",
      failedDetail: "Invalid To phone number",
    });

    const sentRow = await context.repositories.smsMessages.findByTwilioSid("SM-4");
    expect(sentRow).toMatchObject({
      id: "message-4",
      sendStatus: "sent",
    });
  });

  it("does not resend already-sent rows on resume or rerun", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    await seedContact(context, {
      id: "contact-5",
      phoneE164: "+14065550127",
    });
    await seedContact(context, {
      id: "contact-6",
      phoneE164: "+14065550128",
    });
    const wrapper = buildCampaignRunWrapper(context);
    await seedRun(context, {
      id: "run-4",
      state: "sending",
    });
    await seedConsent(context, {
      id: "consent-5",
      contactId: "contact-5",
      phoneE164: "+14065550127",
      status: "opted_in",
      createdAt: "2026-07-02T12:01:00.000Z",
    });
    await seedConsent(context, {
      id: "consent-6",
      contactId: "contact-6",
      phoneE164: "+14065550128",
      status: "opted_in",
      createdAt: "2026-07-02T12:01:30.000Z",
    });
    await seedMessage(context, {
      id: "message-5",
      contactId: "contact-5",
      runId: "run-4",
      phoneE164: "+14065550127",
      status: "sent",
      createdAt: "2026-07-02T12:02:00.000Z",
    });
    await seedMessage(context, {
      id: "message-6",
      contactId: "contact-6",
      runId: "run-4",
      phoneE164: "+14065550128",
      status: "queued",
      createdAt: "2026-07-02T12:03:00.000Z",
    });

    const provider = {
      sendSms: vi.fn().mockResolvedValue({
        messageSid: "SM-6",
        segments: 1,
      }),
    };
    const task = createSmsBroadcastSendTask({
      campaignRuns: wrapper.campaignRuns,
      repositories: {
        smsMessages: context.repositories.smsMessages,
        consentRecords: context.repositories.consentRecords,
      },
      provider,
      smsEnabled: true,
      now: () => new Date("2026-07-02T12:04:00.000Z"),
    });

    await task({ runId: "run-4" }, {} as never);
    await task({ runId: "run-4" }, {} as never);

    expect(provider.sendSms).toHaveBeenCalledTimes(1);
    expect(provider.sendSms).toHaveBeenCalledWith({
      toE164: "+14065550128",
      body: "Body message-6",
    });
    const originalSentRow = await context.repositories.smsMessages.findByTwilioSid(
      "SM-message-5",
    );
    expect(originalSentRow).toMatchObject({
      id: "message-5",
      sendStatus: "sent",
    });
  });

  it("throws when SMS is disabled before sending anything", async () => {
    if (context === null) {
      throw new Error("Expected test context.");
    }

    await seedContact(context, {
      id: "contact-7",
      phoneE164: "+14065550129",
    });
    await seedRun(context, {
      id: "run-5",
      state: "scheduled",
    });
    await seedConsent(context, {
      id: "consent-7",
      contactId: "contact-7",
      phoneE164: "+14065550129",
      status: "opted_in",
      createdAt: "2026-07-02T12:01:00.000Z",
    });
    await seedMessage(context, {
      id: "message-7",
      contactId: "contact-7",
      runId: "run-5",
      phoneE164: "+14065550129",
      status: "queued",
      createdAt: "2026-07-02T12:02:00.000Z",
    });

    const provider = {
      sendSms: vi.fn(),
    };
    const task = createSmsBroadcastSendTask({
      campaignRuns: buildCampaignRunWrapper(context).campaignRuns,
      repositories: {
        smsMessages: context.repositories.smsMessages,
        consentRecords: context.repositories.consentRecords,
      },
      provider,
      smsEnabled: false,
    });

    await expect(task({ runId: "run-5" }, {} as never)).rejects.toThrow(
      "SMS disabled.",
    );
    expect(provider.sendSms).not.toHaveBeenCalled();
    const queuedRows = await context.repositories.smsMessages.listByBroadcastRun(
      "run-5",
      "queued",
    );
    expect(queuedRows).toHaveLength(1);
    const campaigns = createStage5RepositoryBundle(context.db);
    const run = await campaigns.campaignRuns.findById("run-5");
    expect(run?.state).toBe("scheduled");
  });
});
