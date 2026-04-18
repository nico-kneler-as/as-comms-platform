import { describe, expect, it } from "vitest";

import type {
  AuditEvidenceRecord,
  CanonicalEventRecord,
  ContactRecord,
  InboxProjectionRow,
  TimelineItem,
  SourceEvidenceRecord,
  TimelineProjectionRow
} from "@as-comms/contracts";

import {
  type Stage1RepositoryBundle,
  defineStage1RepositoryBundle
} from "../src/repositories.js";
import { createStage1TimelinePresentationService } from "../src/timeline.js";

interface SalesforceCommunicationDetailRecord {
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly channel: "email" | "sms";
  readonly messageKind: "one_to_one" | "auto" | "campaign";
  readonly subject: string | null;
  readonly snippet: string;
  readonly sourceLabel: string;
}

function createRepositoryBundle(input: {
  readonly canonicalEvents: readonly CanonicalEventRecord[];
  readonly sourceEvidence: readonly SourceEvidenceRecord[];
  readonly salesforceCommunicationDetails: readonly SalesforceCommunicationDetailRecord[];
  readonly timelineRows: readonly TimelineProjectionRow[];
}): Stage1RepositoryBundle {
  const canonicalEventsById = new Map(
    input.canonicalEvents.map((event) => [event.id, event])
  );
  const sourceEvidenceById = new Map(
    input.sourceEvidence.map((evidence) => [evidence.id, evidence])
  );
  const salesforceCommunicationDetailsBySourceEvidenceId = new Map(
    input.salesforceCommunicationDetails.map((detail) => [
      detail.sourceEvidenceId,
      detail
    ])
  );
  const timelineRowsByCanonicalEventId = new Map(
    input.timelineRows.map((row) => [row.canonicalEventId, row])
  );

  const contact: ContactRecord = {
    id: "contact_1",
    salesforceContactId: "003-stage1",
    displayName: "Stage One Volunteer",
    primaryEmail: "volunteer@example.org",
    primaryPhone: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  return defineStage1RepositoryBundle({
    sourceEvidence: {
      append: (record) => Promise.resolve(record),
      findById: (id) => Promise.resolve(sourceEvidenceById.get(id) ?? null),
      listByIds: (ids) =>
        Promise.resolve(
          ids.flatMap((id) => {
            const evidence = sourceEvidenceById.get(id);
            return evidence === undefined ? [] : [evidence];
          })
        ),
      findByIdempotencyKey: () => Promise.resolve(null),
      countByProvider: () => Promise.resolve(0),
      listByProviderRecord: () => Promise.resolve([])
    },
    canonicalEvents: {
      findById: (id) => Promise.resolve(canonicalEventsById.get(id) ?? null),
      findByIdempotencyKey: () => Promise.resolve(null),
      countAll: () => Promise.resolve(input.canonicalEvents.length),
      countByPrimaryProvider: () => Promise.resolve(0),
      countDistinctInboxContacts: () => Promise.resolve(1),
      listByIds: (ids) =>
        Promise.resolve(
          ids.flatMap((id) => {
            const event = canonicalEventsById.get(id);
            return event === undefined ? [] : [event];
          })
        ),
      listByContactId: (contactId) =>
        Promise.resolve(
          input.canonicalEvents.filter((event) => event.contactId === contactId)
        ),
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
      listBySourceEvidenceIds: (sourceEvidenceIds) =>
        Promise.resolve(
          sourceEvidenceIds.flatMap(
            (sourceEvidenceId): readonly SalesforceCommunicationDetailRecord[] => {
            const detail =
              salesforceCommunicationDetailsBySourceEvidenceId.get(sourceEvidenceId);
            return detail === undefined ? [] : [detail];
            }
          )
        ),
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
      countInvalidRecencyRows: () => Promise.resolve(0),
      findByContactId: () => Promise.resolve(null),
      listAllOrderedByRecency: () => Promise.resolve([]),
      listInvalidRecencyContactIds: () => Promise.resolve([]),
      searchPageOrderedByRecency: () =>
        Promise.resolve({
          rows: [],
          total: 0
        }),
      listPageOrderedByRecency: () => Promise.resolve([]),
      countByFilters: () =>
        Promise.resolve({
          all: 0,
          unread: 0,
          followUp: 0,
          unresolved: 0
        }),
        getFreshness: () =>
          Promise.resolve({
            total: 0,
            latestUpdatedAt: null
          }),
        getFreshnessByContactId: () => Promise.resolve(null),
        deleteByContactId: () => Promise.resolve(),
        setNeedsFollowUp: () => Promise.resolve(null),
        upsert: (record: InboxProjectionRow) => Promise.resolve(record)
      },
    timelineProjection: {
      countAll: () => Promise.resolve(input.timelineRows.length),
      findByCanonicalEventId: (canonicalEventId) =>
        Promise.resolve(timelineRowsByCanonicalEventId.get(canonicalEventId) ?? null),
      listByContactId: (contactId) =>
        Promise.resolve(
          input.timelineRows.filter((row) => row.contactId === contactId)
        ),
      listRecentByContactId: ({ contactId, limit, beforeSortKey }) =>
        Promise.resolve(
          input.timelineRows
            .filter(
              (row) =>
                row.contactId === contactId &&
                (beforeSortKey === null || row.sortKey < beforeSortKey)
            )
            .sort((left, right) => right.sortKey.localeCompare(left.sortKey))
            .slice(0, limit)
        ),
      countByContactId: (contactId) =>
        Promise.resolve(
          input.timelineRows.filter((row) => row.contactId === contactId).length
        ),
      getFreshnessByContactId: (contactId) => {
        const rows = input.timelineRows.filter((row) => row.contactId === contactId);
        return Promise.resolve({
          contactId,
          total: rows.length,
          latestUpdatedAt: null,
          latestSortKey: rows.at(-1)?.sortKey ?? null
        });
      },
      upsert: (record) => Promise.resolve(record)
    },
    syncState: {
      findById: () => Promise.resolve(null),
      findLatest: () => Promise.resolve(null),
      upsert: (record) => Promise.resolve(record)
    },
    auditEvidence: {
      append: (record: AuditEvidenceRecord) => Promise.resolve(record),
      listByEntity: () => Promise.resolve([])
    }
  });
}

function buildSourceEvidence(
  id: string,
  providerRecordId: string
): SourceEvidenceRecord {
  return {
    id,
    provider: "salesforce",
    providerRecordType: "task_communication",
    providerRecordId,
    receivedAt: "2026-01-01T00:00:00.000Z",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payloadRef: `payloads/salesforce/${providerRecordId}.json`,
    idempotencyKey: `salesforce:${providerRecordId}`,
    checksum: `checksum:${providerRecordId}`
  };
}

function buildSalesforceOutboundEmailEvent(input: {
  readonly id: string;
  readonly sourceEvidenceId: string;
  readonly occurredAt: string;
  readonly messageKind: "one_to_one" | "auto" | null;
  readonly subject: string;
  readonly snippet: string;
}): {
  readonly canonicalEvent: CanonicalEventRecord;
  readonly detail: SalesforceCommunicationDetailRecord;
  readonly timelineRow: TimelineProjectionRow;
} {
  return {
    canonicalEvent: {
      id: input.id,
      contactId: "contact_1",
      eventType: "communication.email.outbound",
      channel: "email",
      occurredAt: input.occurredAt,
      sourceEvidenceId: input.sourceEvidenceId,
      idempotencyKey: `canonical:${input.id}`,
      provenance: {
        primaryProvider: "salesforce",
        primarySourceEvidenceId: input.sourceEvidenceId,
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "task_communication",
        sourceRecordId: input.id,
        messageKind: input.messageKind,
        campaignRef: null,
        threadRef: null,
        direction: "outbound",
        notes: null
      } as CanonicalEventRecord["provenance"],
      reviewState: "clear"
    },
    detail: {
      sourceEvidenceId: input.sourceEvidenceId,
      providerRecordId: input.id,
      channel: "email",
      // The detail table stores a concrete message kind even when canonical
      // provenance remains null for the classification regression case.
      messageKind: input.messageKind ?? "one_to_one",
      subject: input.subject,
      snippet: input.snippet,
      sourceLabel: "Salesforce Logged Email"
    },
    timelineRow: {
      id: `timeline:${input.id}`,
      contactId: "contact_1",
      canonicalEventId: input.id,
      occurredAt: input.occurredAt,
      sortKey: `${input.occurredAt}::${input.id}`,
      eventType: "communication.email.outbound",
      summary: input.subject,
      channel: "email",
      primaryProvider: "salesforce",
      reviewState: "clear"
    }
  };
}

describe("Stage 1 timeline presenter", () => {
  it("keeps Salesforce outbound email in the 1:1 family unless canon explicitly marks it auto", async () => {
    const nullClassified = buildSalesforceOutboundEmailEvent({
      id: "evt_salesforce_null",
      sourceEvidenceId: "sev_salesforce_null",
      occurredAt: "2026-01-01T00:00:00.000Z",
      messageKind: null,
      subject: "Logged follow-up",
      snippet: "Logged follow-up body"
    });
    const explicitOneToOne = buildSalesforceOutboundEmailEvent({
      id: "evt_salesforce_one_to_one",
      sourceEvidenceId: "sev_salesforce_one_to_one",
      occurredAt: "2026-01-01T00:01:00.000Z",
      messageKind: "one_to_one",
      subject: "Explicit one-to-one follow-up",
      snippet: "Explicit one-to-one body"
    });
    const explicitAuto = buildSalesforceOutboundEmailEvent({
      id: "evt_salesforce_auto",
      sourceEvidenceId: "sev_salesforce_auto",
      occurredAt: "2026-01-01T00:02:00.000Z",
      messageKind: "auto",
      subject: "Automation sent",
      snippet: "Automation body"
    });

    const repositories = createRepositoryBundle({
      canonicalEvents: [
        nullClassified.canonicalEvent,
        explicitOneToOne.canonicalEvent,
        explicitAuto.canonicalEvent
      ],
      sourceEvidence: [
        buildSourceEvidence("sev_salesforce_null", "salesforce-null"),
        buildSourceEvidence("sev_salesforce_one_to_one", "salesforce-one-to-one"),
        buildSourceEvidence("sev_salesforce_auto", "salesforce-auto")
      ],
      salesforceCommunicationDetails: [
        nullClassified.detail,
        explicitOneToOne.detail,
        explicitAuto.detail
      ],
      timelineRows: [
        nullClassified.timelineRow,
        explicitOneToOne.timelineRow,
        explicitAuto.timelineRow
      ]
    });
    const presenter =
      createStage1TimelinePresentationService(repositories);

    const items: readonly TimelineItem[] =
      await presenter.listTimelineItemsByContactId("contact_1");

    expect(
      items.map((item) => ({
        canonicalEventId: item.canonicalEventId,
        family: item.family
      }))
    ).toEqual([
      {
        canonicalEventId: "evt_salesforce_null",
        family: "one_to_one_email"
      },
      {
        canonicalEventId: "evt_salesforce_one_to_one",
        family: "one_to_one_email"
      },
      {
        canonicalEventId: "evt_salesforce_auto",
        family: "auto_email"
      }
    ]);
  });
});
