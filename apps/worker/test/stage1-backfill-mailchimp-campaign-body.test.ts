import { describe, expect, it } from "vitest";

import { backfillMailchimpCampaignBodies } from "../src/ops/backfill-mailchimp-campaign-body.js";
import { createTestWorkerContext, type TestWorkerContext } from "./helpers.js";

const contactId = "contact:mailchimp:003-stage1";

async function seedMailchimpContact(context: TestWorkerContext): Promise<void> {
  await context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: contactId,
      salesforceContactId: null,
      displayName: "Mailchimp Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    identities: [
      {
        id: `identity:${contactId}:email`,
        contactId,
        kind: "email",
        normalizedValue: "volunteer@example.org",
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    memberships: [],
  });
}

async function seedMailchimpCampaignEvent(input: {
  readonly context: TestWorkerContext;
  readonly sourceEvidenceId: string;
  readonly canonicalEventId: string;
  readonly providerRecordId: string;
  readonly eventType:
    | "campaign.email.sent"
    | "campaign.email.opened"
    | "campaign.email.clicked";
  readonly activityType: "sent" | "opened" | "clicked";
  readonly campaignId?: string;
  readonly occurredAt: string;
  readonly snippet: string;
}): Promise<void> {
  const campaignId = input.campaignId ?? "campaign-1";

  await input.context.normalization.applyNormalizedCanonicalEvent({
    sourceEvidence: {
      id: input.sourceEvidenceId,
      provider: "mailchimp",
      providerRecordType: "campaign_activity",
      providerRecordId: input.providerRecordId,
      receivedAt: "2026-02-01T00:05:00.000Z",
      occurredAt: input.occurredAt,
      payloadRef: `payloads/mailchimp/${input.providerRecordId}.json`,
      idempotencyKey: `mailchimp:${input.providerRecordId}`,
      checksum: `checksum:${input.providerRecordId}`,
    },
    canonicalEvent: {
      id: input.canonicalEventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      idempotencyKey: `canonical:${input.providerRecordId}`,
      summary:
        input.activityType === "clicked"
          ? "Campaign email clicked"
          : "Campaign email sent",
      snippet: input.snippet,
    },
    identity: {
      salesforceContactId: null,
      volunteerIdPlainValues: [],
      normalizedEmails: ["volunteer@example.org"],
      normalizedPhones: [],
    },
    supportingSources: [],
    mailchimpCampaignActivityDetail: {
      sourceEvidenceId: input.sourceEvidenceId,
      providerRecordId: input.providerRecordId,
      activityType: input.activityType,
      campaignId,
      audienceId: "audience-1",
      memberId: "member-1",
      campaignName: "Spring Update",
      snippet: input.snippet,
    },
  });
}

describe("Stage 1 Mailchimp campaign body backfill ops", () => {
  it("hydrates non-click rows from campaign HTML while leaving click snippets untouched", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedMailchimpContact(context);
      await seedMailchimpCampaignEvent({
        context,
        sourceEvidenceId: "sev_mailchimp_sent",
        canonicalEventId: "evt_mailchimp_sent",
        providerRecordId: "campaign-1:member-1:sent",
        eventType: "campaign.email.sent",
        activityType: "sent",
        occurredAt: "2026-02-01T15:00:00.000Z",
        snippet: "Preview text",
      });
      await seedMailchimpCampaignEvent({
        context,
        sourceEvidenceId: "sev_mailchimp_opened",
        canonicalEventId: "evt_mailchimp_opened",
        providerRecordId: "campaign-1:member-1:opened",
        eventType: "campaign.email.opened",
        activityType: "opened",
        occurredAt: "2026-02-01T15:01:00.000Z",
        snippet: "Preview text",
      });
      await seedMailchimpCampaignEvent({
        context,
        sourceEvidenceId: "sev_mailchimp_clicked",
        canonicalEventId: "evt_mailchimp_clicked",
        providerRecordId: "campaign-1:member-1:clicked",
        eventType: "campaign.email.clicked",
        activityType: "clicked",
        occurredAt: "2026-02-01T15:02:00.000Z",
        snippet: "https://example.org/project",
      });

      const dryRun = await backfillMailchimpCampaignBodies({
        db: context.db,
        repositories: context.repositories,
        fetchCampaignContent: async (campaignId) => {
          expect(campaignId).toBe("campaign-1");
          return {
            html: "<p>Campaign body line one.</p><p>Campaign body line two.</p>",
          };
        },
        dryRun: true,
        options: {
          progressInterval: null,
        },
      });

      expect(dryRun).toMatchObject({
        dryRun: true,
        scannedCount: 2,
        campaignCount: 1,
        fetchedCount: 1,
        wouldUpdateCount: 2,
        updatedCount: 0,
        skippedClickedCount: 1,
        failedCampaignIds: [],
        missingCampaignIds: [],
      });

      const confirm = await backfillMailchimpCampaignBodies({
        db: context.db,
        repositories: context.repositories,
        fetchCampaignContent: async () => ({
          html: "<p>Campaign body line one.</p><p>Campaign body line two.</p>",
        }),
        dryRun: false,
        options: {
          progressInterval: null,
        },
      });

      expect(confirm).toMatchObject({
        dryRun: false,
        scannedCount: 2,
        campaignCount: 1,
        fetchedCount: 1,
        wouldUpdateCount: 2,
        updatedCount: 2,
        skippedClickedCount: 1,
      });

      const afterRows =
        await context.repositories.mailchimpCampaignActivityDetails.listBySourceEvidenceIds(
          [
            "sev_mailchimp_sent",
            "sev_mailchimp_opened",
            "sev_mailchimp_clicked",
          ],
        );

      expect(afterRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceEvidenceId: "sev_mailchimp_sent",
            snippet: "Campaign body line one.\n\nCampaign body line two.",
          }),
          expect.objectContaining({
            sourceEvidenceId: "sev_mailchimp_opened",
            snippet: "Campaign body line one.\n\nCampaign body line two.",
          }),
          expect.objectContaining({
            sourceEvidenceId: "sev_mailchimp_clicked",
            snippet: "https://example.org/project",
          }),
        ]),
      );
    } finally {
      await context.dispose();
    }
  });

  it("sanitizes Mailchimp merge tags and footer content from plain text", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedMailchimpContact(context);
      await seedMailchimpCampaignEvent({
        context,
        sourceEvidenceId: "sev_mailchimp_plain_text",
        canonicalEventId: "evt_mailchimp_plain_text",
        providerRecordId: "campaign-plain:member-1:sent",
        eventType: "campaign.email.sent",
        activityType: "sent",
        campaignId: "campaign-plain",
        occurredAt: "2026-02-02T15:00:00.000Z",
        snippet: "Old preview",
      });

      const result = await backfillMailchimpCampaignBodies({
        db: context.db,
        repositories: context.repositories,
        fetchCampaignContent: async () => ({
          plain_text: [
            "*|MC_PREVIEW_TEXT|*",
            "",
            "Field update headline",
            "",
            "Bring your field notebook.",
            "",
            "============================================================",
            "** Facebook (https://example.org)",
            "Copyright © 2026 Adventure Scientists",
            "Want to change how you receive these emails?",
          ].join("\n"),
        }),
        dryRun: false,
        options: {
          campaignId: "campaign-plain",
          progressInterval: null,
        },
      });

      expect(result).toMatchObject({
        dryRun: false,
        scannedCount: 1,
        campaignCount: 1,
        updatedCount: 1,
      });

      const afterRows =
        await context.repositories.mailchimpCampaignActivityDetails.listBySourceEvidenceIds(
          ["sev_mailchimp_plain_text"],
        );

      expect(afterRows[0]).toMatchObject({
        snippet: "Field update headline\n\nBring your field notebook.",
      });
    } finally {
      await context.dispose();
    }
  });

  it("can limit the number of campaigns fetched for safe trial runs", async () => {
    const context = await createTestWorkerContext();
    const fetchedCampaignIds: string[] = [];

    try {
      await seedMailchimpContact(context);
      await seedMailchimpCampaignEvent({
        context,
        sourceEvidenceId: "sev_mailchimp_limited_1",
        canonicalEventId: "evt_mailchimp_limited_1",
        providerRecordId: "campaign-limited-1:member-1:sent",
        eventType: "campaign.email.sent",
        activityType: "sent",
        campaignId: "campaign-limited-1",
        occurredAt: "2026-02-03T15:00:00.000Z",
        snippet: "Old preview 1",
      });
      await seedMailchimpCampaignEvent({
        context,
        sourceEvidenceId: "sev_mailchimp_limited_2",
        canonicalEventId: "evt_mailchimp_limited_2",
        providerRecordId: "campaign-limited-2:member-1:sent",
        eventType: "campaign.email.sent",
        activityType: "sent",
        campaignId: "campaign-limited-2",
        occurredAt: "2026-02-04T15:00:00.000Z",
        snippet: "Old preview 2",
      });

      const result = await backfillMailchimpCampaignBodies({
        db: context.db,
        repositories: context.repositories,
        fetchCampaignContent: async (campaignId) => {
          fetchedCampaignIds.push(campaignId);
          return {
            plain_text: `Full body for ${campaignId}`,
          };
        },
        dryRun: true,
        options: {
          limitCampaigns: 1,
          progressInterval: null,
        },
      });

      expect(result).toMatchObject({
        dryRun: true,
        campaignCount: 1,
        scannedCount: 1,
        wouldUpdateCount: 1,
      });
      expect(fetchedCampaignIds).toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });
});
