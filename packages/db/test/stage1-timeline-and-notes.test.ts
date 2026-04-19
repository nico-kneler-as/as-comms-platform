import { describe, expect, it } from "vitest";

import {
  createStage1InternalNoteService,
  createStage1TimelinePresentationService
} from "@as-comms/domain";

import { createTestStage1Context } from "./helpers.js";

async function seedVolunteerContact(input: {
  readonly contactId: string;
  readonly salesforceContactId: string;
  readonly displayName: string;
  readonly email: string;
  readonly phone: string;
}) {
  const context = await createTestStage1Context();

  await context.repositories.projectDimensions.upsert({
    projectId: "project-stage1-seed",
    projectName: "Project Stage 1 Seed",
    source: "salesforce"
  });
  await context.repositories.expeditionDimensions.upsert({
    expeditionId: "expedition-stage1-seed",
    projectId: "project-stage1-seed",
    expeditionName: "Expedition Stage 1 Seed",
    source: "salesforce"
  });

  await context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: input.contactId,
      salesforceContactId: input.salesforceContactId,
      displayName: input.displayName,
      primaryEmail: input.email,
      primaryPhone: input.phone,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    identities: [
      {
        id: `${input.contactId}:email`,
        contactId: input.contactId,
        kind: "email",
        normalizedValue: input.email,
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: `${input.contactId}:phone`,
        contactId: input.contactId,
        kind: "phone",
        normalizedValue: input.phone,
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    memberships: [
      {
        id: `${input.contactId}:membership-seed`,
        contactId: input.contactId,
        projectId: "project-stage1-seed",
        expeditionId: "expedition-stage1-seed",
        role: null,
        status: "applied",
        source: "salesforce"
      }
    ]
  });

  return context;
}

function buildCommunicationClassification(input: {
  readonly sourceRecordType: string;
  readonly sourceRecordId: string;
  readonly messageKind: "one_to_one" | "auto" | "campaign";
  readonly direction: "inbound" | "outbound";
  readonly campaignRef?: {
    readonly providerCampaignId: string | null;
    readonly providerAudienceId: string | null;
    readonly providerMessageName: string | null;
  } | null;
  readonly threadRef?: {
    readonly crossProviderCollapseKey: string | null;
    readonly providerThreadId: string | null;
  } | null;
}) {
  return {
    messageKind: input.messageKind,
    sourceRecordType: input.sourceRecordType,
    sourceRecordId: input.sourceRecordId,
    campaignRef: input.campaignRef ?? null,
    threadRef:
      input.threadRef ?? {
        crossProviderCollapseKey: null,
        providerThreadId: null
      },
    direction: input.direction
  } as const;
}

describe("Stage 1 notes and timeline presenter", () => {
  it("creates an internal note through the canonical pipeline without mutating inbox state", async () => {
    const context = await seedVolunteerContact({
      contactId: "contact_1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer",
      email: "volunteer@example.org",
      phone: "+15555550123"
    });
    const noteService = createStage1InternalNoteService({
      persistence: context.persistence,
      normalization: context.normalization
    });
    const presenter = createStage1TimelinePresentationService(context.repositories);

    const result = await noteService.createNote({
      noteId: "note-1",
      contactId: "contact_1",
      body: "Volunteer asked to be contacted again next week.",
      occurredAt: "2026-01-02T00:00:00.000Z"
    });

    expect(result.outcome).toBe("applied");
    expect(result.sourceEvidence.provider).toBe("manual");
    expect(result.canonicalEvent.eventType).toBe("note.internal.created");
    expect(result.timelineProjection.channel).toBe("note");
    expect(result.noteDetail.body).toBe(
      "Volunteer asked to be contacted again next week."
    );
    expect(result.inboxProjection).toBeNull();
    await expect(
      context.repositories.inboxProjection.findByContactId("contact_1")
    ).resolves.toBeNull();

    await expect(
      presenter.listTimelineItemsByContactId("contact_1")
    ).resolves.toEqual([
      expect.objectContaining({
        family: "internal_note",
        body: "Volunteer asked to be contacted again next week.",
        authorDisplayName: null
      })
    ]);
  });

  it("renders exactly one typed family for each of the seven supported timeline families", async () => {
    const context = await seedVolunteerContact({
      contactId: "contact_1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer",
      email: "volunteer@example.org",
      phone: "+15555550123"
    });
    const noteService = createStage1InternalNoteService({
      persistence: context.persistence,
      normalization: context.normalization
    });
    const presenter = createStage1TimelinePresentationService(context.repositories);

    await context.repositories.projectDimensions.upsert({
      projectId: "project-stage1",
      projectName: "Project Stage 1",
      source: "salesforce"
    });
    await context.repositories.expeditionDimensions.upsert({
      expeditionId: "expedition-stage1",
      projectId: "project-stage1",
      expeditionName: "Expedition Stage 1",
      source: "salesforce"
    });

    await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_lifecycle",
        provider: "salesforce",
        providerRecordType: "lifecycle_milestone",
        providerRecordId: "membership-stage1:Expedition_Members__c.CreatedDate",
        receivedAt: "2026-01-01T00:00:05.000Z",
        occurredAt: "2026-01-01T00:00:00.000Z",
        payloadRef: "payloads/salesforce/lifecycle-1.json",
        idempotencyKey:
          "salesforce:lifecycle_milestone:membership-stage1:Expedition_Members__c.CreatedDate",
        checksum: "checksum-lifecycle"
      },
      canonicalEvent: {
        id: "evt_lifecycle",
        eventType: "lifecycle.signed_up",
        occurredAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "canonical:salesforce:lifecycle:1",
        summary: "Volunteer signed up",
        snippet: "Signed up"
      },
      identity: {
        salesforceContactId: "003-stage1",
        volunteerIdPlainValues: [],
        normalizedEmails: ["volunteer@example.org"],
        normalizedPhones: ["+15555550123"]
      },
      supportingSources: [],
      salesforceEventContext: {
        sourceEvidenceId: "sev_lifecycle",
        salesforceContactId: "003-stage1",
        projectId: "project-stage1",
        expeditionId: "expedition-stage1",
        sourceField: "Expedition_Members__c.CreatedDate"
      }
    });

    await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_auto_email",
        provider: "salesforce",
        providerRecordType: "flow_email",
        providerRecordId: "flow-email-1",
        receivedAt: "2026-01-01T00:01:05.000Z",
        occurredAt: "2026-01-01T00:01:00.000Z",
        payloadRef: "payloads/salesforce/flow-email-1.json",
        idempotencyKey: "salesforce:flow_email:flow-email-1",
        checksum: "checksum-auto-email"
      },
      canonicalEvent: {
        id: "evt_auto_email",
        eventType: "communication.email.outbound",
        occurredAt: "2026-01-01T00:01:00.000Z",
        idempotencyKey: "canonical:salesforce:flow-email-1",
        summary: "Auto email sent",
        snippet: "Training reminder"
      },
      communicationClassification: buildCommunicationClassification({
        sourceRecordType: "flow_email",
        sourceRecordId: "flow-email-1",
        messageKind: "auto",
        direction: "outbound"
      }),
      identity: {
        salesforceContactId: "003-stage1",
        volunteerIdPlainValues: [],
        normalizedEmails: ["volunteer@example.org"],
        normalizedPhones: ["+15555550123"]
      },
      supportingSources: [],
      salesforceCommunicationDetail: {
        sourceEvidenceId: "sev_auto_email",
        providerRecordId: "flow-email-1",
        channel: "email",
        messageKind: "auto",
        subject: "Training reminder",
        snippet: "Training reminder",
        sourceLabel: "Salesforce Flow"
      }
    });

    await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_campaign_email",
        provider: "mailchimp",
        providerRecordType: "campaign_activity",
        providerRecordId: "campaign-1:member-1:opened",
        receivedAt: "2026-01-01T00:02:05.000Z",
        occurredAt: "2026-01-01T00:02:00.000Z",
        payloadRef: "payloads/mailchimp/campaign-1-opened.json",
        idempotencyKey: "mailchimp:campaign_activity:campaign-1:member-1:opened",
        checksum: "checksum-campaign-email"
      },
      canonicalEvent: {
        id: "evt_campaign_email",
        eventType: "campaign.email.opened",
        occurredAt: "2026-01-01T00:02:00.000Z",
        idempotencyKey: "canonical:mailchimp:campaign-1:member-1:opened",
        summary: "Campaign email opened",
        snippet: "Campaign opened"
      },
      identity: {
        salesforceContactId: "003-stage1",
        volunteerIdPlainValues: [],
        normalizedEmails: ["volunteer@example.org"],
        normalizedPhones: []
      },
      supportingSources: [],
      mailchimpCampaignActivityDetail: {
        sourceEvidenceId: "sev_campaign_email",
        providerRecordId: "campaign-1:member-1:opened",
        activityType: "opened",
        campaignId: "campaign-1",
        audienceId: "audience-1",
        memberId: "member-1",
        campaignName: "Spring Outreach",
        snippet: "Campaign opened"
      }
    });

    await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_campaign_sms",
        provider: "simpletexting",
        providerRecordType: "message",
        providerRecordId: "campaign-message-1",
        receivedAt: "2026-01-01T00:03:05.000Z",
        occurredAt: "2026-01-01T00:03:00.000Z",
        payloadRef: "payloads/simpletexting/campaign-message-1.json",
        idempotencyKey: "simpletexting:message:campaign-message-1",
        checksum: "checksum-campaign-sms"
      },
      canonicalEvent: {
        id: "evt_campaign_sms",
        eventType: "communication.sms.outbound",
        occurredAt: "2026-01-01T00:03:00.000Z",
        idempotencyKey: "canonical:simpletexting:campaign-message-1",
        summary: "Campaign SMS sent",
        snippet: "Reminder text"
      },
      communicationClassification: buildCommunicationClassification({
        sourceRecordType: "message",
        sourceRecordId: "campaign-message-1",
        messageKind: "campaign",
        direction: "outbound",
        campaignRef: {
          providerCampaignId: "st-campaign-1",
          providerAudienceId: null,
          providerMessageName: "Text Blast"
        }
      }),
      identity: {
        salesforceContactId: "003-stage1",
        volunteerIdPlainValues: [],
        normalizedEmails: [],
        normalizedPhones: ["+15555550123"]
      },
      supportingSources: [],
      simpleTextingMessageDetail: {
        sourceEvidenceId: "sev_campaign_sms",
        providerRecordId: "campaign-message-1",
        direction: "outbound",
        messageKind: "campaign",
        messageTextPreview: "Reminder text",
        normalizedPhone: "+15555550123",
        campaignId: "st-campaign-1",
        campaignName: "Text Blast",
        providerThreadId: null,
        threadKey: null
      }
    });

    await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_one_to_one_email",
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-message-1",
        receivedAt: "2026-01-01T00:04:05.000Z",
        occurredAt: "2026-01-01T00:04:00.000Z",
        payloadRef: "payloads/gmail/gmail-message-1.json",
        idempotencyKey: "gmail:message:gmail-message-1",
        checksum: "checksum-one-to-one-email"
      },
      canonicalEvent: {
        id: "evt_one_to_one_email",
        eventType: "communication.email.inbound",
        occurredAt: "2026-01-01T00:04:00.000Z",
        idempotencyKey: "canonical:gmail:message-1",
        summary: "Inbound email received",
        snippet: "Can I still join?"
      },
      communicationClassification: buildCommunicationClassification({
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-1",
        messageKind: "one_to_one",
        direction: "inbound",
        threadRef: {
          crossProviderCollapseKey: "gmail-thread-1",
          providerThreadId: "thread-1"
        }
      }),
      identity: {
        salesforceContactId: "003-stage1",
        volunteerIdPlainValues: [],
        normalizedEmails: ["volunteer@example.org"],
        normalizedPhones: []
      },
      supportingSources: [],
      gmailMessageDetail: {
        sourceEvidenceId: "sev_one_to_one_email",
        providerRecordId: "gmail-message-1",
        gmailThreadId: "thread-1",
        rfc822MessageId: "<gmail-message-1@example.org>",
        direction: "inbound",
        subject: "Question about training",
        snippetClean: "Can I still join?",
        bodyTextPreview: "Can I still join the training this week?",
        capturedMailbox: "volunteers@example.org",
        projectInboxAlias: "project-stage1@example.org"
      }
    });

    await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        id: "sev_one_to_one_sms",
        provider: "simpletexting",
        providerRecordType: "message",
        providerRecordId: "conversation-message-1",
        receivedAt: "2026-01-01T00:05:05.000Z",
        occurredAt: "2026-01-01T00:05:00.000Z",
        payloadRef: "payloads/simpletexting/conversation-message-1.json",
        idempotencyKey: "simpletexting:message:conversation-message-1",
        checksum: "checksum-one-to-one-sms"
      },
      canonicalEvent: {
        id: "evt_one_to_one_sms",
        eventType: "communication.sms.inbound",
        occurredAt: "2026-01-01T00:05:00.000Z",
        idempotencyKey: "canonical:simpletexting:conversation-message-1",
        summary: "Inbound SMS received",
        snippet: "I can make it"
      },
      communicationClassification: buildCommunicationClassification({
        sourceRecordType: "message",
        sourceRecordId: "conversation-message-1",
        messageKind: "one_to_one",
        direction: "inbound",
        threadRef: {
          crossProviderCollapseKey: "sms-thread-1",
          providerThreadId: "st-thread-1"
        }
      }),
      identity: {
        salesforceContactId: "003-stage1",
        volunteerIdPlainValues: [],
        normalizedEmails: [],
        normalizedPhones: ["+15555550123"]
      },
      supportingSources: [],
      simpleTextingMessageDetail: {
        sourceEvidenceId: "sev_one_to_one_sms",
        providerRecordId: "conversation-message-1",
        direction: "inbound",
        messageKind: "one_to_one",
        messageTextPreview: "I can make it",
        normalizedPhone: "+15555550123",
        campaignId: null,
        campaignName: null,
        providerThreadId: "st-thread-1",
        threadKey: "sms-thread-1"
      }
    });

    await noteService.createNote({
      noteId: "note-7",
      contactId: "contact_1",
      body: "Internal follow-up note.",
      occurredAt: "2026-01-01T00:06:00.000Z",
      authorDisplayName: null
    });

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items.map((item) => item.family)).toEqual([
      "salesforce_event",
      "auto_email",
      "campaign_email",
      "campaign_sms",
      "one_to_one_email",
      "one_to_one_sms",
      "internal_note"
    ]);
    expect(items[0]).toEqual(
      expect.objectContaining({
        family: "salesforce_event",
        milestone: "signed_up",
        projectName: "Project Stage 1",
        expeditionName: "Expedition Stage 1",
        sourceField: "Expedition_Members__c.CreatedDate"
      })
    );
    expect(items[1]).toEqual(
      expect.objectContaining({
        family: "auto_email",
        direction: "outbound",
        subject: "Training reminder",
        sourceLabel: "Salesforce Flow"
      })
    );
    expect(items[2]).toEqual(
      expect.objectContaining({
        family: "campaign_email",
        activityType: "opened",
        campaignName: "Spring Outreach",
        campaignId: "campaign-1",
        audienceId: "audience-1"
      })
    );
    expect(items[3]).toEqual(
      expect.objectContaining({
        family: "campaign_sms",
        direction: "outbound",
        messageTextPreview: "Reminder text",
        campaignName: "Text Blast",
        campaignId: "st-campaign-1"
      })
    );
    expect(items[4]).toEqual(
      expect.objectContaining({
        family: "one_to_one_email",
        direction: "inbound",
        subject: "Question about training",
        threadId: "thread-1",
        mailbox: "project-stage1@example.org"
      })
    );
    expect(items[5]).toEqual(
      expect.objectContaining({
        family: "one_to_one_sms",
        direction: "inbound",
        messageTextPreview: "I can make it",
        phone: "+15555550123",
        threadKey: "sms-thread-1"
      })
    );
    expect(items[6]).toEqual(
      expect.objectContaining({
        family: "internal_note",
        body: "Internal follow-up note.",
        authorDisplayName: null
      })
    );
  });
});
