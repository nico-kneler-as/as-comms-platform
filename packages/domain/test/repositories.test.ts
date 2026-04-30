import { describe, expect, it } from "vitest";

import type { ContactRecord } from "@as-comms/contracts";

import {
  defineStage1RepositoryBundle,
  type PendingComposerOutboundRecord,
  type Stage1RepositoryBundle,
} from "../src/index.js";

describe("defineStage1RepositoryBundle", () => {
  it("accepts a Stage 1 repository bundle without leaking DB row types", async () => {
    const contact: ContactRecord = {
      id: "contact_1",
      salesforceContactId: "003-example",
      displayName: "Example Volunteer",
      primaryEmail: "volunteer@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const bundle: Stage1RepositoryBundle = defineStage1RepositoryBundle({
      sourceEvidence: {
        append: (record) => Promise.resolve(record),
        findById: () => Promise.resolve(null),
        listByIds: () => Promise.resolve([]),
        findByIdempotencyKey: () => Promise.resolve(null),
        listIdempotencyChecksumCollisions: () =>
          Promise.resolve({ entries: [], hasMore: false }),
        countByProvider: () => Promise.resolve(0),
        listByProviderRecord: () => Promise.resolve([]),
      },
      sourceEvidenceQuarantine: {
        record: (input) =>
          Promise.resolve({
            id: "source_evidence_quarantine:test",
            ...input,
            createdAt: new Date(0),
          }),
        listRecent: () => Promise.resolve({ entries: [], hasMore: false }),
      },
      canonicalEvents: {
        findById: () => Promise.resolve(null),
        findByIdempotencyKey: () => Promise.resolve(null),
        listByContentFingerprintWindow: () => Promise.resolve([]),
        countAll: () => Promise.resolve(0),
        countByPrimaryProvider: () => Promise.resolve(0),
        countDistinctInboxContacts: () => Promise.resolve(0),
        listByIds: () => Promise.resolve([]),
        listByContactId: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record),
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
        listBySourceEvidenceIds: () => Promise.resolve([]),
        listLastInboundAliasByContactIds: () => Promise.resolve(new Map()),
        upsert: (record) => Promise.resolve(record),
      },
      messageAttachments: {
        findById: () => Promise.resolve(null),
        findByMessageIds: () => Promise.resolve([]),
        upsertManyForMessage: () => Promise.resolve(),
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
            authorDisplayName: "User 1",
            authorId: "user_1",
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
            rows: [],
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
            archived: 0,
          }),
        getFreshness: () =>
          Promise.resolve({
            total: 0,
            latestUpdatedAt: null,
          }),
        getFreshnessByContactId: () => Promise.resolve(null),
        deleteByContactId: () => Promise.resolve(),
        setNeedsFollowUp: () => Promise.resolve(null),
        setArchived: () => Promise.resolve(null),
        setBucket: () => Promise.resolve(null),
        upsert: (record) => Promise.resolve(record),
      },
      timelineProjection: {
        countAll: () => Promise.resolve(0),
        findByCanonicalEventId: () => Promise.resolve(null),
        listByContactId: () => Promise.resolve([]),
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

    await expect(bundle.contacts.findById("contact_1")).resolves.toEqual(
      contact,
    );
  });
});
