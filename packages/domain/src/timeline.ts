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

export interface Stage1TimelinePresentationService {
  listTimelineItemsByContactId(contactId: string): Promise<readonly TimelineItem[]>;
}

export function createStage1TimelinePresentationService(
  repositories: Stage1RepositoryBundle
): Stage1TimelinePresentationService {
  return {
    async listTimelineItemsByContactId(contactId) {
      const [canonicalEvents, timelineRows] = await Promise.all([
        repositories.canonicalEvents.listByContactId(contactId),
        repositories.timelineProjection.listByContactId(contactId)
      ]);
      const canonicalEventById = new Map(
        canonicalEvents.map((event) => [event.id, event])
      );
      const sourceEvidence = (
        await Promise.all(
          canonicalEvents.map((event) =>
            repositories.sourceEvidence.findById(event.sourceEvidenceId)
          )
        )
      ).filter((record): record is SourceEvidenceRecord => record !== null);
      const sourceEvidenceById = new Map(
        sourceEvidence.map((record) => [record.id, record])
      );
      const sourceEvidenceIds = sourceEvidence.map((record) => record.id);
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

      const salesforceContextBySourceEvidenceId = new Map(
        salesforceContexts.map((detail) => [detail.sourceEvidenceId, detail])
      );
      const gmailDetailBySourceEvidenceId = new Map(
        gmailDetails.map((detail) => [detail.sourceEvidenceId, detail])
      );
      const salesforceCommunicationBySourceEvidenceId = new Map(
        salesforceCommunicationDetails.map((detail) => [
          detail.sourceEvidenceId,
          detail
        ])
      );
      const simpleTextingDetailBySourceEvidenceId = new Map(
        simpleTextingMessageDetails.map((detail) => [detail.sourceEvidenceId, detail])
      );
      const mailchimpDetailBySourceEvidenceId = new Map(
        mailchimpCampaignActivityDetails.map((detail) => [
          detail.sourceEvidenceId,
          detail
        ])
      );
      const manualNoteDetailBySourceEvidenceId = new Map(
        manualNoteDetails.map((detail) => [detail.sourceEvidenceId, detail])
      );
      const [projectDimensions, expeditionDimensions] = await Promise.all([
        repositories.projectDimensions.listByIds(
          Array.from(
            new Set(
              salesforceContexts
                .map((context) => context.projectId)
                .filter((value): value is string => value !== null)
            )
          )
        ),
        repositories.expeditionDimensions.listByIds(
          Array.from(
            new Set(
              salesforceContexts
                .map((context) => context.expeditionId)
                .filter((value): value is string => value !== null)
            )
          )
        )
      ]);
      const projectNameById = new Map(
        projectDimensions.map((dimension) => [
          dimension.projectId,
          dimension.projectName
        ])
      );
      const expeditionNameById = new Map(
        expeditionDimensions.map((dimension) => [
          dimension.expeditionId,
          dimension.expeditionName
        ])
      );

      const items: TimelineItem[] = [];

      for (const row of timelineRows) {
        const event = canonicalEventById.get(row.canonicalEventId);

        if (event === undefined) {
          continue;
        }

        const evidence = sourceEvidenceById.get(event.sourceEvidenceId);

        if (evidence === undefined) {
          continue;
        }

        const family = resolveFamily(event);
        const base = commonFields(row);
        const provenance = event.provenance as TimelineProvenance;
        const salesforceContext = salesforceContextBySourceEvidenceId.get(evidence.id);
        const gmailDetail = gmailDetailBySourceEvidenceId.get(evidence.id);
        const salesforceCommunicationDetail =
          salesforceCommunicationBySourceEvidenceId.get(evidence.id);
        const simpleTextingDetail = simpleTextingDetailBySourceEvidenceId.get(
          evidence.id
        );
        const mailchimpDetail = mailchimpDetailBySourceEvidenceId.get(evidence.id);
        const manualNoteDetail = manualNoteDetailBySourceEvidenceId.get(evidence.id);

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
                  : (projectNameById.get(salesforceContext.projectId) ?? null),
              expeditionName:
                salesforceContext?.expeditionId === null ||
                salesforceContext?.expeditionId === undefined
                  ? null
                  : (expeditionNameById.get(salesforceContext.expeditionId) ?? null),
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
          case "campaign_email":
            items.push({
              ...base,
              family,
              activityType:
                mailchimpDetail?.activityType ??
                (event.eventType.replace("campaign.email.", "") as CampaignEmailTimelineItem["activityType"]),
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
              direction:
                gmailDetail?.direction ?? provenance.direction ?? "outbound",
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
                null
            });
            break;
          case "one_to_one_sms":
            items.push({
              ...base,
              family,
              direction:
                simpleTextingDetail?.direction ??
                provenance.direction ??
                "outbound",
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
  };
}
