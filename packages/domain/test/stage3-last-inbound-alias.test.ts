import { describe, expect, it } from "vitest";

import type {
  CanonicalEventRecord,
  ContactRecord,
  GmailMessageDetailRecord,
  InboxProjectionRow,
  TimelineProjectionRow,
} from "@as-comms/contracts";

import {
  createStage1TimelinePresentationService,
  defineStage1RepositoryBundle,
  type PendingComposerOutboundRecord,
  type Stage1RepositoryBundle,
} from "../src/index.js";

function buildRepositoryBundle(input: {
  readonly canonicalEvents: readonly CanonicalEventRecord[];
  readonly gmailDetails: readonly GmailMessageDetailRecord[];
}): Stage1RepositoryBundle {
  const contact: ContactRecord = {
    id: "contact:volunteer",
    salesforceContactId: "003-volunteer",
    displayName: "Volunteer Contact",
    primaryEmail: "volunteer@example.org",
    primaryPhone: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  return defineStage1RepositoryBundle({
    sourceEvidence: {
      append: (record) => Promise.resolve(record),
      findById: () => Promise.resolve(null),
      listByIds: () => Promise.resolve([]),
      findByIdempotencyKey: () => Promise.resolve(null),
      countByProvider: () => Promise.resolve(0),
      listByProviderRecord: () => Promise.resolve([]),
    },
    canonicalEvents: {
      findById: () => Promise.resolve(null),
      findByIdempotencyKey: () => Promise.resolve(null),
      listByContentFingerprintWindow: () => Promise.resolve([]),
      countAll: () => Promise.resolve(input.canonicalEvents.length),
      countByPrimaryProvider: () => Promise.resolve(0),
      countDistinctInboxContacts: () => Promise.resolve(1),
      listByIds: () => Promise.resolve(input.canonicalEvents),
      listByContactId: (contactId) =>
        Promise.resolve(
          input.canonicalEvents.filter(
            (event) => event.contactId === contactId,
          ),
        ),
      upsert: (record) => Promise.resolve(record),
    },
    aiKnowledge: {
      findByScope: () => Promise.resolve(null),
      findProjectNotionContent: () => Promise.resolve(null),
      hasProjectNotionContent: () => Promise.resolve(false),
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
      findById: () => Promise.resolve(contact),
      findBySalesforceContactId: () => Promise.resolve(contact),
      listAll: () => Promise.resolve([contact]),
      listByIds: () => Promise.resolve([contact]),
      searchByQuery: () => Promise.resolve([contact]),
      upsert: (record) => Promise.resolve(record),
    },
    contactIdentities: {
      listByContactId: () => Promise.resolve([]),
      listByNormalizedValue: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    contactMemberships: {
      listByContactId: () => Promise.resolve([]),
      listByContactIds: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    projectDimensions: {
      listAll: () => Promise.resolve([]),
      listActive: () => Promise.resolve([]),
      listByIds: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    expeditionDimensions: {
      listByIds: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    gmailMessageDetails: {
      listBySourceEvidenceIds: (sourceEvidenceIds) =>
        Promise.resolve(
          input.gmailDetails.filter((detail) =>
            sourceEvidenceIds.includes(detail.sourceEvidenceId),
          ),
        ),
      listLastInboundAliasByContactIds: () => Promise.resolve(new Map()),
      upsert: (record) => Promise.resolve(record),
    },
    salesforceEventContext: {
      listBySourceEvidenceIds: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    salesforceCommunicationDetails: {
      listBySourceEvidenceIds: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    simpleTextingMessageDetails: {
      listBySourceEvidenceIds: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    mailchimpCampaignActivityDetails: {
      listBySourceEvidenceIds: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    manualNoteDetails: {
      listBySourceEvidenceIds: () => Promise.resolve([]),
      findLatestForContact: () => Promise.resolve(null),
      upsert: (record) => Promise.resolve(record),
      updateBody: () => Promise.resolve(null),
      deleteByAuthor: () => Promise.resolve(0),
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
      upsert: (record) => Promise.resolve(record),
    },
    routingReviewQueue: {
      findById: () => Promise.resolve(null),
      listOpenByContactId: () => Promise.resolve([]),
      listOpenByReasonCode: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    inboxProjection: {
      countAll: () => Promise.resolve(0),
      countInvalidRecencyRows: () => Promise.resolve(0),
      findByContactId: () => Promise.resolve(null),
      listAllOrderedByRecency: () => Promise.resolve([]),
      listInvalidRecencyContactIds: () => Promise.resolve([]),
      searchPageOrderedByRecency: () =>
        Promise.resolve({
          rows: [] as InboxProjectionRow[],
          total: 0,
        }),
      listPageOrderedByRecency: () => Promise.resolve([]),
      countByFilters: () =>
        Promise.resolve({
          all: 0,
          unread: 0,
          followUp: 0,
          unresolved: 0,
          sent: 0,
        }),
      getFreshness: () =>
        Promise.resolve({
          total: 0,
          latestUpdatedAt: null,
        }),
      getFreshnessByContactId: () => Promise.resolve(null),
      deleteByContactId: () => Promise.resolve(),
      setNeedsFollowUp: () => Promise.resolve(null),
      setBucket: () => Promise.resolve(null),
      upsert: (record) => Promise.resolve(record),
    },
    timelineProjection: {
      countAll: () => Promise.resolve(0),
      findByCanonicalEventId: () => Promise.resolve(null),
      listByContactId: () => Promise.resolve([] as TimelineProjectionRow[]),
      listRecentByContactId: () => Promise.resolve([]),
      countByContactId: () => Promise.resolve(0),
      getFreshnessByContactId: (contactId) =>
        Promise.resolve({
          contactId,
          total: 0,
          latestUpdatedAt: null,
          latestSortKey: null,
        }),
      upsert: (record) => Promise.resolve(record),
    },
    syncState: {
      findById: () => Promise.resolve(null),
      findLatest: () => Promise.resolve(null),
      listAll: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    auditEvidence: {
      append: (record) => Promise.resolve(record),
      listByEntity: () => Promise.resolve([]),
    },
  });
}

function buildInboundEvent(input: {
  readonly id: string;
  readonly occurredAt: string;
}): CanonicalEventRecord {
  return {
    id: `event:${input.id}`,
    contactId: "contact:volunteer",
    eventType: "communication.email.inbound",
    channel: "email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId: `source:${input.id}`,
    idempotencyKey: `canonical:${input.id}`,
    provenance: {
      primaryProvider: "gmail",
      primarySourceEvidenceId: `source:${input.id}`,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: input.id,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: null,
      direction: "inbound",
      notes: null,
    },
    reviewState: "clear",
  };
}

function buildGmailDetail(input: {
  readonly id: string;
  readonly alias: string | null;
}): GmailMessageDetailRecord {
  return {
    sourceEvidenceId: `source:${input.id}`,
    providerRecordId: input.id,
    gmailThreadId: `thread:${input.id}`,
    rfc822MessageId: `<${input.id}@example.org>`,
    direction: "inbound",
    subject: `Subject ${input.id}`,
    fromHeader: "Volunteer <volunteer@example.org>",
    toHeader: "captured@example.org",
    ccHeader: null,
    snippetClean: `Snippet ${input.id}`,
    bodyTextPreview: `Body ${input.id}`,
    capturedMailbox: "captured@example.org",
    projectInboxAlias: input.alias,
  };
}

describe("findLastInboundAliasForContact", () => {
  it("returns the most recent inbound alias with a project inbox alias", async () => {
    const presenter = createStage1TimelinePresentationService(
      buildRepositoryBundle({
        canonicalEvents: [
          buildInboundEvent({
            id: "older",
            occurredAt: "2026-04-20T09:00:00.000Z",
          }),
          buildInboundEvent({
            id: "newer-without-alias",
            occurredAt: "2026-04-21T08:00:00.000Z",
          }),
          buildInboundEvent({
            id: "latest",
            occurredAt: "2026-04-21T09:00:00.000Z",
          }),
        ],
        gmailDetails: [
          buildGmailDetail({
            id: "older",
            alias: "older-project@example.org",
          }),
          buildGmailDetail({
            id: "newer-without-alias",
            alias: null,
          }),
          buildGmailDetail({
            id: "latest",
            alias: "latest-project@example.org",
          }),
        ],
      }),
    );

    await expect(
      presenter.findLastInboundAliasForContact("contact:volunteer"),
    ).resolves.toBe("latest-project@example.org");
  });

  it("returns null when the contact has no inbound alias-bearing email", async () => {
    const presenter = createStage1TimelinePresentationService(
      buildRepositoryBundle({
        canonicalEvents: [],
        gmailDetails: [],
      }),
    );

    await expect(
      presenter.findLastInboundAliasForContact("contact:volunteer"),
    ).resolves.toBeNull();
  });
});
