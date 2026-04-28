import type { InboxProjectionRow } from "@as-comms/contracts";

import {
  createStage1WebTestRuntime,
  type Stage1WebTestRuntime,
  type TestStage1Context,
} from "../../src/server/stage1-runtime.test-support";

export type InboxTestRuntime = Stage1WebTestRuntime;
export const createInboxTestRuntime = createStage1WebTestRuntime;

export async function seedInboxContact(
  context: TestStage1Context,
  input: {
    readonly contactId: string;
    readonly salesforceContactId: string | null;
    readonly displayName: string;
    readonly primaryEmail: string | null;
    readonly primaryPhone: string | null;
    readonly projectId?: string;
    readonly projectName?: string;
    readonly projectAlias?: string | null;
    readonly membershipId?: string;
    readonly salesforceMembershipId?: string | null;
    readonly membershipStatus?: string | null;
    readonly membershipCreatedAt?: string;
  },
): Promise<void> {
  await context.repositories.contacts.upsert({
    id: input.contactId,
    salesforceContactId: input.salesforceContactId,
    displayName: input.displayName,
    primaryEmail: input.primaryEmail,
    primaryPhone: input.primaryPhone,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  if (input.projectId !== undefined) {
    await context.repositories.projectDimensions.upsert({
      projectId: input.projectId,
      projectName: input.projectName ?? input.projectId,
      projectAlias: input.projectAlias ?? null,
      source: "salesforce",
      // Default fixture projects to active so tests don't have to opt in. Tests
      // that need a specific project to be inactive should call setActive(id,false)
      // explicitly — the upsert won't toggle isActive on conflict-update because
      // PR #141 protects admin-managed state from being overwritten by SF capture.
      isActive: true,
    });
  }

  if (input.membershipId !== undefined) {
    await context.repositories.contactMemberships.upsert({
      id: input.membershipId,
      contactId: input.contactId,
      projectId: input.projectId ?? null,
      expeditionId: null,
      salesforceMembershipId: input.salesforceMembershipId ?? undefined,
      role: "volunteer",
      status: input.membershipStatus ?? null,
      source: "salesforce",
      createdAt:
        input.membershipCreatedAt ?? new Date().toISOString(),
    });
  }
}

export async function seedInboxEmailEvent(
  context: TestStage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly occurredAt: string;
    readonly direction: "inbound" | "outbound";
    readonly subject: string;
    readonly snippet: string;
    readonly snippetClean?: string;
    readonly bodyTextPreview?: string;
    readonly bodyKind?:
      | "plaintext"
      | "encrypted_placeholder"
      | "binary_fallback";
    readonly fromHeader?: string | null;
    readonly toHeader?: string | null;
    readonly ccHeader?: string | null;
    readonly projectInboxAlias?: string | null;
  },
): Promise<{ readonly canonicalEventId: string }> {
  const sourceEvidenceId = `source:${input.id}`;
  const canonicalEventId = `event:${input.id}`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/gmail/${input.id}.json`,
    idempotencyKey: `gmail:${input.id}`,
    checksum: `checksum:${input.id}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType:
      input.direction === "inbound"
        ? "communication.email.inbound"
        : "communication.email.outbound",
    channel: "email",
    occurredAt: input.occurredAt,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    contentFingerprint: null,
    provenance: {
      primaryProvider: "gmail",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: input.id,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: null,
      direction: input.direction,
      notes: null,
    },
    reviewState: "clear",
  });

  await context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.id,
    gmailThreadId: `thread:${input.contactId}`,
    rfc822MessageId: `<${input.id}@example.org>`,
    direction: input.direction,
    subject: input.subject,
    fromHeader: input.fromHeader ?? null,
    toHeader: input.toHeader ?? null,
    ccHeader: input.ccHeader ?? null,
    snippetClean: input.snippetClean ?? input.snippet,
    bodyTextPreview: input.bodyTextPreview ?? input.snippet,
    bodyKind: input.bodyKind ?? "plaintext",
    capturedMailbox: "volunteers@example.org",
    projectInboxAlias: input.projectInboxAlias ?? "volunteers@example.org",
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.id}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEventId}`,
    eventType:
      input.direction === "inbound"
        ? "communication.email.inbound"
        : "communication.email.outbound",
    summary: input.subject,
    channel: "email",
    primaryProvider: "gmail",
    reviewState: "clear",
  });

  return {
    canonicalEventId,
  };
}

export async function seedInboxMessageAttachment(
  context: TestStage1Context,
  input: {
    readonly sourceEvidenceId: string;
    readonly id: string;
    readonly mimeType: string;
    readonly filename: string | null;
    readonly sizeBytes: number;
    readonly storageKey: string;
    readonly gmailAttachmentId?: string;
  },
): Promise<void> {
  await context.repositories.messageAttachments.upsertManyForMessage(
    input.sourceEvidenceId,
    [
      {
        id: input.id,
        provider: "gmail",
        gmailAttachmentId: input.gmailAttachmentId ?? `gmail:${input.id}`,
        mimeType: input.mimeType,
        filename: input.filename,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
      },
    ],
  );
}

export async function seedInboxSmsEvent(
  context: TestStage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly occurredAt: string;
    readonly direction: "inbound" | "outbound";
    readonly summary: string;
  },
): Promise<{ readonly canonicalEventId: string }> {
  const sourceEvidenceId = `source:${input.id}`;
  const canonicalEventId = `event:${input.id}`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: "communication",
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/salesforce/${input.id}.json`,
    idempotencyKey: `salesforce:${input.id}`,
    checksum: `checksum:${input.id}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType:
      input.direction === "inbound"
        ? "communication.sms.inbound"
        : "communication.sms.outbound",
    channel: "sms",
    occurredAt: input.occurredAt,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    contentFingerprint: null,
    provenance: {
      primaryProvider: "salesforce",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "communication",
      sourceRecordId: input.id,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: null,
      direction: input.direction,
      notes: null,
    },
    reviewState: "clear",
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.id}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEventId}`,
    eventType:
      input.direction === "inbound"
        ? "communication.sms.inbound"
        : "communication.sms.outbound",
    summary: input.summary,
    channel: "sms",
    primaryProvider: "salesforce",
    reviewState: "clear",
  });

  return {
    canonicalEventId,
  };
}

export async function seedInboxAutoEmailEvent(
  context: TestStage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly occurredAt: string;
    readonly subject: string;
    readonly snippet: string;
    readonly sourceLabel?: string;
  },
): Promise<{ readonly canonicalEventId: string }> {
  const sourceEvidenceId = `source:${input.id}`;
  const canonicalEventId = `event:${input.id}`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: "task",
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/salesforce/${input.id}.json`,
    idempotencyKey: `salesforce:${input.id}`,
    checksum: `checksum:${input.id}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType: "communication.email.outbound",
    channel: "email",
    occurredAt: input.occurredAt,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    contentFingerprint: null,
    provenance: {
      primaryProvider: "salesforce",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "task",
      sourceRecordId: input.id,
      messageKind: "auto",
      campaignRef: null,
      threadRef: null,
      direction: "outbound",
      notes: null,
    },
    reviewState: "clear",
  });

  await context.repositories.salesforceCommunicationDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.id,
    channel: "email",
    messageKind: "auto",
    subject: input.subject,
    snippet: input.snippet,
    sourceLabel: input.sourceLabel ?? "Salesforce Flow",
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.id}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEventId}`,
    eventType: "communication.email.outbound",
    summary: input.subject,
    channel: "email",
    primaryProvider: "salesforce",
    reviewState: "clear",
  });

  return {
    canonicalEventId,
  };
}

export async function seedInboxAutoSmsEvent(
  context: TestStage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly occurredAt: string;
    readonly messageTextPreview: string;
    readonly sourceLabel?: string;
  },
): Promise<{ readonly canonicalEventId: string }> {
  const sourceEvidenceId = `source:${input.id}`;
  const canonicalEventId = `event:${input.id}`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: "task",
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/salesforce/${input.id}.json`,
    idempotencyKey: `salesforce:${input.id}`,
    checksum: `checksum:${input.id}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType: "communication.sms.outbound",
    channel: "sms",
    occurredAt: input.occurredAt,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    contentFingerprint: null,
    provenance: {
      primaryProvider: "salesforce",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "task",
      sourceRecordId: input.id,
      messageKind: "auto",
      campaignRef: null,
      threadRef: null,
      direction: "outbound",
      notes: null,
    },
    reviewState: "clear",
  });

  await context.repositories.salesforceCommunicationDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.id,
    channel: "sms",
    messageKind: "auto",
    subject: null,
    snippet: input.messageTextPreview,
    sourceLabel: input.sourceLabel ?? "Salesforce Flow",
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.id}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEventId}`,
    eventType: "communication.sms.outbound",
    summary: input.messageTextPreview,
    channel: "sms",
    primaryProvider: "salesforce",
    reviewState: "clear",
  });

  return {
    canonicalEventId,
  };
}

export async function seedInboxSalesforceOutboundEmailEvent(
  context: TestStage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly occurredAt: string;
    readonly subject: string;
    readonly snippet: string;
    readonly messageKind: "one_to_one" | null;
    readonly direction?: "inbound" | "outbound";
    readonly sourceRecordType?: string;
    readonly sourceLabel?: string;
  },
): Promise<{ readonly canonicalEventId: string }> {
  const sourceEvidenceId = `source:${input.id}`;
  const canonicalEventId = `event:${input.id}`;
  const sourceRecordType = input.sourceRecordType ?? "task_communication";
  const direction = input.direction ?? "outbound";

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: sourceRecordType,
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/salesforce/${input.id}.json`,
    idempotencyKey: `salesforce:${input.id}`,
    checksum: `checksum:${input.id}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType: `communication.email.${direction}`,
    channel: "email",
    occurredAt: input.occurredAt,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    contentFingerprint: null,
    provenance: {
      primaryProvider: "salesforce",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType,
      sourceRecordId: input.id,
      messageKind: input.messageKind,
      campaignRef: null,
      threadRef: null,
      direction,
      notes: null,
    },
    reviewState: "clear",
  });

  await context.repositories.salesforceCommunicationDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.id,
    channel: "email",
    // The detail row stores a concrete message kind even when canonical
    // provenance remains null for the logged-email regression case.
    messageKind: input.messageKind ?? "one_to_one",
    subject: input.subject,
    snippet: input.snippet,
    sourceLabel: input.sourceLabel ?? "Salesforce Logged Email",
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.id}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEventId}`,
    eventType: `communication.email.${direction}`,
    summary: input.subject,
    channel: "email",
    primaryProvider: "salesforce",
    reviewState: "clear",
  });

  return {
    canonicalEventId,
  };
}

export async function seedInboxLegacySalesforceOutboundEmailEvent(
  context: TestStage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly occurredAt: string;
    readonly summary?: string;
    readonly messageKind: "one_to_one" | null;
    readonly sourceRecordType?: string;
  },
): Promise<{ readonly canonicalEventId: string }> {
  const sourceEvidenceId = `source:${input.id}`;
  const canonicalEventId = `event:${input.id}`;
  const sourceRecordType = input.sourceRecordType ?? "task_communication";

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: sourceRecordType,
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/salesforce/${input.id}.json`,
    idempotencyKey: `salesforce:${input.id}`,
    checksum: `checksum:${input.id}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType: "communication.email.outbound",
    channel: "email",
    occurredAt: input.occurredAt,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    contentFingerprint: null,
    provenance: {
      primaryProvider: "salesforce",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType,
      sourceRecordId: input.id,
      messageKind: input.messageKind,
      campaignRef: null,
      threadRef: null,
      direction: "outbound",
      notes: null,
    },
    reviewState: "clear",
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.id}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEventId}`,
    eventType: "communication.email.outbound",
    summary: input.summary ?? "Outbound email sent",
    channel: "email",
    primaryProvider: "salesforce",
    reviewState: "clear",
  });

  return {
    canonicalEventId,
  };
}

export async function seedInboxCampaignEmailEvent(
  context: TestStage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly occurredAt: string;
    readonly activityType: "sent" | "opened" | "clicked" | "unsubscribed";
    readonly campaignName: string | null;
    readonly campaignId?: string;
    readonly snippet: string;
  },
): Promise<{ readonly canonicalEventId: string }> {
  const sourceEvidenceId = `source:${input.id}`;
  const canonicalEventId = `event:${input.id}`;
  const eventType = `campaign.email.${input.activityType}` as const;
  const campaignId = input.campaignId ?? `campaign:${input.id}`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "mailchimp",
    providerRecordType: "campaign_activity",
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/mailchimp/${input.id}.json`,
    idempotencyKey: `mailchimp:${input.id}`,
    checksum: `checksum:${input.id}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType,
    channel: "campaign_email",
    occurredAt: input.occurredAt,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    contentFingerprint: null,
    provenance: {
      primaryProvider: "mailchimp",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "campaign_activity",
      sourceRecordId: input.id,
      messageKind: "campaign",
      campaignRef: {
        providerCampaignId: campaignId,
        providerAudienceId: "audience_1",
        providerMessageName: input.campaignName,
      },
      threadRef: null,
      direction: "outbound",
      notes: null,
    },
    reviewState: "clear",
  });

  await context.repositories.mailchimpCampaignActivityDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.id,
    activityType: input.activityType,
    campaignId,
    audienceId: "audience_1",
    memberId: "member_1",
    campaignName: input.campaignName,
    snippet: input.snippet,
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.id}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEventId}`,
    eventType,
    summary: input.campaignName ?? input.campaignId ?? "Campaign email",
    channel: "campaign_email",
    primaryProvider: "mailchimp",
    reviewState: "clear",
  });

  return {
    canonicalEventId,
  };
}

export async function seedInboxCampaignSmsEvent(
  context: TestStage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly occurredAt: string;
    readonly campaignName: string;
    readonly messageTextPreview: string;
  },
): Promise<{ readonly canonicalEventId: string }> {
  const sourceEvidenceId = `source:${input.id}`;
  const canonicalEventId = `event:${input.id}`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "simpletexting",
    providerRecordType: "message",
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/simpletexting/${input.id}.json`,
    idempotencyKey: `simpletexting:${input.id}`,
    checksum: `checksum:${input.id}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType: "communication.sms.outbound",
    channel: "sms",
    occurredAt: input.occurredAt,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    contentFingerprint: null,
    provenance: {
      primaryProvider: "simpletexting",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: input.id,
      messageKind: "campaign",
      campaignRef: {
        providerCampaignId: "campaign_sms_1",
        providerAudienceId: null,
        providerMessageName: input.campaignName,
      },
      threadRef: null,
      direction: "outbound",
      notes: null,
    },
    reviewState: "clear",
  });

  await context.repositories.simpleTextingMessageDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.id,
    direction: "outbound",
    messageKind: "campaign",
    messageTextPreview: input.messageTextPreview,
    normalizedPhone: "+15550000001",
    campaignId: "campaign_sms_1",
    campaignName: input.campaignName,
    providerThreadId: `thread:${input.contactId}`,
    threadKey: `thread:${input.contactId}`,
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.id}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEventId}`,
    eventType: "communication.sms.outbound",
    summary: input.campaignName,
    channel: "sms",
    primaryProvider: "simpletexting",
    reviewState: "clear",
  });

  return {
    canonicalEventId,
  };
}

export async function seedInboxInternalNoteEvent(
  context: TestStage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly occurredAt: string;
    readonly body: string;
    readonly authorDisplayName: string;
    readonly authorId?: string | null;
  },
): Promise<{ readonly canonicalEventId: string }> {
  const sourceEvidenceId = `source:${input.id}`;
  const canonicalEventId = `event:${input.id}`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "manual",
    providerRecordType: "note",
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/manual/${input.id}.json`,
    idempotencyKey: `manual:${input.id}`,
    checksum: `checksum:${input.id}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType: "note.internal.created",
    channel: "note",
    occurredAt: input.occurredAt,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    contentFingerprint: null,
    provenance: {
      primaryProvider: "manual",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "note",
      sourceRecordId: input.id,
      messageKind: null,
      campaignRef: null,
      threadRef: null,
      direction: null,
      notes: null,
    },
    reviewState: "clear",
  });

  // FK from manual_note_details.author_id → users.id requires the user to exist
  // before we can insert a note that references it. Upsert a minimal user row
  // when authorId is provided.
  if (input.authorId) {
    await context.settings.users.upsert({
      id: input.authorId,
      email: `${input.authorId.replace(/[^a-zA-Z0-9]/g, "-")}@test.local`,
      name: input.authorDisplayName,
      emailVerified: null,
      image: null,
      role: "operator",
      deactivatedAt: null,
      createdAt: new Date(input.occurredAt),
      updatedAt: new Date(input.occurredAt),
    });
  }

  await context.repositories.manualNoteDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.id,
    body: input.body,
    authorDisplayName: input.authorDisplayName,
    authorId: input.authorId ?? null,
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.id}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEventId}`,
    eventType: "note.internal.created",
    summary: "Internal note added",
    channel: "note",
    primaryProvider: "manual",
    reviewState: "clear",
  });

  return {
    canonicalEventId,
  };
}

export async function seedInboxLifecycleEvent(
  context: TestStage1Context,
  input: {
    readonly id: string;
    readonly contactId: string;
    readonly occurredAt: string;
    readonly eventType:
      | "lifecycle.signed_up"
      | "lifecycle.received_training"
      | "lifecycle.completed_training"
      | "lifecycle.submitted_first_data";
    readonly summary: string;
    readonly projectId?: string | null;
    readonly expeditionId?: string | null;
  },
): Promise<{ readonly canonicalEventId: string }> {
  const sourceEvidenceId = `source:${input.id}`;
  const canonicalEventId = `event:${input.id}`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: "lifecycle",
    providerRecordId: input.id,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/salesforce/${input.id}.json`,
    idempotencyKey: `salesforce:${input.id}`,
    checksum: `checksum:${input.id}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType: input.eventType,
    channel: "lifecycle",
    occurredAt: input.occurredAt,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.id}`,
    contentFingerprint: null,
    provenance: {
      primaryProvider: "salesforce",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "lifecycle",
      sourceRecordId: input.id,
      messageKind: null,
      campaignRef: null,
      threadRef: null,
      direction: null,
      notes: null,
    },
    reviewState: "clear",
  });

  await context.repositories.salesforceEventContext.upsert({
    sourceEvidenceId,
    salesforceContactId: null,
    projectId: input.projectId ?? null,
    expeditionId: input.expeditionId ?? null,
    sourceField: "Lifecycle",
  });

  await context.repositories.timelineProjection.upsert({
    id: `timeline:${input.id}`,
    contactId: input.contactId,
    canonicalEventId,
    occurredAt: input.occurredAt,
    sortKey: `${input.occurredAt}::${canonicalEventId}`,
    eventType: input.eventType,
    summary: input.summary,
    channel: "lifecycle",
    primaryProvider: "salesforce",
    reviewState: "clear",
  });

  return {
    canonicalEventId,
  };
}

export async function seedInboxProjection(
  context: TestStage1Context,
  row: InboxProjectionRow,
): Promise<void> {
  await context.repositories.inboxProjection.upsert(row);
}
