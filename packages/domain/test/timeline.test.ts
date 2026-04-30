import { describe, expect, it, vi } from "vitest";

import type {
  AuditEvidenceRecord,
  CanonicalEventRecord,
  ContactRecord,
  GmailMessageDetailRecord,
  InboxProjectionRow,
  MailchimpCampaignActivityDetailRecord,
  MessageAttachmentRecord,
  TimelineItem,
  SourceEvidenceRecord,
  TimelineProjectionRow,
} from "@as-comms/contracts";

import {
  type InternalNoteRecord,
  type Stage1RepositoryBundle,
  defineStage1RepositoryBundle,
} from "../src/repositories.js";
import type { PendingComposerOutboundRecord } from "../src/pending-outbounds.js";
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
  readonly gmailMessageDetails?: readonly GmailMessageDetailRecord[];
  readonly messageAttachments?: readonly MessageAttachmentRecord[];
  readonly mailchimpCampaignActivityDetails?: readonly MailchimpCampaignActivityDetailRecord[];
  readonly internalNotes?: readonly InternalNoteRecord[];
  readonly timelineRows: readonly TimelineProjectionRow[];
  readonly pendingOutbounds?: readonly PendingComposerOutboundRecord[];
}): Stage1RepositoryBundle {
  const canonicalEventsById = new Map(
    input.canonicalEvents.map((event) => [event.id, event]),
  );
  const sourceEvidenceById = new Map(
    input.sourceEvidence.map((evidence) => [evidence.id, evidence]),
  );
  const salesforceCommunicationDetailsBySourceEvidenceId = new Map(
    input.salesforceCommunicationDetails.map((detail) => [
      detail.sourceEvidenceId,
      detail,
    ]),
  );
  const gmailMessageDetailsBySourceEvidenceId = new Map(
    (input.gmailMessageDetails ?? []).map((detail) => [
      detail.sourceEvidenceId,
      detail,
    ]),
  );
  const messageAttachmentsBySourceEvidenceId = new Map<
    string,
    MessageAttachmentRecord[]
  >();
  for (const attachment of input.messageAttachments ?? []) {
    const existing =
      messageAttachmentsBySourceEvidenceId.get(attachment.sourceEvidenceId) ?? [];
    existing.push(attachment);
    messageAttachmentsBySourceEvidenceId.set(attachment.sourceEvidenceId, existing);
  }
  const mailchimpCampaignActivityDetailsBySourceEvidenceId = new Map(
    (input.mailchimpCampaignActivityDetails ?? []).map((detail) => [
      detail.sourceEvidenceId,
      detail,
    ]),
  );
  const timelineRowsByCanonicalEventId = new Map(
    input.timelineRows.map((row) => [row.canonicalEventId, row]),
  );

  const contact: ContactRecord = {
    id: "contact_1",
    salesforceContactId: "003-stage1",
    displayName: "Stage One Volunteer",
    primaryEmail: "volunteer@example.org",
    primaryPhone: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
          }),
        ),
      findByIdempotencyKey: () => Promise.resolve(null),
      listIdempotencyChecksumCollisions: () =>
        Promise.resolve({ entries: [], hasMore: false }),
      countByProvider: () => Promise.resolve(0),
      listByProviderRecord: () => Promise.resolve([]),
    },
    sourceEvidenceQuarantine: {
      record: (input) =>
        Promise.resolve({
          id: "source_evidence_quarantine:timeline",
          ...input,
          createdAt: new Date(0),
        }),
      listRecent: () => Promise.resolve({ entries: [], hasMore: false }),
    },
    canonicalEvents: {
      findById: (id) => Promise.resolve(canonicalEventsById.get(id) ?? null),
      findByIdempotencyKey: () => Promise.resolve(null),
      listByContentFingerprintWindow: () => Promise.resolve([]),
      countAll: () => Promise.resolve(input.canonicalEvents.length),
      countByPrimaryProvider: () => Promise.resolve(0),
      countDistinctInboxContacts: () => Promise.resolve(1),
      listByIds: (ids) =>
        Promise.resolve(
          ids.flatMap((id) => {
            const event = canonicalEventsById.get(id);
            return event === undefined ? [] : [event];
          }),
        ),
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
      listBySourceEvidenceIds: (sourceEvidenceIds) =>
        Promise.resolve(
          sourceEvidenceIds.flatMap((sourceEvidenceId) => {
            const detail =
              gmailMessageDetailsBySourceEvidenceId.get(sourceEvidenceId);
            return detail === undefined ? [] : [detail];
          }),
        ),
      listLastInboundAliasByContactIds: () => Promise.resolve(new Map()),
      upsert: (record) => Promise.resolve(record),
    },
    messageAttachments: {
      findById: (id) =>
        Promise.resolve(
          (input.messageAttachments ?? []).find((attachment) => attachment.id === id) ??
            null,
        ),
      findByMessageIds: (sourceEvidenceIds) =>
        Promise.resolve(
          sourceEvidenceIds.flatMap(
            (sourceEvidenceId) =>
              messageAttachmentsBySourceEvidenceId.get(sourceEvidenceId) ?? [],
          ),
        ),
      upsertManyForMessage: () => Promise.resolve(),
    },
    salesforceEventContext: {
      listBySourceEvidenceIds: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    salesforceCommunicationDetails: {
      listBySourceEvidenceIds: (sourceEvidenceIds) =>
        Promise.resolve(
          sourceEvidenceIds.flatMap(
            (
              sourceEvidenceId,
            ): readonly SalesforceCommunicationDetailRecord[] => {
              const detail =
                salesforceCommunicationDetailsBySourceEvidenceId.get(
                  sourceEvidenceId,
                );
              return detail === undefined ? [] : [detail];
            },
          ),
        ),
      upsert: (record) => Promise.resolve(record),
    },
    simpleTextingMessageDetails: {
      listBySourceEvidenceIds: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
    },
    mailchimpCampaignActivityDetails: {
      listBySourceEvidenceIds: (sourceEvidenceIds) =>
        Promise.resolve(
          sourceEvidenceIds.flatMap((sourceEvidenceId) => {
            const detail =
              mailchimpCampaignActivityDetailsBySourceEvidenceId.get(
                sourceEvidenceId,
              );
            return detail === undefined ? [] : [detail];
          }),
        ),
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
      findByContactId: (contactId, limit) =>
        Promise.resolve(
          (input.internalNotes ?? [])
            .filter((note) => note.contactId === contactId)
            .slice(0, limit),
        ),
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
      findByFingerprint: () => Promise.resolve(null),
      markSentRfc822: () => Promise.resolve(),
      findBySentRfc822MessageId: () => Promise.resolve(null),
      markConfirmed: () => Promise.resolve(),
      markFailed: () => Promise.resolve(),
      markSuperseded: () => Promise.resolve(),
      sweepOrphans: () => Promise.resolve(0),
      findForContact: (contactId, { limit }) =>
        Promise.resolve(
          (input.pendingOutbounds ?? [])
            .filter((row) => row.canonicalContactId === contactId)
            .slice(0, limit),
        ),
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
      upsert: (record: InboxProjectionRow) => Promise.resolve(record),
    },
    timelineProjection: {
      countAll: () => Promise.resolve(input.timelineRows.length),
      findByCanonicalEventId: (canonicalEventId) =>
        Promise.resolve(
          timelineRowsByCanonicalEventId.get(canonicalEventId) ?? null,
        ),
      listByContactId: (contactId) =>
        Promise.resolve(
          input.timelineRows.filter((row) => row.contactId === contactId),
        ),
      listRecentByContactId: ({ contactId, limit, beforeSortKey }) =>
        Promise.resolve(
          input.timelineRows
            .filter(
              (row) =>
                row.contactId === contactId &&
                (beforeSortKey === null || row.sortKey < beforeSortKey),
            )
            .sort((left, right) => right.sortKey.localeCompare(left.sortKey))
            .slice(0, limit),
        ),
      countByContactId: (contactId) =>
        Promise.resolve(
          input.timelineRows.filter((row) => row.contactId === contactId)
            .length,
        ),
      getFreshnessByContactId: (contactId) => {
        const rows = input.timelineRows.filter(
          (row) => row.contactId === contactId,
        );
        return Promise.resolve({
          contactId,
          total: rows.length,
          latestUpdatedAt: null,
          latestSortKey: rows.at(-1)?.sortKey ?? null,
        });
      },
      upsert: (record) => Promise.resolve(record),
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
}

function buildSourceEvidence(input: {
  readonly id: string;
  readonly providerRecordId: string;
  readonly provider?: SourceEvidenceRecord["provider"];
  readonly providerRecordType?: string;
}): SourceEvidenceRecord {
  return {
    id: input.id,
    provider: input.provider ?? "salesforce",
    providerRecordType: input.providerRecordType ?? "task_communication",
    providerRecordId: input.providerRecordId,
    receivedAt: "2026-01-01T00:00:00.000Z",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payloadRef: `payloads/${input.provider ?? "salesforce"}/${input.providerRecordId}.json`,
    idempotencyKey: `${input.provider ?? "salesforce"}:${input.providerRecordId}`,
    checksum: `checksum:${input.providerRecordId}`,
  };
}

function buildSalesforceEmailEvent(input: {
  readonly id: string;
  readonly sourceEvidenceId: string;
  readonly occurredAt: string;
  readonly direction: "inbound" | "outbound";
  readonly canonicalMessageKind: "one_to_one" | "auto" | null;
  readonly detailMessageKind?: "one_to_one" | "auto" | "campaign";
  readonly subject: string;
  readonly snippet: string;
  readonly contentFingerprint?: string | null;
}): {
  readonly canonicalEvent: CanonicalEventRecord;
  readonly detail: SalesforceCommunicationDetailRecord;
  readonly timelineRow: TimelineProjectionRow;
} {
  return {
    canonicalEvent: {
      id: input.id,
      contactId: "contact_1",
      eventType: `communication.email.${input.direction}`,
      channel: "email",
      occurredAt: input.occurredAt,
      contentFingerprint: input.contentFingerprint ?? null,
      sourceEvidenceId: input.sourceEvidenceId,
      idempotencyKey: `canonical:${input.id}`,
      provenance: {
        primaryProvider: "salesforce",
        primarySourceEvidenceId: input.sourceEvidenceId,
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "task_communication",
        sourceRecordId: input.id,
        messageKind: input.canonicalMessageKind,
        campaignRef: null,
        threadRef: null,
        direction: input.direction,
        notes: null,
      } as CanonicalEventRecord["provenance"],
      reviewState: "clear",
    },
    detail: {
      sourceEvidenceId: input.sourceEvidenceId,
      providerRecordId: input.id,
      channel: "email",
      messageKind:
        input.detailMessageKind ?? input.canonicalMessageKind ?? "one_to_one",
      subject: input.subject,
      snippet: input.snippet,
      sourceLabel: "Salesforce Logged Email",
    },
    timelineRow: {
      id: `timeline:${input.id}`,
      contactId: "contact_1",
      canonicalEventId: input.id,
      occurredAt: input.occurredAt,
      sortKey: `${input.occurredAt}::${input.id}`,
      eventType: `communication.email.${input.direction}`,
      summary: input.subject,
      channel: "email",
      primaryProvider: "salesforce",
      reviewState: "clear",
    },
  };
}

function buildGmailOutboundEmailEvent(input: {
  readonly id: string;
  readonly sourceEvidenceId: string;
  readonly occurredAt: string;
  readonly subject: string;
  readonly snippet: string;
  readonly bodyPreview: string;
  readonly contentFingerprint?: string | null;
  readonly threadId?: string;
  readonly capturedMailbox?: string;
  readonly projectInboxAlias?: string;
}): {
  readonly canonicalEvent: CanonicalEventRecord;
  readonly detail: GmailMessageDetailRecord;
  readonly timelineRow: TimelineProjectionRow;
} {
  const threadId = input.threadId ?? `thread:${input.id}`;
  const capturedMailbox = input.capturedMailbox ?? "pnw@example.org";

  return {
    canonicalEvent: {
      id: input.id,
      contactId: "contact_1",
      eventType: "communication.email.outbound",
      channel: "email",
      occurredAt: input.occurredAt,
      contentFingerprint: input.contentFingerprint ?? null,
      sourceEvidenceId: input.sourceEvidenceId,
      idempotencyKey: `canonical:${input.id}`,
      provenance: {
        primaryProvider: "gmail",
        primarySourceEvidenceId: input.sourceEvidenceId,
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "gmail_message",
        sourceRecordId: input.id,
        messageKind: "one_to_one",
        campaignRef: null,
        threadRef: {
          providerThreadId: threadId,
          crossProviderCollapseKey: null,
        },
        direction: "outbound",
        notes: null,
      } as CanonicalEventRecord["provenance"],
      reviewState: "clear",
    },
    detail: {
      sourceEvidenceId: input.sourceEvidenceId,
      providerRecordId: input.id,
      gmailThreadId: threadId,
      rfc822MessageId: `<${input.id}@example.org>`,
      direction: "outbound",
      subject: input.subject,
      fromHeader: "PNW Project <pnw@example.org>",
      toHeader: "Stage One Volunteer <volunteer@example.org>",
      ccHeader: null,
      snippetClean: input.snippet,
      bodyTextPreview: input.bodyPreview,
      capturedMailbox,
      projectInboxAlias: input.projectInboxAlias ?? capturedMailbox,
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
      primaryProvider: "gmail",
      reviewState: "clear",
    },
  };
}

function buildMailchimpCampaignEmailEvent(input: {
  readonly id: string;
  readonly sourceEvidenceId: string;
  readonly occurredAt: string;
  readonly snippet: string;
  readonly campaignName: string;
  readonly activityType: MailchimpCampaignActivityDetailRecord["activityType"];
  readonly contentFingerprint: string;
}): {
  readonly canonicalEvent: CanonicalEventRecord;
  readonly detail: MailchimpCampaignActivityDetailRecord;
  readonly timelineRow: TimelineProjectionRow;
} {
  return {
    canonicalEvent: {
      id: input.id,
      contactId: "contact_1",
      eventType: `campaign.email.${input.activityType}`,
      channel: "email",
      occurredAt: input.occurredAt,
      contentFingerprint: input.contentFingerprint,
      sourceEvidenceId: input.sourceEvidenceId,
      idempotencyKey: `canonical:${input.id}`,
      provenance: {
        primaryProvider: "mailchimp",
        primarySourceEvidenceId: input.sourceEvidenceId,
        supportingSourceEvidenceIds: [],
        winnerReason: "single_source",
        sourceRecordType: "campaign_email_activity",
        sourceRecordId: input.id,
        messageKind: "campaign",
        campaignRef: {
          providerMessageName: input.campaignName,
          providerCampaignId: "cmp-1",
          providerAudienceId: "aud-1",
        },
        threadRef: null,
        direction: "outbound",
        notes: null,
      } as CanonicalEventRecord["provenance"],
      reviewState: "clear",
    },
    detail: {
      sourceEvidenceId: input.sourceEvidenceId,
      providerRecordId: input.id,
      activityType: input.activityType,
      campaignId: "cmp-1",
      audienceId: "aud-1",
      memberId: "member-1",
      campaignName: input.campaignName,
      snippet: input.snippet,
    },
    timelineRow: {
      id: `timeline:${input.id}`,
      contactId: "contact_1",
      canonicalEventId: input.id,
      occurredAt: input.occurredAt,
      sortKey: `${input.occurredAt}::${input.id}`,
      eventType: `campaign.email.${input.activityType}`,
      summary: input.campaignName,
      channel: "email",
      primaryProvider: "mailchimp",
      reviewState: "clear",
    },
  };
}

function buildInternalNote(input: {
  readonly id: string;
  readonly contactId?: string;
  readonly body: string;
  readonly authorDisplayName?: string | null;
  readonly authorId?: string;
  readonly createdAt: string;
}): InternalNoteRecord {
  return {
    id: input.id,
    contactId: input.contactId ?? "contact_1",
    body: input.body,
    authorDisplayName: input.authorDisplayName ?? null,
    authorId: input.authorId ?? "user:author",
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.createdAt),
  };
}

describe("Stage 1 timeline presenter", () => {
  it("keeps Salesforce outbound email in the 1:1 family unless canon explicitly marks it auto", async () => {
    const nullClassified = buildSalesforceEmailEvent({
      id: "evt_salesforce_null",
      sourceEvidenceId: "sev_salesforce_null",
      occurredAt: "2026-01-01T00:00:00.000Z",
      direction: "outbound",
      canonicalMessageKind: null,
      subject: "Logged follow-up",
      snippet: "Logged follow-up body",
    });
    const explicitOneToOne = buildSalesforceEmailEvent({
      id: "evt_salesforce_one_to_one",
      sourceEvidenceId: "sev_salesforce_one_to_one",
      occurredAt: "2026-01-01T00:01:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "one_to_one",
      subject: "Explicit one-to-one follow-up",
      snippet: "Explicit one-to-one body",
    });
    const explicitAuto = buildSalesforceEmailEvent({
      id: "evt_salesforce_auto",
      sourceEvidenceId: "sev_salesforce_auto",
      occurredAt: "2026-01-01T00:02:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "auto",
      subject: "Automation sent",
      snippet: "Automation body",
    });

    const repositories = createRepositoryBundle({
      canonicalEvents: [
        nullClassified.canonicalEvent,
        explicitOneToOne.canonicalEvent,
        explicitAuto.canonicalEvent,
      ],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_salesforce_null",
          providerRecordId: "salesforce-null",
        }),
        buildSourceEvidence({
          id: "sev_salesforce_one_to_one",
          providerRecordId: "salesforce-one-to-one",
        }),
        buildSourceEvidence({
          id: "sev_salesforce_auto",
          providerRecordId: "salesforce-auto",
        }),
      ],
      salesforceCommunicationDetails: [
        nullClassified.detail,
        explicitOneToOne.detail,
        explicitAuto.detail,
      ],
      timelineRows: [
        nullClassified.timelineRow,
        explicitOneToOne.timelineRow,
        explicitAuto.timelineRow,
      ],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items: readonly TimelineItem[] =
      await presenter.listTimelineItemsByContactId("contact_1");

    expect(
      items.map((item) => ({
        canonicalEventId: item.canonicalEventId,
        family: item.family,
      })),
    ).toEqual([
      {
        canonicalEventId: "evt_salesforce_null",
        family: "one_to_one_email",
      },
      {
        canonicalEventId: "evt_salesforce_one_to_one",
        family: "one_to_one_email",
      },
      {
        canonicalEventId: "evt_salesforce_auto",
        family: "auto_email",
      },
    ]);
  });

  it("prefers Salesforce communication detail message kinds when canonical metadata is stale", async () => {
    const inboundAutoMismatch = buildSalesforceEmailEvent({
      id: "evt_salesforce_inbound_auto_mismatch",
      sourceEvidenceId: "sev_salesforce_inbound_auto_mismatch",
      occurredAt: "2026-01-01T00:00:00.000Z",
      direction: "inbound",
      canonicalMessageKind: "auto",
      detailMessageKind: "one_to_one",
      subject: "Accepted: chat about orcas",
      snippet: "Elise Newman has accepted this invitation.",
    });
    const outboundAutoMismatch = buildSalesforceEmailEvent({
      id: "evt_salesforce_outbound_auto_mismatch",
      sourceEvidenceId: "sev_salesforce_outbound_auto_mismatch",
      occurredAt: "2026-01-01T00:01:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "auto",
      detailMessageKind: "one_to_one",
      subject: "Manual follow-up",
      snippet: "Operator follow-up sent from Salesforce.",
    });

    const repositories = createRepositoryBundle({
      canonicalEvents: [
        inboundAutoMismatch.canonicalEvent,
        outboundAutoMismatch.canonicalEvent,
      ],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_salesforce_inbound_auto_mismatch",
          providerRecordId: "salesforce-inbound-auto-mismatch",
        }),
        buildSourceEvidence({
          id: "sev_salesforce_outbound_auto_mismatch",
          providerRecordId: "salesforce-outbound-auto-mismatch",
        }),
      ],
      salesforceCommunicationDetails: [
        inboundAutoMismatch.detail,
        outboundAutoMismatch.detail,
      ],
      timelineRows: [
        inboundAutoMismatch.timelineRow,
        outboundAutoMismatch.timelineRow,
      ],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(
      items.map((item) => ({
        canonicalEventId: item.canonicalEventId,
        family: item.family,
      })),
    ).toEqual([
      {
        canonicalEventId: "evt_salesforce_inbound_auto_mismatch",
        family: "one_to_one_email",
      },
      {
        canonicalEventId: "evt_salesforce_outbound_auto_mismatch",
        family: "one_to_one_email",
      },
    ]);
  });

  it("unions pending composer outbounds into the timeline read model", async () => {
    const outbound = buildSalesforceEmailEvent({
      id: "evt_salesforce_one_to_one",
      sourceEvidenceId: "sev_salesforce_one_to_one",
      occurredAt: "2026-01-01T00:01:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "one_to_one",
      subject: "Existing outbound",
      snippet: "Existing outbound body",
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [outbound.canonicalEvent],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_salesforce_one_to_one",
          providerRecordId: "salesforce-one-to-one",
        }),
      ],
      salesforceCommunicationDetails: [outbound.detail],
      timelineRows: [outbound.timelineRow],
      pendingOutbounds: [
        {
          id: "pending:1",
          fingerprint: "fp:pending:1",
          status: "pending",
          actorId: "user:operator",
          canonicalContactId: "contact_1",
          projectId: null,
          fromAlias: "antarctica@example.org",
          toEmailNormalized: "volunteer@example.org",
          subject: "Pending outbound",
          bodyPlaintext: "Pending outbound body",
          bodyHtml: "<p>Pending outbound body</p>",
          bodySha256: "sha256:pending",
          attachmentMetadata: [],
          gmailThreadId: null,
          inReplyToRfc822: null,
          attemptedAt: "2026-01-01T00:02:00.000Z",
          reconciledEventId: null,
          reconciledAt: null,
          failedReason: null,
          sentRfc822MessageId: null,
          failedDetail: null,
          orphanedAt: null,
          createdAt: "2026-01-01T00:02:00.000Z",
          updatedAt: "2026-01-01T00:02:00.000Z",
        },
      ],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items.map((item) => item.canonicalEventId)).toEqual([
      "evt_salesforce_one_to_one",
      "pending-outbound:pending:1",
    ]);
    expect(items[1]).toMatchObject({
      family: "one_to_one_email",
      primaryProvider: "manual",
      subject: "Pending outbound",
      bodyPreview: "Pending outbound body",
      sendStatus: "pending",
      attachmentCount: 0,
    });
  });

  it("drops reconciled pending outbounds once the canonical event is present", async () => {
    const outbound = buildGmailOutboundEmailEvent({
      id: "canonical-event:gmail%3Amessage%3Atest123",
      sourceEvidenceId: "sev_gmail_outbound_reconciled",
      occurredAt: "2026-01-01T00:03:00.000Z",
      subject: "Reconciled outbound",
      snippet: "Reconciled outbound body",
      bodyPreview: "Reconciled outbound body",
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [outbound.canonicalEvent],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_gmail_outbound_reconciled",
          provider: "gmail",
          providerRecordType: "gmail_message",
          providerRecordId: "gmail-message-test123",
        }),
      ],
      gmailMessageDetails: [outbound.detail],
      timelineRows: [outbound.timelineRow],
      salesforceCommunicationDetails: [],
      pendingOutbounds: [
        {
          id: "pending:reconciled",
          fingerprint: "fp:pending:reconciled",
          status: "confirmed",
          actorId: "user:operator",
          canonicalContactId: "contact_1",
          projectId: null,
          fromAlias: "antarctica@example.org",
          toEmailNormalized: "volunteer@example.org",
          subject: "Reconciled outbound",
          bodyPlaintext: "Reconciled outbound body",
          bodyHtml: "<p>Reconciled outbound body</p>",
          bodySha256: "sha256:reconciled",
          attachmentMetadata: [],
          gmailThreadId: null,
          inReplyToRfc822: null,
          sentAt: "2026-01-01T00:03:00.000Z",
          reconciledEventId: "canonical-event:gmail%3Amessage%3Atest123",
          reconciledAt: "2026-01-01T00:03:24.000Z",
          failedReason: null,
          sentRfc822MessageId: null,
          failedDetail: null,
          orphanedAt: null,
          createdAt: "2026-01-01T00:03:00.000Z",
          updatedAt: "2026-01-01T00:03:24.000Z",
        },
      ],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items.filter((item) => item.family === "one_to_one_email")).toHaveLength(1);
    expect(items.map((item) => item.canonicalEventId)).toEqual([
      "canonical-event:gmail%3Amessage%3Atest123",
    ]);
  });

  it("preserves unreconciled pending outbounds", async () => {
    const repositories = createRepositoryBundle({
      canonicalEvents: [],
      sourceEvidence: [],
      salesforceCommunicationDetails: [],
      timelineRows: [],
      pendingOutbounds: [
        {
          id: "pending:null-reconcile",
          fingerprint: "fp:pending:null-reconcile",
          status: "pending",
          actorId: "user:operator",
          canonicalContactId: "contact_1",
          projectId: null,
          fromAlias: "antarctica@example.org",
          toEmailNormalized: "volunteer@example.org",
          subject: "Pending outbound",
          bodyPlaintext: "Pending outbound body",
          bodyHtml: "<p>Pending outbound body</p>",
          bodySha256: "sha256:pending-null",
          attachmentMetadata: [],
          gmailThreadId: null,
          inReplyToRfc822: null,
          sentAt: "2026-01-01T00:04:00.000Z",
          reconciledEventId: null,
          reconciledAt: null,
          failedReason: null,
          sentRfc822MessageId: null,
          failedDetail: null,
          orphanedAt: null,
          createdAt: "2026-01-01T00:04:00.000Z",
          updatedAt: "2026-01-01T00:04:00.000Z",
        },
      ],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items.map((item) => item.canonicalEventId)).toEqual([
      "pending-outbound:pending:null-reconcile",
    ]);
    expect(items[0]).toMatchObject({
      sendStatus: "pending",
      subject: "Pending outbound",
    });
  });

  it("preserves reconciled pending outbounds when the canonical event is not in the current page", async () => {
    const outbound = buildSalesforceEmailEvent({
      id: "evt_salesforce_one_to_one_page_only",
      sourceEvidenceId: "sev_salesforce_one_to_one_page_only",
      occurredAt: "2026-01-01T00:05:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "one_to_one",
      subject: "Page event",
      snippet: "Page event body",
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [outbound.canonicalEvent],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_salesforce_one_to_one_page_only",
          providerRecordId: "salesforce-page-only",
        }),
      ],
      salesforceCommunicationDetails: [outbound.detail],
      timelineRows: [outbound.timelineRow],
      pendingOutbounds: [
        {
          id: "pending:lag-window",
          fingerprint: "fp:pending:lag-window",
          status: "confirmed",
          actorId: "user:operator",
          canonicalContactId: "contact_1",
          projectId: null,
          fromAlias: "antarctica@example.org",
          toEmailNormalized: "volunteer@example.org",
          subject: "Lag window outbound",
          bodyPlaintext: "Lag window outbound body",
          bodyHtml: "<p>Lag window outbound body</p>",
          bodySha256: "sha256:lag-window",
          attachmentMetadata: [],
          gmailThreadId: null,
          inReplyToRfc822: null,
          sentAt: "2026-01-01T00:06:00.000Z",
          reconciledEventId: "canonical-event:something-not-in-the-page",
          reconciledAt: "2026-01-01T00:06:24.000Z",
          failedReason: null,
          sentRfc822MessageId: null,
          failedDetail: null,
          orphanedAt: null,
          createdAt: "2026-01-01T00:06:00.000Z",
          updatedAt: "2026-01-01T00:06:24.000Z",
        },
      ],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items.map((item) => item.canonicalEventId)).toEqual([
      "evt_salesforce_one_to_one_page_only",
      "pending-outbound:pending:lag-window",
    ]);
    expect(items[1]).toMatchObject({
      sendStatus: "confirmed",
      subject: "Lag window outbound",
    });
  });

  // The "hydrates attachmentCount from message_attachments rows" assertion
  // moved to the inbox selector tests — the domain timeline presenter
  // intentionally returns attachmentCount: 0 to avoid a duplicate
  // findByMessageIds call. Selector
  // ("batch-loads timeline attachments once and groups them by source
  // evidence id" in apps/web/tests/unit/inbox-selectors.test.ts) is now the
  // canonical home for the attachmentCount assertion.

  it("collapses cross-provider outbound email duplicates and keeps the richer Gmail record", async () => {
    const duplicateFingerprint = "fp:hex-13174";
    const salesforceAuto = buildSalesforceEmailEvent({
      id: "evt_salesforce_auto_duplicate",
      sourceEvidenceId: "sev_salesforce_auto_duplicate",
      occurredAt: "2026-01-01T00:05:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "auto",
      subject: "Re: Confirmed: Hex 13174",
      snippet: "No problem at all! I will plan to retrieve the ARUs.",
      contentFingerprint: duplicateFingerprint,
    });
    const gmailOneToOne = buildGmailOutboundEmailEvent({
      id: "evt_gmail_duplicate",
      sourceEvidenceId: "sev_gmail_duplicate",
      occurredAt: "2026-01-01T00:05:30.000Z",
      subject: "Re: Confirmed: Hex 13174",
      snippet: "No problem at all! I will plan to retrieve the ARUs.",
      bodyPreview: "No problem at all! I will plan to retrieve the ARUs.",
      contentFingerprint: duplicateFingerprint,
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [
        salesforceAuto.canonicalEvent,
        gmailOneToOne.canonicalEvent,
      ],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_salesforce_auto_duplicate",
          providerRecordId: "salesforce-auto-duplicate",
        }),
        buildSourceEvidence({
          id: "sev_gmail_duplicate",
          provider: "gmail",
          providerRecordType: "gmail_message",
          providerRecordId: "gmail-duplicate",
        }),
      ],
      salesforceCommunicationDetails: [salesforceAuto.detail],
      gmailMessageDetails: [gmailOneToOne.detail],
      timelineRows: [salesforceAuto.timelineRow, gmailOneToOne.timelineRow],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      canonicalEventId: "evt_gmail_duplicate",
      family: "one_to_one_email",
      primaryProvider: "gmail",
      subject: "Re: Confirmed: Hex 13174",
      bodyPreview: "No problem at all! I will plan to retrieve the ARUs.",
    });
  });

  it("collapses same-day identical Gmail outbound resends on the same thread and keeps the first message", async () => {
    const firstGmail = buildGmailOutboundEmailEvent({
      id: "evt_gmail_same_day_first",
      sourceEvidenceId: "sev_gmail_same_day_first",
      occurredAt: "2026-04-20T18:02:51.000Z",
      subject: "Re: Update on Hex 43191",
      snippet:
        "Hi Shaina,\n\nThanks so much for reaching out! Just to confirm you are planning to head out later in the summer, around 8/24?",
      bodyPreview:
        "Hi Shaina,\n\nThanks so much for reaching out! Just to confirm you are planning to head out later in the summer, around 8/24?",
      contentFingerprint: "fp:gmail-same-day-first",
      threadId: "thread:shaina-dotson",
      capturedMailbox: "volunteers@adventurescientists.org",
      projectInboxAlias: "pnwbio@adventurescientists.org",
    });
    const secondGmail = buildGmailOutboundEmailEvent({
      id: "evt_gmail_same_day_second",
      sourceEvidenceId: "sev_gmail_same_day_second",
      occurredAt: "2026-04-20T21:26:25.000Z",
      subject: "Re: Update on Hex 43191",
      snippet:
        "Hi Shaina,\n\nThanks so much for reaching out! Just to confirm you are planning to head out later in the summer, around 8/24?",
      bodyPreview:
        "Hi Shaina,\n\nThanks so much for reaching out! Just to confirm you are planning to head out later in the summer, around 8/24?",
      contentFingerprint: "fp:gmail-same-day-second",
      threadId: "thread:shaina-dotson",
      capturedMailbox: "volunteers@adventurescientists.org",
      projectInboxAlias: "pnwbio@adventurescientists.org",
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [
        firstGmail.canonicalEvent,
        secondGmail.canonicalEvent,
      ],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_gmail_same_day_first",
          provider: "gmail",
          providerRecordType: "gmail_message",
          providerRecordId: "gmail-same-day-first",
        }),
        buildSourceEvidence({
          id: "sev_gmail_same_day_second",
          provider: "gmail",
          providerRecordType: "gmail_message",
          providerRecordId: "gmail-same-day-second",
        }),
      ],
      salesforceCommunicationDetails: [],
      gmailMessageDetails: [firstGmail.detail, secondGmail.detail],
      timelineRows: [firstGmail.timelineRow, secondGmail.timelineRow],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      canonicalEventId: "evt_gmail_same_day_first",
      family: "one_to_one_email",
      primaryProvider: "gmail",
      threadId: "thread:shaina-dotson",
      mailbox: "pnwbio@adventurescientists.org",
      subject: "Re: Update on Hex 43191",
    });
  });

  it("does not warn when every displayable communication event has a timeline projection row", async () => {
    const autoEmail = buildSalesforceEmailEvent({
      id: "evt_projection_complete",
      sourceEvidenceId: "sev_projection_complete",
      occurredAt: "2026-01-01T00:10:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "auto",
      subject: "Plan your Adventure Today",
      snippet: "Body: Reminder sent.",
      contentFingerprint: "fp:projection-complete",
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [autoEmail.canonicalEvent],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_projection_complete",
          providerRecordId: "projection-complete",
        }),
      ],
      salesforceCommunicationDetails: [autoEmail.detail],
      timelineRows: [autoEmail.timelineRow],
    });
    const presenter = createStage1TimelinePresentationService(repositories);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await presenter.listTimelineItemsPageByContactId("contact_1", {
        limit: 40,
        beforeSortKey: null,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns when a displayable communication event is missing from the timeline projection", async () => {
    const firstAutoEmail = buildSalesforceEmailEvent({
      id: "evt_projection_present",
      sourceEvidenceId: "sev_projection_present",
      occurredAt: "2026-01-01T00:10:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "auto",
      subject: "Plan your Adventure Today",
      snippet: "Body: First reminder sent.",
      contentFingerprint: "fp:projection-gap",
    });
    const missingAutoEmail = buildSalesforceEmailEvent({
      id: "evt_projection_missing",
      sourceEvidenceId: "sev_projection_missing",
      occurredAt: "2026-01-01T00:12:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "auto",
      subject: "Plan your Adventure Today",
      snippet: "Body: Second reminder sent.",
      contentFingerprint: "fp:projection-gap",
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [
        firstAutoEmail.canonicalEvent,
        missingAutoEmail.canonicalEvent,
      ],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_projection_present",
          providerRecordId: "projection-present",
        }),
        buildSourceEvidence({
          id: "sev_projection_missing",
          providerRecordId: "projection-missing",
        }),
      ],
      salesforceCommunicationDetails: [
        firstAutoEmail.detail,
        missingAutoEmail.detail,
      ],
      timelineRows: [firstAutoEmail.timelineRow],
    });
    const presenter = createStage1TimelinePresentationService(repositories);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await presenter.listTimelineItemsPageByContactId("contact_1", {
        limit: 40,
        beforeSortKey: null,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        "Timeline projection gap detected for canonical communication event.",
        {
          contactId: "contact_1",
          canonicalEventId: "evt_projection_missing",
          eventType: "communication.email.outbound",
          provider: "salesforce",
          timestamp: "2026-01-01T00:12:00.000Z",
        },
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("collapses duplicate campaign rows before pagination counts them", async () => {
    const duplicateFingerprint = "fp:campaign-april-update";
    const firstCampaign = buildMailchimpCampaignEmailEvent({
      id: "evt_campaign_duplicate_1",
      sourceEvidenceId: "sev_campaign_duplicate_1",
      occurredAt: "2026-01-01T00:10:00.000Z",
      activityType: "sent",
      campaignName: "April Volunteer Update",
      snippet: "Subject: April Volunteer Update\n\nBody:\nBring your field notebook.",
      contentFingerprint: duplicateFingerprint,
    });
    const secondCampaign = buildMailchimpCampaignEmailEvent({
      id: "evt_campaign_duplicate_2",
      sourceEvidenceId: "sev_campaign_duplicate_2",
      occurredAt: "2026-01-01T00:10:30.000Z",
      activityType: "sent",
      campaignName: "April Volunteer Update",
      snippet: "Subject: April Volunteer Update\n\nBody:\nBring your field notebook.",
      contentFingerprint: duplicateFingerprint,
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [
        firstCampaign.canonicalEvent,
        secondCampaign.canonicalEvent,
      ],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_campaign_duplicate_1",
          provider: "mailchimp",
          providerRecordType: "campaign_email_activity",
          providerRecordId: "campaign-duplicate-1",
        }),
        buildSourceEvidence({
          id: "sev_campaign_duplicate_2",
          provider: "mailchimp",
          providerRecordType: "campaign_email_activity",
          providerRecordId: "campaign-duplicate-2",
        }),
      ],
      salesforceCommunicationDetails: [],
      mailchimpCampaignActivityDetails: [
        firstCampaign.detail,
        secondCampaign.detail,
      ],
      timelineRows: [firstCampaign.timelineRow, secondCampaign.timelineRow],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const firstPage = await presenter.listTimelineItemsPageByContactId(
      "contact_1",
      {
        limit: 1,
        beforeSortKey: null,
      },
    );

    expect(firstPage.total).toBe(1);
    expect(firstPage.hasMore).toBe(false);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]).toMatchObject({
      canonicalEventId: "evt_campaign_duplicate_1",
      family: "campaign_email",
      campaignName: "April Volunteer Update",
    });
  });

  it("collapses sent and opened campaign activity variants into one representative email row", async () => {
    const sentCampaign = buildMailchimpCampaignEmailEvent({
      id: "evt_campaign_sent",
      sourceEvidenceId: "sev_campaign_sent",
      occurredAt: "2026-01-01T00:10:00.000Z",
      activityType: "sent",
      campaignName: "Trailhead Update",
      snippet: "Subject: Trailhead Update\n\nBody:\nBring your field notebook.",
      contentFingerprint: "fp:campaign-sent",
    });
    const openedCampaign = buildMailchimpCampaignEmailEvent({
      id: "evt_campaign_opened",
      sourceEvidenceId: "sev_campaign_opened",
      occurredAt: "2026-01-02T04:45:00.000Z",
      activityType: "opened",
      campaignName: "Trailhead Update",
      snippet: "Subject: Trailhead Update\n\nBody:\nBring your field notebook.",
      contentFingerprint: "fp:campaign-opened",
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [
        sentCampaign.canonicalEvent,
        openedCampaign.canonicalEvent,
      ],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_campaign_sent",
          provider: "mailchimp",
          providerRecordType: "campaign_email_activity",
          providerRecordId: "campaign-sent",
        }),
        buildSourceEvidence({
          id: "sev_campaign_opened",
          provider: "mailchimp",
          providerRecordType: "campaign_email_activity",
          providerRecordId: "campaign-opened",
        }),
      ],
      salesforceCommunicationDetails: [],
      mailchimpCampaignActivityDetails: [
        sentCampaign.detail,
        openedCampaign.detail,
      ],
      timelineRows: [sentCampaign.timelineRow, openedCampaign.timelineRow],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      canonicalEventId: "evt_campaign_sent",
      family: "campaign_email",
      activityType: "sent",
      campaignName: "Trailhead Update",
      snippet: "Subject: Trailhead Update\n\nBody:\nBring your field notebook.",
    });
  });

  it("keeps auto-email rows with the same signature when they are minutes apart", async () => {
    const firstAutoEmail = buildSalesforceEmailEvent({
      id: "evt_auto_email_1",
      sourceEvidenceId: "sev_auto_email_1",
      occurredAt: "2026-01-01T00:10:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "auto",
      subject: "Plan your Adventure Today",
      snippet: "Body: Reminder sent.",
      contentFingerprint: "fp:auto-email-repeat",
    });
    const secondAutoEmail = buildSalesforceEmailEvent({
      id: "evt_auto_email_2",
      sourceEvidenceId: "sev_auto_email_2",
      occurredAt: "2026-01-01T00:12:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "auto",
      subject: "Plan your Adventure Today",
      snippet: "Body: Reminder sent.",
      contentFingerprint: "fp:auto-email-repeat",
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [
        firstAutoEmail.canonicalEvent,
        secondAutoEmail.canonicalEvent,
      ],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_auto_email_1",
          providerRecordId: "auto-email-1",
        }),
        buildSourceEvidence({
          id: "sev_auto_email_2",
          providerRecordId: "auto-email-2",
        }),
      ],
      salesforceCommunicationDetails: [
        firstAutoEmail.detail,
        secondAutoEmail.detail,
      ],
      timelineRows: [firstAutoEmail.timelineRow, secondAutoEmail.timelineRow],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.canonicalEventId)).toEqual([
      "evt_auto_email_1",
      "evt_auto_email_2",
    ]);
    expect(items.every((item) => item.family === "auto_email")).toBe(true);
  });

  it("still collapses non-auto-email rows with the same signature in the duplicate window", async () => {
    const firstOneToOneEmail = buildSalesforceEmailEvent({
      id: "evt_one_to_one_1",
      sourceEvidenceId: "sev_one_to_one_1",
      occurredAt: "2026-01-01T00:10:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "one_to_one",
      subject: "Checking in",
      snippet: "Body: Following up on your question.",
      contentFingerprint: "fp:one-to-one-repeat",
    });
    const secondOneToOneEmail = buildSalesforceEmailEvent({
      id: "evt_one_to_one_2",
      sourceEvidenceId: "sev_one_to_one_2",
      occurredAt: "2026-01-01T00:12:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "one_to_one",
      subject: "Checking in",
      snippet: "Body: Following up on your question.",
      contentFingerprint: "fp:one-to-one-repeat",
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [
        firstOneToOneEmail.canonicalEvent,
        secondOneToOneEmail.canonicalEvent,
      ],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_one_to_one_1",
          providerRecordId: "one-to-one-1",
        }),
        buildSourceEvidence({
          id: "sev_one_to_one_2",
          providerRecordId: "one-to-one-2",
        }),
      ],
      salesforceCommunicationDetails: [
        firstOneToOneEmail.detail,
        secondOneToOneEmail.detail,
      ],
      timelineRows: [
        firstOneToOneEmail.timelineRow,
        secondOneToOneEmail.timelineRow,
      ],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      canonicalEventId: "evt_one_to_one_1",
      family: "one_to_one_email",
    });
  });

  it("interleaves internal notes with canonical events by occurredAt", async () => {
    const firstEvent = buildSalesforceEmailEvent({
      id: "evt_t0",
      sourceEvidenceId: "sev_t0",
      occurredAt: "2026-01-01T00:00:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "one_to_one",
      subject: "First event",
      snippet: "First event body",
    });
    const secondEvent = buildSalesforceEmailEvent({
      id: "evt_t2",
      sourceEvidenceId: "sev_t2",
      occurredAt: "2026-01-01T00:00:02.000Z",
      direction: "outbound",
      canonicalMessageKind: "one_to_one",
      subject: "Second event",
      snippet: "Second event body",
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [firstEvent.canonicalEvent, secondEvent.canonicalEvent],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_t0",
          providerRecordId: "timeline-t0",
        }),
        buildSourceEvidence({
          id: "sev_t2",
          providerRecordId: "timeline-t2",
        }),
      ],
      salesforceCommunicationDetails: [firstEvent.detail, secondEvent.detail],
      internalNotes: [
        buildInternalNote({
          id: "note_t1",
          body: "Interleaved note",
          authorDisplayName: "Author",
          createdAt: "2026-01-01T00:00:01.000Z",
        }),
      ],
      timelineRows: [firstEvent.timelineRow, secondEvent.timelineRow],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items.map((item) => item.canonicalEventId)).toEqual([
      "evt_t0",
      "note:note_t1",
      "evt_t2",
    ]);
  });

  it("uses a deterministic sort-key tiebreaker when a note and event share a timestamp", async () => {
    const event = buildSalesforceEmailEvent({
      id: "evt_same_time",
      sourceEvidenceId: "sev_same_time",
      occurredAt: "2026-01-01T00:00:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "one_to_one",
      subject: "Same timestamp",
      snippet: "Canonical event",
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [event.canonicalEvent],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_same_time",
          providerRecordId: "same-time",
        }),
      ],
      salesforceCommunicationDetails: [event.detail],
      internalNotes: [
        buildInternalNote({
          id: "note_same_time",
          body: "Same timestamp note",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      ],
      timelineRows: [event.timelineRow],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items.map((item) => item.canonicalEventId)).toEqual([
      "evt_same_time",
      "note:note_same_time",
    ]);
  });

  it("paginates across interleaved canonical events and internal notes without drops or duplicates", async () => {
    const event0 = buildSalesforceEmailEvent({
      id: "evt_page_0",
      sourceEvidenceId: "sev_page_0",
      occurredAt: "2026-01-01T00:00:00.000Z",
      direction: "outbound",
      canonicalMessageKind: "one_to_one",
      subject: "Page 0",
      snippet: "Page 0 body",
    });
    const event2 = buildSalesforceEmailEvent({
      id: "evt_page_2",
      sourceEvidenceId: "sev_page_2",
      occurredAt: "2026-01-01T00:00:02.000Z",
      direction: "outbound",
      canonicalMessageKind: "one_to_one",
      subject: "Page 2",
      snippet: "Page 2 body",
    });
    const event4 = buildSalesforceEmailEvent({
      id: "evt_page_4",
      sourceEvidenceId: "sev_page_4",
      occurredAt: "2026-01-01T00:00:04.000Z",
      direction: "outbound",
      canonicalMessageKind: "one_to_one",
      subject: "Page 4",
      snippet: "Page 4 body",
    });
    const repositories = createRepositoryBundle({
      canonicalEvents: [
        event0.canonicalEvent,
        event2.canonicalEvent,
        event4.canonicalEvent,
      ],
      sourceEvidence: [
        buildSourceEvidence({
          id: "sev_page_0",
          providerRecordId: "page-0",
        }),
        buildSourceEvidence({
          id: "sev_page_2",
          providerRecordId: "page-2",
        }),
        buildSourceEvidence({
          id: "sev_page_4",
          providerRecordId: "page-4",
        }),
      ],
      salesforceCommunicationDetails: [
        event0.detail,
        event2.detail,
        event4.detail,
      ],
      internalNotes: [
        buildInternalNote({
          id: "note_page_1",
          body: "Page 1",
          createdAt: "2026-01-01T00:00:01.000Z",
        }),
        buildInternalNote({
          id: "note_page_3",
          body: "Page 3",
          createdAt: "2026-01-01T00:00:03.000Z",
        }),
      ],
      timelineRows: [event0.timelineRow, event2.timelineRow, event4.timelineRow],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const page1 = await presenter.listTimelineItemsPageByContactId("contact_1", {
      limit: 2,
      beforeSortKey: null,
    });
    const page2 = await presenter.listTimelineItemsPageByContactId("contact_1", {
      limit: 2,
      beforeSortKey: page1.nextBeforeSortKey,
    });
    const page3 = await presenter.listTimelineItemsPageByContactId("contact_1", {
      limit: 2,
      beforeSortKey: page2.nextBeforeSortKey,
    });

    expect(page1.total).toBe(5);
    expect(page1.items.map((item) => item.canonicalEventId)).toEqual([
      "note:note_page_3",
      "evt_page_4",
    ]);
    expect(page2.items.map((item) => item.canonicalEventId)).toEqual([
      "note:note_page_1",
      "evt_page_2",
    ]);
    expect(page3.items.map((item) => item.canonicalEventId)).toEqual([
      "evt_page_0",
    ]);
    expect([
      ...page1.items,
      ...page2.items,
      ...page3.items,
    ].map((item) => item.canonicalEventId)).toEqual([
      "note:note_page_3",
      "evt_page_4",
      "note:note_page_1",
      "evt_page_2",
      "evt_page_0",
    ]);
  });

  it("does not collapse duplicate internal notes", async () => {
    const repositories = createRepositoryBundle({
      canonicalEvents: [],
      sourceEvidence: [],
      salesforceCommunicationDetails: [],
      internalNotes: [
        buildInternalNote({
          id: "note_dup_1",
          body: "Same body",
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
        buildInternalNote({
          id: "note_dup_2",
          body: "Same body",
          createdAt: "2026-01-01T00:04:00.000Z",
        }),
      ],
      timelineRows: [],
    });
    const presenter = createStage1TimelinePresentationService(repositories);

    const items = await presenter.listTimelineItemsByContactId("contact_1");

    expect(items.map((item) => item.canonicalEventId)).toEqual([
      "note:note_dup_1",
      "note:note_dup_2",
    ]);
  });
});
