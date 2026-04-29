import { describe, expect, it } from "vitest";

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
  ProjectDimensionRecord,
  RoutingReviewCase,
  SalesforceCommunicationDetailRecord,
  SalesforceEventContextRecord,
  SimpleTextingMessageDetailRecord,
  SourceEvidenceRecord,
  TimelineProjectionRow,
} from "@as-comms/contracts";

import {
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
}): SourceEvidenceRecord {
  return {
    id: `source:${input.key}`,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: `gmail:${input.key}`,
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
  readonly direction: "inbound" | "outbound";
}): CanonicalEventRecord {
  const eventType =
    input.direction === "inbound"
      ? "communication.email.inbound"
      : "communication.email.outbound";

  return {
    id: `event:${input.key}`,
    contactId: contact.id,
    eventType,
    channel: "email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId: `source:${input.key}`,
    idempotencyKey: `canonical:${input.key}`,
    provenance: {
      primaryProvider: "gmail",
      primarySourceEvidenceId: `source:${input.key}`,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: `gmail:${input.key}`,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: null,
      direction: input.direction,
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
    lastCanonicalEventId: input.lastCanonicalEventId ?? "event:existing",
    lastEventType: input.lastEventType ?? "communication.email.inbound",
  };
}

function buildReplayInput(event: CanonicalEventRecord): NormalizedCanonicalEventIntake {
  const direction = event.provenance.direction ?? "inbound";

  return {
    sourceEvidence: buildSourceEvidence({
      key: event.id.replace("event:", ""),
      occurredAt: event.occurredAt,
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
    communicationClassification: {
      messageKind: "one_to_one",
      sourceRecordType: "message",
      sourceRecordId: `gmail:${event.id.replace("event:", "")}`,
      campaignRef: null,
      threadRef: null,
      direction,
    },
  };
}

function buildContext(input: {
  readonly events: readonly CanonicalEventRecord[];
  readonly existingProjection?: InboxProjectionRow | null;
  readonly contacts?: readonly ContactRecord[];
  readonly contactIdentities?: readonly ContactIdentityRecord[];
  readonly sourceProvider?: SourceEvidenceRecord["provider"];
}): TestContext {
  const contacts = input.contacts ?? [contact];
  const contactIdentities = input.contactIdentities ?? [emailIdentity];
  const contactsById = new Map(contacts.map((entry) => [entry.id, entry]));
  const contactsBySalesforceContactId = new Map(
    contacts
      .filter((entry): entry is ContactRecord & { salesforceContactId: string } =>
        entry.salesforceContactId !== null
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
        }),
        provider: input.sourceProvider ?? "gmail",
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
  const timelineRowsByCanonicalEventId = new Map<string, TimelineProjectionRow>();
  const gmailDetailsBySourceEvidenceId = new Map<string, GmailMessageDetailRecord>();
  let inboxProjection = input.existingProjection ?? null;
  let inboxSaveCount = 0;

  const bundle: Stage1RepositoryBundle = defineStage1RepositoryBundle({
    sourceEvidence: {
      append: (record) => {
        sourceEvidenceById.set(record.id, record);
        sourceEvidenceByIdempotencyKey.set(record.idempotencyKey, record);
        return Promise.resolve(record);
      },
      findById: (id) => Promise.resolve(sourceEvidenceById.get(id) ?? null),
      listByIds: (ids) =>
        Promise.resolve(
          ids
            .map((id) => sourceEvidenceById.get(id))
            .filter((record): record is SourceEvidenceRecord => record !== undefined),
        ),
      findByIdempotencyKey: (idempotencyKey) =>
        Promise.resolve(sourceEvidenceByIdempotencyKey.get(idempotencyKey) ?? null),
      listIdempotencyChecksumCollisions: () =>
        Promise.resolve({ entries: [], hasMore: false }),
      countByProvider: () => Promise.resolve(sourceEvidenceById.size),
      listByProviderRecord: ({ provider, providerRecordType, providerRecordId }) =>
        Promise.resolve(
          [...sourceEvidenceById.values()].filter(
            (record) =>
              record.provider === provider &&
              record.providerRecordType === providerRecordType &&
              record.providerRecordId === providerRecordId,
          ),
        ),
    },
    canonicalEvents: {
      findById: (id) => Promise.resolve(canonicalEventsById.get(id) ?? null),
      findByIdempotencyKey: (idempotencyKey) =>
        Promise.resolve(canonicalEventsByIdempotencyKey.get(idempotencyKey) ?? null),
      listByContentFingerprintWindow: () => Promise.resolve([]),
      countAll: () => Promise.resolve(input.events.length),
      countByPrimaryProvider: () => Promise.resolve(input.events.length),
      countDistinctInboxContacts: () => Promise.resolve(1),
      listByIds: (ids) =>
        Promise.resolve(
          ids
            .map((id) => canonicalEventsById.get(id))
            .filter((event): event is CanonicalEventRecord => event !== undefined),
        ),
      listByContactId: (contactId) =>
        Promise.resolve(
          sortEvents(
            input.events.filter((event) => event.contactId === contactId),
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
      hasProjectNotionContent: () => Promise.resolve(false),
      findProjectIdsWithNotionContent: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    projectKnowledge: {
      list: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
      setApproved: () => Promise.resolve(),
      deleteById: () => Promise.resolve(),
      getForRetrieval: () => Promise.resolve([]),
    },
    contacts: {
      findById: (id) => Promise.resolve(contactsById.get(id) ?? null),
      findBySalesforceContactId: (salesforceContactId) =>
        Promise.resolve(contactsBySalesforceContactId.get(salesforceContactId) ?? null),
      listAll: () => Promise.resolve([...contacts]),
      listByIds: (ids) =>
        Promise.resolve(
          ids
            .map((id) => contactsById.get(id))
            .filter((entry): entry is ContactRecord => entry !== undefined),
        ),
      searchByQuery: () => Promise.resolve([...contacts]),
      upsert: (record) => Promise.resolve(record),
    },
    contactIdentities: {
      listByContactId: (contactId) =>
        Promise.resolve(
          contactIdentities.filter((identity) => identity.contactId === contactId),
        ),
      listByNormalizedValue: ({ normalizedValue }) =>
        Promise.resolve(
          contactIdentities.filter(
            (identity) => identity.normalizedValue === normalizedValue,
          ),
        ),
      upsert: (record) => Promise.resolve(record),
    },
    contactMemberships: {
      listByContactId: () => Promise.resolve([]),
      listByContactIds: () => Promise.resolve([]),
      upsert: (record: ContactMembershipRecord) => Promise.resolve(record),
    },
    projectDimensions: {
      listAll: () => Promise.resolve([]),
      listActive: () => Promise.resolve([]),
      listByIds: () => Promise.resolve([]),
      upsert: (record: ProjectDimensionRecord) => Promise.resolve(record),
    },
    expeditionDimensions: {
      listByIds: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    gmailMessageDetails: {
      listBySourceEvidenceIds: (ids) =>
        Promise.resolve(
          ids
            .map((id) => gmailDetailsBySourceEvidenceId.get(id))
            .filter(
              (record): record is GmailMessageDetailRecord => record !== undefined,
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
          authorId: "user:author",
          createdAt: new Date(0),
          updatedAt: new Date(0),
        }),
      delete: () => Promise.resolve(),
    },
    pendingOutbounds: {
      insert: ({ id }) => Promise.resolve(id),
      findByFingerprint: () =>
        Promise.resolve<PendingComposerOutboundRecord | null>(null),
      markSentRfc822: () => Promise.resolve(),
      findBySentRfc822MessageId: () =>
        Promise.resolve<PendingComposerOutboundRecord | null>(null),
      markConfirmed: () => Promise.resolve(),
      markFailed: () => Promise.resolve(),
      markSuperseded: () => Promise.resolve(),
      sweepOrphans: () => Promise.resolve(0),
      findForContact: () => Promise.resolve([]),
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
        Promise.resolve(timelineRowsByCanonicalEventId.get(canonicalEventId) ?? null),
      listByContactId: () =>
        Promise.resolve([...timelineRowsByCanonicalEventId.values()]),
      listRecentByContactId: () =>
        Promise.resolve([...timelineRowsByCanonicalEventId.values()]),
      countByContactId: () => Promise.resolve(timelineRowsByCanonicalEventId.size),
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
    },
  });

  const persistence = createStage1PersistenceService(bundle);

  return {
    normalization: createStage1NormalizationService(persistence),
    getInboxProjection: () => inboxProjection,
    getInboxSaveCount: () => inboxSaveCount,
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
    await expect(replayEvent(outboundContext, outbound)).resolves.toMatchObject({
      bucket: "Opened",
      lastInboundAt: null,
      lastOutboundAt: outbound.occurredAt,
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
