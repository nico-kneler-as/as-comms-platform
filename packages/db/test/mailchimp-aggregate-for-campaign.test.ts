import { afterEach, describe, expect, it } from "vitest";

import {
  mailchimpCampaignActivityDetails,
  sourceEvidenceLog,
} from "../src/index.js";
import { createTestStage1Context } from "./helpers.js";

type Stage1Context = Awaited<ReturnType<typeof createTestStage1Context>>;

async function seedMailchimpActivity(
  context: Stage1Context,
  input: {
    readonly sourceEvidenceId: string;
    readonly providerRecordId: string;
    readonly activityType:
      | "sent"
      | "open"
      | "click"
      | "bounce"
      | "unsubscribe";
    readonly campaignId: string;
    readonly memberId: string;
    readonly createdAt: string;
  },
) {
  const createdAt = new Date(input.createdAt);

  await context.db.insert(sourceEvidenceLog).values({
    id: input.sourceEvidenceId,
    provider: "mailchimp",
    providerRecordType: "campaign_activity",
    providerRecordId: input.providerRecordId,
    receivedAt: createdAt,
    occurredAt: createdAt,
    payloadRef: `payloads/mailchimp/${input.providerRecordId}.json`,
    idempotencyKey: `mailchimp:${input.providerRecordId}`,
    checksum: `checksum:${input.providerRecordId}`,
    createdAt,
  });

  await context.db.insert(mailchimpCampaignActivityDetails).values({
    sourceEvidenceId: input.sourceEvidenceId,
    providerRecordId: input.providerRecordId,
    activityType: input.activityType,
    campaignId: input.campaignId,
    audienceId: "aud-1",
    memberId: input.memberId,
    campaignName: "Spring Launch",
    snippet: "Mailchimp activity",
    createdAt,
    updatedAt: createdAt,
  });
}

describe("mailchimp aggregate + recipient queries", () => {
  const contexts: Stage1Context[] = [];

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.dispose()));
  });

  it("aggregates campaign activity counts and pages recipient summaries", async () => {
    const context = await createTestStage1Context();
    contexts.push(context);
    const repository = context.repositories.mailchimpCampaignActivityDetails;

    await seedMailchimpActivity(context, {
      sourceEvidenceId: "mc-1-sent",
      providerRecordId: "mc-1-sent",
      activityType: "sent",
      campaignId: "campaign-1",
      memberId: "member-1",
      createdAt: "2026-05-10T12:01:00.000Z",
    });
    await seedMailchimpActivity(context, {
      sourceEvidenceId: "mc-1-open",
      providerRecordId: "mc-1-open",
      activityType: "open",
      campaignId: "campaign-1",
      memberId: "member-1",
      createdAt: "2026-05-10T12:05:00.000Z",
    });
    await seedMailchimpActivity(context, {
      sourceEvidenceId: "mc-2-sent",
      providerRecordId: "mc-2-sent",
      activityType: "sent",
      campaignId: "campaign-1",
      memberId: "member-2",
      createdAt: "2026-05-10T12:02:00.000Z",
    });
    await seedMailchimpActivity(context, {
      sourceEvidenceId: "mc-2-bounce",
      providerRecordId: "mc-2-bounce",
      activityType: "bounce",
      campaignId: "campaign-1",
      memberId: "member-2",
      createdAt: "2026-05-10T12:06:00.000Z",
    });
    await seedMailchimpActivity(context, {
      sourceEvidenceId: "mc-3-sent",
      providerRecordId: "mc-3-sent",
      activityType: "sent",
      campaignId: "campaign-1",
      memberId: "member-3",
      createdAt: "2026-05-10T12:03:00.000Z",
    });
    await seedMailchimpActivity(context, {
      sourceEvidenceId: "mc-3-unsubscribe",
      providerRecordId: "mc-3-unsubscribe",
      activityType: "unsubscribe",
      campaignId: "campaign-1",
      memberId: "member-3",
      createdAt: "2026-05-10T12:07:00.000Z",
    });
    await seedMailchimpActivity(context, {
      sourceEvidenceId: "mc-4-sent",
      providerRecordId: "mc-4-sent",
      activityType: "sent",
      campaignId: "campaign-1",
      memberId: "member-4",
      createdAt: "2026-05-10T12:04:00.000Z",
    });

    await seedMailchimpActivity(context, {
      sourceEvidenceId: "other-sent",
      providerRecordId: "other-sent",
      activityType: "sent",
      campaignId: "campaign-2",
      memberId: "member-x",
      createdAt: "2026-05-10T12:08:00.000Z",
    });

    await expect(repository.aggregateForCampaign("campaign-1")).resolves.toEqual({
      sent: 4,
      opened: 1,
      clicked: 0,
      bounced: 1,
      unsubscribed: 1,
      distinctMembers: 4,
    });

    await expect(
      repository.listRecipientsForCampaign("campaign-1", {
        limit: 2,
        offset: 1,
        filter: "all",
      }),
    ).resolves.toEqual({
      rows: [
        {
          memberId: "member-2",
          email: null,
          displayName: null,
          contactId: null,
          latestState: "bounced",
          latestEventAt: "2026-05-10T12:06:00.000Z",
        },
        {
          memberId: "member-1",
          email: null,
          displayName: null,
          contactId: null,
          latestState: "opened",
          latestEventAt: "2026-05-10T12:05:00.000Z",
        },
      ],
      total: 4,
    });

    await expect(
      repository.listRecipientsForCampaign("campaign-1", {
        limit: 10,
        offset: 0,
        filter: "bounced",
      }),
    ).resolves.toEqual({
      rows: [
        {
          memberId: "member-2",
          email: null,
          displayName: null,
          contactId: null,
          latestState: "bounced",
          latestEventAt: "2026-05-10T12:06:00.000Z",
        },
      ],
      total: 1,
    });
  });
});
