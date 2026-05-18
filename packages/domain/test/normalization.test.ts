import { describe, expect, it, vi } from "vitest";

import type {
  AuditEvidenceRecord,
  CanonicalEventRecord,
  ContactIdentityRecord,
  ContactMembershipRecord,
  ContactRecord,
  GmailMessageDetailRecord,
  IdentityResolutionCase,
  InboxBucket,
  InboxProjectionRow,
  MailchimpCampaignActivityDetailRecord,
  ManualNoteDetailRecord,
  NormalizedCanonicalEventIntake,
  NormalizedContactGraphUpsertInput,
  ProjectDimensionRecord,
  RoutingReviewCase,
  SalesforceCommunicationDetailRecord,
  SalesforceEventContextRecord,
  SimpleTextingMessageDetailRecord,
  SourceEvidenceRecord,
  TimelineProjectionRow,
} from "@as-comms/contracts";

import {
  computePendingComposerOutboundFingerprint,
  createStage1NormalizationService,
  createStage1PersistenceService,
  defineStage1RepositoryBundle,
  type PendingComposerOutboundRecord,
  type Stage1RepositoryBundle,
} from "../src/index.js";
import type { CanonicalContactAmbiguityError } from "../src/index.js";

const contact: ContactRecord = {
  id: "contact:volunteer",
  salesforceContactId: null,
  displayName: "Volunteer Contact",
  primaryEmail: "volunteer@example.org",
  primaryPhone: null,
  createdAt: "2026-04-24T00:00:00.000Z",
  updatedAt: "2026-04-24T00:00:00.000Z",
};

const emailIdentity: ContactIdentityRecord = {
  id: "identity:volunteer:email",
  contactId: contact.id,
  kind: "email",
  normalizedValue: "volunteer@example.org",
  isPrimary: true,
  source: "gmail",
  verifiedAt: "2026-04-24T00:00:00.000Z",
};

interface TestContext {
  readonly normalization: ReturnType<typeof createStage1NormalizationService>;
  readonly getInboxProjection: () => InboxProjectionRow | null;
  readonly getInboxSaveCount: () => number;
  readonly getPendingOutbound: (
    id: string,
  ) => PendingComposerOutboundRecord | null;
}

function sortEvents(
  events: readonly CanonicalEventRecord[],
): readonly CanonicalEventRecord[] {
  return [...events].sort((left, right) =>
    left.occurredAt === right.occurredAt
      ? left.id.localeCompare(right.id)
      : left.occurredAt.localeCompare(right.occurredAt),
  );
}

function buildSourceEvidence(input: {
  readonly key: string;
  readonly occurredAt: string;
  readonly provider?: SourceEvidenceRecord["provider"];
  readonly providerRecordType?: SourceEvidenceRecord["providerRecordType"];
}): SourceEvidenceRecord {
  return {
    id: `source:${input.key}`,
    provider: input.provider ?? "gmail",
    providerRecordType: input.providerRecordType ?? "message",
    providerRecordId: `${input.provider ?? "gmail"}:${input.key}`,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/gmail/${input.key}.json`,
    idempotencyKey: `gmail:message:${input.key}`,
    checksum: `checksum:${input.key}`,
  };
}

function buildEvent(input: {
  readonly key: string;
  readonly occurredAt: string;
  readonly direction?: "inbound" | "outbound" | null;
  readonly eventType?: CanonicalEventRecord["eventType"];
  readonly provider?: CanonicalEventRecord["provenance"]["primaryProvider"];
  readonly sourceRecordType?: CanonicalEventRecord["provenance"]["sourceRecordType"];
  readonly messageKind?: CanonicalEventRecord["provenance"]["messageKind"];
  readonly channel?: CanonicalEventRecord["channel"];
}): CanonicalEventRecord {
  const eventType =
    input.eventType ??
    (input.direction === "outbound"
      ? "communication.email.outbound"
      : "communication.email.inbound");
  const channel =
    input.channel ??
    (eventType.startsWith("communication.email.")
      ? "email"
      : eventType.startsWith("communication.sms.")
        ? "sms"
        : eventType.startsWith("lifecycle.")
          ? "lifecycle"
          : eventType.startsWith("campaign.email.")
            ? "campaign_email"
            : "note");

  return {
    id: `event:${input.key}`,
    contactId: contact.id,
    eventType,
    channel,
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId: `source:${input.key}`,
    idempotencyKey: `canonical:${input.key}`,
    provenance: {
      primaryProvider: input.provider ?? "gmail",
      primarySourceEvidenceId: `source:${input.key}`,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: input.sourceRecordType ?? "message",
      sourceRecordId: `${input.provider ?? "gmail"}:${input.key}`,
      messageKind: input.messageKind ?? "one_to_one",
      campaignRef: null,
      threadRef: null,
      direction: input.direction ?? null,
      notes: null,
    },
    reviewState: "clear",
  };
}

function buildExistingProjection(input: {
  readonly bucket: InboxBucket;
  readonly needsFollowUp?: boolean;
  readonly lastInboundAt: string | null;
  readonly lastOutboundAt?: string | null;
  readonly lastCanonicalEventId?: string;
  readonly lastEventType?: InboxProjectionRow["lastEventType"];
}): InboxProjectionRow {
  const lastOutboundAt = input.lastOutboundAt ?? null;
  const lastActivityAt =
    input.lastInboundAt === null
      ? lastOutboundAt
      : lastOutboundAt === null || input.lastInboundAt > lastOutboundAt
        ? input.lastInboundAt
        : lastOutboundAt;

  if (lastActivityAt === null) {
    throw new Error("Test projection needs at least one activity timestamp.");
  }

  return {
    contactId: contact.id,
    bucket: input.bucket,
    needsFollowUp: input.needsFollowUp ?? false,
    hasUnresolved: false,
    lastInboundAt: input.lastInboundAt,
    lastOutboundAt,
    lastActivityAt,
    snippet: "Existing snippet",
    archivedAt: null,
    lastCanonicalEventId: input.lastCanonicalEventId ?? "event:existing",
    lastEventType: input.lastEventType ?? "communication.email.inbound",
  };
}

function buildGmailDetail(input: {
  readonly key: string;
  readonly direction: GmailMessageDetailRecord["direction"];
  readonly rfc822MessageId?: string | null;
  readonly subject?: string | null;
  readonly bodyTextPreview?: string;
}): GmailMessageDetailRecord {
  return {
    sourceEvidenceId: `source:${input.key}`,
    providerRecordId: `gmail:${input.key}`,
    gmailThreadId: `thread:${input.key}`,
    rfc822MessageId: input.rfc822MessageId ?? `<${input.key}@example.org>`,
    direction: input.direction,
    subject: input.subject ?? `Subject ${input.key}`,
    fromHeader:
      input.direction === "outbound"
        ? "Forests <forests@adventurescientists.org>"
        : "Volunteer <volunteer@example.org>",
    toHeader:
      input.direction === "outbound"
        ? "Volunteer <volunteer@example.org>"
        : "Forests <forests@adventurescientists.org>",
    ccHeader: null,
    snippetClean: input.bodyTextPreview ?? `Snippet ${input.key}`,
    bodyTextPreview: input.bodyTextPreview ?? `Body ${input.key}`,
    capturedMailbox: "volunteers@adventurescientists.org",
    projectInboxAlias: "forests@adventurescientists.org",
  };
}

function buildPendingOutbound(input: {
  readonly id: string;
  readonly fingerprint: string;
  readonly status: PendingComposerOutboundRecord["status"];
  readonly sentRfc822MessageId?: string | null;
  readonly reconciledEventId?: string | null;
}): PendingComposerOutboundRecord {
  return {
    id: input.id,
    fingerprint: input.fingerprint,
    status: input.status,
    actorId: "user:operator",
    canonicalContactId: contact.id,
    projectId: null,
    fromAlias: "forests@adventurescientists.org",
    toEmailNormalized: "volunteer@example.org",
    subject: "Pending subject",
    bodyPlaintext: "Pending body",
    bodyHtml: null,
    bodySha256: "sha256:pending",
    attachmentMetadata: [],
    gmailThreadId: null,
    inReplyToRfc822: null,
    attemptedAt: "2026-04-24T10:00:00.000Z",
    reconciledEventId: input.reconciledEventId ?? null,
    reconciledAt:
      input.reconciledEventId === undefined || input.reconciledEventId === null
        ? null
        : "2026-04-24T10:01:00.000Z",
    failedReason: null,
    sentRfc822MessageId: input.sentRfc822MessageId ?? null,
    failedDetail: null,
    orphanedAt: input.status === "orphaned" ? "2026-04-24T10:05:00.000Z" : null,
    createdAt: "2026-04-24T10:00:00.000Z",
    updatedAt: "2026-04-24T10:00:00.000Z",
  };
}

function buildReplayInput(
  event: CanonicalEventRecord,
): NormalizedCanonicalEventIntake {
  const direction = event.provenance.direction;
  const communicationClassification = event.eventType.startsWith(
    "communication.",
  )
    ? {
        messageKind: event.provenance.messageKind ?? "one_to_one",
        sourceRecordType: event.provenance.sourceRecordType ?? "message",
        sourceRecordId:
          event.provenance.sourceRecordId ??
          `${event.provenance.primaryProvider}:${event.id.replace("event:", "")}`,
        campaignRef: event.provenance.campaignRef ?? null,
        threadRef: event.provenance.threadRef ?? null,
        direction: direction ?? "inbound",
      }
    : undefined;

  return {
    sourceEvidence: buildSourceEvidence({
      key: event.id.replace("event:", ""),
      occurredAt: event.occurredAt,
      provider: event.provenance.primaryProvider,
      providerRecordType: event.provenance.sourceRecordType ?? "message",
    }),
    canonicalEvent: {
      id: `${event.id}:replay`,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      idempotencyKey: event.idempotencyKey,
      summary: "Replayed email",
      snippet: "Replayed snippet",
    },
    identity: {
      salesforceContactId: null,
      volunteerIdPlainValues: [],
      normalizedEmails: [emailIdentity.normalizedValue],
      normalizedPhones: [],
    },
    routing: {
      required: false,
      projectId: null,
      expeditionId: null,
      projectName: null,
      expeditionName: null,
    },
    supportingSources: [],
    communicationClassification,
  };
}

function buildContext(input: {
  readonly events: readonly CanonicalEventRecord[];
  readonly existingProjection?: InboxProjectionRow | null;
  readonly contacts?: readonly ContactRecord[];
  readonly contactIdentities?: readonly ContactIdentityRecord[];
  readonly gmailMessageDetails?: readonly GmailMessageDetailRecord[];
  readonly pendingOutbounds?: readonly PendingComposerOutboundRecord[];
  readonly sourceProvider?: SourceEvidenceRecord["provider"];
  readonly onContactIdentityUpsert?: (record: ContactIdentityRecord) => void;
  readonly onContactMembershipUpsert?: (
    record: ContactMembershipRecord,
  ) => void;
  readonly onProjectDimensionUpsert?: (record: ProjectDimensionRecord) => void;
  readonly onExpeditionDimensionUpsert?: (
    record: Parameters<
      Stage1RepositoryBundle["expeditionDimensions"]["upsert"]
    >[0],
  ) => void;
  readonly onPendingOutboundConfirmed?: (record: PendingComposerOutboundRecord) => void;
}): TestContext {
  const contacts = input.contacts ?? [contact];
  const contactIdentities = input.contactIdentities ?? [emailIdentity];
  const contactsById = new Map(contacts.map((entry) => [entry.id, entry]));
  const contactsBySalesforceContactId = new Map(
    contacts
      .filter(
        (entry): entry is ContactRecord & { salesforceContactId: string } =>
          entry.salesforceContactId !== null,
      )
      .map((entry) => [entry.salesforceContactId, entry]),
  );
  const sourceEvidenceById = new Map(
    input.events.map((event) => [
      event.sourceEvidenceId,
      {
        ...buildSourceEvidence({
          key: event.id.replace("event:", ""),
          occurredAt: event.occurredAt,
          provider: event.provenance.primaryProvider,
          providerRecordType: event.provenance.sourceRecordType ?? "message",
        }),
        provider: input.sourceProvider ?? event.provenance.primaryProvider,
      },
    ]),
  );
  const sourceEvidenceByIdempotencyKey = new Map(
    [...sourceEvidenceById.values()].map((record) => [
      record.idempotencyKey,
      record,
    ]),
  );
  const canonicalEventsByIdempotencyKey = new Map(
    input.events.map((event) => [event.idempotencyKey, event]),
  );
  const canonicalEventsById = new Map(
    input.events.map((event) => [event.id, event]),
  );
  const timelineRowsByCanonicalEventId = new Map<
    string,
    TimelineProjectionRow
  >();
  const gmailDetailsBySourceEvidenceId = new Map<
    string,
    GmailMessageDetailRecord
  >(
    (input.gmailMessageDetails ?? []).map((record) => [
      record.sourceEvidenceId,
      record,
    ]),
  );
  const pendingOutboundsById = new Map(
    (input.pendingOutbounds ?? []).map((record) => [record.id, record]),
  );
  const sourceEvidenceQuarantineEntries = new Array<{
    id: string;
    provider: SourceEvidenceRecord["provider"];
    idempotencyKey: string;
    checksum: string;
    attemptedAt: Date;
    reason: "checksum_mismatch" | "superseded_canonical";
    payloadRef: string;
    details: Readonly<Record<string, unknown>>;
    createdAt: Date;
  }>();
  let inboxProjection = input.existingProjection ?? null;
  let inboxSaveCount = 0;

  const bundle: Stage1RepositoryBundle = defineStage1RepositoryBundle({
    sourceEvidence: {
      append: (record) => {
        sourceEvidenceById.set(record.id, record);
        sourceEvidenceByIdempotencyKey.set(record.idempotencyKey, record);
        return Promise.resolve(record);
      },
      replaceByIdempotencyKey: (record) => {
        const existing = sourceEvidenceByIdempotencyKey.get(
          record.idempotencyKey,
        );
        const updated = existing === undefined ? record : { ...record, id: existing.id };
        sourceEvidenceById.set(updated.id, updated);
        sourceEvidenceByIdempotencyKey.set(updated.idempotencyKey, updated);
        return Promise.resolve(updated);
      },
      findById: (id) => Promise.resolve(sourceEvidenceById.get(id) ?? null),
      listByIds: (ids) =>
        Promise.resolve(
          ids
            .map((id) => sourceEvidenceById.get(id))
            .filter(
              (record): record is SourceEvidenceRecord => record !== undefined,
            ),
        ),
      findByIdempotencyKey: (idempotencyKey) =>
        Promise.resolve(
          sourceEvidenceByIdempotencyKey.get(idempotencyKey) ?? null,
        ),
      listIdempotencyChecksumCollisions: () =>
        Promise.resolve({ entries: [], hasMore: false }),
      countByProvider: () => Promise.resolve(sourceEvidenceById.size),
      listByProviderRecord: ({
        provider,
        providerRecordType,
        providerRecordId,
      }) =>
        Promise.resolve(
          [...sourceEvidenceById.values()].filter(
            (record) =>
              record.provider === provider &&
              record.providerRecordType === providerRecordType &&
              record.providerRecordId === providerRecordId,
          ),
        ),
    },
    sourceEvidenceQuarantine: {
      record: (input) => {
        const record = {
          id: `source_evidence_quarantine:${String(sourceEvidenceQuarantineEntries.length + 1)}`,
          ...input,
          createdAt: input.attemptedAt,
        };
        sourceEvidenceQuarantineEntries.push(record);
        return Promise.resolve(record);
      },
      listRecent: ({ limit, beforeTimestamp }) => {
        const entries = [...sourceEvidenceQuarantineEntries]
          .filter((entry) =>
            beforeTimestamp === undefined
              ? true
              : entry.attemptedAt < beforeTimestamp,
          )
          .sort(
            (left, right) =>
              right.attemptedAt.getTime() - left.attemptedAt.getTime(),
          );

        return Promise.resolve({
          entries: entries.slice(0, limit),
          hasMore: entries.length > limit,
        });
      },
    },
    canonicalEvents: {
      findById: (id) => Promise.resolve(canonicalEventsById.get(id) ?? null),
      findByIdempotencyKey: (idempotencyKey) =>
        Promise.resolve(
          canonicalEventsByIdempotencyKey.get(idempotencyKey) ?? null,
        ),
      findBySourceEvidenceId: (sourceEvidenceId, eventType) =>
        Promise.resolve(
          [...canonicalEventsById.values()].find(
            (event) =>
              event.sourceEvidenceId === sourceEvidenceId &&
              event.eventType === eventType,
          ) ?? null,
        ),
      listByContentFingerprintWindow: () => Promise.resolve([]),
      countAll: () => Promise.resolve(canonicalEventsById.size),
      countByPrimaryProvider: () => Promise.resolve(canonicalEventsById.size),
      countDistinctInboxContacts: () => Promise.resolve(1),
      listByIds: (ids) =>
        Promise.resolve(
          ids
            .map((id) => canonicalEventsById.get(id))
            .filter(
              (event): event is CanonicalEventRecord => event !== undefined,
            ),
        ),
      listByContactId: (contactId) =>
        Promise.resolve(
          sortEvents(
            [...canonicalEventsById.values()].filter(
              (event) => event.contactId === contactId,
            ),
          ),
        ),
      listByContactIds: (contactIds) =>
        Promise.resolve(
          sortEvents(
            [...canonicalEventsById.values()].filter((event) =>
              contactIds.includes(event.contactId),
            ),
          ),
        ),
      upsert: (record) => {
        canonicalEventsById.set(record.id, record);
        canonicalEventsByIdempotencyKey.set(record.idempotencyKey, record);
        return Promise.resolve(record);
      },
    },
    aiKnowledge: {
      findByScope: () => Promise.resolve(null),
      findProjectNotionContent: () => Promise.resolve(null),
      findEffectiveProjectNotionContent: () => Promise.resolve(null),
      hasProjectNotionContent: () => Promise.resolve(false),
      findProjectIdsWithAiKnowledgeConfigured: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    projectKnowledge: {
      list: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
      setApproved: () => Promise.resolve(),
      deleteById: () => Promise.resolve(),
      getForRetrieval: () => Promise.resolve([]),
      countCapturedSinceTimestamp: () => Promise.resolve(0),
    },
    contacts: {
      findById: (id) => Promise.resolve(contactsById.get(id) ?? null),
      findBySalesforceContactId: (salesforceContactId) =>
        Promise.resolve(
          contactsBySalesforceContactId.get(salesforceContactId) ?? null,
        ),
      findByPrimaryPhone: (phoneE164) =>
        Promise.resolve(
          contacts.find((contact) => contact.primaryPhone === phoneE164) ??
            null,
        ),
      listAll: () => Promise.resolve([...contacts]),
      listByIds: (ids) =>
        Promise.resolve(
          ids
            .map((id) => contactsById.get(id))
            .filter((entry): entry is ContactRecord => entry !== undefined),
        ),
      searchByQuery: () => Promise.resolve([...contacts]),
      searchInboxUnified: () =>
        Promise.resolve({
          volunteers: [],
          contacts: [],
          totals: { volunteers: 0, contacts: 0 },
        }),
      upsert: (record) => Promise.resolve(record),
    },
    contactIdentities: {
      listByContactId: (contactId) =>
        Promise.resolve(
          contactIdentities.filter(
            (identity) => identity.contactId === contactId,
          ),
        ),
      listByNormalizedValue: ({ normalizedValue }) =>
        Promise.resolve(
          contactIdentities.filter(
            (identity) => identity.normalizedValue === normalizedValue,
          ),
        ),
      upsert: (record) => {
        input.onContactIdentityUpsert?.(record);
        return Promise.resolve(record);
      },
    },
    contactMemberships: {
      listByContactId: () => Promise.resolve([]),
      listByContactIds: () => Promise.resolve([]),
      upsert: (record: ContactMembershipRecord) => {
        input.onContactMembershipUpsert?.(record);
        return Promise.resolve(record);
      },
    },
    smsMessages: {
      insert: (record) => Promise.resolve(record),
      findByTwilioSid: () => Promise.resolve(null),
      findLatestByStatuses: () => Promise.resolve(null),
      hasInboundForPhone: () => Promise.resolve(false),
      listByContact: () => Promise.resolve([]),
      updateDelivery: () => Promise.resolve(null),
      updateSendStatus: () => Promise.resolve(null),
    },
    consentRecords: {
      findLatestByPhone: () => Promise.resolve(null),
      findLatestByContact: () => Promise.resolve(null),
      insert: (record) => Promise.resolve(record),
    },
    smsSenders: {
      listActive: () => Promise.resolve([]),
      findById: () => Promise.resolve(null),
      findByPhone: () => Promise.resolve(null),
      getActiveUsageSnapshot: () => Promise.resolve(null),
    },
    projectDimensions: {
      findById: () => Promise.resolve(null),
      listAll: () => Promise.resolve([]),
      listActive: () => Promise.resolve([]),
      listByIds: () => Promise.resolve([]),
      listConnectedProjects: () => Promise.resolve([]),
      listAvailableConnectionCandidates: () => Promise.resolve([]),
      findEffectiveAiKnowledge: () => Promise.resolve(null),
      getAiKnowledgeSources: () => Promise.resolve([]),
      setAiKnowledgeSources: () => Promise.resolve(),
      setAiAutoSyncSchedule: () => Promise.resolve(),
      updateOperatingContext: () => Promise.resolve(),
      setSynthesisMetadata: () => Promise.resolve(),
      upsert: (record: ProjectDimensionRecord) => {
        input.onProjectDimensionUpsert?.(record);
        return Promise.resolve(record);
      },
    },
    expeditionDimensions: {
      listByIds: () => Promise.resolve([]),
      upsert: (record) => {
        input.onExpeditionDimensionUpsert?.(record);
        return Promise.resolve(record);
      },
    },
    gmailMessageDetails: {
      findByRfc822MessageId: (rfc822MessageId) =>
        Promise.resolve(
          [...gmailDetailsBySourceEvidenceId.values()].find(
            (record) => record.rfc822MessageId === rfc822MessageId,
          ) ?? null,
        ),
      listBySourceEvidenceIds: (ids) =>
        Promise.resolve(
          ids
            .map((id) => gmailDetailsBySourceEvidenceId.get(id))
            .filter(
              (record): record is GmailMessageDetailRecord =>
                record !== undefined,
            ),
        ),
      listLastInboundAliasByContactIds: () => Promise.resolve(new Map()),
      upsert: (record) => {
        gmailDetailsBySourceEvidenceId.set(record.sourceEvidenceId, record);
        return Promise.resolve(record);
      },
    },
    messageAttachments: {
      findById: () => Promise.resolve(null),
      findByMessageIds: () => Promise.resolve([]),
      upsertManyForMessage: () => Promise.resolve(),
    },
    salesforceEventContext: {
      listBySourceEvidenceIds: () => Promise.resolve([]),
      upsert: (record: SalesforceEventContextRecord) => Promise.resolve(record),
    },
    salesforceCommunicationDetails: {
      listBySourceEvidenceIds: () => Promise.resolve([]),
      upsert: (record: SalesforceCommunicationDetailRecord) =>
        Promise.resolve(record),
    },
    simpleTextingMessageDetails: {
      listBySourceEvidenceIds: () => Promise.resolve([]),
      upsert: (record: SimpleTextingMessageDetailRecord) =>
        Promise.resolve(record),
    },
    mailchimpCampaignActivityDetails: {
      listBySourceEvidenceIds: () => Promise.resolve([]),
      upsert: (record: MailchimpCampaignActivityDetailRecord) =>
        Promise.resolve(record),
      aggregateForCampaign: () =>
        Promise.resolve({
          sent: 0,
          opened: 0,
          clicked: 0,
          bounced: 0,
          unsubscribed: 0,
          distinctMembers: 0,
        }),
      listRecipientsForCampaign: () => Promise.resolve({ rows: [], total: 0 }),
    },
    manualNoteDetails: {
      listBySourceEvidenceIds: () => Promise.resolve([]),
      findLatestForContact: () => Promise.resolve(null),
      upsert: (record: ManualNoteDetailRecord) => Promise.resolve(record),
      updateBody: () => Promise.resolve(null),
      deleteByAuthor: () => Promise.resolve(0),
    },
    internalNotes: {
      create: (input) =>
        Promise.resolve({
          ...input,
          authorDisplayName: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        }),
      findById: () => Promise.resolve(undefined),
      findByContactId: () => Promise.resolve([]),
      update: (input) =>
        Promise.resolve({
          id: input.id,
          contactId: "contact_1",
          body: input.body,
          authorDisplayName: "Author",
          authorId: "user:author",
          createdAt: new Date(0),
          updatedAt: new Date(0),
        }),
      delete: () => Promise.resolve(),
    },
    pendingOutbounds: {
      insert: ({ id }) => Promise.resolve(id),
      findByFingerprint: (fingerprint) =>
        Promise.resolve(
          [...pendingOutboundsById.values()].find(
            (record) => record.fingerprint === fingerprint,
          ) ?? null,
        ),
      markSentRfc822: () => Promise.resolve(),
      findBySentRfc822MessageId: (messageId) =>
        Promise.resolve(
          [...pendingOutboundsById.values()].find(
            (record) => record.sentRfc822MessageId === messageId,
          ) ?? null,
        ),
      listUnreconciledWithRfc822: () =>
        Promise.resolve(
          [...pendingOutboundsById.values()].filter(
            (record) =>
              record.sentRfc822MessageId !== null &&
              record.reconciledEventId === null &&
              ["pending", "confirmed", "orphaned"].includes(record.status),
          ),
        ),
      markConfirmed: (id, confirmedInput) => {
        const existing = pendingOutboundsById.get(id);

        if (
          existing === undefined ||
          !(
            existing.status === "pending" ||
            existing.status === "orphaned" ||
            (existing.status === "confirmed" &&
              existing.reconciledEventId === null)
          )
        ) {
          return Promise.resolve();
        }

        const updated: PendingComposerOutboundRecord = {
          ...existing,
          status: "confirmed",
          reconciledEventId: confirmedInput.reconciledEventId,
          reconciledAt: "2026-04-24T10:02:00.000Z",
          failedReason: null,
          failedDetail: null,
          orphanedAt: null,
          updatedAt: "2026-04-24T10:02:00.000Z",
        };
        pendingOutboundsById.set(id, updated);
        input.onPendingOutboundConfirmed?.(updated);
        return Promise.resolve();
      },
      markFailed: () => Promise.resolve(),
      markSuperseded: () => Promise.resolve(),
      sweepOrphans: () => Promise.resolve(0),
      findForContact: () => Promise.resolve([...pendingOutboundsById.values()]),
    },
    identityResolutionQueue: {
      findById: () => Promise.resolve(null),
      listOpenByContactId: () => Promise.resolve([]),
      listOpenByReasonCode: () => Promise.resolve([]),
      upsert: (record: IdentityResolutionCase) => Promise.resolve(record),
    },
    routingReviewQueue: {
      findById: () => Promise.resolve(null),
      listOpenByContactId: () => Promise.resolve([]),
      listOpenByReasonCode: () => Promise.resolve([]),
      upsert: (record: RoutingReviewCase) => Promise.resolve(record),
    },
    inboxProjection: {
      countAll: () => Promise.resolve(inboxProjection === null ? 0 : 1),
      countInvalidRecencyRows: () => Promise.resolve(0),
      findByContactId: () => Promise.resolve(inboxProjection),
      listInvalidRecencyContactIds: () => Promise.resolve([]),
      listAllOrderedByRecency: () =>
        Promise.resolve(inboxProjection === null ? [] : [inboxProjection]),
      searchPageOrderedByRecency: () =>
        Promise.resolve({
          rows: inboxProjection === null ? [] : [inboxProjection],
          total: inboxProjection === null ? 0 : 1,
        }),
      listPageOrderedByRecency: () =>
        Promise.resolve(inboxProjection === null ? [] : [inboxProjection]),
      countByFilters: () =>
        Promise.resolve({
          all: inboxProjection === null ? 0 : 1,
          unread: inboxProjection?.bucket === "New" ? 1 : 0,
          followUp: inboxProjection?.needsFollowUp === true ? 1 : 0,
          unresolved: inboxProjection?.hasUnresolved === true ? 1 : 0,
          sent: inboxProjection?.lastOutboundAt === null ? 0 : 1,
          archived:
            inboxProjection !== null && inboxProjection.archivedAt !== null
              ? 1
              : 0,
        }),
      getFreshness: () =>
        Promise.resolve({
          total: inboxProjection === null ? 0 : 1,
          latestUpdatedAt: null,
        }),
      getFreshnessByContactId: () => Promise.resolve(null),
      deleteByContactId: () => {
        inboxProjection = null;
        return Promise.resolve();
      },
      setNeedsFollowUp: ({ needsFollowUp }) => {
        inboxProjection =
          inboxProjection === null
            ? null
            : {
                ...inboxProjection,
                needsFollowUp,
              };
        return Promise.resolve(inboxProjection);
      },
      setArchived: ({ archived }) => {
        inboxProjection =
          inboxProjection === null
            ? null
            : {
                ...inboxProjection,
                archivedAt: archived ? "2026-04-14T00:00:00.000Z" : null,
              };
        return Promise.resolve(inboxProjection);
      },
      setBucket: ({ bucket }) => {
        inboxProjection =
          inboxProjection === null
            ? null
            : {
                ...inboxProjection,
                bucket,
              };
        return Promise.resolve(inboxProjection);
      },
      upsert: (record) => {
        inboxSaveCount += 1;
        inboxProjection = record;
        return Promise.resolve(record);
      },
    },
    timelineProjection: {
      countAll: () => Promise.resolve(timelineRowsByCanonicalEventId.size),
      findByCanonicalEventId: (canonicalEventId) =>
        Promise.resolve(
          timelineRowsByCanonicalEventId.get(canonicalEventId) ?? null,
        ),
      listByContactId: () =>
        Promise.resolve([...timelineRowsByCanonicalEventId.values()]),
      listRecentByContactId: () =>
        Promise.resolve([...timelineRowsByCanonicalEventId.values()]),
      countByContactId: () =>
        Promise.resolve(timelineRowsByCanonicalEventId.size),
      getFreshnessByContactId: () =>
        Promise.resolve({
          contactId: contacts[0]?.id ?? contact.id,
          total: timelineRowsByCanonicalEventId.size,
          latestUpdatedAt: null,
          latestSortKey: null,
        }),
      upsert: (record) => {
        timelineRowsByCanonicalEventId.set(record.canonicalEventId, record);
        return Promise.resolve(record);
      },
    },
    syncState: {
      findById: () => Promise.resolve(null),
      findLatest: () => Promise.resolve(null),
      listAll: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    auditEvidence: {
      append: (record: AuditEvidenceRecord) => Promise.resolve(record),
      listByEntity: () => Promise.resolve([]),
      listByEntities: () => Promise.resolve([]),
    },
  });

  const persistence = createStage1PersistenceService(bundle);

  return {
    normalization: createStage1NormalizationService(persistence),
    getInboxProjection: () => inboxProjection,
    getInboxSaveCount: () => inboxSaveCount,
    getPendingOutbound: (id) => pendingOutboundsById.get(id) ?? null,
  };
}

async function replayEvent(
  context: TestContext,
  event: CanonicalEventRecord,
): Promise<InboxProjectionRow | null> {
  const result = await context.normalization.applyNormalizedCanonicalEvent(
    buildReplayInput(event),
  );

  expect(result.outcome).toBe("duplicate");

  if (result.outcome !== "duplicate") {
    return null;
  }

  return result.inboxProjection;
}

describe("rebuildInboxProjectionForContact bucket semantics", () => {
  it("flips Opened to New when rebuild advances lastInboundAt after an outbound reply and keeps follow-up", async () => {
    const firstInbound = buildEvent({
      key: "first-inbound",
      occurredAt: "2026-04-24T10:00:00.000Z",
      direction: "inbound",
    });
    const outboundReply = buildEvent({
      key: "outbound-reply",
      occurredAt: "2026-04-24T10:05:00.000Z",
      direction: "outbound",
    });
    const newerInbound = buildEvent({
      key: "newer-inbound",
      occurredAt: "2026-04-24T10:10:00.000Z",
      direction: "inbound",
    });
    const context = buildContext({
      events: [firstInbound, outboundReply, newerInbound],
      existingProjection: buildExistingProjection({
        bucket: "Opened",
        needsFollowUp: true,
        lastInboundAt: firstInbound.occurredAt,
        lastOutboundAt: outboundReply.occurredAt,
        lastCanonicalEventId: outboundReply.id,
        lastEventType: "communication.email.outbound",
      }),
    });

    const projection = await replayEvent(context, newerInbound);

    expect(projection).toMatchObject({
      bucket: "New",
      needsFollowUp: true,
      lastInboundAt: newerInbound.occurredAt,
      lastOutboundAt: outboundReply.occurredAt,
    });
  });

  it("keeps an existing New bucket as New when rebuild advances lastInboundAt", async () => {
    const firstInbound = buildEvent({
      key: "already-new-first",
      occurredAt: "2026-04-24T11:00:00.000Z",
      direction: "inbound",
    });
    const newerInbound = buildEvent({
      key: "already-new-latest",
      occurredAt: "2026-04-24T11:15:00.000Z",
      direction: "inbound",
    });
    const context = buildContext({
      events: [firstInbound, newerInbound],
      existingProjection: buildExistingProjection({
        bucket: "New",
        lastInboundAt: firstInbound.occurredAt,
        lastCanonicalEventId: firstInbound.id,
      }),
    });

    const projection = await replayEvent(context, newerInbound);

    expect(projection).toMatchObject({
      bucket: "New",
      lastInboundAt: newerInbound.occurredAt,
    });
  });

  it("preserves Opened for out-of-order inbound replay that does not advance lastInboundAt", async () => {
    const lateArrivingOldInbound = buildEvent({
      key: "late-arriving-old",
      occurredAt: "2026-04-24T12:00:00.000Z",
      direction: "inbound",
    });
    const existingNewestInbound = buildEvent({
      key: "existing-newest",
      occurredAt: "2026-04-24T12:30:00.000Z",
      direction: "inbound",
    });
    const context = buildContext({
      events: [lateArrivingOldInbound, existingNewestInbound],
      existingProjection: buildExistingProjection({
        bucket: "Opened",
        lastInboundAt: existingNewestInbound.occurredAt,
        lastCanonicalEventId: existingNewestInbound.id,
      }),
    });

    const projection = await replayEvent(context, lateArrivingOldInbound);

    expect(projection).toMatchObject({
      bucket: "Opened",
      lastInboundAt: existingNewestInbound.occurredAt,
    });
  });

  it("preserves Opened for an idempotent rebuild when newest inbound equals existing lastInboundAt", async () => {
    const inbound = buildEvent({
      key: "same-newest-inbound",
      occurredAt: "2026-04-24T13:00:00.000Z",
      direction: "inbound",
    });
    const context = buildContext({
      events: [inbound],
      existingProjection: buildExistingProjection({
        bucket: "Opened",
        lastInboundAt: inbound.occurredAt,
        lastCanonicalEventId: inbound.id,
      }),
    });

    const projection = await replayEvent(context, inbound);

    expect(projection).toMatchObject({
      bucket: "Opened",
      lastInboundAt: inbound.occurredAt,
    });
  });

  it("uses latest event direction for first-creation rebuilds", async () => {
    const inbound = buildEvent({
      key: "first-create-inbound",
      occurredAt: "2026-04-24T14:00:00.000Z",
      direction: "inbound",
    });
    const outbound = buildEvent({
      key: "first-create-outbound",
      occurredAt: "2026-04-24T14:30:00.000Z",
      direction: "outbound",
    });

    const inboundContext = buildContext({
      events: [inbound],
      existingProjection: null,
    });
    const outboundContext = buildContext({
      events: [outbound],
      existingProjection: null,
    });

    await expect(replayEvent(inboundContext, inbound)).resolves.toMatchObject({
      bucket: "New",
      lastInboundAt: inbound.occurredAt,
      lastOutboundAt: null,
    });
    await expect(replayEvent(outboundContext, outbound)).resolves.toMatchObject(
      {
        bucket: "Opened",
        lastInboundAt: null,
        lastOutboundAt: outbound.occurredAt,
      },
    );
  });

  it("creates a projection for campaign-only contacts", async () => {
    const campaignSent = buildEvent({
      key: "campaign-only-sent",
      occurredAt: "2026-04-24T14:45:00.000Z",
      eventType: "campaign.email.sent",
      direction: null,
      provider: "mailchimp",
      sourceRecordType: "campaign_activity",
      messageKind: "campaign",
    });
    const context = buildContext({
      events: [campaignSent],
      existingProjection: null,
    });

    await expect(replayEvent(context, campaignSent)).resolves.toMatchObject({
      bucket: "Opened",
      lastInboundAt: null,
      lastOutboundAt: campaignSent.occurredAt,
      lastActivityAt: campaignSent.occurredAt,
      lastCanonicalEventId: campaignSent.id,
      lastEventType: "campaign.email.sent",
    });
  });

  it("creates a projection for auto-email-only contacts", async () => {
    const autoOutbound = buildEvent({
      key: "auto-only-outbound",
      occurredAt: "2026-04-24T14:50:00.000Z",
      direction: "outbound",
      messageKind: "auto",
    });
    const context = buildContext({
      events: [autoOutbound],
      existingProjection: null,
    });

    await expect(replayEvent(context, autoOutbound)).resolves.toMatchObject({
      bucket: "Opened",
      lastInboundAt: null,
      lastOutboundAt: autoOutbound.occurredAt,
      lastActivityAt: autoOutbound.occurredAt,
      lastCanonicalEventId: autoOutbound.id,
      lastEventType: "communication.email.outbound",
    });
  });

  it("creates a projection for lifecycle-only contacts", async () => {
    const lifecycle = buildEvent({
      key: "lifecycle-only-signed-up",
      occurredAt: "2026-04-24T14:55:00.000Z",
      eventType: "lifecycle.signed_up",
      direction: null,
      provider: "salesforce",
      sourceRecordType: "contact_membership",
      messageKind: null,
    });
    const context = buildContext({
      events: [lifecycle],
      existingProjection: null,
    });

    await expect(replayEvent(context, lifecycle)).resolves.toMatchObject({
      bucket: "Opened",
      lastInboundAt: null,
      lastOutboundAt: null,
      lastActivityAt: lifecycle.occurredAt,
      lastCanonicalEventId: lifecycle.id,
      lastEventType: "lifecycle.signed_up",
    });
  });

  it("derives inbox fields from mixed qualifying events without letting non-inbound activity change the bucket", async () => {
    const inbound = buildEvent({
      key: "mixed-inbound",
      occurredAt: "2026-04-24T15:00:00.000Z",
      direction: "inbound",
    });
    const autoOutbound = buildEvent({
      key: "mixed-auto-outbound",
      occurredAt: "2026-04-24T15:05:00.000Z",
      direction: "outbound",
      messageKind: "auto",
    });
    const campaignSent = buildEvent({
      key: "mixed-campaign-sent",
      occurredAt: "2026-04-24T15:10:00.000Z",
      eventType: "campaign.email.sent",
      direction: null,
      provider: "mailchimp",
      sourceRecordType: "campaign_activity",
      messageKind: "campaign",
    });
    const lifecycle = buildEvent({
      key: "mixed-lifecycle",
      occurredAt: "2026-04-24T15:15:00.000Z",
      eventType: "lifecycle.received_training",
      direction: null,
      provider: "salesforce",
      sourceRecordType: "contact_membership",
      messageKind: null,
    });
    const context = buildContext({
      events: [inbound, autoOutbound, campaignSent, lifecycle],
      existingProjection: buildExistingProjection({
        bucket: "Opened",
        lastInboundAt: inbound.occurredAt,
        lastCanonicalEventId: inbound.id,
        lastEventType: inbound.eventType,
      }),
    });

    await expect(replayEvent(context, lifecycle)).resolves.toMatchObject({
      bucket: "Opened",
      lastInboundAt: inbound.occurredAt,
      lastOutboundAt: campaignSent.occurredAt,
      lastActivityAt: lifecycle.occurredAt,
      lastCanonicalEventId: lifecycle.id,
      lastEventType: "lifecycle.received_training",
    });
  });

  it("saves one rebuilt projection for a multi-event contact replay", async () => {
    const firstInbound = buildEvent({
      key: "batch-first-inbound",
      occurredAt: "2026-04-24T15:00:00.000Z",
      direction: "inbound",
    });
    const outbound = buildEvent({
      key: "batch-outbound",
      occurredAt: "2026-04-24T15:10:00.000Z",
      direction: "outbound",
    });
    const latestInbound = buildEvent({
      key: "batch-latest-inbound",
      occurredAt: "2026-04-24T15:20:00.000Z",
      direction: "inbound",
    });
    const context = buildContext({
      events: [firstInbound, outbound, latestInbound],
      existingProjection: buildExistingProjection({
        bucket: "Opened",
        lastInboundAt: firstInbound.occurredAt,
        lastOutboundAt: outbound.occurredAt,
        lastCanonicalEventId: outbound.id,
        lastEventType: "communication.email.outbound",
      }),
    });

    await replayEvent(context, latestInbound);

    expect(context.getInboxSaveCount()).toBe(1);
    expect(context.getInboxProjection()).toMatchObject({
      bucket: "New",
      lastInboundAt: latestInbound.occurredAt,
    });
  });
});

describe("upsertNormalizedContactGraph write ordering", () => {
  it("writes project and expedition dimensions before contact memberships for a new expedition", async () => {
    const callOrder: { kind: string; id: string }[] = [];
    const context = buildContext({
      events: [],
      contacts: [],
      contactIdentities: [],
      onContactIdentityUpsert: (record) => {
        callOrder.push({ kind: "contactIdentity", id: record.id });
      },
      onProjectDimensionUpsert: (record) => {
        callOrder.push({ kind: "projectDimension", id: record.projectId });
      },
      onExpeditionDimensionUpsert: (record) => {
        callOrder.push({
          kind: "expeditionDimension",
          id: record.expeditionId,
        });
      },
      onContactMembershipUpsert: (record) => {
        callOrder.push({ kind: "contactMembership", id: record.id });
      },
    });
    const input: NormalizedContactGraphUpsertInput = {
      contact: {
        id: "contact:salesforce:003-new-expedition",
        salesforceContactId: "003-new-expedition",
        displayName: "New Expedition Volunteer",
        primaryEmail: "new-expedition@example.org",
        primaryPhone: null,
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
      identities: [
        {
          id: "identity:salesforce-contact-id:003-new-expedition",
          contactId: "contact:salesforce:003-new-expedition",
          kind: "salesforce_contact_id",
          normalizedValue: "003-new-expedition",
          isPrimary: true,
          source: "salesforce",
          verifiedAt: "2026-04-29T00:00:00.000Z",
        },
      ],
      memberships: [
        {
          id: "membership:new-expedition",
          contactId: "contact:salesforce:003-new-expedition",
          projectId: "sf-project-NEW-1",
          expeditionId: "sf-expedition-NEW-1",
          salesforceMembershipId: "a0B-new-expedition",
          role: "volunteer",
          status: "active",
          source: "salesforce",
          createdAt: "2026-04-29T00:00:00.000Z",
        },
      ],
      projectDimensions: [
        {
          projectId: "sf-project-NEW-1",
          projectName: "New Project",
          source: "salesforce",
          isActive: false,
        },
      ],
      expeditionDimensions: [
        {
          expeditionId: "sf-expedition-NEW-1",
          projectId: "sf-project-NEW-1",
          expeditionName: "New Expedition",
          source: "salesforce",
        },
      ],
    };

    await context.normalization.upsertNormalizedContactGraph(input);

    const firstProjectDimensionIndex = callOrder.findIndex(
      (entry) => entry.kind === "projectDimension",
    );
    const firstExpeditionDimensionIndex = callOrder.findIndex(
      (entry) => entry.kind === "expeditionDimension",
    );
    const firstMembershipIndex = callOrder.findIndex(
      (entry) => entry.kind === "contactMembership",
    );

    expect(firstProjectDimensionIndex).toBeGreaterThanOrEqual(0);
    expect(firstExpeditionDimensionIndex).toBeGreaterThanOrEqual(0);
    expect(firstMembershipIndex).toBeGreaterThanOrEqual(0);
    expect(firstProjectDimensionIndex).toBeLessThan(firstMembershipIndex);
    expect(firstExpeditionDimensionIndex).toBeLessThan(firstMembershipIndex);
  });
});

describe("identity resolution hardening", () => {
  it("still anchors Salesforce intakes by salesforceContactId", async () => {
    const anchoredContact: ContactRecord = {
      ...contact,
      id: "contact:anchored",
      salesforceContactId: "sf-contact-1",
    };
    const event = buildEvent({
      key: "salesforce-anchor",
      occurredAt: "2026-04-25T10:00:00.000Z",
      direction: "inbound",
    });
    const context = buildContext({
      events: [],
      contacts: [anchoredContact],
      contactIdentities: [],
    });

    const result = await context.normalization.applyNormalizedCanonicalEvent({
      ...buildReplayInput(event),
      sourceEvidence: {
        ...buildSourceEvidence({
          key: "salesforce-anchor",
          occurredAt: event.occurredAt,
        }),
        provider: "salesforce",
      },
      identity: {
        salesforceContactId: "sf-contact-1",
        volunteerIdPlainValues: [],
        normalizedEmails: [],
        normalizedPhones: [],
      },
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") {
      throw new Error("Expected applied result.");
    }
    expect(result.canonicalEvent.contactId).toBe(anchoredContact.id);
  });

  it("ignores salesforceContactId from non-Salesforce intakes", async () => {
    const anchoredContact: ContactRecord = {
      ...contact,
      id: "contact:anchored",
      salesforceContactId: "sf-contact-1",
      primaryEmail: "anchored@example.org",
    };
    const emailMatchedContact: ContactRecord = {
      ...contact,
      id: "contact:email-match",
      salesforceContactId: null,
      primaryEmail: "volunteer@example.org",
    };
    const event = buildEvent({
      key: "gmail-untrusted-anchor",
      occurredAt: "2026-04-25T11:00:00.000Z",
      direction: "inbound",
    });
    const context = buildContext({
      events: [],
      contacts: [anchoredContact, emailMatchedContact],
      contactIdentities: [
        {
          ...emailIdentity,
          contactId: emailMatchedContact.id,
        },
      ],
    });

    const result = await context.normalization.applyNormalizedCanonicalEvent({
      ...buildReplayInput(event),
      sourceEvidence: {
        ...buildSourceEvidence({
          key: "gmail-untrusted-anchor",
          occurredAt: event.occurredAt,
        }),
        provider: "gmail",
      },
      identity: {
        salesforceContactId: "sf-contact-1",
        volunteerIdPlainValues: [],
        normalizedEmails: ["volunteer@example.org"],
        normalizedPhones: [],
      },
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") {
      throw new Error("Expected applied result.");
    }
    expect(result.canonicalEvent.contactId).toBe(emailMatchedContact.id);
  });

  it("returns the single contact for an unambiguous email", async () => {
    const context = buildContext({
      events: [],
    });

    await expect(
      context.normalization.ensureCanonicalContactForEmail({
        emailAddress: "volunteer@example.org",
      }),
    ).resolves.toMatchObject({
      id: contact.id,
    });
  });

  it("throws CanonicalContactAmbiguityError when the email maps to multiple contacts", async () => {
    const duplicateContact: ContactRecord = {
      ...contact,
      id: "contact:duplicate",
      primaryEmail: "volunteer@example.org",
    };
    const duplicateIdentity: ContactIdentityRecord = {
      ...emailIdentity,
      id: "identity:duplicate:email",
      contactId: duplicateContact.id,
    };
    const context = buildContext({
      events: [],
      contacts: [contact, duplicateContact],
      contactIdentities: [emailIdentity, duplicateIdentity],
    });

    try {
      await context.normalization.ensureCanonicalContactForEmail({
        emailAddress: "volunteer@example.org",
      });
      throw new Error("Expected CanonicalContactAmbiguityError.");
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      const ambiguityError = error as CanonicalContactAmbiguityError;
      expect(ambiguityError.name).toBe("CanonicalContactAmbiguityError");
      expect(ambiguityError.normalizedEmail).toBe("volunteer@example.org");
      expect([...ambiguityError.candidateContactIds].sort()).toEqual(
        [contact.id, duplicateContact.id].sort(),
      );
    }
  });
});

describe("pending composer outbound reconciliation", () => {
  it("reconciles via rfc822 Message-ID before fingerprint matching", async () => {
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation((entry) => void entry);
    const event = buildEvent({
      key: "rfc822-primary",
      occurredAt: "2026-04-24T15:05:02.000Z",
      direction: "outbound",
    });
    const context = buildContext({
      events: [],
      pendingOutbounds: [
        buildPendingOutbound({
          id: "pending:rfc822-primary",
          fingerprint: "fp:deliberately-different",
          status: "pending",
          sentRfc822MessageId: "<matched-rfc822@example.org>",
        }),
      ],
    });

    const result = await context.normalization.applyNormalizedCanonicalEvent({
      ...buildReplayInput(event),
      gmailMessageDetail: buildGmailDetail({
        key: "rfc822-primary",
        direction: "outbound",
        rfc822MessageId: "<matched-rfc822@example.org>",
        subject: "Project Inquiry",
        bodyTextPreview: "Thanks for reaching out about the project.",
      }),
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") {
      throw new Error("Expected applied result.");
    }

    expect(context.getPendingOutbound("pending:rfc822-primary")).toMatchObject({
      status: "confirmed",
      reconciledEventId: result.canonicalEvent.id,
    });

    const matchedLog = consoleLog.mock.calls
      .map(([entry]) => JSON.parse(String(entry)) as Record<string, unknown>)
      .find((entry) => entry.event === "composer.reconciliation.matched");

    expect(matchedLog).toMatchObject({
      pendingOutboundId: "pending:rfc822-primary",
      rfc822MessageId: "<matched-rfc822@example.org>",
      via: "rfc822",
    });

    consoleLog.mockRestore();
  });

  it("falls back to fingerprint matching when the Gmail detail has no rfc822 Message-ID", async () => {
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation((entry) => void entry);
    const subject = "Fallback subject";
    const body = "Fallback body";
    const occurredAt = "2026-04-24T15:04:00.000Z";
    const event = buildEvent({
      key: "fingerprint-fallback-missing-rfc822",
      occurredAt,
      direction: "outbound",
    });
    const fingerprint = computePendingComposerOutboundFingerprint({
      contactId: contact.id,
      subject,
      bodyPlaintext: body,
      sentAt: occurredAt,
    });

    if (fingerprint === null) {
      throw new Error("Expected fingerprint to be computed for pending outbound.");
    }

    const context = buildContext({
      events: [],
      pendingOutbounds: [
        buildPendingOutbound({
          id: "pending:fingerprint-fallback-missing-rfc822",
          fingerprint,
          status: "pending",
        }),
      ],
    });

    const result = await context.normalization.applyNormalizedCanonicalEvent({
      ...buildReplayInput(event),
      gmailMessageDetail: buildGmailDetail({
        key: "fingerprint-fallback-missing-rfc822",
        direction: "outbound",
        rfc822MessageId: null,
        subject,
        bodyTextPreview: body,
      }),
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") {
      throw new Error("Expected applied result.");
    }

    expect(
      context.getPendingOutbound("pending:fingerprint-fallback-missing-rfc822"),
    ).toMatchObject({
      status: "confirmed",
      reconciledEventId: result.canonicalEvent.id,
    });

    const matchedLog = consoleLog.mock.calls
      .map(([entry]) => JSON.parse(String(entry)) as Record<string, unknown>)
      .find((entry) => entry.event === "composer.reconciliation.matched");

    expect(matchedLog).toMatchObject({
      pendingOutboundId: "pending:fingerprint-fallback-missing-rfc822",
      fingerprint,
      via: "fingerprint",
    });

    consoleLog.mockRestore();
  });

  it("falls back to fingerprint matching when rfc822 is present but no pending row matches it", async () => {
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation((entry) => void entry);
    const subject = "Fingerprint fallback despite rfc822";
    const body = "Body that should still fingerprint-match.";
    const occurredAt = "2026-04-24T15:06:00.000Z";
    const event = buildEvent({
      key: "fingerprint-fallback-rfc822-miss",
      occurredAt,
      direction: "outbound",
    });
    const fingerprint = computePendingComposerOutboundFingerprint({
      contactId: contact.id,
      subject,
      bodyPlaintext: body,
      sentAt: occurredAt,
    });

    if (fingerprint === null) {
      throw new Error("Expected fingerprint to be computed for pending outbound.");
    }

    const context = buildContext({
      events: [],
      pendingOutbounds: [
        buildPendingOutbound({
          id: "pending:fingerprint-fallback-rfc822-miss",
          fingerprint,
          status: "pending",
          sentRfc822MessageId: "<different-rfc822@example.org>",
        }),
      ],
    });

    const result = await context.normalization.applyNormalizedCanonicalEvent({
      ...buildReplayInput(event),
      gmailMessageDetail: buildGmailDetail({
        key: "fingerprint-fallback-rfc822-miss",
        direction: "outbound",
        rfc822MessageId: "<unmatched-rfc822@example.org>",
        subject,
        bodyTextPreview: body,
      }),
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") {
      throw new Error("Expected applied result.");
    }

    expect(
      context.getPendingOutbound("pending:fingerprint-fallback-rfc822-miss"),
    ).toMatchObject({
      status: "confirmed",
      reconciledEventId: result.canonicalEvent.id,
    });

    const matchedLog = consoleLog.mock.calls
      .map(([entry]) => JSON.parse(String(entry)) as Record<string, unknown>)
      .find((entry) => entry.event === "composer.reconciliation.matched");

    expect(matchedLog).toMatchObject({
      pendingOutboundId: "pending:fingerprint-fallback-rfc822-miss",
      fingerprint,
      via: "fingerprint",
    });

    consoleLog.mockRestore();
  });

  it("does not reconfirm a pending row that is already linked to another canonical event", async () => {
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation((entry) => void entry);
    const confirmedRows: PendingComposerOutboundRecord[] = [];
    const event = buildEvent({
      key: "already-linked-rfc822",
      occurredAt: "2026-04-24T15:07:00.000Z",
      direction: "outbound",
    });
    const context = buildContext({
      events: [],
      pendingOutbounds: [
        buildPendingOutbound({
          id: "pending:already-linked-rfc822",
          fingerprint: "fp:already-linked",
          status: "confirmed",
          sentRfc822MessageId: "<already-linked@example.org>",
          reconciledEventId: "event:existing-link",
        }),
      ],
      onPendingOutboundConfirmed: (record) => {
        confirmedRows.push(record);
      },
    });

    const result = await context.normalization.applyNormalizedCanonicalEvent({
      ...buildReplayInput(event),
      gmailMessageDetail: buildGmailDetail({
        key: "already-linked-rfc822",
        direction: "outbound",
        rfc822MessageId: "<already-linked@example.org>",
        subject: "Already linked subject",
        bodyTextPreview: "Already linked body",
      }),
    });

    expect(result.outcome).toBe("applied");
    expect(confirmedRows).toHaveLength(0);
    expect(context.getPendingOutbound("pending:already-linked-rfc822")).toMatchObject(
      {
        status: "confirmed",
        reconciledEventId: "event:existing-link",
      },
    );

    const matchedLog = consoleLog.mock.calls
      .map(([entry]) => JSON.parse(String(entry)) as Record<string, unknown>)
      .find((entry) => entry.event === "composer.reconciliation.matched");

    expect(matchedLog).toBeUndefined();

    consoleLog.mockRestore();
  });
});
