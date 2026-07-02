import { describe, expect, it, vi } from "vitest";

import type {
  AuditEvidenceRecord,
  CanonicalEventRecord,
  CanonicalEventAudienceRecord,
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
  buildTimelineSortKey,
  computePendingComposerOutboundFingerprint,
  createStage1NormalizationService,
  createStage1PersistenceService,
  defineStage1RepositoryBundle,
  rebuildInboxProjectionForContact,
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
  readonly getInboxProjectionForContact: (
    contactId: string,
  ) => InboxProjectionRow | null;
  readonly getInboxSaveCount: () => number;
  readonly getContact: (contactId: string) => ContactRecord | null;
  readonly getCanonicalEvent: (eventId: string) => CanonicalEventRecord | null;
  readonly getTimelineRow: (
    canonicalEventId: string,
  ) => TimelineProjectionRow | null;
  readonly getCanonicalEventAudienceRows: (
    canonicalEventId: string,
  ) => readonly CanonicalEventAudienceRecord[];
  readonly getAuditEvidence: () => readonly AuditEvidenceRecord[];
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
  readonly contactId?: string;
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
    contactId: input.contactId ?? contact.id,
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
  readonly contactId?: string;
  readonly bucket: InboxBucket;
  readonly needsFollowUp?: boolean;
  readonly hasUnresolved?: boolean;
  readonly lastInboundAt: string | null;
  readonly lastOutboundAt?: string | null;
  readonly lastCanonicalEventId?: string;
  readonly lastEventType?: InboxProjectionRow["lastEventType"];
  readonly snippet?: string;
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
    contactId: input.contactId ?? contact.id,
    bucket: input.bucket,
    needsFollowUp: input.needsFollowUp ?? false,
    hasUnresolved: input.hasUnresolved ?? false,
    lastInboundAt: input.lastInboundAt,
    lastOutboundAt,
    lastActivityAt,
    snippet: input.snippet ?? "Existing snippet",
    archivedAt: null,
    lastCanonicalEventId: input.lastCanonicalEventId ?? "event:existing",
    lastEventType: input.lastEventType ?? "communication.email.inbound",
  };
}

function buildGmailDetail(input: {
  readonly key: string;
  readonly direction: GmailMessageDetailRecord["direction"];
  readonly gmailThreadId?: string | null;
  readonly rfc822MessageId?: string | null;
  readonly subject?: string | null;
  readonly bodyTextPreview?: string;
}): GmailMessageDetailRecord {
  return {
    sourceEvidenceId: `source:${input.key}`,
    providerRecordId: `gmail:${input.key}`,
    gmailThreadId: input.gmailThreadId ?? `thread:${input.key}`,
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
    fromEmails:
      input.direction === "outbound"
        ? ["forests@adventurescientists.org"]
        : ["volunteer@example.org"],
    toEmails:
      input.direction === "outbound"
        ? ["volunteer@example.org"]
        : ["forests@adventurescientists.org"],
    ccEmails: [],
    bccEmails: [],
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
  readonly inReplyToRfc822?: string | null;
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
    inReplyToRfc822: input.inReplyToRfc822 ?? null,
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
  overrides?: {
    readonly snippet?: string;
  },
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
      snippet: overrides?.snippet ?? "Replayed snippet",
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
  readonly inboxProjections?: readonly InboxProjectionRow[];
  readonly contacts?: readonly ContactRecord[];
  readonly contactIdentities?: readonly ContactIdentityRecord[];
  readonly contactMemberships?: readonly ContactMembershipRecord[];
  readonly projectAliases?: readonly string[];
  readonly gmailMessageDetails?: readonly GmailMessageDetailRecord[];
  readonly timelineRows?: readonly TimelineProjectionRow[];
  readonly identityCases?: readonly IdentityResolutionCase[];
  readonly routingCases?: readonly RoutingReviewCase[];
  readonly auditEvidence?: readonly AuditEvidenceRecord[];
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
  readonly onPendingOutboundConfirmed?: (
    record: PendingComposerOutboundRecord,
  ) => void;
}): TestContext {
  interface StoredInternalNote {
    readonly id: string;
    readonly contactId: string;
    readonly body: string;
    readonly authorDisplayName: string | null;
    readonly authorId: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }

  const contactRecords = new Map(
    (input.contacts ?? [contact]).map((entry) => [entry.id, entry]),
  );
  const contactIdentityRecords = [
    ...(input.contactIdentities ?? [emailIdentity]),
  ];
  const contactMembershipRecords = [...(input.contactMemberships ?? [])];
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
  const timelineRowsByCanonicalEventId = new Map<string, TimelineProjectionRow>(
    (input.timelineRows ?? []).map((row) => [row.canonicalEventId, row]),
  );
  const canonicalEventAudienceRowsByKey = new Map<
    string,
    CanonicalEventAudienceRecord
  >();
  const identityCasesById = new Map(
    (input.identityCases ?? []).map((record) => [record.id, record]),
  );
  const routingCasesById = new Map(
    (input.routingCases ?? []).map((record) => [record.id, record]),
  );
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
  const internalNotesById = new Map<string, StoredInternalNote>();
  const auditEvidenceRecords = [...(input.auditEvidence ?? [])];
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
  const inboxProjectionByContactId = new Map(
    [
      ...(input.inboxProjections ?? []),
      ...(input.existingProjection === undefined ||
      input.existingProjection === null
        ? []
        : [input.existingProjection]),
    ].map((projection) => [projection.contactId, projection]),
  );
  let inboxSaveCount = 0;

  const listContacts = (): ContactRecord[] =>
    [...contactRecords.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  const listContactIdentities = (): ContactIdentityRecord[] => [
    ...contactIdentityRecords,
  ];
  const getInboxProjection = (contactId: string): InboxProjectionRow | null =>
    inboxProjectionByContactId.get(contactId) ?? null;

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
        const updated =
          existing === undefined ? record : { ...record, id: existing.id };
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
      findById: (id) => Promise.resolve(contactRecords.get(id) ?? null),
      findBySalesforceContactId: (salesforceContactId) =>
        Promise.resolve(
          listContacts().find(
            (entry) => entry.salesforceContactId === salesforceContactId,
          ) ?? null,
        ),
      findByPrimaryPhone: (phoneE164) =>
        Promise.resolve(
          listContacts().find(
            (contact) => contact.primaryPhone === phoneE164,
          ) ?? null,
        ),
      listAll: () => Promise.resolve(listContacts()),
      listByIds: (ids) =>
        Promise.resolve(
          ids
            .map((id) => contactRecords.get(id))
            .filter((entry): entry is ContactRecord => entry !== undefined),
        ),
      listSalesforceAnchoredIds: () => Promise.resolve([]),
      markSalesforceDeleted: () => Promise.resolve(0),
      markSalesforceReconciled: () => Promise.resolve(0),
      searchByQuery: () => Promise.resolve(listContacts()),
      searchInboxUnified: () =>
        Promise.resolve({
          volunteers: [],
          contacts: [],
          totals: { volunteers: 0, contacts: 0 },
        }),
      upsert: (record) => {
        contactRecords.set(record.id, record);
        return Promise.resolve(record);
      },
    },
    mergeEmailOnlyContactIntoAnchored: (mergeInput: {
      readonly emailOnlyContactId: string;
      readonly anchoredContactId: string;
    }) => {
      let canonicalEventsRepointed = 0;
      for (const [eventId, event] of canonicalEventsById.entries()) {
        if (event.contactId !== mergeInput.emailOnlyContactId) {
          continue;
        }

        canonicalEventsRepointed += 1;
        canonicalEventsById.set(eventId, {
          ...event,
          contactId: mergeInput.anchoredContactId,
        });
      }

      let timelineRowsRepointed = 0;
      for (const [
        canonicalEventId,
        row,
      ] of timelineRowsByCanonicalEventId.entries()) {
        if (row.contactId !== mergeInput.emailOnlyContactId) {
          continue;
        }

        timelineRowsRepointed += 1;
        timelineRowsByCanonicalEventId.set(canonicalEventId, {
          ...row,
          contactId: mergeInput.anchoredContactId,
        });
      }

      let notesRepointed = 0;
      for (const [noteId, note] of internalNotesById.entries()) {
        if (note.contactId !== mergeInput.emailOnlyContactId) {
          continue;
        }

        notesRepointed += 1;
        internalNotesById.set(noteId, {
          ...note,
          contactId: mergeInput.anchoredContactId,
          updatedAt: new Date(0),
        });
      }

      let routingRowsRepointed = 0;
      for (const [caseId, routingCase] of routingCasesById.entries()) {
        if (routingCase.contactId !== mergeInput.emailOnlyContactId) {
          continue;
        }

        routingRowsRepointed += 1;
        routingCasesById.set(caseId, {
          ...routingCase,
          contactId: mergeInput.anchoredContactId,
        });
      }

      let identityCasesRepointed = 0;
      for (const [caseId, identityCase] of identityCasesById.entries()) {
        const nextAnchoredContactId =
          identityCase.anchoredContactId === mergeInput.emailOnlyContactId
            ? mergeInput.anchoredContactId
            : identityCase.anchoredContactId;
        const nextCandidateContactIds = [
          ...new Set(
            identityCase.candidateContactIds
              .map((contactId) =>
                contactId === mergeInput.emailOnlyContactId
                  ? mergeInput.anchoredContactId
                  : contactId,
              )
              .filter(
                (contactId) => contactId !== mergeInput.emailOnlyContactId,
              ),
          ),
        ];

        if (
          nextAnchoredContactId === identityCase.anchoredContactId &&
          nextCandidateContactIds.length ===
            identityCase.candidateContactIds.length &&
          nextCandidateContactIds.every(
            (contactId, index) =>
              contactId === identityCase.candidateContactIds[index],
          )
        ) {
          continue;
        }

        identityCasesRepointed += 1;
        identityCasesById.set(caseId, {
          ...identityCase,
          anchoredContactId: nextAnchoredContactId,
          candidateContactIds: nextCandidateContactIds,
        });
      }

      const contactDeleted = contactRecords.delete(
        mergeInput.emailOnlyContactId,
      );
      inboxProjectionByContactId.delete(mergeInput.emailOnlyContactId);
      for (
        let index = contactIdentityRecords.length - 1;
        index >= 0;
        index -= 1
      ) {
        if (
          contactIdentityRecords[index]?.contactId ===
          mergeInput.emailOnlyContactId
        ) {
          contactIdentityRecords.splice(index, 1);
        }
      }

      return Promise.resolve({
        canonicalEventsRepointed,
        timelineRowsRepointed,
        notesRepointed,
        routingRowsRepointed,
        identityCasesRepointed,
        audienceRowsRepointed: 0,
        contactDeleted,
      });
    },
    contactIdentities: {
      listByContactId: (contactId) =>
        Promise.resolve(
          listContactIdentities().filter(
            (identity) => identity.contactId === contactId,
          ),
        ),
      listByNormalizedValue: ({ kind, normalizedValue }) =>
        Promise.resolve(
          listContactIdentities().filter(
            (identity) =>
              identity.kind === kind &&
              identity.normalizedValue === normalizedValue,
          ),
        ),
      upsert: (record) => {
        input.onContactIdentityUpsert?.(record);
        const existingIndex = contactIdentityRecords.findIndex(
          (entry) => entry.id === record.id,
        );
        if (existingIndex >= 0) {
          contactIdentityRecords.splice(existingIndex, 1, record);
        } else {
          contactIdentityRecords.push(record);
        }
        return Promise.resolve(record);
      },
    },
    contactMemberships: {
      listByContactId: (contactId) =>
        Promise.resolve(
          contactMembershipRecords.filter(
            (record) => record.contactId === contactId,
          ),
        ),
      listByContactIds: (contactIds) =>
        Promise.resolve(
          contactMembershipRecords.filter((record) =>
            contactIds.includes(record.contactId),
          ),
        ),
      listSalesforceAnchoredIds: () => Promise.resolve([]),
      markSalesforceDeleted: () => Promise.resolve(0),
      markSalesforceReconciled: () => Promise.resolve(0),
      upsert: (record: ContactMembershipRecord) => {
        input.onContactMembershipUpsert?.(record);
        const existingIndex = contactMembershipRecords.findIndex(
          (entry) => entry.id === record.id,
        );
        if (existingIndex >= 0) {
          contactMembershipRecords.splice(existingIndex, 1, record);
        } else {
          contactMembershipRecords.push(record);
        }
        return Promise.resolve(record);
      },
    },
    smsMessages: {
      insert: (record) => Promise.resolve(record),
      bulkInsert: () => Promise.resolve(),
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
      findLatestByContactIds: () => Promise.resolve(new Map()),
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
      listAllProjectAliases: () => Promise.resolve(input.projectAliases ?? []),
      listByIds: () => Promise.resolve([]),
      listSalesforceAnchoredIds: () => Promise.resolve([]),
      markSalesforceDeleted: () => Promise.resolve(0),
      markSalesforceReconciled: () => Promise.resolve(0),
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
    salesforceReconciliationRuns: {
      insert: () => Promise.resolve(),
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
      create: (noteInput) => {
        const record: StoredInternalNote = {
          id: noteInput.id,
          contactId: noteInput.contactId,
          body: noteInput.body,
          authorDisplayName: null,
          authorId: noteInput.authorId,
          createdAt: noteInput.createdAt ?? new Date(0),
          updatedAt: noteInput.updatedAt ?? new Date(0),
        };
        internalNotesById.set(record.id, record);
        return Promise.resolve(record);
      },
      findById: (id) => Promise.resolve(internalNotesById.get(id)),
      findByContactId: (contactId) =>
        Promise.resolve(
          [...internalNotesById.values()].filter(
            (note) => note.contactId === contactId,
          ),
        ),
      update: (noteInput) => {
        const existing = internalNotesById.get(noteInput.id);
        const updated: StoredInternalNote = {
          id: noteInput.id,
          contactId: existing?.contactId ?? "contact_1",
          body: noteInput.body,
          authorDisplayName: existing?.authorDisplayName ?? "Author",
          authorId: existing?.authorId ?? "user:author",
          createdAt: existing?.createdAt ?? new Date(0),
          updatedAt: noteInput.updatedAt ?? new Date(0),
        };
        internalNotesById.set(updated.id, updated);
        return Promise.resolve(updated);
      },
      delete: (id) => {
        internalNotesById.delete(id);
        return Promise.resolve();
      },
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
    integrationBackfillJobs: {
      insert: () => Promise.resolve(null),
      countAll: () => Promise.resolve(0),
      findById: () => Promise.resolve(null),
      findByIdempotencyKey: () => Promise.resolve(null),
      markRunning: () => Promise.resolve(null),
      markCompleted: () => Promise.resolve(null),
      markFailed: () => Promise.resolve(null),
    },
    identityResolutionQueue: {
      findById: (id) => Promise.resolve(identityCasesById.get(id) ?? null),
      listOpenByContactId: (contactId) =>
        Promise.resolve(
          [...identityCasesById.values()].filter(
            (record) =>
              record.status === "open" &&
              (record.anchoredContactId === contactId ||
                record.candidateContactIds.includes(contactId)),
          ),
        ),
      listOpenByReasonCode: (reasonCode) =>
        Promise.resolve(
          [...identityCasesById.values()].filter(
            (record) =>
              record.status === "open" && record.reasonCode === reasonCode,
          ),
        ),
      upsert: (record: IdentityResolutionCase) => {
        identityCasesById.set(record.id, record);
        return Promise.resolve(record);
      },
    },
    routingReviewQueue: {
      findById: (id) => Promise.resolve(routingCasesById.get(id) ?? null),
      listOpenByContactId: (contactId) =>
        Promise.resolve(
          [...routingCasesById.values()].filter(
            (record) =>
              record.status === "open" && record.contactId === contactId,
          ),
        ),
      listOpenByReasonCode: (reasonCode) =>
        Promise.resolve(
          [...routingCasesById.values()].filter(
            (record) =>
              record.status === "open" && record.reasonCode === reasonCode,
          ),
        ),
      upsert: (record: RoutingReviewCase) => {
        routingCasesById.set(record.id, record);
        return Promise.resolve(record);
      },
    },
    inboxProjection: {
      countAll: () => Promise.resolve(inboxProjectionByContactId.size),
      countInvalidRecencyRows: () => Promise.resolve(0),
      findByContactId: (contactId) =>
        Promise.resolve(getInboxProjection(contactId)),
      listInvalidRecencyContactIds: () => Promise.resolve([]),
      listAllOrderedByRecency: () =>
        Promise.resolve([...inboxProjectionByContactId.values()]),
      searchPageOrderedByRecency: () =>
        Promise.resolve({
          rows: [...inboxProjectionByContactId.values()],
          total: inboxProjectionByContactId.size,
        }),
      listPageOrderedByRecency: () =>
        Promise.resolve([...inboxProjectionByContactId.values()]),
      countByFilters: () =>
        Promise.resolve({
          all: inboxProjectionByContactId.size,
          unread: [...inboxProjectionByContactId.values()].filter(
            (record) => record.bucket === "New",
          ).length,
          followUp: [...inboxProjectionByContactId.values()].filter(
            (record) => record.needsFollowUp,
          ).length,
          unresolved: [...inboxProjectionByContactId.values()].filter(
            (record) => record.hasUnresolved,
          ).length,
          sent: [...inboxProjectionByContactId.values()].filter(
            (record) => record.lastOutboundAt !== null,
          ).length,
          archived: [...inboxProjectionByContactId.values()].filter(
            (record) => record.archivedAt !== null,
          ).length,
        }),
      getFreshness: () =>
        Promise.resolve({
          total: inboxProjectionByContactId.size,
          latestUpdatedAt: null,
        }),
      getFreshnessByContactId: (contactId) =>
        Promise.resolve(
          inboxProjectionByContactId.has(contactId)
            ? { contactId, updatedAt: null }
            : null,
        ),
      deleteByContactId: (contactId) => {
        inboxProjectionByContactId.delete(contactId);
        return Promise.resolve();
      },
      setNeedsFollowUp: ({ contactId, needsFollowUp }) => {
        const existing = inboxProjectionByContactId.get(contactId) ?? null;
        const updated =
          existing === null
            ? null
            : {
                ...existing,
                needsFollowUp,
              };
        if (updated !== null) {
          inboxProjectionByContactId.set(contactId, updated);
        }
        return Promise.resolve(updated);
      },
      setArchived: ({ contactId, archived }) => {
        const existing = inboxProjectionByContactId.get(contactId) ?? null;
        const updated =
          existing === null
            ? null
            : {
                ...existing,
                archivedAt: archived ? "2026-04-14T00:00:00.000Z" : null,
              };
        if (updated !== null) {
          inboxProjectionByContactId.set(contactId, updated);
        }
        return Promise.resolve(updated);
      },
      setBucket: ({ contactId, bucket }) => {
        const existing = inboxProjectionByContactId.get(contactId) ?? null;
        const updated =
          existing === null
            ? null
            : {
                ...existing,
                bucket,
              };
        if (updated !== null) {
          inboxProjectionByContactId.set(contactId, updated);
        }
        return Promise.resolve(updated);
      },
      upsert: (record) => {
        inboxSaveCount += 1;
        inboxProjectionByContactId.set(record.contactId, record);
        return Promise.resolve(record);
      },
    },
    timelineProjection: {
      countAll: () => Promise.resolve(timelineRowsByCanonicalEventId.size),
      findByCanonicalEventId: (canonicalEventId) =>
        Promise.resolve(
          timelineRowsByCanonicalEventId.get(canonicalEventId) ?? null,
        ),
      listByContactId: (contactId) =>
        Promise.resolve(
          [...timelineRowsByCanonicalEventId.values()].filter(
            (record) => record.contactId === contactId,
          ),
        ),
      listRecentByContactId: ({ contactId }) =>
        Promise.resolve(
          [...timelineRowsByCanonicalEventId.values()].filter(
            (record) => record.contactId === contactId,
          ),
        ),
      countByContactId: (contactId) =>
        Promise.resolve(
          [...timelineRowsByCanonicalEventId.values()].filter(
            (record) => record.contactId === contactId,
          ).length,
        ),
      getFreshnessByContactId: (contactId) =>
        Promise.resolve({
          contactId,
          total: [...timelineRowsByCanonicalEventId.values()].filter(
            (record) => record.contactId === contactId,
          ).length,
          latestUpdatedAt: null,
          latestSortKey: null,
        }),
      upsert: (record) => {
        timelineRowsByCanonicalEventId.set(record.canonicalEventId, record);
        return Promise.resolve(record);
      },
    },
    canonicalEventAudience: {
      upsert: (record) => {
        canonicalEventAudienceRowsByKey.set(
          `${record.canonicalEventId}:${record.contactId}`,
          record,
        );
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
      append: (record: AuditEvidenceRecord) => {
        auditEvidenceRecords.push(record);
        return Promise.resolve(record);
      },
      listByEntity: ({ entityType, entityId }) =>
        Promise.resolve(
          auditEvidenceRecords.filter(
            (record) =>
              record.entityType === entityType && record.entityId === entityId,
          ),
        ),
      listByEntities: ({ entityType, entityIds }) =>
        Promise.resolve(
          auditEvidenceRecords.filter(
            (record) =>
              record.entityType === entityType &&
              entityIds.includes(record.entityId),
          ),
        ),
    },
  });

  const persistence = createStage1PersistenceService(bundle);

  return {
    normalization: createStage1NormalizationService(persistence),
    getInboxProjection: () => getInboxProjection(contact.id),
    getInboxProjectionForContact: (contactId) => getInboxProjection(contactId),
    getInboxSaveCount: () => inboxSaveCount,
    getContact: (contactId) => contactRecords.get(contactId) ?? null,
    getCanonicalEvent: (eventId) => canonicalEventsById.get(eventId) ?? null,
    getTimelineRow: (canonicalEventId) =>
      timelineRowsByCanonicalEventId.get(canonicalEventId) ?? null,
    getCanonicalEventAudienceRows: (canonicalEventId) =>
      [...canonicalEventAudienceRowsByKey.values()]
        .filter((row) => row.canonicalEventId === canonicalEventId)
        .sort((left, right) => left.contactId.localeCompare(right.contactId)),
    getAuditEvidence: () => [...auditEvidenceRecords],
    getPendingOutbound: (id) => pendingOutboundsById.get(id) ?? null,
  };
}

async function applyReplayEvent(
  context: TestContext,
  event: CanonicalEventRecord,
  overrides?: {
    readonly snippet?: string;
  },
) {
  return context.normalization.applyNormalizedCanonicalEvent(
    buildReplayInput(event, overrides),
  );
}

async function replayEvent(
  context: TestContext,
  event: CanonicalEventRecord,
): Promise<InboxProjectionRow | null> {
  const result = await applyReplayEvent(context, event);

  expect(result.outcome).toBe("duplicate");

  if (result.outcome !== "duplicate") {
    return null;
  }

  return result.inboxProjection;
}

describe("rebuildInboxProjectionForContact bucket semantics", () => {
  it("transitions New to Opened when the latest outbound is an in-thread reply", async () => {
    const inbound = buildEvent({
      key: "reply-thread-inbound",
      occurredAt: "2026-04-24T09:00:00.000Z",
      direction: "inbound",
    });
    const outboundReply = buildEvent({
      key: "reply-thread-outbound",
      occurredAt: "2026-04-24T09:30:00.000Z",
      direction: "outbound",
    });
    const context = buildContext({
      events: [inbound, outboundReply],
      existingProjection: buildExistingProjection({
        bucket: "New",
        lastInboundAt: inbound.occurredAt,
        lastCanonicalEventId: inbound.id,
      }),
      gmailMessageDetails: [
        buildGmailDetail({
          key: "reply-thread-inbound",
          direction: "inbound",
          gmailThreadId: "thread:shared-reply",
        }),
        buildGmailDetail({
          key: "reply-thread-outbound",
          direction: "outbound",
          gmailThreadId: "thread:shared-reply",
        }),
      ],
    });

    const projection = await rebuildInboxProjectionForContact(
      context.normalization.persistence,
      outboundReply.contactId,
    );

    expect(projection).toMatchObject({
      bucket: "Opened",
      lastInboundAt: inbound.occurredAt,
      lastOutboundAt: outboundReply.occurredAt,
    });
  });

  it("keeps New when the latest outbound is a compose-new message on a different thread", async () => {
    const inbound = buildEvent({
      key: "compose-new-inbound",
      occurredAt: "2026-04-24T09:45:00.000Z",
      direction: "inbound",
    });
    const composeNewOutbound = buildEvent({
      key: "compose-new-outbound",
      occurredAt: "2026-04-24T10:15:00.000Z",
      direction: "outbound",
    });
    const context = buildContext({
      events: [inbound, composeNewOutbound],
      existingProjection: buildExistingProjection({
        bucket: "New",
        lastInboundAt: inbound.occurredAt,
        lastCanonicalEventId: inbound.id,
      }),
      gmailMessageDetails: [
        buildGmailDetail({
          key: "compose-new-inbound",
          direction: "inbound",
          gmailThreadId: "thread:inbound-original",
        }),
        buildGmailDetail({
          key: "compose-new-outbound",
          direction: "outbound",
          gmailThreadId: "thread:fresh-compose",
        }),
      ],
    });

    const projection = await rebuildInboxProjectionForContact(
      context.normalization.persistence,
      composeNewOutbound.contactId,
    );

    expect(projection).toMatchObject({
      bucket: "New",
      lastInboundAt: inbound.occurredAt,
      lastOutboundAt: composeNewOutbound.occurredAt,
    });
  });

  it("keeps newer inbound precedence over an earlier in-thread reply", async () => {
    const inbound = buildEvent({
      key: "reply-then-newer-inbound-first",
      occurredAt: "2026-04-24T10:30:00.000Z",
      direction: "inbound",
    });
    const outboundReply = buildEvent({
      key: "reply-then-newer-inbound-outbound",
      occurredAt: "2026-04-24T11:00:00.000Z",
      direction: "outbound",
    });
    const newerInbound = buildEvent({
      key: "reply-then-newer-inbound-latest",
      occurredAt: "2026-04-24T11:30:00.000Z",
      direction: "inbound",
    });
    const context = buildContext({
      events: [inbound, outboundReply, newerInbound],
      existingProjection: buildExistingProjection({
        bucket: "Opened",
        lastInboundAt: inbound.occurredAt,
        lastOutboundAt: outboundReply.occurredAt,
        lastCanonicalEventId: outboundReply.id,
        lastEventType: outboundReply.eventType,
      }),
      gmailMessageDetails: [
        buildGmailDetail({
          key: "reply-then-newer-inbound-first",
          direction: "inbound",
          gmailThreadId: "thread:shared-newer-inbound",
        }),
        buildGmailDetail({
          key: "reply-then-newer-inbound-outbound",
          direction: "outbound",
          gmailThreadId: "thread:shared-newer-inbound",
        }),
        buildGmailDetail({
          key: "reply-then-newer-inbound-latest",
          direction: "inbound",
          gmailThreadId: "thread:shared-newer-inbound",
        }),
      ],
    });

    const projection = await rebuildInboxProjectionForContact(
      context.normalization.persistence,
      newerInbound.contactId,
    );

    expect(projection).toMatchObject({
      bucket: "New",
      lastInboundAt: newerInbound.occurredAt,
      lastOutboundAt: outboundReply.occurredAt,
    });
  });

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

describe("rebuildInboxProjectionForContact snippet selection", () => {
  it("prefers the latest tier-1 communication snippet over newer campaign engagement", async () => {
    const inbound = buildEvent({
      key: "snippet-tier-1-inbound",
      occurredAt: "2026-04-24T10:00:00.000Z",
      direction: "inbound",
    });
    const campaignOpened = buildEvent({
      key: "snippet-tier-3-open",
      occurredAt: "2026-04-24T12:00:00.000Z",
      eventType: "campaign.email.opened",
      direction: null,
      provider: "mailchimp",
      sourceRecordType: "campaign_activity",
      messageKind: "campaign",
    });
    const context = buildContext({
      events: [inbound, campaignOpened],
      gmailMessageDetails: [
        buildGmailDetail({
          key: "snippet-tier-1-inbound",
          direction: "inbound",
          bodyTextPreview:
            "I went to pick it up today and Weaverville had no units to give me.",
        }),
      ],
    });

    const projection = await rebuildInboxProjectionForContact(
      context.normalization.persistence,
      inbound.contactId,
    );

    expect(projection).toMatchObject({
      snippet:
        "I went to pick it up today and Weaverville had no units to give me.",
      lastEventType: "campaign.email.opened",
      lastCanonicalEventId: campaignOpened.id,
    });
  });

  it("falls back to a friendly campaign label when only campaign opens exist", async () => {
    const campaignOpened = buildEvent({
      key: "snippet-campaign-only-open",
      occurredAt: "2026-04-24T12:00:00.000Z",
      eventType: "campaign.email.opened",
      direction: null,
      provider: "mailchimp",
      sourceRecordType: "campaign_activity",
      messageKind: "campaign",
    });
    const context = buildContext({
      events: [campaignOpened],
    });

    const projection = await rebuildInboxProjectionForContact(
      context.normalization.persistence,
      campaignOpened.contactId,
    );

    expect(projection).toMatchObject({
      snippet: "Campaign email opened",
      lastEventType: "campaign.email.opened",
    });
  });

  it("prefers the latest tier-2 lifecycle snippet over newer tier-3 campaign activity", async () => {
    const lifecycle = buildEvent({
      key: "snippet-tier-2-lifecycle",
      occurredAt: "2026-04-24T11:00:00.000Z",
      eventType: "lifecycle.signed_up",
      direction: null,
      provider: "salesforce",
      sourceRecordType: "contact_membership",
      messageKind: null,
    });
    const campaignSent = buildEvent({
      key: "snippet-tier-3-sent",
      occurredAt: "2026-04-24T12:00:00.000Z",
      eventType: "campaign.email.sent",
      direction: null,
      provider: "mailchimp",
      sourceRecordType: "campaign_activity",
      messageKind: "campaign",
    });
    const context = buildContext({
      events: [lifecycle, campaignSent],
    });

    const projection = await rebuildInboxProjectionForContact(
      context.normalization.persistence,
      lifecycle.contactId,
    );

    expect(projection).toMatchObject({
      snippet: "Signed up",
      lastEventType: "campaign.email.sent",
      lastCanonicalEventId: campaignSent.id,
    });
  });
});

describe("applyNormalizedCanonicalEvent snippet selection", () => {
  it("keeps an existing tier-1 snippet when a newer tier-3 campaign event arrives", async () => {
    const campaignOpened = buildEvent({
      key: "ingest-tier-3-open",
      occurredAt: "2026-04-24T12:00:00.000Z",
      eventType: "campaign.email.opened",
      direction: null,
      provider: "mailchimp",
      sourceRecordType: "campaign_activity",
      messageKind: "campaign",
    });
    const context = buildContext({
      events: [],
      existingProjection: buildExistingProjection({
        bucket: "Opened",
        lastInboundAt: "2026-04-24T10:00:00.000Z",
        snippet: "I went to pick it up today",
      }),
    });

    const result = await applyReplayEvent(context, campaignOpened, {
      snippet: "",
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") {
      return;
    }

    expect(result.inboxProjection).toMatchObject({
      snippet: "I went to pick it up today",
      lastEventType: "campaign.email.opened",
    });
  });

  it("keeps an existing tier-1 snippet when a newer tier-2 lifecycle event arrives", async () => {
    const lifecycle = buildEvent({
      key: "ingest-tier-2-training",
      occurredAt: "2026-04-24T12:00:00.000Z",
      eventType: "lifecycle.received_training",
      direction: null,
      provider: "salesforce",
      sourceRecordType: "contact_membership",
      messageKind: null,
    });
    const context = buildContext({
      events: [],
      existingProjection: buildExistingProjection({
        bucket: "Opened",
        lastInboundAt: "2026-04-24T10:00:00.000Z",
        snippet: "I went to pick it up today",
      }),
    });

    const result = await applyReplayEvent(context, lifecycle, {
      snippet: "",
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") {
      return;
    }

    expect(result.inboxProjection).toMatchObject({
      snippet: "I went to pick it up today",
      lastEventType: "lifecycle.received_training",
    });
  });

  it("updates the snippet when a tier-1 inbound arrives", async () => {
    const inbound = buildEvent({
      key: "ingest-tier-1-inbound",
      occurredAt: "2026-04-24T12:00:00.000Z",
      direction: "inbound",
    });
    const context = buildContext({
      events: [],
      existingProjection: buildExistingProjection({
        bucket: "Opened",
        lastInboundAt: "2026-04-24T10:00:00.000Z",
        snippet: "old text",
      }),
    });

    const result = await applyReplayEvent(context, inbound, {
      snippet: "new text",
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") {
      return;
    }

    expect(result.inboxProjection).toMatchObject({
      snippet: "new text",
      lastEventType: "communication.email.inbound",
    });
  });

  it("uses a friendly fallback when a tier-3 event arrives with no existing snippet", async () => {
    const campaignOpened = buildEvent({
      key: "ingest-tier-3-open-fallback",
      occurredAt: "2026-04-24T12:00:00.000Z",
      eventType: "campaign.email.opened",
      direction: null,
      provider: "mailchimp",
      sourceRecordType: "campaign_activity",
      messageKind: "campaign",
    });
    const context = buildContext({
      events: [],
      existingProjection: buildExistingProjection({
        bucket: "Opened",
        lastInboundAt: "2026-04-24T10:00:00.000Z",
        snippet: "",
      }),
    });

    const result = await applyReplayEvent(context, campaignOpened, {
      snippet: "",
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") {
      return;
    }

    expect(result.inboxProjection).toMatchObject({
      snippet: "Campaign email opened",
      lastEventType: "campaign.email.opened",
    });
  });

  it("uses a friendly fallback when a tier-2 lifecycle event arrives with no existing snippet", async () => {
    const lifecycle = buildEvent({
      key: "ingest-tier-2-training-fallback",
      occurredAt: "2026-04-24T12:00:00.000Z",
      eventType: "lifecycle.received_training",
      direction: null,
      provider: "salesforce",
      sourceRecordType: "contact_membership",
      messageKind: null,
    });
    const context = buildContext({
      events: [],
      existingProjection: buildExistingProjection({
        bucket: "Opened",
        lastInboundAt: "2026-04-24T10:00:00.000Z",
        snippet: "",
      }),
    });

    const result = await applyReplayEvent(context, lifecycle, {
      snippet: "",
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") {
      return;
    }

    expect(result.inboxProjection).toMatchObject({
      snippet: "Received training",
      lastEventType: "lifecycle.received_training",
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

  it("skips Salesforce email identity upserts when the email matches an internal project alias", async () => {
    const upsertedIdentityKinds: ContactIdentityRecord["kind"][] = [];
    const context = buildContext({
      events: [],
      contacts: [],
      contactIdentities: [],
      projectAliases: ["orcas@adventurescientists.org"],
      onContactIdentityUpsert: (record) => {
        upsertedIdentityKinds.push(record.kind);
      },
    });

    await context.normalization.upsertNormalizedContactGraph({
      contact: {
        id: "contact:salesforce:003-alias-owner",
        salesforceContactId: "003-alias-owner",
        displayName: "Slack Test Test",
        primaryEmail: "orcas@adventurescientists.org",
        primaryPhone: null,
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T00:00:00.000Z",
      },
      identities: [
        {
          id: "identity:sf-contact-id",
          contactId: "contact:salesforce:003-alias-owner",
          kind: "salesforce_contact_id",
          normalizedValue: "003-alias-owner",
          isPrimary: true,
          source: "salesforce",
          verifiedAt: "2026-06-03T00:00:00.000Z",
        },
        {
          id: "identity:sf-alias-email",
          contactId: "contact:salesforce:003-alias-owner",
          kind: "email",
          normalizedValue: "orcas@adventurescientists.org",
          isPrimary: true,
          source: "salesforce",
          verifiedAt: "2026-06-03T00:00:00.000Z",
        },
      ],
      memberships: [
        {
          id: "membership:sf-alias-owner",
          contactId: "contact:salesforce:003-alias-owner",
          projectId: "sf-project-orcas",
          expeditionId: "sf-expedition-orcas",
          salesforceMembershipId: "a0B-orcas",
          role: "volunteer",
          status: "active",
          source: "salesforce",
          createdAt: "2026-06-03T00:00:00.000Z",
        },
      ],
      projectDimensions: [
        {
          projectId: "sf-project-orcas",
          projectName: "Orcas",
          source: "salesforce",
          isActive: false,
        },
      ],
      expeditionDimensions: [
        {
          expeditionId: "sf-expedition-orcas",
          projectId: "sf-project-orcas",
          expeditionName: "Orcas Expedition",
          source: "salesforce",
        },
      ],
    });

    expect(upsertedIdentityKinds).toContain("salesforce_contact_id");
    expect(upsertedIdentityKinds).not.toContain("email");
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

  it("auto-merges pure email-only conflicts into the Salesforce-anchored contact", async () => {
    const sfAnchoredContact: ContactRecord = {
      ...contact,
      id: "contact:salesforce:sf-contact-1",
      salesforceContactId: "sf-contact-1",
      primaryEmail: "foo@bar.com",
    };
    const emailOnlyContact: ContactRecord = {
      ...contact,
      id: "contact:email:foo@bar.com",
      primaryEmail: "foo@bar.com",
      displayName: "Foo Bar",
    };
    const strandedInbound = buildEvent({
      key: "stranded-inbound",
      contactId: emailOnlyContact.id,
      occurredAt: "2026-05-17T12:44:00.000Z",
      direction: "inbound",
    });
    const context = buildContext({
      events: [strandedInbound],
      contacts: [emailOnlyContact, sfAnchoredContact],
      contactIdentities: [
        {
          ...emailIdentity,
          id: "identity:email-only:foo",
          contactId: emailOnlyContact.id,
          normalizedValue: "foo@bar.com",
          source: "gmail",
        },
        {
          ...emailIdentity,
          id: "identity:sf:foo",
          contactId: sfAnchoredContact.id,
          normalizedValue: "foo@bar.com",
          source: "salesforce",
        },
      ],
      gmailMessageDetails: [
        buildGmailDetail({
          key: "stranded-inbound",
          direction: "inbound",
          subject: "Volunteer reply",
          bodyTextPreview: "I can help this weekend.",
        }),
      ],
      timelineRows: [
        {
          id: "timeline:event:stranded-inbound",
          contactId: emailOnlyContact.id,
          canonicalEventId: strandedInbound.id,
          occurredAt: strandedInbound.occurredAt,
          sortKey: buildTimelineSortKey(
            strandedInbound.id,
            strandedInbound.occurredAt,
            strandedInbound.eventType,
          ),
          eventType: strandedInbound.eventType,
          summary: "Volunteer replied",
          channel: strandedInbound.channel,
          primaryProvider: strandedInbound.provenance.primaryProvider,
          reviewState: strandedInbound.reviewState,
        },
      ],
      inboxProjections: [
        buildExistingProjection({
          contactId: emailOnlyContact.id,
          bucket: "Opened",
          lastInboundAt: strandedInbound.occurredAt,
          lastCanonicalEventId: strandedInbound.id,
          lastEventType: strandedInbound.eventType,
          snippet: "I can help this weekend.",
        }),
      ],
    });

    const result = await context.normalization.applyNormalizedCanonicalEvent({
      sourceEvidence: {
        ...buildSourceEvidence({
          key: "salesforce-signup",
          occurredAt: "2026-05-17T12:45:00.000Z",
          provider: "salesforce",
          providerRecordType: "task",
        }),
        provider: "salesforce",
      },
      canonicalEvent: {
        id: "event:salesforce-signup:replay",
        eventType: "lifecycle.signed_up",
        occurredAt: "2026-05-17T12:45:00.000Z",
        idempotencyKey: "canonical:salesforce-signup",
        summary: "Signed up",
        snippet: "Signed up",
      },
      identity: {
        salesforceContactId: "sf-contact-1",
        volunteerIdPlainValues: [],
        normalizedEmails: ["foo@bar.com"],
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
    });

    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") {
      throw new Error("Expected applied result.");
    }
    expect(result.identityCase).toBeNull();
    expect(context.getContact(emailOnlyContact.id)).toBeNull();
    expect(context.getCanonicalEvent(strandedInbound.id)?.contactId).toBe(
      sfAnchoredContact.id,
    );
    expect(context.getTimelineRow(strandedInbound.id)?.contactId).toBe(
      sfAnchoredContact.id,
    );
    expect(
      context.getInboxProjectionForContact(emailOnlyContact.id),
    ).toBeNull();

    const anchoredProjection = context.getInboxProjectionForContact(
      sfAnchoredContact.id,
    );
    expect(anchoredProjection?.hasUnresolved).toBe(false);
    expect(anchoredProjection?.lastInboundAt).toBe(strandedInbound.occurredAt);

    expect(
      context
        .getAuditEvidence()
        .find(
          (record) =>
            record.policyCode ===
              "stage1.identity.auto_merge_email_only_into_salesforce_anchored" &&
            record.entityType === "contact_merge" &&
            record.entityId ===
              `${emailOnlyContact.id}->${sfAnchoredContact.id}`,
        ),
    ).toBeDefined();
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

  it("sets displayName from the observed header value when creating a new contact", async () => {
    const context = buildContext({
      events: [],
      contacts: [],
      contactIdentities: [],
    });

    const created = await context.normalization.ensureCanonicalContactForEmail({
      emailAddress: "or-rural-coordinator@example.org",
      createdAt: "2026-05-31T12:00:00.000Z",
      source: "gmail",
      observedDisplayName: "Scotty Stalp",
    });

    expect(created).toMatchObject({
      primaryEmail: "or-rural-coordinator@example.org",
      displayName: "Scotty Stalp",
    });
    expect(context.getContact(created.id)).toMatchObject({
      displayName: "Scotty Stalp",
    });
  });

  it("falls back to the email address when creating a new contact without an observed display name", async () => {
    const context = buildContext({
      events: [],
      contacts: [],
      contactIdentities: [],
    });

    const created = await context.normalization.ensureCanonicalContactForEmail({
      emailAddress: "or-rural-coordinator@example.org",
      createdAt: "2026-05-31T12:00:00.000Z",
      source: "gmail",
    });

    expect(created).toMatchObject({
      primaryEmail: "or-rural-coordinator@example.org",
      displayName: "or-rural-coordinator@example.org",
    });
  });

  it("updates an existing contact when displayName is effectively unset", async () => {
    const legacyContact: ContactRecord = {
      ...contact,
      displayName: null as unknown as string,
      primaryEmail: "or-rural-coordinator@example.org",
    };
    const legacyIdentity: ContactIdentityRecord = {
      ...emailIdentity,
      contactId: legacyContact.id,
      normalizedValue: "or-rural-coordinator@example.org",
    };
    const context = buildContext({
      events: [],
      contacts: [legacyContact],
      contactIdentities: [legacyIdentity],
    });

    const resolved = await context.normalization.ensureCanonicalContactForEmail(
      {
        emailAddress: "or-rural-coordinator@example.org",
        createdAt: "2026-05-31T12:00:00.000Z",
        source: "gmail",
        observedDisplayName: "Scotty Stalp",
      },
    );

    expect(resolved.displayName).toBe("Scotty Stalp");
    expect(context.getContact(legacyContact.id)?.displayName).toBe(
      "Scotty Stalp",
    );
  });

  it("updates an existing contact when displayName equals the primary email", async () => {
    const emailNamedContact: ContactRecord = {
      ...contact,
      displayName: "or-rural-coordinator@example.org",
      primaryEmail: "or-rural-coordinator@example.org",
    };
    const emailNamedIdentity: ContactIdentityRecord = {
      ...emailIdentity,
      contactId: emailNamedContact.id,
      normalizedValue: "or-rural-coordinator@example.org",
    };
    const context = buildContext({
      events: [],
      contacts: [emailNamedContact],
      contactIdentities: [emailNamedIdentity],
    });

    const resolved = await context.normalization.ensureCanonicalContactForEmail(
      {
        emailAddress: "or-rural-coordinator@example.org",
        createdAt: "2026-05-31T12:00:00.000Z",
        source: "gmail",
        observedDisplayName: "Scotty Stalp",
      },
    );

    expect(resolved.displayName).toBe("Scotty Stalp");
    expect(context.getContact(emailNamedContact.id)?.displayName).toBe(
      "Scotty Stalp",
    );
  });

  it("does not overwrite an existing real displayName with an observed header value", async () => {
    const context = buildContext({
      events: [],
      contacts: [
        {
          ...contact,
          displayName: "Scott Stalp",
          primaryEmail: "or-rural-coordinator@example.org",
        },
      ],
      contactIdentities: [
        {
          ...emailIdentity,
          normalizedValue: "or-rural-coordinator@example.org",
        },
      ],
    });

    const resolved = await context.normalization.ensureCanonicalContactForEmail(
      {
        emailAddress: "or-rural-coordinator@example.org",
        createdAt: "2026-05-31T12:00:00.000Z",
        source: "gmail",
        observedDisplayName: "Scotty Stalp",
      },
    );

    expect(resolved.displayName).toBe("Scott Stalp");
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

  describe("canonical event audience writes", () => {
    const occurredAt = "2026-05-30T12:00:00.000Z";

    const buildAudienceContact = (
      contactId: string,
      email: string,
    ): ContactRecord => ({
      id: contactId,
      salesforceContactId: null,
      displayName: email,
      primaryEmail: email,
      primaryPhone: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    const buildAudienceIdentity = (
      contactId: string,
      email: string,
    ): ContactIdentityRecord => ({
      id: `identity:${contactId}:email`,
      contactId,
      kind: "email",
      normalizedValue: email,
      isPrimary: true,
      source: "gmail",
      verifiedAt: "2026-05-01T00:00:00.000Z",
    });

    const buildAudienceGmailInput = (input?: {
      readonly eventKey?: string;
      readonly identityEmails?: readonly string[];
      readonly fromEmails?: readonly string[];
      readonly toEmails?: readonly string[];
      readonly ccEmails?: readonly string[];
      readonly bccEmails?: readonly string[];
    }): NormalizedCanonicalEventIntake => {
      const eventKey = input?.eventKey ?? "fanout";

      return {
        sourceEvidence: buildSourceEvidence({
          key: eventKey,
          occurredAt,
        }),
        canonicalEvent: {
          id: `event:${eventKey}`,
          eventType: "communication.email.inbound",
          occurredAt,
          idempotencyKey: `canonical:${eventKey}`,
          summary: "Inbound email received",
          snippet: "Audience test message",
        },
        identity: {
          salesforceContactId: null,
          volunteerIdPlainValues: [],
          normalizedEmails: [
            ...(input?.identityEmails ?? ["sender@example.org"]),
          ],
          normalizedPhones: [],
        },
        supportingSources: [],
        communicationClassification: {
          messageKind: "one_to_one",
          sourceRecordType: "message",
          sourceRecordId: `gmail:${eventKey}`,
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey: null,
            providerThreadId: `thread:${eventKey}`,
          },
          direction: "inbound",
        },
        gmailMessageDetail: {
          ...buildGmailDetail({
            key: eventKey,
            direction: "inbound",
          }),
          fromEmails: [...(input?.fromEmails ?? ["sender@example.org"])],
          toEmails: [...(input?.toEmails ?? ["direct@example.org"])],
          ccEmails: [...(input?.ccEmails ?? ["cc@example.org"])],
          bccEmails: [...(input?.bccEmails ?? ["bcc@example.org"])],
        },
      };
    };

    it("writes one audience row per Gmail participant with the correct role", async () => {
      const contacts = [
        buildAudienceContact("contact:sender", "sender@example.org"),
        buildAudienceContact("contact:direct", "direct@example.org"),
        buildAudienceContact("contact:cc", "cc@example.org"),
        buildAudienceContact("contact:bcc", "bcc@example.org"),
      ];
      const identities = contacts.map((entry) =>
        buildAudienceIdentity(entry.id, entry.primaryEmail ?? ""),
      );
      const context = buildContext({
        events: [],
        contacts,
        contactIdentities: identities,
      });

      const result = await context.normalization.applyNormalizedCanonicalEvent(
        buildAudienceGmailInput(),
      );

      expect(result.outcome).toBe("applied");
      expect(
        context.getCanonicalEventAudienceRows("event:fanout"),
      ).toStrictEqual([
        {
          canonicalEventId: "event:fanout",
          contactId: "contact:bcc",
          participantRole: "bcc",
          normalizedEmail: "bcc@example.org",
        },
        {
          canonicalEventId: "event:fanout",
          contactId: "contact:cc",
          participantRole: "cc",
          normalizedEmail: "cc@example.org",
        },
        {
          canonicalEventId: "event:fanout",
          contactId: "contact:direct",
          participantRole: "direct_recipient",
          normalizedEmail: "direct@example.org",
        },
        {
          canonicalEventId: "event:fanout",
          contactId: "contact:sender",
          participantRole: "sender",
          normalizedEmail: "sender@example.org",
        },
      ]);
    });

    it("keeps audience rows replay-idempotent when the same Gmail canonical event is applied twice", async () => {
      const contacts = [
        buildAudienceContact("contact:sender", "sender@example.org"),
        buildAudienceContact("contact:direct", "direct@example.org"),
      ];
      const identities = contacts.map((entry) =>
        buildAudienceIdentity(entry.id, entry.primaryEmail ?? ""),
      );
      const context = buildContext({
        events: [],
        contacts,
        contactIdentities: identities,
      });
      const input = buildAudienceGmailInput({
        eventKey: "fanout-replay",
        toEmails: ["direct@example.org"],
        ccEmails: [],
        bccEmails: [],
      });

      await context.normalization.applyNormalizedCanonicalEvent(input);
      const replayResult =
        await context.normalization.applyNormalizedCanonicalEvent(input);

      expect(replayResult.outcome).toBe("duplicate");
      expect(
        context.getCanonicalEventAudienceRows("event:fanout-replay"),
      ).toStrictEqual([
        {
          canonicalEventId: "event:fanout-replay",
          contactId: "contact:direct",
          participantRole: "direct_recipient",
          normalizedEmail: "direct@example.org",
        },
        {
          canonicalEventId: "event:fanout-replay",
          contactId: "contact:sender",
          participantRole: "sender",
          normalizedEmail: "sender@example.org",
        },
      ]);
    });

    it("skips audience rows for non-Gmail canonical events", async () => {
      const context = buildContext({
        events: [],
      });

      const result = await context.normalization.applyNormalizedCanonicalEvent({
        sourceEvidence: {
          id: "source:sms-fanout-skip",
          provider: "simpletexting",
          providerRecordType: "message",
          providerRecordId: "sms-fanout-skip",
          receivedAt: occurredAt,
          occurredAt,
          payloadRef: "payloads/simpletexting/sms-fanout-skip.json",
          idempotencyKey: "simpletexting:message:sms-fanout-skip",
          checksum: "checksum:sms-fanout-skip",
        },
        canonicalEvent: {
          id: "event:sms-fanout-skip",
          eventType: "communication.sms.inbound",
          occurredAt,
          idempotencyKey: "canonical:sms-fanout-skip",
          summary: "Inbound SMS received",
          snippet: "SMS fan-out should not run",
        },
        identity: {
          salesforceContactId: null,
          volunteerIdPlainValues: [],
          normalizedEmails: [],
          normalizedPhones: ["+14065550142"],
        },
        supportingSources: [],
        communicationClassification: {
          messageKind: "one_to_one",
          sourceRecordType: "message",
          sourceRecordId: "sms-fanout-skip",
          campaignRef: null,
          threadRef: null,
          direction: "inbound",
        },
        simpleTextingMessageDetail: {
          sourceEvidenceId: "source:sms-fanout-skip",
          providerRecordId: "sms-fanout-skip",
          direction: "inbound",
          messageKind: "one_to_one",
          messageTextPreview: "SMS fan-out should not run",
          normalizedPhone: "+14065550142",
          campaignId: null,
          campaignName: null,
          providerThreadId: null,
          threadKey: null,
        },
      });

      expect(result.outcome).toBe("applied");
      expect(
        context.getCanonicalEventAudienceRows("event:sms-fanout-skip"),
      ).toStrictEqual([]);
    });
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
      throw new Error(
        "Expected fingerprint to be computed for pending outbound.",
      );
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
      throw new Error(
        "Expected fingerprint to be computed for pending outbound.",
      );
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
    expect(
      context.getPendingOutbound("pending:already-linked-rfc822"),
    ).toMatchObject({
      status: "confirmed",
      reconciledEventId: "event:existing-link",
    });

    const matchedLog = consoleLog.mock.calls
      .map(([entry]) => JSON.parse(String(entry)) as Record<string, unknown>)
      .find((entry) => entry.event === "composer.reconciliation.matched");

    expect(matchedLog).toBeUndefined();

    consoleLog.mockRestore();
  });
});
