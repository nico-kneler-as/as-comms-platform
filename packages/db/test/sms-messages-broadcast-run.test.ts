import { afterEach, describe, expect, it } from "vitest";

import { asc } from "drizzle-orm";

import { campaignRuns, smsMessages, smsSenders } from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

type Stage1Context = Awaited<ReturnType<typeof createTestStage1Context>>;

async function seedContact(context: Stage1Context) {
  await context.repositories.contacts.upsert({
    id: "contact-sms-1",
    salesforceContactId: null,
    displayName: "SMS Contact",
    primaryEmail: null,
    primaryPhone: "+15555550123",
    createdAt: "2026-07-02T12:00:00.000Z",
    updatedAt: "2026-07-02T12:00:00.000Z",
  });
}

async function seedSender(context: Stage1Context) {
  await context.db.insert(smsSenders).values({
    id: "sender-sms-1",
    phoneE164: "+15555550999",
    displayName: "Primary SMS Sender",
  });
}

async function seedBroadcastRun(context: Stage1Context) {
  await context.db.insert(campaignRuns).values({
    id: "campaign-run-sms-1",
    kind: "project",
    launchType: "sms",
    state: "draft",
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
  });
}

describe("sms_messages broadcast run id", () => {
  const contexts: Stage1Context[] = [];

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
  });

  it("persists nullable and non-null broadcast run ids", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);

    await seedContact(context);
    await seedSender(context);
    await seedBroadcastRun(context);

    const withBroadcastRun = await context.repositories.smsMessages.insert({
      id: "sms-message-with-run",
      twilioMessageSid: null,
      direction: "outbound",
      contactId: "contact-sms-1",
      phoneE164: "+15555550123",
      senderId: "sender-sms-1",
      broadcastRunId: "campaign-run-sms-1",
      body: "Broadcast message body",
      segments: 1,
      encoding: "GSM-7",
      mediaUrls: null,
      sendStatus: "queued",
      failedReason: null,
      failedDetail: null,
      sentAt: null,
      receivedAt: null,
      actorId: null,
      createdAt: new Date("2026-07-02T12:01:00.000Z"),
      updatedAt: new Date("2026-07-02T12:01:00.000Z"),
    });

    const withoutBroadcastRun = await context.repositories.smsMessages.insert({
      id: "sms-message-without-run",
      twilioMessageSid: null,
      direction: "outbound",
      contactId: "contact-sms-1",
      phoneE164: "+15555550123",
      senderId: "sender-sms-1",
      broadcastRunId: null,
      body: "Direct message body",
      segments: 1,
      encoding: "GSM-7",
      mediaUrls: null,
      sendStatus: "queued",
      failedReason: null,
      failedDetail: null,
      sentAt: null,
      receivedAt: null,
      actorId: null,
      createdAt: new Date("2026-07-02T12:02:00.000Z"),
      updatedAt: new Date("2026-07-02T12:02:00.000Z"),
    });

    const rows = await context.db
      .select({
        id: smsMessages.id,
        broadcastRunId: smsMessages.broadcastRunId,
      })
      .from(smsMessages)
      .orderBy(asc(smsMessages.id));

    expect(withBroadcastRun.broadcastRunId).toBe("campaign-run-sms-1");
    expect(withoutBroadcastRun.broadcastRunId).toBeNull();
    expect(rows).toEqual([
      {
        id: "sms-message-with-run",
        broadcastRunId: "campaign-run-sms-1",
      },
      {
        id: "sms-message-without-run",
        broadcastRunId: null,
      },
    ]);
  });
});
