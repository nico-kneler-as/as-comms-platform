import { describe, expect, it } from "vitest";

import type {
  AuditEvidenceRecord,
  CanonicalEventRecord,
  ContactRecord,
  GmailMessageDetailRecord,
  InboxProjectionRow,
  MailchimpCampaignActivityDetailRecord,
  TimelineItem,
  SourceEvidenceRecord,
  TimelineProjectionRow,
} from "@as-comms/contracts";

import {
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
  readonly mailchimpCampaignActivityDetails?: readonly MailchimpCampaignActivityDetailRecord[];
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
      countByProvider: () => Promise.resolve(0),
      listByProviderRecord: () => Promise.resolve([]),
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
      upsert: (record) => Promise.resolve(record),
    },
    projectKnowledge: {
      list: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
      setApproved: () => Promise.resolve(),
      deleteById: () => Promise.resolve(),
      getForRetrieval: () => Promise.resolve([]),
    },
    projectKnowledgeSourceLinks: {
      list: () => Promise.resolve([]),
      upsert: (record) => Promise.resolve(record),
      deleteById: () => Promise.resolve(),
    },
    projectKnowledgeBootstrapRuns: {
      create: (record) => Promise.resolve(record),
      findById: () => Promise.resolve(null),
      listByProject: () => Promise.resolve([]),
      update: () => Promise.resolve(null),
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
      upsert: (record) => Promise.resolve(record),
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
      upsert: (record) => Promise.resolve(record),
      updateBody: () => Promise.resolve(null),
      deleteByAuthor: () => Promise.resolve(0),
    },
    pendingOutbounds: {
      insert: ({ id }) => Promise.resolve(id),
      findByFingerprint: () => Promise.resolve(null),
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
          sentAt: "2026-01-01T00:02:00.000Z",
          reconciledEventId: null,
          reconciledAt: null,
          failedReason: null,
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
});
