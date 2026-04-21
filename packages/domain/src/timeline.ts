import {
  timelineItemListSchema,
  type CampaignEmailTimelineItem,
  type CanonicalEventRecord,
  type GmailMessageDetailRecord,
  type SalesforceEventContextRecord,
  type SourceEvidenceRecord,
  type TimelineItem,
  type TimelineProjectionRow
} from "@as-comms/contracts";

import type { Stage1RepositoryBundle } from "./repositories.js";
import type { PendingComposerOutboundRecord } from "./pending-outbounds.js";

type TimelineProvenance = CanonicalEventRecord["provenance"] & {
  readonly messageKind?: "auto" | "campaign" | "one_to_one" | null;
  readonly campaignRef?: {
    readonly providerMessageName: string | null;
    readonly providerCampaignId: string | null;
  } | null;
  readonly threadRef?: {
    readonly providerThreadId: string | null;
    readonly crossProviderCollapseKey: string | null;
  } | null;
  readonly direction?: "inbound" | "outbound" | null;
};

type SalesforceEventContextDetail = SalesforceEventContextRecord & {
  readonly sourceField?: string | null;
};

interface SalesforceCommunicationDetail {
  readonly sourceEvidenceId: string;
  readonly subject: string | null;
  readonly snippet: string;
  readonly sourceLabel: string;
}

interface SimpleTextingMessageDetail {
  readonly sourceEvidenceId: string;
  readonly direction: "inbound" | "outbound";
  readonly messageTextPreview: string;
  readonly campaignName: string | null;
  readonly campaignId: string | null;
  readonly normalizedPhone: string | null;
  readonly threadKey: string | null;
}

interface MailchimpCampaignActivityDetail {
  readonly sourceEvidenceId: string;
  readonly activityType: CampaignEmailTimelineItem["activityType"];
  readonly campaignName: string | null;
  readonly campaignId: string | null;
  readonly audienceId: string | null;
  readonly snippet: string;
}

interface ManualNoteDetail {
  readonly sourceEvidenceId: string;
  readonly body: string;
  readonly authorDisplayName: string | null;
}

interface TimelinePresentationContext {
  readonly sourceEvidenceById: ReadonlyMap<string, SourceEvidenceRecord>;
  readonly salesforceContextBySourceEvidenceId: ReadonlyMap<
    string,
    SalesforceEventContextDetail
  >;
  readonly gmailDetailBySourceEvidenceId: ReadonlyMap<
    string,
    GmailMessageDetailRecord
  >;
  readonly salesforceCommunicationBySourceEvidenceId: ReadonlyMap<
    string,
    SalesforceCommunicationDetail
  >;
  readonly simpleTextingDetailBySourceEvidenceId: ReadonlyMap<
    string,
    SimpleTextingMessageDetail
  >;
  readonly mailchimpDetailBySourceEvidenceId: ReadonlyMap<
    string,
    MailchimpCampaignActivityDetail
  >;
  readonly manualNoteDetailBySourceEvidenceId: ReadonlyMap<string, ManualNoteDetail>;
  readonly projectNameById: ReadonlyMap<string, string>;
  readonly expeditionNameById: ReadonlyMap<string, string>;
}

function getLifecycleMilestone(
  eventType: CanonicalEventRecord["eventType"]
): "signed_up" | "received_training" | "completed_training" | "submitted_first_data" {
  switch (eventType) {
    case "lifecycle.signed_up":
      return "signed_up";
    case "lifecycle.received_training":
      return "received_training";
    case "lifecycle.completed_training":
      return "completed_training";
    case "lifecycle.submitted_first_data":
      return "submitted_first_data";
    default:
      throw new Error(`Unsupported lifecycle event type ${eventType}.`);
  }
}

function resolveFamily(event: CanonicalEventRecord): TimelineItem["family"] {
  const eventType = event.eventType as string;
  const provenance = event.provenance as TimelineProvenance;

  if (eventType.startsWith("lifecycle.")) {
    return "salesforce_event";
  }

  if (eventType === "note.internal.created") {
    return "internal_note";
  }

  if (eventType.startsWith("campaign.email.")) {
    return "campaign_email";
  }

  if (
    eventType === "communication.email.outbound" &&
    provenance.messageKind === "auto"
  ) {
    return "auto_email";
  }

  if (
    eventType === "communication.sms.outbound" &&
    provenance.messageKind === "auto"
  ) {
    return "auto_sms";
  }

  if (
    eventType === "communication.sms.outbound" &&
    provenance.messageKind === "campaign"
  ) {
    return "campaign_sms";
  }

  if (
    (eventType === "communication.email.inbound" ||
      eventType === "communication.email.outbound") &&
    (provenance.messageKind === "one_to_one" ||
      (provenance.messageKind === null &&
        (provenance.primaryProvider === "gmail" ||
          provenance.primaryProvider === "salesforce")))
  ) {
    return "one_to_one_email";
  }

  if (
    (eventType === "communication.sms.inbound" ||
      eventType === "communication.sms.outbound") &&
    (provenance.messageKind === "one_to_one" ||
      (provenance.messageKind === null &&
        (provenance.primaryProvider === "simpletexting" ||
          provenance.primaryProvider === "salesforce")))
  ) {
    return "one_to_one_sms";
  }

  throw new Error(
    `Canonical event ${event.id} (${event.eventType}) could not be resolved to a timeline family.`
  );
}

function commonFields(
  row: TimelineProjectionRow
): Omit<TimelineItem, "family"> & { family?: never } {
  return {
    id: row.id,
    contactId: row.contactId,
    canonicalEventId: row.canonicalEventId,
    occurredAt: row.occurredAt,
    sortKey: row.sortKey,
    reviewState: row.reviewState,
    primaryProvider: row.primaryProvider,
    summary: row.summary
  } as Omit<TimelineItem, "family"> & { family?: never };
}

function buildPendingTimelineSortKey(id: string, sentAt: string): string {
  return `${sentAt}::pending-outbound:${id}`;
}

function buildPendingTimelineItems(
  pendingRows: readonly PendingComposerOutboundRecord[]
): readonly TimelineItem[] {
  return timelineItemListSchema.parse(
    pendingRows.map((row) => ({
      id: `pending-outbound:${row.id}`,
      contactId: row.canonicalContactId,
      canonicalEventId: `pending-outbound:${row.id}`,
      family: "one_to_one_email" as const,
      occurredAt: row.sentAt,
      sortKey: buildPendingTimelineSortKey(row.id, row.sentAt),
      reviewState: "clear" as const,
      primaryProvider: "manual" as const,
      summary:
        row.subject.trim().length > 0 ? row.subject : "Outbound email pending",
      direction: "outbound" as const,
      subject: row.subject,
      snippet: row.bodyPlaintext,
      bodyPreview: row.bodyPlaintext,
      mailbox: row.fromAlias,
      threadId: row.gmailThreadId,
      rfc822MessageId: null,
      inReplyToRfc822: row.inReplyToRfc822,
      sendStatus:
        row.status === "pending" ||
        row.status === "failed" ||
        row.status === "orphaned"
          ? row.status
          : null,
      attachmentCount: row.attachmentMetadata.length,
    }))
  );
}

function mergeTimelineItems(input: {
  readonly canonicalItems: readonly TimelineItem[];
  readonly pendingRows: readonly PendingComposerOutboundRecord[];
}): readonly TimelineItem[] {
  return timelineItemListSchema.parse(
    [...input.canonicalItems, ...buildPendingTimelineItems(input.pendingRows)].sort(
      (left, right) => left.sortKey.localeCompare(right.sortKey)
    )
  );
}

export interface Stage1TimelinePresentationService {
  listTimelineItemsByContactId(contactId: string): Promise<readonly TimelineItem[]>;
  listTimelineItemsPageByContactId(
    contactId: string,
    input: {
      readonly limit: number;
      readonly beforeSortKey: string | null;
    }
  ): Promise<{
    readonly items: readonly TimelineItem[];
    readonly hasMore: boolean;
    readonly nextBeforeSortKey: string | null;
    readonly total: number;
  }>;
  findLastInboundAliasForContact(contactId: string): Promise<string | null>;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return Array.from(
    new Set(
      values.filter((value): value is string => typeof value === "string")
    )
  );
}

async function loadTimelinePresentationContext(
  repositories: Stage1RepositoryBundle,
  canonicalEvents: readonly CanonicalEventRecord[]
): Promise<TimelinePresentationContext> {
  const sourceEvidenceIds = uniqueStrings(
    canonicalEvents.map((event) => event.sourceEvidenceId)
  );
  const sourceEvidence = await repositories.sourceEvidence.listByIds(sourceEvidenceIds);
  const sourceEvidenceById = new Map(
    sourceEvidence.map((record) => [record.id, record])
  );
  const [
    gmailDetails,
    salesforceContexts,
    salesforceCommunicationDetails,
    simpleTextingMessageDetails,
    mailchimpCampaignActivityDetails,
    manualNoteDetails
  ] = (await Promise.all([
    repositories.gmailMessageDetails.listBySourceEvidenceIds(sourceEvidenceIds),
    repositories.salesforceEventContext.listBySourceEvidenceIds(sourceEvidenceIds),
    repositories.salesforceCommunicationDetails.listBySourceEvidenceIds(
      sourceEvidenceIds
    ),
    repositories.simpleTextingMessageDetails.listBySourceEvidenceIds(
      sourceEvidenceIds
    ),
    repositories.mailchimpCampaignActivityDetails.listBySourceEvidenceIds(
      sourceEvidenceIds
    ),
    repositories.manualNoteDetails.listBySourceEvidenceIds(sourceEvidenceIds)
  ])) as [
    readonly GmailMessageDetailRecord[],
    readonly SalesforceEventContextDetail[],
    readonly SalesforceCommunicationDetail[],
    readonly SimpleTextingMessageDetail[],
    readonly MailchimpCampaignActivityDetail[],
    readonly ManualNoteDetail[]
  ];

  const [projectDimensions, expeditionDimensions] = await Promise.all([
    repositories.projectDimensions.listByIds(
      uniqueStrings(salesforceContexts.map((context) => context.projectId))
    ),
    repositories.expeditionDimensions.listByIds(
      uniqueStrings(salesforceContexts.map((context) => context.expeditionId))
    )
  ]);

  return {
    sourceEvidenceById,
    salesforceContextBySourceEvidenceId: new Map(
      salesforceContexts.map((detail) => [detail.sourceEvidenceId, detail])
    ),
    gmailDetailBySourceEvidenceId: new Map(
      gmailDetails.map((detail) => [detail.sourceEvidenceId, detail])
    ),
    salesforceCommunicationBySourceEvidenceId: new Map(
      salesforceCommunicationDetails.map((detail) => [
        detail.sourceEvidenceId,
        detail
      ])
    ),
    simpleTextingDetailBySourceEvidenceId: new Map(
      simpleTextingMessageDetails.map((detail) => [detail.sourceEvidenceId, detail])
    ),
    mailchimpDetailBySourceEvidenceId: new Map(
      mailchimpCampaignActivityDetails.map((detail) => [
        detail.sourceEvidenceId,
        detail
      ])
    ),
    manualNoteDetailBySourceEvidenceId: new Map(
      manualNoteDetails.map((detail) => [detail.sourceEvidenceId, detail])
    ),
    projectNameById: new Map(
      projectDimensions.map((dimension) => [
        dimension.projectId,
        dimension.projectName
      ])
    ),
    expeditionNameById: new Map(
      expeditionDimensions.map((dimension) => [
        dimension.expeditionId,
        dimension.expeditionName
      ])
    )
  };
}

function buildTimelineItemsFromRows(input: {
  readonly timelineRows: readonly TimelineProjectionRow[];
  readonly canonicalEventById: ReadonlyMap<string, CanonicalEventRecord>;
  readonly context: TimelinePresentationContext;
}): readonly TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const row of input.timelineRows) {
    const event = input.canonicalEventById.get(row.canonicalEventId);

    if (event === undefined) {
      continue;
    }

    const evidence = input.context.sourceEvidenceById.get(event.sourceEvidenceId);

    if (evidence === undefined) {
      continue;
    }

    const family = resolveFamily(event);
    const base = commonFields(row);
    const provenance = event.provenance as TimelineProvenance;
    const salesforceContext =
      input.context.salesforceContextBySourceEvidenceId.get(evidence.id);
    const gmailDetail = input.context.gmailDetailBySourceEvidenceId.get(evidence.id);
    const salesforceCommunicationDetail =
      input.context.salesforceCommunicationBySourceEvidenceId.get(evidence.id);
    const simpleTextingDetail =
      input.context.simpleTextingDetailBySourceEvidenceId.get(evidence.id);
    const mailchimpDetail =
      input.context.mailchimpDetailBySourceEvidenceId.get(evidence.id);
    const manualNoteDetail =
      input.context.manualNoteDetailBySourceEvidenceId.get(evidence.id);

    switch (family) {
      case "salesforce_event":
        items.push({
          ...base,
          family,
          milestone: getLifecycleMilestone(event.eventType),
          projectName:
            salesforceContext?.projectId === null ||
            salesforceContext?.projectId === undefined
              ? null
              : (input.context.projectNameById.get(salesforceContext.projectId) ??
                null),
          expeditionName:
            salesforceContext?.expeditionId === null ||
            salesforceContext?.expeditionId === undefined
              ? null
              : (input.context.expeditionNameById.get(
                  salesforceContext.expeditionId
                ) ?? null),
          sourceField: salesforceContext?.sourceField ?? null
        });
        break;
      case "auto_email":
        items.push({
          ...base,
          family,
          direction: "outbound",
          subject: salesforceCommunicationDetail?.subject ?? null,
          snippet: salesforceCommunicationDetail?.snippet ?? "",
          sourceLabel:
            salesforceCommunicationDetail?.sourceLabel ?? "Salesforce Flow"
        });
        break;
      case "auto_sms":
        items.push({
          ...base,
          family,
          direction: "outbound",
          messageTextPreview: salesforceCommunicationDetail?.snippet ?? "",
          sourceLabel:
            salesforceCommunicationDetail?.sourceLabel ?? "Salesforce Flow"
        });
        break;
      case "campaign_email":
        items.push({
          ...base,
          family,
          activityType:
            mailchimpDetail?.activityType ??
            (event.eventType.replace(
              "campaign.email.",
              ""
            ) as CampaignEmailTimelineItem["activityType"]),
          campaignName: mailchimpDetail?.campaignName ?? null,
          campaignId: mailchimpDetail?.campaignId ?? null,
          audienceId: mailchimpDetail?.audienceId ?? null,
          snippet: mailchimpDetail?.snippet ?? ""
        });
        break;
      case "campaign_sms":
        items.push({
          ...base,
          family,
          direction: "outbound",
          messageTextPreview: simpleTextingDetail?.messageTextPreview ?? "",
          campaignName:
            simpleTextingDetail?.campaignName ??
            provenance.campaignRef?.providerMessageName ??
            null,
          campaignId:
            simpleTextingDetail?.campaignId ??
            provenance.campaignRef?.providerCampaignId ??
            null
        });
        break;
      case "one_to_one_email":
        items.push({
          ...base,
          family,
          direction: gmailDetail?.direction ?? provenance.direction ?? "outbound",
          subject:
            gmailDetail?.subject ?? salesforceCommunicationDetail?.subject ?? null,
          snippet:
            gmailDetail?.snippetClean ?? salesforceCommunicationDetail?.snippet ?? "",
          bodyPreview: gmailDetail?.bodyTextPreview ?? null,
          mailbox:
            gmailDetail?.projectInboxAlias ?? gmailDetail?.capturedMailbox ?? null,
          threadId:
            gmailDetail?.gmailThreadId ??
            provenance.threadRef?.providerThreadId ??
            null,
          rfc822MessageId: gmailDetail?.rfc822MessageId ?? null,
          inReplyToRfc822: null,
          sendStatus: null,
          attachmentCount: 0
        });
        break;
      case "one_to_one_sms":
        items.push({
          ...base,
          family,
          direction:
            simpleTextingDetail?.direction ?? provenance.direction ?? "outbound",
          messageTextPreview:
            simpleTextingDetail?.messageTextPreview ??
            salesforceCommunicationDetail?.snippet ??
            "",
          phone: simpleTextingDetail?.normalizedPhone ?? null,
          threadKey:
            simpleTextingDetail?.threadKey ??
            provenance.threadRef?.crossProviderCollapseKey ??
            null
        });
        break;
      case "internal_note":
        items.push({
          ...base,
          family,
          body: manualNoteDetail?.body ?? "",
          authorDisplayName: manualNoteDetail?.authorDisplayName ?? null
        });
        break;
    }
  }

  return timelineItemListSchema.parse(items);
}

export function createStage1TimelinePresentationService(
  repositories: Stage1RepositoryBundle
): Stage1TimelinePresentationService {
  return {
    async listTimelineItemsByContactId(contactId) {
      const [canonicalEvents, timelineRows, pendingRows] = await Promise.all([
        repositories.canonicalEvents.listByContactId(contactId),
        repositories.timelineProjection.listByContactId(contactId),
        repositories.pendingOutbounds.findForContact(contactId, {
          limit: Number.MAX_SAFE_INTEGER
        })
      ]);
      const canonicalEventById = new Map(
        canonicalEvents.map((event) => [event.id, event])
      );
      const context = await loadTimelinePresentationContext(
        repositories,
        canonicalEvents
      );

      return mergeTimelineItems({
        canonicalItems: buildTimelineItemsFromRows({
          timelineRows,
          canonicalEventById,
          context
        }),
        pendingRows
      });
    },

    async listTimelineItemsPageByContactId(contactId, input) {
      const [canonicalEvents, rows, pendingRows] = await Promise.all([
        repositories.canonicalEvents.listByContactId(contactId),
        repositories.timelineProjection.listByContactId(contactId),
        repositories.pendingOutbounds.findForContact(contactId, {
          limit: Number.MAX_SAFE_INTEGER
        })
      ]);
      const canonicalEventById = new Map(
        canonicalEvents.map((event) => [event.id, event])
      );
      const context = await loadTimelinePresentationContext(
        repositories,
        canonicalEvents
      );
      const mergedItems = mergeTimelineItems({
        canonicalItems: buildTimelineItemsFromRows({
          timelineRows: rows,
          canonicalEventById,
          context
        }),
        pendingRows
      });
      const beforeSortKey = input.beforeSortKey;
      const filteredItems =
        beforeSortKey === null
          ? mergedItems
          : mergedItems.filter((item) => item.sortKey < beforeSortKey);
      const filteredDescending = [...filteredItems].reverse();
      const hasMore = filteredDescending.length > input.limit;
      const pageItemsDescending = hasMore
        ? filteredDescending.slice(0, input.limit)
        : filteredDescending;
      const pageItems = [...pageItemsDescending].reverse();

      return {
        items: pageItems,
        hasMore,
        nextBeforeSortKey:
          pageItemsDescending[pageItemsDescending.length - 1]?.sortKey ?? null,
        total: mergedItems.length
      };
    },

    async findLastInboundAliasForContact(contactId) {
      const canonicalEvents =
        await repositories.canonicalEvents.listByContactId(contactId);
      const inboundEmailEvents = canonicalEvents
        .filter((event) => event.eventType === "communication.email.inbound")
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

      if (inboundEmailEvents.length === 0) {
        return null;
      }

      const gmailDetails =
        await repositories.gmailMessageDetails.listBySourceEvidenceIds(
          uniqueStrings(
            inboundEmailEvents.map((event) => event.sourceEvidenceId)
          )
        );
      const aliasBySourceEvidenceId = new Map(
        gmailDetails.map((detail) => [
          detail.sourceEvidenceId,
          detail.projectInboxAlias
        ])
      );

      for (const event of inboundEmailEvents) {
        const alias = aliasBySourceEvidenceId.get(event.sourceEvidenceId);

        if (typeof alias === "string" && alias.trim().length > 0) {
          return alias;
        }
      }

      return null;
    }
  };
}
