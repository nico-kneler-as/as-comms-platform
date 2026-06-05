import { describe, expect, it } from "vitest";
import { messageAttachmentSchema } from "@as-comms/contracts";

import { createTestStage1Context } from "./helpers.js";
import {
  inboxRecencyExpectedOrder,
  inboxRecencyFixture,
  inboxSentExpectedOrder,
} from "./fixtures/inbox-recency-fixture.js";

interface SalesforceCommunicationDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly channel: "email" | "sms";
  readonly messageKind: "one_to_one" | "auto" | "campaign";
  readonly subject: string | null;
  readonly snippet: string;
  readonly sourceLabel: string;
}

interface SimpleTextingMessageDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly direction: "inbound" | "outbound";
  readonly messageKind: "one_to_one" | "campaign";
  readonly messageTextPreview: string;
  readonly normalizedPhone: string | null;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly providerThreadId: string | null;
  readonly threadKey: string | null;
}

interface MailchimpCampaignActivityDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly activityType: "sent" | "opened" | "clicked" | "unsubscribed";
  readonly campaignId: string | null;
  readonly audienceId: string | null;
  readonly memberId: string;
  readonly campaignName: string | null;
  readonly snippet: string;
}

interface ManualNoteDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly body: string;
  readonly authorDisplayName: string | null;
  readonly authorId: string | null;
}

type Stage1TestRepositories = Awaited<
  ReturnType<typeof createTestStage1Context>
>["repositories"];

async function seedTimelineFanoutContact(
  repositories: Stage1TestRepositories,
  contactId: string,
): Promise<void> {
  await repositories.contacts.upsert({
    id: contactId,
    salesforceContactId: `003-${contactId}`,
    displayName: `Contact ${contactId}`,
    primaryEmail: `${contactId}@example.org`,
    primaryPhone: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

async function seedTimelineFanoutEvent(input: {
  readonly repositories: Stage1TestRepositories;
  readonly eventId: string;
  readonly anchorContactId: string;
  readonly occurredAt: string;
  readonly direction: "inbound" | "outbound";
  readonly summary?: string;
}): Promise<{
  readonly canonicalEvent: Awaited<
    ReturnType<Stage1TestRepositories["canonicalEvents"]["upsert"]>
  >;
  readonly timelineProjection: Awaited<
    ReturnType<Stage1TestRepositories["timelineProjection"]["upsert"]>
  >;
}> {
  const sourceEvidenceId = `sev:${input.eventId}`;
  await input.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.eventId,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/gmail/${input.eventId}.json`,
    idempotencyKey: `gmail:${input.eventId}`,
    checksum: `checksum:${input.eventId}`,
  });

  const canonicalEvent = await input.repositories.canonicalEvents.upsert({
    id: input.eventId,
    contactId: input.anchorContactId,
    eventType: `communication.email.${input.direction}`,
    channel: "email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.eventId}`,
    provenance: {
      primaryProvider: "gmail",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: input.eventId,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: {
        providerThreadId: `thread:${input.eventId}`,
        crossProviderCollapseKey: null,
      },
      direction: input.direction,
      notes: null,
    },
    reviewState: "clear",
  });

  const timelineProjection = await input.repositories.timelineProjection.upsert({
    id: `timeline:${input.eventId}`,
    contactId: input.anchorContactId,
    canonicalEventId: input.eventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${input.eventId}`,
    eventType: canonicalEvent.eventType,
    summary: input.summary ?? input.eventId,
    channel: "email",
    primaryProvider: "gmail",
    reviewState: "clear",
  });

  return {
    canonicalEvent,
    timelineProjection,
  };
}

async function seedSharedInboxRecencyFixture(): Promise<{
  readonly repositories: Awaited<
    ReturnType<typeof createTestStage1Context>
  >["repositories"];
}> {
  const context = await createTestStage1Context();

  for (const [index, row] of inboxRecencyFixture.entries()) {
    await context.repositories.contacts.upsert({
      id: row.contactId,
      salesforceContactId: `003-recency-${index.toString()}`,
      displayName: row.displayName,
      primaryEmail: `${row.contactId}@example.org`,
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    if (row.lastInboundAt !== null) {
      const inboundSourceEvidenceId = `sev-recency-inbound-${index.toString()}`;
      const inboundCanonicalEventId = `evt-recency-inbound-${index.toString()}`;

      await context.repositories.sourceEvidence.append({
        id: inboundSourceEvidenceId,
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: inboundCanonicalEventId,
        receivedAt: row.lastInboundAt,
        occurredAt: row.lastInboundAt,
        payloadRef: `payloads/gmail/${inboundCanonicalEventId}.json`,
        idempotencyKey: `gmail:${inboundCanonicalEventId}`,
        checksum: `checksum:${inboundCanonicalEventId}`,
      });
      await context.repositories.canonicalEvents.upsert({
        id: inboundCanonicalEventId,
        contactId: row.contactId,
        eventType: "communication.email.inbound",
        channel: "email",
        occurredAt: row.lastInboundAt,
        contentFingerprint: null,
        sourceEvidenceId: inboundSourceEvidenceId,
        idempotencyKey: `canonical:${inboundCanonicalEventId}`,
        provenance: {
          primaryProvider: "gmail",
          primarySourceEvidenceId: inboundSourceEvidenceId,
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "message",
          sourceRecordId: inboundCanonicalEventId,
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: null,
          direction: "inbound",
          notes: null,
        },
        reviewState: "clear",
      });
    }

    if (row.lastOutboundAt !== null) {
      const outboundSourceEvidenceId = `sev-recency-outbound-${index.toString()}`;
      const outboundCanonicalEventId = `evt-recency-outbound-${index.toString()}`;

      await context.repositories.sourceEvidence.append({
        id: outboundSourceEvidenceId,
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: outboundCanonicalEventId,
        receivedAt: row.lastOutboundAt,
        occurredAt: row.lastOutboundAt,
        payloadRef: `payloads/gmail/${outboundCanonicalEventId}.json`,
        idempotencyKey: `gmail:${outboundCanonicalEventId}`,
        checksum: `checksum:${outboundCanonicalEventId}`,
      });
      await context.repositories.canonicalEvents.upsert({
        id: outboundCanonicalEventId,
        contactId: row.contactId,
        eventType: "communication.email.outbound",
        channel: "email",
        occurredAt: row.lastOutboundAt,
        contentFingerprint: null,
        sourceEvidenceId: outboundSourceEvidenceId,
        idempotencyKey: `canonical:${outboundCanonicalEventId}`,
        provenance: {
          primaryProvider: "gmail",
          primarySourceEvidenceId: outboundSourceEvidenceId,
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "message",
          sourceRecordId: outboundCanonicalEventId,
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: null,
          direction: "outbound",
          notes: null,
        },
        reviewState: "clear",
      });
    }

    await context.repositories.inboxProjection.upsert({
      contactId: row.contactId,
      bucket: row.lastInboundAt === null ? "Opened" : "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: row.lastInboundAt,
      lastOutboundAt: row.lastOutboundAt,
      lastActivityAt: row.lastActivityAt,
      snippet: `${row.displayName} preview`,
      archivedAt: null,
      lastCanonicalEventId:
        row.lastActivityAt === row.lastInboundAt
          ? `evt-recency-inbound-${index.toString()}`
          : `evt-recency-outbound-${index.toString()}`,
      lastEventType:
        row.lastActivityAt === row.lastInboundAt
          ? "communication.email.inbound"
          : "communication.email.outbound",
    });
  }

  return context;
}

async function appendSourceEvidenceRows(
  repositories: Awaited<
    ReturnType<typeof createTestStage1Context>
  >["repositories"],
  rows: readonly {
    readonly id: string;
    readonly provider:
      | "gmail"
      | "salesforce"
      | "simpletexting"
      | "mailchimp"
      | "manual";
    readonly providerRecordId: string;
    readonly receivedAt: string;
    readonly idempotencyKey: string;
    readonly checksum: string;
  }[],
): Promise<void> {
  for (const row of rows) {
    await repositories.sourceEvidence.append({
      id: row.id,
      provider: row.provider,
      providerRecordType: "message",
      providerRecordId: row.providerRecordId,
      receivedAt: row.receivedAt,
      occurredAt: row.receivedAt,
      payloadRef: `payloads/${row.provider}/${row.providerRecordId}.json`,
      idempotencyKey: row.idempotencyKey,
      checksum: row.checksum,
    });
  }
}

async function recordSourceEvidenceQuarantineRows(
  repositories: Awaited<
    ReturnType<typeof createTestStage1Context>
  >["repositories"],
  rows: readonly {
    readonly provider:
      | "gmail"
      | "salesforce"
      | "simpletexting"
      | "mailchimp"
      | "manual";
    readonly idempotencyKey: string;
    readonly checksum: string;
    readonly attemptedAt: string;
    readonly payloadRef: string;
    readonly providerRecordId: string;
  }[],
) {
  const records = [];

  for (const row of rows) {
    records.push(
      await repositories.sourceEvidenceQuarantine.record({
        provider: row.provider,
        idempotencyKey: row.idempotencyKey,
        checksum: row.checksum,
        attemptedAt: new Date(row.attemptedAt),
        reason: "checksum_mismatch",
        payloadRef: row.payloadRef,
        details: {
          provider: row.provider,
          providerRecordType: "message",
          providerRecordId: row.providerRecordId,
          receivedAt: row.attemptedAt,
          occurredAt: row.attemptedAt,
          payloadRef: row.payloadRef,
          idempotencyKey: row.idempotencyKey,
          checksum: row.checksum,
        },
      }),
    );
  }

  return records;
}

describe("Stage 1 DB repositories", () => {
  it("persists and maps source evidence, contacts, identities, and memberships", async () => {
    const { repositories, settings } = await createTestStage1Context();

    await settings.users.upsert({
      id: "user:stage-one",
      name: "Stage One Operator",
      email: "stage-one@example.org",
      emailVerified: new Date("2026-01-01T00:00:00.000Z"),
      image: null,
      role: "operator",
      deactivatedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const sourceEvidence = await repositories.sourceEvidence.append({
      id: "sev_1",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-1",
      receivedAt: "2026-01-01T00:01:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-1.json",
      idempotencyKey: "gmail:message:gmail-message-1",
      checksum: "checksum-1",
    });

    expect(
      await repositories.sourceEvidence.findById(sourceEvidence.id),
    ).toEqual(sourceEvidence);
    await expect(
      repositories.sourceEvidence.findByIdempotencyKey(
        sourceEvidence.idempotencyKey,
      ),
    ).resolves.toEqual(sourceEvidence);
    await expect(
      repositories.sourceEvidence.listByProviderRecord({
        provider: sourceEvidence.provider,
        providerRecordType: sourceEvidence.providerRecordType,
        providerRecordId: sourceEvidence.providerRecordId,
      }),
    ).resolves.toEqual([sourceEvidence]);

    const contact = await repositories.contacts.upsert({
      id: "contact_1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: "+15555550123",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(repositories.contacts.findById(contact.id)).resolves.toEqual(
      contact,
    );
    await expect(
      repositories.contacts.findBySalesforceContactId("003-stage1"),
    ).resolves.toEqual(contact);
    await expect(
      repositories.contacts.listByIds([contact.id]),
    ).resolves.toEqual([contact]);

    const identity = await repositories.contactIdentities.upsert({
      id: "identity_1",
      contactId: contact.id,
      kind: "email",
      normalizedValue: "volunteer@example.org",
      isPrimary: true,
      source: "salesforce",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    });

    await repositories.projectDimensions.upsert({
      projectId: "project_1",
      projectName: "Project Antarctica",
      source: "salesforce",
    });
    await repositories.expeditionDimensions.upsert({
      expeditionId: "expedition_1",
      projectId: "project_1",
      expeditionName: "Expedition Antarctica",
      source: "salesforce",
    });

    const membership = await repositories.contactMemberships.upsert({
      id: "membership_1",
      contactId: contact.id,
      projectId: "project_1",
      expeditionId: "expedition_1",
      salesforceMembershipId: "a0B-membership-1",
      role: "volunteer",
      status: "active",
      source: "salesforce",
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    await expect(
      repositories.contactIdentities.listByContactId(contact.id),
    ).resolves.toEqual([identity]);
    await expect(
      repositories.contactIdentities.listByNormalizedValue({
        kind: "email",
        normalizedValue: "volunteer@example.org",
      }),
    ).resolves.toEqual([identity]);

    await expect(
      repositories.contactMemberships.listByContactId(contact.id),
    ).resolves.toEqual([membership]);
    await expect(
      repositories.contactMemberships.listByContactIds([contact.id]),
    ).resolves.toEqual([membership]);

    const projectDimension = await repositories.projectDimensions.upsert({
      projectId: "project_1",
      projectName: "Project Antarctica",
      source: "salesforce",
    });
    const expeditionDimension = await repositories.expeditionDimensions.upsert({
      expeditionId: "expedition_1",
      projectId: "project_1",
      expeditionName: "Expedition Antarctica",
      source: "salesforce",
    });
    const gmailDetail = await repositories.gmailMessageDetails.upsert({
      sourceEvidenceId: sourceEvidence.id,
      providerRecordId: sourceEvidence.providerRecordId,
      gmailThreadId: "thread_1",
      rfc822MessageId: "<gmail-message-1@example.org>",
      direction: "inbound",
      subject: "Hello there",
      fromHeader: "Volunteer <volunteer@example.org>",
      toHeader: "Project Antarctica <project-antarctica@example.org>",
      ccHeader: null,
      fromEmails: [],
      toEmails: [],
      ccEmails: [],
      bccEmails: [],
      labelIds: ["INBOX"],
      snippetClean: "Hello there",
      bodyTextPreview: "Hello there from the volunteer mailbox.",
      capturedMailbox: "volunteers@example.org",
      projectInboxAlias: "project-antarctica@example.org",
    });
    const salesforceContext = await repositories.salesforceEventContext.upsert({
      sourceEvidenceId: sourceEvidence.id,
      salesforceContactId: contact.salesforceContactId,
      projectId: "project_1",
      expeditionId: "expedition_1",
      sourceField: null,
    });
    const salesforceCommunicationDetail =
      (await repositories.salesforceCommunicationDetails.upsert({
        sourceEvidenceId: sourceEvidence.id,
        providerRecordId: sourceEvidence.providerRecordId,
        channel: "email",
        messageKind: "auto",
        subject: "Automation complete",
        snippet: "Your workflow completed successfully.",
        sourceLabel: "Salesforce Flow",
      })) as SalesforceCommunicationDetailRecord;
    const simpleTextingMessageDetail =
      (await repositories.simpleTextingMessageDetails.upsert({
        sourceEvidenceId: sourceEvidence.id,
        providerRecordId: sourceEvidence.providerRecordId,
        direction: "outbound",
        messageKind: "campaign",
        messageTextPreview: "Campaign kickoff reminder",
        normalizedPhone: "+15555550123",
        campaignId: "campaign_sms_1",
        campaignName: "Volunteer Reminders",
        providerThreadId: "thread_1",
        threadKey: "thread-key-1",
      })) as SimpleTextingMessageDetailRecord;
    const mailchimpCampaignActivityDetail =
      (await repositories.mailchimpCampaignActivityDetails.upsert({
        sourceEvidenceId: sourceEvidence.id,
        providerRecordId: sourceEvidence.providerRecordId,
        activityType: "sent",
        campaignId: "campaign_email_1",
        audienceId: "audience_1",
        memberId: "member_1",
        campaignName: "Spring Launch",
        snippet: "Campaign launch message",
      })) as MailchimpCampaignActivityDetailRecord;
    const manualNoteDetail = (await repositories.manualNoteDetails.upsert({
      sourceEvidenceId: sourceEvidence.id,
      providerRecordId: sourceEvidence.providerRecordId,
      body: "Follow up after the kickoff call.",
      authorDisplayName: "Stage One Operator",
      authorId: "user:stage-one",
    })) as ManualNoteDetailRecord;

    await expect(
      repositories.projectDimensions.listByIds(["project_1"]),
    ).resolves.toEqual([projectDimension]);
    await expect(
      repositories.expeditionDimensions.listByIds(["expedition_1"]),
    ).resolves.toEqual([expeditionDimension]);
    await expect(
      repositories.gmailMessageDetails.listBySourceEvidenceIds([
        sourceEvidence.id,
      ]),
    ).resolves.toEqual([gmailDetail]);
    await repositories.messageAttachments.upsertManyForMessage(
      sourceEvidence.id,
      [
        {
          id: "att:gmail:gmail-message-1:0",
          provider: "gmail",
          gmailAttachmentId: "gmail-attachment-1",
          mimeType: "image/png",
          filename: "image001.png",
          sizeBytes: 2048,
          storageKey: "gmail/ab/att:gmail:gmail-message-1:0",
          externalUrl: null,
          isDecoration: true,
        },
      ],
    );
    await expect(
      repositories.messageAttachments.findByMessageIds([sourceEvidence.id]),
    ).resolves.toMatchObject([
      {
        id: "att:gmail:gmail-message-1:0",
        sourceEvidenceId: sourceEvidence.id,
        provider: "gmail",
        gmailAttachmentId: "gmail-attachment-1",
        mimeType: "image/png",
        filename: "image001.png",
        sizeBytes: 2048,
        storageKey: "gmail/ab/att:gmail:gmail-message-1:0",
        externalUrl: null,
        isDecoration: true,
      },
    ]);
    await expect(
      repositories.salesforceEventContext.listBySourceEvidenceIds([
        sourceEvidence.id,
      ]),
    ).resolves.toEqual([salesforceContext]);
    await expect(
      repositories.salesforceCommunicationDetails.listBySourceEvidenceIds([
        sourceEvidence.id,
      ]),
    ).resolves.toEqual([salesforceCommunicationDetail]);
    await expect(
      repositories.simpleTextingMessageDetails.listBySourceEvidenceIds([
        sourceEvidence.id,
      ]),
    ).resolves.toEqual([simpleTextingMessageDetail]);
    await expect(
      repositories.mailchimpCampaignActivityDetails.listBySourceEvidenceIds([
        sourceEvidence.id,
      ]),
    ).resolves.toEqual([mailchimpCampaignActivityDetail]);
    await expect(
      repositories.manualNoteDetails.listBySourceEvidenceIds([
        sourceEvidence.id,
      ]),
    ).resolves.toEqual([manualNoteDetail]);
  });

  it("round-trips a drive attachment row", async () => {
    const { repositories } = await createTestStage1Context();
    const sourceEvidence = await repositories.sourceEvidence.append({
      id: "sev-drive-attachment",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-drive-attachment",
      receivedAt: "2026-01-01T00:00:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "payloads/gmail/drive-attachment.json",
      idempotencyKey: "gmail:drive-attachment",
      checksum: "checksum-drive-attachment",
    });

    await repositories.messageAttachments.upsertManyForMessage(sourceEvidence.id, [
      {
        id: "att:drive:gmail-drive-attachment:drive-file-1",
        provider: "drive",
        gmailAttachmentId: null,
        mimeType: "application/octet-stream",
        filename: "shared-file.pdf",
        sizeBytes: 0,
        storageKey: null,
        externalUrl: "https://drive.google.com/file/d/drive-file-1/view",
        isDecoration: false,
      },
    ]);

    await expect(
      repositories.messageAttachments.findById(
        "att:drive:gmail-drive-attachment:drive-file-1",
      ),
    ).resolves.toMatchObject({
      id: "att:drive:gmail-drive-attachment:drive-file-1",
      provider: "drive",
      gmailAttachmentId: null,
      storageKey: null,
      externalUrl: "https://drive.google.com/file/d/drive-file-1/view",
    });
  });

  it("round-trips Gmail and Drive attachments from one batch", async () => {
    const { repositories } = await createTestStage1Context();
    const sourceEvidence = await repositories.sourceEvidence.append({
      id: "sev-mixed-attachments",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-mixed-attachments",
      receivedAt: "2026-01-01T00:00:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "payloads/gmail/mixed-attachments.json",
      idempotencyKey: "gmail:mixed-attachments",
      checksum: "checksum-mixed-attachments",
    });

    await repositories.messageAttachments.upsertManyForMessage(sourceEvidence.id, [
      {
        id: "att:gmail:gmail-mixed-attachments:0/1",
        provider: "gmail",
        gmailAttachmentId: "gmail-attachment-1",
        mimeType: "image/png",
        filename: "image001.png",
        sizeBytes: 2048,
        storageKey: "gmail/ab/att:gmail:gmail-mixed-attachments:0/1",
        externalUrl: null,
        isDecoration: true,
      },
      {
        id: "att:drive:gmail-mixed-attachments:drive-file-2",
        provider: "drive",
        gmailAttachmentId: null,
        mimeType: "application/octet-stream",
        filename: "shared-file.pdf",
        sizeBytes: 0,
        storageKey: null,
        externalUrl: "https://drive.google.com/file/d/drive-file-2/view",
        isDecoration: false,
      },
    ]);

    await expect(
      repositories.messageAttachments.findByMessageIds([sourceEvidence.id]),
    ).resolves.toMatchObject([
      {
        id: "att:drive:gmail-mixed-attachments:drive-file-2",
        provider: "drive",
        externalUrl: "https://drive.google.com/file/d/drive-file-2/view",
      },
      {
        id: "att:gmail:gmail-mixed-attachments:0/1",
        provider: "gmail",
        externalUrl: null,
      },
    ]);
  });

  it("rejects malformed drive attachment rows", () => {
    expect(() =>
      messageAttachmentSchema.parse({
        id: "att:drive:bad",
        sourceEvidenceId: "sev-bad-drive",
        provider: "drive",
        gmailAttachmentId: null,
        mimeType: "application/octet-stream",
        filename: null,
        sizeBytes: 0,
        storageKey: null,
        externalUrl: null,
        isDecoration: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects malformed gmail attachment rows", () => {
    expect(() =>
      messageAttachmentSchema.parse({
        id: "att:gmail:bad",
        sourceEvidenceId: "sev-bad-gmail",
        provider: "gmail",
        gmailAttachmentId: null,
        mimeType: "image/png",
        filename: "image001.png",
        sizeBytes: 2048,
        storageKey: "gmail/ab/att:gmail:bad",
        externalUrl: null,
        isDecoration: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });

  it("returns no source-evidence collisions when the table is empty", async () => {
    const { repositories } = await createTestStage1Context();

    await expect(
      repositories.sourceEvidence.listIdempotencyChecksumCollisions({
        limit: 10,
      }),
    ).resolves.toEqual({
      entries: [],
      hasMore: false,
    });
  });

  it("ignores source-evidence keys that only have one checksum", async () => {
    const { repositories } = await createTestStage1Context();

    await appendSourceEvidenceRows(repositories, [
      {
        id: "sev-single",
        provider: "gmail",
        providerRecordId: "gmail-single",
        receivedAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "gmail:single",
        checksum: "checksum-single",
      },
    ]);

    await expect(
      repositories.sourceEvidence.listIdempotencyChecksumCollisions({
        limit: 10,
      }),
    ).resolves.toEqual({
      entries: [],
      hasMore: false,
    });
  });

  it("records and pages source-evidence quarantine rows", async () => {
    const { repositories } = await createTestStage1Context();

    const older = await repositories.sourceEvidenceQuarantine.record({
      provider: "gmail",
      idempotencyKey: "gmail:quarantine:older",
      checksum: "checksum-older",
      attemptedAt: new Date("2026-01-01T00:00:00.000Z"),
      reason: "checksum_mismatch",
      payloadRef: "payloads/gmail/quarantine-older.json",
      details: {
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-quarantine-older",
        receivedAt: "2026-01-01T00:00:00.000Z",
        occurredAt: "2026-01-01T00:00:00.000Z",
        payloadRef: "payloads/gmail/quarantine-older.json",
        idempotencyKey: "gmail:quarantine:older",
        checksum: "checksum-older",
      },
    });
    const newer = await repositories.sourceEvidenceQuarantine.record({
      provider: "gmail",
      idempotencyKey: "gmail:quarantine:newer",
      checksum: "checksum-newer",
      attemptedAt: new Date("2026-01-01T00:05:00.000Z"),
      reason: "checksum_mismatch",
      payloadRef: "payloads/gmail/quarantine-newer.json",
      details: {
        provider: "gmail",
        providerRecordType: "message",
        providerRecordId: "gmail-quarantine-newer",
        receivedAt: "2026-01-01T00:05:00.000Z",
        occurredAt: "2026-01-01T00:05:00.000Z",
        payloadRef: "payloads/gmail/quarantine-newer.json",
        idempotencyKey: "gmail:quarantine:newer",
        checksum: "checksum-newer",
      },
    });

    await expect(
      repositories.sourceEvidenceQuarantine.listRecent({
        limit: 1,
      }),
    ).resolves.toEqual({
      entries: [newer],
      hasMore: true,
    });

    await expect(
      repositories.sourceEvidenceQuarantine.listRecent({
        limit: 10,
        beforeTimestamp: new Date("2026-01-01T00:05:00.000Z"),
      }),
    ).resolves.toEqual({
      entries: [older],
      hasMore: false,
    });
  });

  it("returns the winning log row with quarantine-backed losing entries", async () => {
    const { repositories } = await createTestStage1Context();

    await appendSourceEvidenceRows(repositories, [
      {
        id: "sev-winning",
        provider: "gmail",
        providerRecordId: "gmail-winning",
        receivedAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "gmail:collision",
        checksum: "checksum-a",
      },
    ]);
    const [losingFirst, losingSecond] =
      await recordSourceEvidenceQuarantineRows(repositories, [
        {
          provider: "gmail",
          idempotencyKey: "gmail:collision",
          checksum: "checksum-b",
          attemptedAt: "2026-01-01T00:01:00.000Z",
          payloadRef: "payloads/gmail/gmail-losing-1.json",
          providerRecordId: "gmail-losing-1",
        },
        {
          provider: "gmail",
          idempotencyKey: "gmail:collision",
          checksum: "checksum-c",
          attemptedAt: "2026-01-01T00:02:00.000Z",
          payloadRef: "payloads/gmail/gmail-losing-2.json",
          providerRecordId: "gmail-losing-2",
        },
      ]);

    const result =
      await repositories.sourceEvidence.listIdempotencyChecksumCollisions({
        limit: 10,
      });

    expect(result.hasMore).toBe(false);
    expect(result.entries).toEqual([
      {
        provider: "gmail",
        idempotencyKey: "gmail:collision",
        latestReceivedAt: new Date("2026-01-01T00:02:00.000Z"),
        winning: {
          sourceEvidenceId: "sev-winning",
          checksum: "checksum-a",
          receivedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        losing: [
          {
            quarantineId: losingFirst?.id ?? "",
            checksum: "checksum-b",
            attemptedAt: new Date("2026-01-01T00:01:00.000Z"),
          },
          {
            quarantineId: losingSecond?.id ?? "",
            checksum: "checksum-c",
            attemptedAt: new Date("2026-01-01T00:02:00.000Z"),
          },
        ],
      },
    ]);
  });

  it("pages source-evidence collisions by latest received timestamp", async () => {
    const { repositories } = await createTestStage1Context();

    await appendSourceEvidenceRows(repositories, [
      {
        id: "sev-older-1",
        provider: "gmail",
        providerRecordId: "gmail-older-1",
        receivedAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "gmail:older",
        checksum: "older-a",
      },
      {
        id: "sev-newer-1",
        provider: "salesforce",
        providerRecordId: "sf-newer-1",
        receivedAt: "2026-01-01T01:00:00.000Z",
        idempotencyKey: "salesforce:newer",
        checksum: "newer-a",
      },
    ]);
    await recordSourceEvidenceQuarantineRows(repositories, [
      {
        provider: "gmail",
        idempotencyKey: "gmail:older",
        checksum: "older-b",
        attemptedAt: "2026-01-01T00:05:00.000Z",
        payloadRef: "payloads/gmail/gmail-older-2.json",
        providerRecordId: "gmail-older-2",
      },
      {
        provider: "salesforce",
        idempotencyKey: "salesforce:newer",
        checksum: "newer-b",
        attemptedAt: "2026-01-01T01:15:00.000Z",
        payloadRef: "payloads/salesforce/sf-newer-2.json",
        providerRecordId: "sf-newer-2",
      },
    ]);

    const result =
      await repositories.sourceEvidence.listIdempotencyChecksumCollisions({
        limit: 1,
      });

    expect(result.hasMore).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      provider: "salesforce",
      idempotencyKey: "salesforce:newer",
      latestReceivedAt: new Date("2026-01-01T01:15:00.000Z"),
    });
  });

  it("applies the beforeTimestamp cursor to source-evidence collisions", async () => {
    const { repositories } = await createTestStage1Context();

    await appendSourceEvidenceRows(repositories, [
      {
        id: "sev-cursor-old-1",
        provider: "gmail",
        providerRecordId: "gmail-cursor-old-1",
        receivedAt: "2026-01-01T00:00:00.000Z",
        idempotencyKey: "gmail:cursor-old",
        checksum: "cursor-old-a",
      },
      {
        id: "sev-cursor-new-1",
        provider: "mailchimp",
        providerRecordId: "mailchimp-cursor-new-1",
        receivedAt: "2026-01-01T01:00:00.000Z",
        idempotencyKey: "mailchimp:cursor-new",
        checksum: "cursor-new-a",
      },
    ]);
    await recordSourceEvidenceQuarantineRows(repositories, [
      {
        provider: "gmail",
        idempotencyKey: "gmail:cursor-old",
        checksum: "cursor-old-b",
        attemptedAt: "2026-01-01T00:10:00.000Z",
        payloadRef: "payloads/gmail/gmail-cursor-old-2.json",
        providerRecordId: "gmail-cursor-old-2",
      },
      {
        provider: "mailchimp",
        idempotencyKey: "mailchimp:cursor-new",
        checksum: "cursor-new-b",
        attemptedAt: "2026-01-01T01:20:00.000Z",
        payloadRef: "payloads/mailchimp/mailchimp-cursor-new-2.json",
        providerRecordId: "mailchimp-cursor-new-2",
      },
    ]);

    const result =
      await repositories.sourceEvidence.listIdempotencyChecksumCollisions({
        limit: 10,
        beforeTimestamp: new Date("2026-01-01T01:20:00.000Z"),
      });

    expect(result.hasMore).toBe(false);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      provider: "gmail",
      idempotencyKey: "gmail:cursor-old",
      latestReceivedAt: new Date("2026-01-01T00:10:00.000Z"),
    });
  });

  it("persists canonical events, review queues, and projections", async () => {
    const { repositories } = await createTestStage1Context();

    await repositories.contacts.upsert({
      id: "contact_1",
      salesforceContactId: "003-stage1",
      displayName: "Stage One Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await repositories.sourceEvidence.append({
      id: "sev_1",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-1",
      receivedAt: "2026-01-01T00:01:00.000Z",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-1.json",
      idempotencyKey: "gmail:message:gmail-message-1",
      checksum: "checksum-1",
    });

    const canonicalEvent = await repositories.canonicalEvents.upsert({
      id: "evt_1",
      contactId: "contact_1",
      eventType: "communication.email.inbound",
      channel: "email",
      occurredAt: "2026-01-01T00:00:00.000Z",
      contentFingerprint: null,
      sourceEvidenceId: "sev_1",
      idempotencyKey: "canonical:gmail-message-1",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: "sev_1",
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-1",
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: null,
        direction: "inbound",
        notes: null,
      },
      reviewState: "clear",
    });

    const identityCase = await repositories.identityResolutionQueue.upsert({
      id: "identity_case_1",
      sourceEvidenceId: "sev_1",
      candidateContactIds: ["contact_1"],
      reasonCode: "identity_missing_anchor",
      status: "open",
      openedAt: "2026-01-01T00:02:00.000Z",
      resolvedAt: null,
      normalizedIdentityValues: ["volunteer@example.org"],
      anchoredContactId: "contact_1",
      explanation: "Needs explicit confirmation for the first Stage 1 pass.",
    });

    const routingCase = await repositories.routingReviewQueue.upsert({
      id: "routing_case_1",
      contactId: "contact_1",
      sourceEvidenceId: "sev_1",
      reasonCode: "routing_missing_membership",
      status: "open",
      openedAt: "2026-01-01T00:03:00.000Z",
      resolvedAt: null,
      candidateMembershipIds: [],
      explanation: "Project context is intentionally absent in this fixture.",
    });

    const inboxProjection = await repositories.inboxProjection.upsert({
      contactId: "contact_1",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: true,
      lastInboundAt: "2026-01-01T00:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      snippet: "Inbound hello",
      archivedAt: null,
      lastCanonicalEventId: canonicalEvent.id,
      lastEventType: "communication.email.inbound",
    });

    const timelineProjection = await repositories.timelineProjection.upsert({
      id: "timeline_1",
      contactId: "contact_1",
      canonicalEventId: canonicalEvent.id,
      occurredAt: canonicalEvent.occurredAt,
      sortKey: "2026-01-01T00:00:00.000Z::evt_1",
      eventType: canonicalEvent.eventType,
      summary: "Inbound email received",
      channel: canonicalEvent.channel,
      primaryProvider: "gmail",
      reviewState: "clear",
    });
    await repositories.contacts.upsert({
      id: "contact_2",
      salesforceContactId: "003-stage1-secondary",
      displayName: "Another Volunteer",
      primaryEmail: "another@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await repositories.sourceEvidence.append({
      id: "sev_2",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-2",
      receivedAt: "2026-01-01T00:11:00.000Z",
      occurredAt: "2026-01-01T00:10:00.000Z",
      payloadRef: "payloads/gmail/gmail-message-2.json",
      idempotencyKey: "gmail:message:gmail-message-2",
      checksum: "checksum-2",
    });
    const secondCanonicalEvent = await repositories.canonicalEvents.upsert({
      id: "evt_2",
      contactId: "contact_2",
      eventType: "communication.email.outbound",
      channel: "email",
      occurredAt: "2026-01-01T00:10:00.000Z",
      contentFingerprint: null,
      sourceEvidenceId: "sev_2",
      idempotencyKey: "canonical:gmail-message-2",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: "sev_2",
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-2",
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: null,
        direction: "outbound",
        notes: null,
      },
      reviewState: "clear",
    });
    const secondInboxProjection = await repositories.inboxProjection.upsert({
      contactId: "contact_2",
      bucket: "Opened",
      needsFollowUp: true,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-01-01T00:10:00.000Z",
      lastActivityAt: "2026-01-01T00:10:00.000Z",
      snippet: "Outbound only follow-up",
      archivedAt: null,
      lastCanonicalEventId: secondCanonicalEvent.id,
      lastEventType: "communication.email.outbound",
    });

    await expect(
      repositories.canonicalEvents.findByIdempotencyKey(
        canonicalEvent.idempotencyKey,
      ),
    ).resolves.toEqual(canonicalEvent);
    await expect(
      repositories.canonicalEvents.listByContactId("contact_1"),
    ).resolves.toEqual([canonicalEvent]);
    await expect(
      repositories.canonicalEvents.listByIds([canonicalEvent.id]),
    ).resolves.toEqual([canonicalEvent]);
    await expect(
      repositories.identityResolutionQueue.listOpenByContactId("contact_1"),
    ).resolves.toEqual([identityCase]);
    await expect(
      repositories.identityResolutionQueue.listOpenByReasonCode(
        "identity_missing_anchor",
      ),
    ).resolves.toEqual([identityCase]);
    await expect(
      repositories.routingReviewQueue.listOpenByContactId("contact_1"),
    ).resolves.toEqual([routingCase]);
    await expect(
      repositories.routingReviewQueue.listOpenByReasonCode(
        "routing_missing_membership",
      ),
    ).resolves.toEqual([routingCase]);
    await expect(
      repositories.inboxProjection.findByContactId("contact_1"),
    ).resolves.toEqual(inboxProjection);
    await expect(
      repositories.inboxProjection.listAllOrderedByRecency(),
    ).resolves.toEqual([inboxProjection, secondInboxProjection]);
    await expect(
      repositories.inboxProjection.setNeedsFollowUp({
        contactId: "contact_1",
        needsFollowUp: true,
      }),
    ).resolves.toEqual({
      ...inboxProjection,
      needsFollowUp: true,
    });
    await expect(
      repositories.inboxProjection.findByContactId("contact_1"),
    ).resolves.toEqual({
      ...inboxProjection,
      needsFollowUp: true,
    });
    await repositories.inboxProjection.deleteByContactId("contact_1");
    await expect(
      repositories.inboxProjection.findByContactId("contact_1"),
    ).resolves.toBeNull();
    await expect(
      repositories.timelineProjection.findByCanonicalEventId(canonicalEvent.id),
    ).resolves.toEqual(timelineProjection);
    await expect(
      repositories.timelineProjection.listByContactId("contact_1"),
    ).resolves.toEqual([timelineProjection]);
  });

  it("preserves admin-managed project active state across project dimension upserts", async () => {
    const { repositories, settings } = await createTestStage1Context();

    await repositories.projectDimensions.upsert({
      projectId: "project_1",
      projectName: "Project Antarctica",
      // Alias required for setActive(true) per migration 0045 CHECK constraint.
      projectAlias: "Antarctica",
      isActive: false,
      source: "salesforce",
    });

    const activatedProject = await settings.projects.setActive("project_1", true);

    expect(activatedProject).toMatchObject({
      projectId: "project_1",
      isActive: true,
    });

    await repositories.projectDimensions.upsert({
      projectId: "project_1",
      projectName: "Project Antarctica Resynced",
      projectAlias: "Antarctica",
      isActive: false,
      source: "salesforce",
    });

    await expect(
      repositories.projectDimensions.listByIds(["project_1"]),
    ).resolves.toEqual([
      expect.objectContaining({
        projectId: "project_1",
        projectName: "Project Antarctica Resynced",
        isActive: true,
      }),
    ]);
  });

  it("preserves anchor-only timeline reads when no audience rows exist", async () => {
    const { repositories } = await createTestStage1Context();

    await seedTimelineFanoutContact(repositories, "contact_anchor");
    const event = await seedTimelineFanoutEvent({
      repositories,
      eventId: "evt_anchor_only",
      anchorContactId: "contact_anchor",
      occurredAt: "2026-02-01T00:00:00.000Z",
      direction: "inbound",
    });

    await expect(
      repositories.timelineProjection.listByContactId("contact_anchor"),
    ).resolves.toEqual([event.timelineProjection]);
    await expect(
      repositories.canonicalEvents.listByContactId("contact_anchor"),
    ).resolves.toEqual([event.canonicalEvent]);
    await expect(
      repositories.timelineProjection.listByContactId("contact_missing"),
    ).resolves.toEqual([]);
    await expect(
      repositories.canonicalEvents.listByContactId("contact_missing"),
    ).resolves.toEqual([]);
  });

  it("returns audience fan-in rows for non-anchor contacts", async () => {
    const { repositories } = await createTestStage1Context();

    await seedTimelineFanoutContact(repositories, "contact_anchor");
    await seedTimelineFanoutContact(repositories, "contact_audience");
    const event = await seedTimelineFanoutEvent({
      repositories,
      eventId: "evt_audience_only",
      anchorContactId: "contact_anchor",
      occurredAt: "2026-02-01T00:01:00.000Z",
      direction: "outbound",
    });
    await repositories.canonicalEventAudience.upsert({
      canonicalEventId: event.canonicalEvent.id,
      contactId: "contact_audience",
      participantRole: "direct_recipient",
      normalizedEmail: "contact_audience@example.org",
    });

    await expect(
      repositories.timelineProjection.listByContactId("contact_audience"),
    ).resolves.toEqual([event.timelineProjection]);
    await expect(
      repositories.canonicalEvents.listByContactId("contact_audience"),
    ).resolves.toEqual([event.canonicalEvent]);
  });

  it("de-duplicates rows when the anchor contact is also in audience", async () => {
    const { repositories } = await createTestStage1Context();

    await seedTimelineFanoutContact(repositories, "contact_anchor");
    const event = await seedTimelineFanoutEvent({
      repositories,
      eventId: "evt_anchor_and_audience",
      anchorContactId: "contact_anchor",
      occurredAt: "2026-02-01T00:02:00.000Z",
      direction: "inbound",
    });
    await repositories.canonicalEventAudience.upsert({
      canonicalEventId: event.canonicalEvent.id,
      contactId: "contact_anchor",
      participantRole: "sender",
      normalizedEmail: "contact_anchor@example.org",
    });

    await expect(
      repositories.timelineProjection.listByContactId("contact_anchor"),
    ).resolves.toEqual([event.timelineProjection]);
    await expect(
      repositories.canonicalEvents.listByContactId("contact_anchor"),
    ).resolves.toEqual([event.canonicalEvent]);
  });

  it("preserves timeline and ledger ordering across anchor and audience rows", async () => {
    const { repositories } = await createTestStage1Context();

    await seedTimelineFanoutContact(repositories, "contact_anchor_a");
    await seedTimelineFanoutContact(repositories, "contact_anchor_b");
    await seedTimelineFanoutContact(repositories, "contact_reader");

    const first = await seedTimelineFanoutEvent({
      repositories,
      eventId: "evt_b",
      anchorContactId: "contact_anchor_a",
      occurredAt: "2026-02-01T00:00:00.000Z",
      direction: "inbound",
    });
    const second = await seedTimelineFanoutEvent({
      repositories,
      eventId: "evt_a",
      anchorContactId: "contact_anchor_b",
      occurredAt: "2026-02-01T00:00:00.000Z",
      direction: "outbound",
    });
    const third = await seedTimelineFanoutEvent({
      repositories,
      eventId: "evt_c",
      anchorContactId: "contact_reader",
      occurredAt: "2026-02-01T00:03:00.000Z",
      direction: "outbound",
    });

    for (const canonicalEventId of [
      first.canonicalEvent.id,
      second.canonicalEvent.id,
    ]) {
      await repositories.canonicalEventAudience.upsert({
        canonicalEventId,
        contactId: "contact_reader",
        participantRole: "cc",
        normalizedEmail: "contact_reader@example.org",
      });
    }

    await expect(
      repositories.timelineProjection.listByContactId("contact_reader"),
    ).resolves.toEqual([
      second.timelineProjection,
      first.timelineProjection,
      third.timelineProjection,
    ]);
    await expect(
      repositories.canonicalEvents.listByContactId("contact_reader"),
    ).resolves.toEqual([
      second.canonicalEvent,
      first.canonicalEvent,
      third.canonicalEvent,
    ]);
  });

  it("does not leak unrelated anchor rows across contacts", async () => {
    const { repositories } = await createTestStage1Context();

    await seedTimelineFanoutContact(repositories, "contact_anchor");
    await seedTimelineFanoutContact(repositories, "contact_reader");
    await seedTimelineFanoutContact(repositories, "contact_unrelated");

    const sharedEvent = await seedTimelineFanoutEvent({
      repositories,
      eventId: "evt_shared",
      anchorContactId: "contact_anchor",
      occurredAt: "2026-02-01T00:04:00.000Z",
      direction: "inbound",
    });
    const unrelatedEvent = await seedTimelineFanoutEvent({
      repositories,
      eventId: "evt_unrelated",
      anchorContactId: "contact_unrelated",
      occurredAt: "2026-02-01T00:05:00.000Z",
      direction: "outbound",
    });
    await repositories.canonicalEventAudience.upsert({
      canonicalEventId: sharedEvent.canonicalEvent.id,
      contactId: "contact_reader",
      participantRole: "direct_recipient",
      normalizedEmail: "contact_reader@example.org",
    });

    await expect(
      repositories.timelineProjection.listByContactId("contact_reader"),
    ).resolves.toEqual([sharedEvent.timelineProjection]);
    await expect(
      repositories.canonicalEvents.listByContactId("contact_reader"),
    ).resolves.toEqual([sharedEvent.canonicalEvent]);
    await expect(
      repositories.timelineProjection.listByContactId("contact_unrelated"),
    ).resolves.toEqual([unrelatedEvent.timelineProjection]);
    await expect(
      repositories.canonicalEvents.listByContactId("contact_unrelated"),
    ).resolves.toEqual([unrelatedEvent.canonicalEvent]);
  });

  it("preserves operator-managed AI knowledge fields when a resync upsert passes nulls", async () => {
    const { repositories } = await createTestStage1Context();

    await repositories.projectDimensions.upsert({
      projectId: "project_1",
      projectName: "Project Antarctica",
      projectAlias: "Antarctica",
      source: "salesforce",
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/abc",
      aiKnowledgeSyncedAt: "2026-05-01T00:00:00.000Z",
    });

    await repositories.projectDimensions.upsert({
      projectId: "project_1",
      projectName: "Project Antarctica Resynced",
      projectAlias: "Antarctica",
      source: "salesforce",
      isActive: true,
      aiKnowledgeUrl: null,
      aiKnowledgeSyncedAt: null,
    });

    await expect(
      repositories.projectDimensions.listByIds(["project_1"]),
    ).resolves.toEqual([
      expect.objectContaining({
        projectId: "project_1",
        projectName: "Project Antarctica Resynced",
        aiKnowledgeUrl: "https://www.notion.so/abc",
        aiKnowledgeSyncedAt: "2026-05-01T00:00:00.000Z",
      }),
    ]);
  });

  it("allows explicit non-null AI knowledge fields to overwrite existing values", async () => {
    const { repositories } = await createTestStage1Context();

    await repositories.projectDimensions.upsert({
      projectId: "project_1",
      projectName: "Project Antarctica",
      projectAlias: "Antarctica",
      source: "salesforce",
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/abc",
      aiKnowledgeSyncedAt: "2026-05-01T00:00:00.000Z",
    });

    await repositories.projectDimensions.upsert({
      projectId: "project_1",
      projectName: "Project Antarctica Resynced",
      projectAlias: "Antarctica",
      source: "salesforce",
      isActive: true,
      aiKnowledgeUrl: "https://www.notion.so/xyz",
      aiKnowledgeSyncedAt: "2026-05-03T00:00:00.000Z",
    });

    await expect(
      repositories.projectDimensions.listByIds(["project_1"]),
    ).resolves.toEqual([
      expect.objectContaining({
        projectId: "project_1",
        projectName: "Project Antarctica Resynced",
        aiKnowledgeUrl: "https://www.notion.so/xyz",
        aiKnowledgeSyncedAt: "2026-05-03T00:00:00.000Z",
      }),
    ]);
  });

  it("persists sync state and audit evidence with contract-shaped results", async () => {
    const { repositories } = await createTestStage1Context();

    const syncRecord = await repositories.syncState.upsert({
      id: "sync_1",
      scope: "provider",
      provider: "gmail",
      jobType: "historical_backfill",
      cursor: "cursor-1",
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-02T00:00:00.000Z",
      status: "running",
      parityPercent: 99.5,
      freshnessP95Seconds: null,
      freshnessP99Seconds: null,
      lastSuccessfulAt: "2026-01-01T01:00:00.000Z",
      consecutiveFailureCount: 4,
      leaseOwner: "worker:test",
      heartbeatAt: "2026-01-01T00:30:00.000Z",
      deadLetterCount: 2,
    });

    const syncUpdate = await repositories.syncState.upsert({
      ...syncRecord,
      status: "succeeded",
      parityPercent: 100,
      consecutiveFailureCount: 0,
      leaseOwner: null,
      heartbeatAt: null,
      deadLetterCount: 0,
    });

    const auditRecord = await repositories.auditEvidence.append({
      id: "audit_1",
      actorType: "system",
      actorId: "stage1-test",
      action: "persisted_contact",
      entityType: "contact",
      entityId: "contact_1",
      occurredAt: "2026-01-01T01:05:00.000Z",
      result: "recorded",
      policyCode: "stage1.audit.test",
      metadataJson: {
        reason: "repository-integration",
      },
    });

    expect(syncUpdate.parityPercent).toBe(100);
    expect(syncUpdate.scope).toBe("provider");
    expect(syncUpdate.provider).toBe("gmail");
    expect(syncRecord.consecutiveFailureCount).toBe(4);
    expect(syncUpdate.consecutiveFailureCount).toBe(0);
    await expect(
      repositories.syncState.findLatest({
        scope: "provider",
        provider: "gmail",
        jobType: "historical_backfill",
      }),
    ).resolves.toEqual(syncUpdate);
    await expect(
      repositories.auditEvidence.listByEntity({
        entityType: "contact",
        entityId: "contact_1",
      }),
    ).resolves.toEqual([auditRecord]);
  });

  it("lists canonical events by content fingerprint window using an ISO timestamp parameter", async () => {
    const { repositories } = await createTestStage1Context();

    await repositories.contacts.upsert({
      id: "contact_fp",
      salesforceContactId: "003-fingerprint",
      displayName: "Fingerprint Contact",
      primaryEmail: "fingerprint@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await repositories.sourceEvidence.append({
      id: "sev_fp",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-message-fingerprint",
      receivedAt: "2026-03-30T01:29:24.000Z",
      occurredAt: "2026-03-30T01:29:24.000Z",
      payloadRef: "payloads/gmail/gmail-message-fingerprint.json",
      idempotencyKey: "gmail:message:gmail-message-fingerprint",
      checksum: "checksum-fingerprint",
    });

    const canonicalEvent = await repositories.canonicalEvents.upsert({
      id: "evt_fp",
      contactId: "contact_fp",
      eventType: "communication.email.outbound",
      channel: "email",
      occurredAt: "2026-03-30T01:29:24.000Z",
      contentFingerprint: "fp:stage1-fingerprint",
      sourceEvidenceId: "sev_fp",
      idempotencyKey: "canonical:gmail-message-fingerprint",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: "sev_fp",
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "message",
        sourceRecordId: "gmail-message-fingerprint",
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: null,
        direction: "outbound",
        notes: null,
      },
      reviewState: "clear",
    });

    await expect(
      repositories.canonicalEvents.listByContentFingerprintWindow({
        contactId: "contact_fp",
        channel: "email",
        contentFingerprint: "fp:stage1-fingerprint",
        occurredAt: "2026-03-30T01:31:24.000Z",
        windowMinutes: 5,
      }),
    ).resolves.toEqual([canonicalEvent]);
  });

  it("lists contacts whose inbox recency projection is still invalid", async () => {
    const { client, repositories } = await createTestStage1Context();

    await repositories.contacts.upsert({
      id: "contact_invalid",
      salesforceContactId: "003-invalid",
      displayName: "Invalid Projection",
      primaryEmail: "invalid@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await repositories.sourceEvidence.append({
      id: "sev_invalid",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-invalid",
      receivedAt: "2026-01-01T00:05:00.000Z",
      occurredAt: "2026-01-01T00:05:00.000Z",
      payloadRef: "payloads/gmail/gmail-invalid.json",
      idempotencyKey: "gmail:invalid",
      checksum: "checksum-invalid",
    });
    await repositories.canonicalEvents.upsert({
      id: "evt_invalid",
      contactId: "contact_invalid",
      eventType: "communication.email.outbound",
      channel: "email",
      occurredAt: "2026-01-01T00:05:00.000Z",
      contentFingerprint: null,
      sourceEvidenceId: "sev_invalid",
      idempotencyKey: "canonical:invalid",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: "sev_invalid",
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "message",
        sourceRecordId: "gmail-invalid",
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: null,
        direction: "outbound",
        notes: null,
      },
      reviewState: "clear",
    });

    await client.exec(`
      insert into contact_inbox_projection (
        contact_id,
        bucket,
        is_starred,
        has_unresolved,
        last_inbound_at,
        last_outbound_at,
        last_activity_at,
        snippet,
        last_canonical_event_id,
        last_event_type
      ) values (
        'contact_invalid',
        'Opened',
        false,
        false,
        '2026-01-01T00:01:00.000Z',
        '2026-01-01T00:05:00.000Z',
        '2026-01-01T00:01:00.000Z',
        'Legacy stale projection',
        'evt_invalid',
        'communication.email.outbound'
      );
    `);

    await expect(
      repositories.inboxProjection.countInvalidRecencyRows(),
    ).resolves.toBe(1);
    await expect(
      repositories.inboxProjection.listInvalidRecencyContactIds(),
    ).resolves.toEqual(["contact_invalid"]);
  });

  it("orders and paginates inbox rows with null inbound timestamps last", async () => {
    const { repositories } = await seedSharedInboxRecencyFixture();

    const orderedRows =
      await repositories.inboxProjection.listAllOrderedByRecency();

    expect(orderedRows.map((row) => row.contactId)).toEqual(
      inboxRecencyExpectedOrder,
    );

    const firstPage =
      await repositories.inboxProjection.listPageOrderedByRecency({
        filter: "visible",
        order: "last-inbound",
        limit: 4,
        cursor: null,
      });

    expect(firstPage.map((row) => row.contactId)).toEqual(
      inboxRecencyExpectedOrder.slice(0, 4),
    );

    const secondPage =
      await repositories.inboxProjection.listPageOrderedByRecency({
        filter: "visible",
        order: "last-inbound",
        limit: 4,
        cursor: {
          lastInboundAt: firstPage[firstPage.length - 1]?.lastInboundAt ?? null,
          lastOutboundAt:
            firstPage[firstPage.length - 1]?.lastOutboundAt ?? null,
          lastActivityAt: firstPage[firstPage.length - 1]?.lastActivityAt ?? "",
          contactId: firstPage[firstPage.length - 1]?.contactId ?? "",
        },
      });

    expect(secondPage.map((row) => row.contactId)).toEqual(
      inboxRecencyExpectedOrder.slice(4),
    );
  });

  it("orders and paginates sent inbox rows by last outbound timestamps", async () => {
    const { repositories } = await seedSharedInboxRecencyFixture();

    const firstPage =
      await repositories.inboxProjection.listPageOrderedByRecency({
        filter: "sent",
        order: "last-outbound",
        limit: 2,
        cursor: null,
      });

    expect(firstPage.map((row) => row.contactId)).toEqual(
      inboxSentExpectedOrder.slice(0, 2),
    );

    const secondPage =
      await repositories.inboxProjection.listPageOrderedByRecency({
        filter: "sent",
        order: "last-outbound",
        limit: 2,
        cursor: {
          lastInboundAt: firstPage[firstPage.length - 1]?.lastInboundAt ?? null,
          lastOutboundAt:
            firstPage[firstPage.length - 1]?.lastOutboundAt ?? null,
          lastActivityAt: firstPage[firstPage.length - 1]?.lastActivityAt ?? "",
          contactId: firstPage[firstPage.length - 1]?.contactId ?? "",
        },
      });

    expect(secondPage.map((row) => row.contactId)).toEqual(
      inboxSentExpectedOrder.slice(2),
    );
  });

  it("matches project filters against any active membership and excludes inactive project memberships", async () => {
    const { repositories, settings } = await createTestStage1Context();
    const now = new Date("2026-04-20T00:00:00.000Z");

    // Alias required for active rows per migration 0045 CHECK constraint.
    await repositories.projectDimensions.upsert({
      projectId: "project:pnw-bio",
      projectName: "PNW Biodiversity",
      projectAlias: "PNW Biodiversity",
      source: "salesforce",
      isActive: true,
    });
    await repositories.projectDimensions.upsert({
      projectId: "project:whitebark-pine",
      projectName: "Tracking Whitebark Pine",
      projectAlias: "Whitebark Pine",
      source: "salesforce",
      isActive: true,
    });
    await repositories.projectDimensions.upsert({
      projectId: "project:forests-a",
      projectName: "Forests A",
      projectAlias: "Forests A",
      source: "salesforce",
      isActive: true,
    });
    await repositories.projectDimensions.upsert({
      projectId: "project:forests-b",
      projectName: "Forests B",
      projectAlias: "Forests B",
      source: "salesforce",
      isActive: true,
    });
    await repositories.projectDimensions.upsert({
      projectId: "project:inactive-c",
      projectName: "Inactive Project",
      projectAlias: "Inactive",
      source: "salesforce",
      isActive: true,
    });
    await settings.projects.setActive("project:inactive-c", false);
    await settings.aliases.create({
      id: "alias:forests-a",
      alias: "forests-a@example.org",
      signature: "",
      projectId: "project:forests-a",
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
    });
    await settings.aliases.create({
      id: "alias:forests-b",
      alias: "forests-b@example.org",
      signature: "",
      projectId: "project:forests-b",
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
    });

    const seedInboxContact = async (input: {
      readonly contactId: string;
      readonly displayName: string;
      readonly occurredAt: string;
      readonly sourceEvidenceId: string;
      readonly canonicalEventId: string;
      readonly provider: "gmail" | "salesforce";
      readonly projectInboxAlias?: string;
      readonly snippet: string;
    }) => {
      await repositories.contacts.upsert({
        id: input.contactId,
        salesforceContactId: `003-${input.contactId}`,
        displayName: input.displayName,
        primaryEmail: `${input.contactId}@example.org`,
        primaryPhone: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      await repositories.sourceEvidence.append({
        id: input.sourceEvidenceId,
        provider: input.provider,
        providerRecordType: input.provider === "gmail" ? "message" : "task",
        providerRecordId: input.canonicalEventId,
        receivedAt: input.occurredAt,
        occurredAt: input.occurredAt,
        payloadRef: `payloads/${input.provider}/${input.canonicalEventId}.json`,
        idempotencyKey: `${input.provider}:${input.canonicalEventId}`,
        checksum: `checksum:${input.canonicalEventId}`,
      });
      await repositories.canonicalEvents.upsert({
        id: input.canonicalEventId,
        contactId: input.contactId,
        eventType: "communication.email.inbound",
        channel: "email",
        occurredAt: input.occurredAt,
        contentFingerprint: null,
        sourceEvidenceId: input.sourceEvidenceId,
        idempotencyKey: `canonical:${input.canonicalEventId}`,
        provenance: {
          primaryProvider: input.provider,
          primarySourceEvidenceId: input.sourceEvidenceId,
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: input.provider === "gmail" ? "message" : "task",
          sourceRecordId: input.canonicalEventId,
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: null,
          direction: "inbound",
          notes: null,
        },
        reviewState: "clear",
      });

      if (input.projectInboxAlias !== undefined) {
        await repositories.gmailMessageDetails.upsert({
          sourceEvidenceId: input.sourceEvidenceId,
          providerRecordId: input.canonicalEventId,
          gmailThreadId: `thread:${input.canonicalEventId}`,
          rfc822MessageId: `<${input.canonicalEventId}@example.org>`,
          direction: "inbound",
          subject: "Project alias inbound",
          fromHeader: `${input.displayName} <${input.contactId}@example.org>`,
          toHeader: input.projectInboxAlias,
          ccHeader: null,
          fromEmails: [],
          toEmails: [],
          ccEmails: [],
          bccEmails: [],
          labelIds: ["INBOX"],
          snippetClean: input.snippet,
          bodyTextPreview: input.snippet,
          capturedMailbox: "forests@example.org",
          projectInboxAlias: input.projectInboxAlias,
        });
      }

      await repositories.inboxProjection.upsert({
        contactId: input.contactId,
        bucket: "New",
        needsFollowUp: false,
        hasUnresolved: false,
        lastInboundAt: input.occurredAt,
        lastOutboundAt: null,
        lastActivityAt: input.occurredAt,
        snippet: input.snippet,
        archivedAt: null,
        lastCanonicalEventId: input.canonicalEventId,
        lastEventType: "communication.email.inbound",
      });
    };

    await repositories.contacts.upsert({
      id: "contact:multi-project",
      salesforceContactId: "003-multi-project",
      displayName: "Matt Bromley",
      primaryEmail: "matt@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await repositories.contactMemberships.upsert({
      id: "membership:multi:pnw",
      contactId: "contact:multi-project",
      projectId: "project:pnw-bio",
      expeditionId: null,
      salesforceMembershipId: "sf-membership:multi:pnw",
      role: "volunteer",
      status: "lead",
      source: "salesforce",
      createdAt: "2026-04-01T10:00:00.000Z",
    });
    await repositories.contactMemberships.upsert({
      id: "membership:multi:whitebark",
      contactId: "contact:multi-project",
      projectId: "project:whitebark-pine",
      expeditionId: null,
      salesforceMembershipId: "sf-membership:multi:whitebark",
      role: "volunteer",
      status: "in_training",
      source: "salesforce",
      createdAt: "2026-04-02T10:00:00.000Z",
    });
    await repositories.contactMemberships.upsert({
      id: "membership:multi:inactive",
      contactId: "contact:multi-project",
      projectId: "project:inactive-c",
      expeditionId: null,
      salesforceMembershipId: "sf-membership:multi:inactive",
      role: "volunteer",
      status: "successful",
      source: "salesforce",
      createdAt: "2026-04-03T10:00:00.000Z",
    });
    await repositories.sourceEvidence.append({
      id: "source:multi-project-inbound",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "multi-project-inbound",
      receivedAt: "2026-04-20T12:00:00.000Z",
      occurredAt: "2026-04-20T12:00:00.000Z",
      payloadRef: "payloads/gmail/multi-project-inbound.json",
      idempotencyKey: "gmail:multi-project-inbound",
      checksum: "checksum:multi-project-inbound",
    });
    await repositories.canonicalEvents.upsert({
      id: "event:multi-project-inbound",
      contactId: "contact:multi-project",
      eventType: "communication.email.inbound",
      channel: "email",
      occurredAt: "2026-04-20T12:00:00.000Z",
      contentFingerprint: null,
      sourceEvidenceId: "source:multi-project-inbound",
      idempotencyKey: "canonical:multi-project-inbound",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: "source:multi-project-inbound",
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "message",
        sourceRecordId: "multi-project-inbound",
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: null,
        direction: "inbound",
        notes: null,
      },
      reviewState: "clear",
    });
    await repositories.inboxProjection.upsert({
      contactId: "contact:multi-project",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-20T12:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-20T12:00:00.000Z",
      snippet: "Testing project filters.",
      archivedAt: null,
      lastCanonicalEventId: "event:multi-project-inbound",
      lastEventType: "communication.email.inbound",
    });
    await seedInboxContact({
      contactId: "contact:alias-only",
      displayName: "Alia Sawyer",
      occurredAt: "2026-04-20T13:00:00.000Z",
      sourceEvidenceId: "source:alias-only-inbound",
      canonicalEventId: "event:alias-only-inbound",
      provider: "gmail",
      projectInboxAlias: "forests-a@example.org",
      snippet: "Alias-only project signal.",
    });
    await seedInboxContact({
      contactId: "contact:cross-project",
      displayName: "Casey Cross",
      occurredAt: "2026-04-20T14:00:00.000Z",
      sourceEvidenceId: "source:cross-project-inbound",
      canonicalEventId: "event:cross-project-inbound",
      provider: "gmail",
      projectInboxAlias: "forests-b@example.org",
      snippet: "Membership and alias point at different projects.",
    });
    await repositories.contactMemberships.upsert({
      id: "membership:cross:forests-a",
      contactId: "contact:cross-project",
      projectId: "project:forests-a",
      expeditionId: null,
      salesforceMembershipId: "sf-membership:cross:forests-a",
      role: "volunteer",
      status: "lead",
      source: "salesforce",
      createdAt: "2026-04-04T10:00:00.000Z",
    });
    await seedInboxContact({
      contactId: "contact:pure-membership",
      displayName: "Morgan Member",
      occurredAt: "2026-04-20T15:00:00.000Z",
      sourceEvidenceId: "source:pure-membership-inbound",
      canonicalEventId: "event:pure-membership-inbound",
      provider: "salesforce",
      snippet: "Membership-only project signal.",
    });
    await repositories.contactMemberships.upsert({
      id: "membership:pure:forests-a",
      contactId: "contact:pure-membership",
      projectId: "project:forests-a",
      expeditionId: null,
      salesforceMembershipId: "sf-membership:pure:forests-a",
      role: "volunteer",
      status: "lead",
      source: "salesforce",
      createdAt: "2026-04-05T10:00:00.000Z",
    });

    const pnwRows = await repositories.inboxProjection.listPageOrderedByRecency({
      filter: "visible",
      order: "last-inbound",
      limit: 10,
      cursor: null,
      projectId: "project:pnw-bio",
    });
    const whitebarkRows =
      await repositories.inboxProjection.listPageOrderedByRecency({
        filter: "visible",
        order: "last-inbound",
        limit: 10,
        cursor: null,
        projectId: "project:whitebark-pine",
      });
    const inactiveRows =
      await repositories.inboxProjection.listPageOrderedByRecency({
        filter: "visible",
        order: "last-inbound",
        limit: 10,
        cursor: null,
        projectId: "project:inactive-c",
      });
    const pnwCounts = await repositories.inboxProjection.countByFilters({
      projectId: "project:pnw-bio",
    });
    const inactiveCounts = await repositories.inboxProjection.countByFilters({
      projectId: "project:inactive-c",
    });
    const forestsARows =
      await repositories.inboxProjection.listPageOrderedByRecency({
        filter: "visible",
        order: "last-inbound",
        limit: 10,
        cursor: null,
        projectId: "project:forests-a",
      });
    const forestsBRows =
      await repositories.inboxProjection.listPageOrderedByRecency({
        filter: "visible",
        order: "last-inbound",
        limit: 10,
        cursor: null,
        projectId: "project:forests-b",
      });
    const forestsACounts = await repositories.inboxProjection.countByFilters({
      projectId: "project:forests-a",
    });
    const forestsBCounts = await repositories.inboxProjection.countByFilters({
      projectId: "project:forests-b",
    });

    expect(pnwRows.map((row) => row.contactId)).toEqual([
      "contact:multi-project",
    ]);
    expect(whitebarkRows.map((row) => row.contactId)).toEqual([
      "contact:multi-project",
    ]);
    expect(inactiveRows).toEqual([]);
    expect(pnwCounts.all).toBe(1);
    expect(inactiveCounts.all).toBe(0);
    expect(forestsARows.map((row) => row.contactId)).toEqual([
      "contact:pure-membership",
      "contact:cross-project",
      "contact:alias-only",
    ]);
    expect(forestsBRows.map((row) => row.contactId)).toEqual([
      "contact:cross-project",
    ]);
    expect(forestsACounts.all).toBe(3);
    expect(forestsBCounts.all).toBe(1);
  });

  it("rolls connected sub-project memberships into the host's inbox filter", async () => {
    // Migration 0056 adds connected_to_project_id, letting two Salesforce
    // projects share one inbox alias. Filtering by the host should now
    // include volunteers whose only membership is in a connected sub-project.
    // Filtering by the sub-project's own id is intentionally NOT supported —
    // operators look at the host tile.
    const { repositories, settings } = await createTestStage1Context();
    const now = "2026-04-21T00:00:00.000Z";

    // Two host/sub pairs, modelled on the Beech & Butternut shared-alias case.
    await repositories.projectDimensions.upsert({
      projectId: "project:host-a",
      projectName: "Host A",
      projectAlias: "Host A",
      source: "salesforce",
      isActive: true,
    });
    await repositories.projectDimensions.upsert({
      projectId: "project:sub-b",
      projectName: "Sub B",
      // Connected sub-projects don't need their own alias — that's the whole
      // point of the relaxed CHECK in 0056.
      projectAlias: null,
      source: "salesforce",
      isActive: true,
      connectedToProjectId: "project:host-a",
    });
    await repositories.projectDimensions.upsert({
      projectId: "project:host-d",
      projectName: "Host D",
      projectAlias: "Host D",
      source: "salesforce",
      isActive: true,
    });
    await repositories.projectDimensions.upsert({
      projectId: "project:sub-c",
      projectName: "Sub C",
      projectAlias: null,
      source: "salesforce",
      isActive: true,
      connectedToProjectId: "project:host-d",
    });

    // Sanity-check the column landed and the trigger isn't refusing the
    // connected sub-project insert.
    const subB = await repositories.projectDimensions.findById("project:sub-b");
    expect(subB?.connectedToProjectId).toBe("project:host-a");

    const seedContact = async (input: {
      readonly contactId: string;
      readonly projectId: string;
      readonly membershipId: string;
    }) => {
      const sourceEvidenceId = `source:${input.contactId}-inbound`;
      const canonicalEventId = `event:${input.contactId}-inbound`;
      await repositories.contacts.upsert({
        id: input.contactId,
        salesforceContactId: `003-${input.contactId}`,
        displayName: input.contactId,
        primaryEmail: `${input.contactId}@example.org`,
        primaryPhone: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      await repositories.contactMemberships.upsert({
        id: input.membershipId,
        contactId: input.contactId,
        projectId: input.projectId,
        expeditionId: null,
        salesforceMembershipId: `sf-${input.membershipId}`,
        role: "volunteer",
        status: "lead",
        source: "salesforce",
        createdAt: "2026-04-01T10:00:00.000Z",
      });
      await repositories.sourceEvidence.append({
        id: sourceEvidenceId,
        provider: "salesforce",
        providerRecordType: "task",
        providerRecordId: `${input.contactId}-msg`,
        receivedAt: now,
        occurredAt: now,
        payloadRef: `payloads/salesforce/${input.contactId}.json`,
        idempotencyKey: `salesforce:${input.contactId}-inbound`,
        checksum: `checksum:${input.contactId}`,
      });
      await repositories.canonicalEvents.upsert({
        id: canonicalEventId,
        contactId: input.contactId,
        eventType: "communication.email.inbound",
        channel: "email",
        occurredAt: now,
        contentFingerprint: null,
        sourceEvidenceId,
        idempotencyKey: `canonical:${input.contactId}-inbound`,
        provenance: {
          primaryProvider: "salesforce",
          primarySourceEvidenceId: sourceEvidenceId,
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "task",
          sourceRecordId: `${input.contactId}-msg`,
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: null,
          direction: "inbound",
          notes: null,
        },
        reviewState: "clear",
      });
      await repositories.inboxProjection.upsert({
        contactId: input.contactId,
        bucket: "New",
        needsFollowUp: false,
        hasUnresolved: false,
        lastInboundAt: now,
        lastOutboundAt: null,
        lastActivityAt: now,
        snippet: `signal for ${input.contactId}`,
        archivedAt: null,
        lastCanonicalEventId: canonicalEventId,
        lastEventType: "communication.email.inbound",
      });
    };

    // Three contacts, each in a different project:
    //   contact:in-host-a    — direct membership in the host (existing case 1)
    //   contact:in-sub-b     — membership in the connected sub-project (NEW)
    //   contact:in-sub-c     — membership in a sub-project of a DIFFERENT host
    await seedContact({
      contactId: "contact:in-host-a",
      projectId: "project:host-a",
      membershipId: "membership:host-a",
    });
    await seedContact({
      contactId: "contact:in-sub-b",
      projectId: "project:sub-b",
      membershipId: "membership:sub-b",
    });
    await seedContact({
      contactId: "contact:in-sub-c",
      projectId: "project:sub-c",
      membershipId: "membership:sub-c",
    });

    // Existing alias case: contact emails the host's alias with no membership.
    await settings.aliases.create({
      id: "alias:host-a",
      alias: "host-a@example.org",
      signature: "",
      projectId: "project:host-a",
      createdAt: new Date(now),
      updatedAt: new Date(now),
      createdBy: null,
      updatedBy: null,
    });
    await repositories.contacts.upsert({
      id: "contact:alias-only",
      salesforceContactId: "003-alias-only",
      displayName: "Alias Only",
      primaryEmail: "alias-only@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await repositories.sourceEvidence.append({
      id: "source:alias-only",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "alias-only-msg",
      receivedAt: now,
      occurredAt: now,
      payloadRef: "payloads/gmail/alias-only.json",
      idempotencyKey: "gmail:alias-only",
      checksum: "checksum:alias-only",
    });
    await repositories.canonicalEvents.upsert({
      id: "event:alias-only",
      contactId: "contact:alias-only",
      eventType: "communication.email.inbound",
      channel: "email",
      occurredAt: now,
      contentFingerprint: null,
      sourceEvidenceId: "source:alias-only",
      idempotencyKey: "canonical:alias-only",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: "source:alias-only",
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "message",
        sourceRecordId: "alias-only-msg",
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: null,
        direction: "inbound",
        notes: null,
      },
      reviewState: "clear",
    });
    await repositories.gmailMessageDetails.upsert({
      sourceEvidenceId: "source:alias-only",
      providerRecordId: "alias-only-msg",
      gmailThreadId: "thread:alias-only",
      rfc822MessageId: "<alias-only@example.org>",
      direction: "inbound",
      subject: "alias-only inbound",
      fromHeader: "Alias Only <alias-only@example.org>",
      toHeader: "host-a@example.org",
      ccHeader: null,
      fromEmails: [],
      toEmails: [],
      ccEmails: [],
      bccEmails: [],
      labelIds: ["INBOX"],
      snippetClean: "alias-only signal",
      bodyTextPreview: "alias-only signal",
      capturedMailbox: "host-a@example.org",
      projectInboxAlias: "host-a@example.org",
    });
    await repositories.inboxProjection.upsert({
      contactId: "contact:alias-only",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: now,
      lastOutboundAt: null,
      lastActivityAt: now,
      snippet: "alias-only signal",
      archivedAt: null,
      lastCanonicalEventId: "event:alias-only",
      lastEventType: "communication.email.inbound",
    });

    const hostARows = await repositories.inboxProjection.listPageOrderedByRecency({
      filter: "visible",
      order: "last-inbound",
      limit: 10,
      cursor: null,
      projectId: "project:host-a",
    });
    const subBRows = await repositories.inboxProjection.listPageOrderedByRecency(
      {
        filter: "visible",
        order: "last-inbound",
        limit: 10,
        cursor: null,
        projectId: "project:sub-b",
      },
    );
    const hostDRows = await repositories.inboxProjection.listPageOrderedByRecency(
      {
        filter: "visible",
        order: "last-inbound",
        limit: 10,
        cursor: null,
        projectId: "project:host-d",
      },
    );

    // Filtering by host A returns: direct member, sub-project member, alias-only.
    expect(new Set(hostARows.map((row) => row.contactId))).toEqual(
      new Set([
        "contact:in-host-a",
        "contact:in-sub-b",
        "contact:alias-only",
      ]),
    );
    // Filtering by the sub-project's own id is not the operator-facing path —
    // it should match only the contact whose membership is on that exact id
    // (existing case 1) and NOT the host or other host's contacts. The sub
    // does not have a host of its own, so no rollup happens here.
    expect(subBRows.map((row) => row.contactId)).toEqual([
      "contact:in-sub-b",
    ]);
    // Cross-host isolation: host D's filter must not include host A's family.
    expect(hostDRows.map((row) => row.contactId)).toEqual([
      "contact:in-sub-c",
    ]);
  });

  it("repoints canonical_event_audience rows when merging an email-only contact into an anchored one", async () => {
    const { client, repositories } = await createTestStage1Context();

    // Two contacts: email-only (to be merged away) and anchored (the survivor).
    await repositories.contacts.upsert({
      id: "contact:email-only",
      salesforceContactId: null,
      displayName: "Dean Schie (email-only)",
      primaryEmail: "deanschie@example.org",
      primaryPhone: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    await repositories.contacts.upsert({
      id: "contact:anchored",
      salesforceContactId: "0033600000ROVpSAAX",
      displayName: "Dean Schie",
      primaryEmail: "deanschie@example.org",
      primaryPhone: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    // Two canonical events, one anchored on each contact.
    await repositories.sourceEvidence.append({
      id: "sev:merge-a",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-merge-a",
      receivedAt: "2026-05-01T12:00:00.000Z",
      occurredAt: "2026-05-01T12:00:00.000Z",
      payloadRef: "payloads/gmail/gmail-merge-a.json",
      idempotencyKey: "gmail:message:gmail-merge-a",
      checksum: "checksum-merge-a",
    });
    await repositories.canonicalEvents.upsert({
      id: "evt:merge-a",
      contactId: "contact:email-only",
      eventType: "communication.email.inbound",
      channel: "email",
      occurredAt: "2026-05-01T12:00:00.000Z",
      contentFingerprint: null,
      sourceEvidenceId: "sev:merge-a",
      idempotencyKey: "canonical:gmail-merge-a",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: "sev:merge-a",
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "message",
        sourceRecordId: "gmail-merge-a",
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: null,
        direction: "inbound",
        notes: null,
      },
      reviewState: "clear",
    });
    await repositories.sourceEvidence.append({
      id: "sev:merge-b",
      provider: "gmail",
      providerRecordType: "message",
      providerRecordId: "gmail-merge-b",
      receivedAt: "2026-05-02T12:00:00.000Z",
      occurredAt: "2026-05-02T12:00:00.000Z",
      payloadRef: "payloads/gmail/gmail-merge-b.json",
      idempotencyKey: "gmail:message:gmail-merge-b",
      checksum: "checksum-merge-b",
    });
    await repositories.canonicalEvents.upsert({
      id: "evt:merge-b",
      contactId: "contact:anchored",
      eventType: "communication.email.inbound",
      channel: "email",
      occurredAt: "2026-05-02T12:00:00.000Z",
      contentFingerprint: null,
      sourceEvidenceId: "sev:merge-b",
      idempotencyKey: "canonical:gmail-merge-b",
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: "sev:merge-b",
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "message",
        sourceRecordId: "gmail-merge-b",
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: null,
        direction: "inbound",
        notes: null,
      },
      reviewState: "clear",
    });

    // Audience setup:
    //   evt:merge-a — email-only is a recipient (will be repointed).
    //   evt:merge-b — BOTH email-only and anchored are recipients (collision:
    //                 email-only side must drop, anchored side must survive).
    await repositories.canonicalEventAudience.upsert({
      canonicalEventId: "evt:merge-a",
      contactId: "contact:email-only",
      participantRole: "direct_recipient",
      normalizedEmail: "deanschie@example.org",
    });
    await repositories.canonicalEventAudience.upsert({
      canonicalEventId: "evt:merge-b",
      contactId: "contact:email-only",
      participantRole: "cc",
      normalizedEmail: "deanschie@example.org",
    });
    await repositories.canonicalEventAudience.upsert({
      canonicalEventId: "evt:merge-b",
      contactId: "contact:anchored",
      participantRole: "direct_recipient",
      normalizedEmail: "deanschie@example.org",
    });

    // The merge method is exposed at runtime but not on the public
    // Stage1RepositoryBundle interface (production callers reach it via
    // the EmailOnlyContactMergeCapableRepositories extension type in
    // packages/domain/src/persistence.ts).
    const mergeCapable = repositories as typeof repositories & {
      mergeEmailOnlyContactIntoAnchored(input: {
        readonly emailOnlyContactId: string;
        readonly anchoredContactId: string;
      }): Promise<{
        readonly canonicalEventsRepointed: number;
        readonly timelineRowsRepointed: number;
        readonly notesRepointed: number;
        readonly routingRowsRepointed: number;
        readonly identityCasesRepointed: number;
        readonly audienceRowsRepointed: number;
        readonly contactDeleted: boolean;
      }>;
    };
    const result = await mergeCapable.mergeEmailOnlyContactIntoAnchored({
      emailOnlyContactId: "contact:email-only",
      anchoredContactId: "contact:anchored",
    });

    // Only one audience row had no collision and got repointed in place.
    expect(result.audienceRowsRepointed).toBe(1);
    expect(result.contactDeleted).toBe(true);

    // Inspect surviving audience rows directly via raw SQL — we want to see
    // both branches of the merge (repointed survivor + dedup of the collision).
    const surviving = await client.query<{
      readonly canonical_event_id: string;
      readonly contact_id: string;
      readonly participant_role: string;
    }>(
      `select canonical_event_id, contact_id, participant_role
       from canonical_event_audience
       order by canonical_event_id, contact_id`,
    );

    // No rows should reference the email-only contact (cascade safety net).
    expect(
      surviving.rows.every((row) => row.contact_id !== "contact:email-only"),
    ).toBe(true);

    // evt:merge-a should now point at the anchored contact (repointed).
    expect(surviving.rows).toContainEqual(
      expect.objectContaining({
        canonical_event_id: "evt:merge-a",
        contact_id: "contact:anchored",
        participant_role: "direct_recipient",
      }),
    );

    // evt:merge-b's anchored row survives, with the original 'direct_recipient'
    // role (not overwritten by the 'cc' role that came from the email-only side).
    expect(surviving.rows).toContainEqual(
      expect.objectContaining({
        canonical_event_id: "evt:merge-b",
        contact_id: "contact:anchored",
        participant_role: "direct_recipient",
      }),
    );

    // Exactly two rows total — one repointed, one survivor of the collision.
    expect(surviving.rows.length).toBe(2);
  });
});
