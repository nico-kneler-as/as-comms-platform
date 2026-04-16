import { describe, expect, it } from "vitest";

import type { ContactRecord } from "@as-comms/contracts";

import {
  defineStage1RepositoryBundle,
  type Stage1RepositoryBundle
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
      updatedAt: "2026-01-01T00:00:00.000Z"
    };

    const bundle: Stage1RepositoryBundle = defineStage1RepositoryBundle({
      sourceEvidence: {
        append: (record) => Promise.resolve(record),
        findById: () => Promise.resolve(null),
        findByIdempotencyKey: () => Promise.resolve(null),
        countByProvider: () => Promise.resolve(0),
        listByProviderRecord: () => Promise.resolve([])
      },
      canonicalEvents: {
        findById: () => Promise.resolve(null),
        findByIdempotencyKey: () => Promise.resolve(null),
        countAll: () => Promise.resolve(0),
        countByPrimaryProvider: () => Promise.resolve(0),
        countDistinctInboxContacts: () => Promise.resolve(0),
        listByIds: () => Promise.resolve([]),
        listByContactId: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      contacts: {
        findById: () => Promise.resolve(contact),
        findBySalesforceContactId: () => Promise.resolve(contact),
        listAll: () => Promise.resolve([contact]),
        listByIds: () => Promise.resolve([contact]),
        upsert: (record) => Promise.resolve(record)
      },
      contactIdentities: {
        listByContactId: () => Promise.resolve([]),
        listByNormalizedValue: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      contactMemberships: {
        listByContactId: () => Promise.resolve([]),
        listByContactIds: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      projectDimensions: {
        listByIds: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      expeditionDimensions: {
        listByIds: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      gmailMessageDetails: {
        listBySourceEvidenceIds: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      salesforceEventContext: {
        listBySourceEvidenceIds: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      salesforceCommunicationDetails: {
        listBySourceEvidenceIds: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      simpleTextingMessageDetails: {
        listBySourceEvidenceIds: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      mailchimpCampaignActivityDetails: {
        listBySourceEvidenceIds: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      manualNoteDetails: {
        listBySourceEvidenceIds: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      identityResolutionQueue: {
        findById: () => Promise.resolve(null),
        listOpenByContactId: () => Promise.resolve([]),
        listOpenByReasonCode: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      routingReviewQueue: {
        findById: () => Promise.resolve(null),
        listOpenByContactId: () => Promise.resolve([]),
        listOpenByReasonCode: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      inboxProjection: {
        countAll: () => Promise.resolve(0),
        findByContactId: () => Promise.resolve(null),
        listAllOrderedByRecency: () => Promise.resolve([]),
        setNeedsFollowUp: () => Promise.resolve(null),
        upsert: (record) => Promise.resolve(record)
      },
      timelineProjection: {
        countAll: () => Promise.resolve(0),
        findByCanonicalEventId: () => Promise.resolve(null),
        listByContactId: () => Promise.resolve([]),
        upsert: (record) => Promise.resolve(record)
      },
      syncState: {
        findById: () => Promise.resolve(null),
        findLatest: () => Promise.resolve(null),
        upsert: (record) => Promise.resolve(record)
      },
      auditEvidence: {
        append: (record) => Promise.resolve(record),
        listByEntity: () => Promise.resolve([])
      }
    });

    await expect(bundle.contacts.findById("contact_1")).resolves.toEqual(contact);
  });
});
