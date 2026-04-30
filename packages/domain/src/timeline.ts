import {
  timelineItemListSchema,
  type CampaignEmailTimelineItem,
  type CanonicalEventRecord,
  type GmailMessageDetailRecord,
  type SalesforceEventContextRecord,
  type SourceEvidenceRecord,
  type TimelineItem,
  type TimelineProjectionRow,
} from "@as-comms/contracts";

import { buildOutboundEmailDuplicateFingerprint } from "./outbound-email-dedup.js";
import type {
  InternalNoteRecord,
  Stage1RepositoryBundle,
} from "./repositories.js";
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
  readonly channel: "email" | "sms";
  readonly messageKind: "auto" | "campaign" | "one_to_one";
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
  readonly projectNameById: ReadonlyMap<string, string>;
  readonly expeditionNameById: ReadonlyMap<string, string>;
}

function getLifecycleMilestone(
  eventType: CanonicalEventRecord["eventType"],
):
  | "signed_up"
  | "received_training"
  | "completed_training"
  | "submitted_first_data" {
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

function resolveCommunicationMessageKind(input: {
  readonly event: CanonicalEventRecord;
  readonly salesforceCommunicationDetail: SalesforceCommunicationDetail | undefined;
}): TimelineProvenance["messageKind"] {
  const provenance = input.event.provenance as TimelineProvenance;
  const eventType = input.event.eventType as string;

  if (provenance.primaryProvider === "salesforce") {
    const expectedChannel = eventType.includes(".sms.")
      ? "sms"
      : eventType.includes(".email.")
        ? "email"
        : null;

    if (
      expectedChannel !== null &&
      input.salesforceCommunicationDetail?.channel === expectedChannel
    ) {
      return input.salesforceCommunicationDetail.messageKind;
    }
  }

  return provenance.messageKind;
}

function resolveFamily(
  event: CanonicalEventRecord,
  salesforceCommunicationDetail: SalesforceCommunicationDetail | undefined,
): TimelineItem["family"] {
  const eventType = event.eventType as string;
  const provenance = event.provenance as TimelineProvenance;
  const messageKind = resolveCommunicationMessageKind({
    event,
    salesforceCommunicationDetail,
  });

  if (eventType.startsWith("lifecycle.")) {
    return "salesforce_event";
  }

  if (eventType.startsWith("campaign.email.")) {
    return "campaign_email";
  }

  if (
    eventType === "communication.email.outbound" &&
    messageKind === "auto"
  ) {
    return "auto_email";
  }

  if (
    eventType === "communication.sms.outbound" &&
    messageKind === "auto"
  ) {
    return "auto_sms";
  }

  if (
    eventType === "communication.sms.outbound" &&
    messageKind === "campaign"
  ) {
    return "campaign_sms";
  }

  if (
    (eventType === "communication.email.inbound" ||
      eventType === "communication.email.outbound") &&
    (messageKind === "one_to_one" ||
      (messageKind === null &&
        (provenance.primaryProvider === "gmail" ||
          provenance.primaryProvider === "salesforce")))
  ) {
    return "one_to_one_email";
  }

  if (
    (eventType === "communication.sms.inbound" ||
      eventType === "communication.sms.outbound") &&
    (messageKind === "one_to_one" ||
      (messageKind === null &&
        (provenance.primaryProvider === "simpletexting" ||
          provenance.primaryProvider === "salesforce")))
  ) {
    return "one_to_one_sms";
  }

  throw new Error(
    `Canonical event ${event.id} (${event.eventType}) could not be resolved to a timeline family.`,
  );
}

function commonFields(
  row: TimelineProjectionRow,
): Omit<TimelineItem, "family"> & { family?: never } {
  return {
    id: row.id,
    contactId: row.contactId,
    canonicalEventId: row.canonicalEventId,
    occurredAt: row.occurredAt,
    sortKey: row.sortKey,
    reviewState: row.reviewState,
    primaryProvider: row.primaryProvider,
    summary: row.summary,
  } as Omit<TimelineItem, "family"> & { family?: never };
}

function buildPendingTimelineSortKey(id: string, attemptedAt: string): string {
  return `${attemptedAt}::pending-outbound:${id}`;
}

function isInternalNoteEvent(event: CanonicalEventRecord): boolean {
  return event.eventType === "note.internal.created";
}

function buildNoteCanonicalEventId(noteId: string): string {
  return `note:${noteId}`;
}

function buildNoteSortKey(note: InternalNoteRecord): string {
  return `${note.createdAt.toISOString()}::${buildNoteCanonicalEventId(note.id)}`;
}

function buildInternalNoteTimelineItems(
  notes: readonly InternalNoteRecord[],
): readonly TimelineItem[] {
  return timelineItemListSchema.parse(
    notes.map((note) => ({
      id: buildNoteCanonicalEventId(note.id),
      contactId: note.contactId,
      canonicalEventId: buildNoteCanonicalEventId(note.id),
      family: "internal_note" as const,
      occurredAt: note.createdAt.toISOString(),
      sortKey: buildNoteSortKey(note),
      reviewState: "clear" as const,
      primaryProvider: "manual" as const,
      summary: "Internal note added",
      noteId: note.id,
      body: note.body,
      authorDisplayName: note.authorDisplayName,
      authorId: note.authorId,
    })),
  );
}

function buildPendingTimelineItems(
  pendingRows: readonly PendingComposerOutboundRecord[],
): readonly TimelineItem[] {
  return timelineItemListSchema.parse(
    pendingRows.map((row) => ({
      id: `pending-outbound:${row.id}`,
      contactId: row.canonicalContactId,
      canonicalEventId: `pending-outbound:${row.id}`,
      family: "one_to_one_email" as const,
      occurredAt: row.attemptedAt,
      sortKey: buildPendingTimelineSortKey(row.id, row.attemptedAt),
      reviewState: "clear" as const,
      primaryProvider: "manual" as const,
      summary:
        row.subject.trim().length > 0 ? row.subject : "Outbound email pending",
      direction: "outbound" as const,
      subject: row.subject,
      fromHeader: null,
      toHeader: null,
      ccHeader: null,
      snippet: row.bodyPlaintext,
      bodyPreview: row.bodyPlaintext,
      mailbox: row.fromAlias,
      threadId: row.gmailThreadId,
      rfc822MessageId: null,
      inReplyToRfc822: row.inReplyToRfc822,
      sendStatus:
        row.status === "pending" ||
        row.status === "confirmed" ||
        row.status === "failed" ||
        row.status === "orphaned"
          ? row.status
          : null,
      failedReason: row.failedReason,
      failedDetail: row.failedDetail,
      attachmentCount: row.attachmentMetadata.length,
    })),
  );
}

interface CanonicalTimelineItemWithEvent {
  readonly item: TimelineItem;
  readonly canonicalEvent: CanonicalEventRecord;
}

const timelineDuplicateWindowMs = 5 * 60 * 1000;

function normalizeDuplicateText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.length === 0 ? null : normalized;
}

function firstNonEmptyDuplicateText(
  values: readonly (string | null | undefined)[]
): string {
  for (const value of values) {
    if (typeof value === "string" && normalizeDuplicateText(value) !== null) {
      return value;
    }
  }

  return "";
}

function timelineCampaignEmailDuplicateKey(
  item: TimelineItem,
): string | null {
  if (item.family !== "campaign_email") {
    return null;
  }

  return normalizeDuplicateText(item.campaignId);
}

function timelineSameDayGmailOutboundDuplicateKey(
  entry: CanonicalTimelineItemWithEvent,
): string | null {
  if (
    entry.item.family !== "one_to_one_email" ||
    entry.item.direction !== "outbound" ||
    entry.canonicalEvent.provenance.primaryProvider !== "gmail"
  ) {
    return null;
  }

  const threadId = normalizeDuplicateText(entry.item.threadId);
  const mailbox = normalizeDuplicateText(entry.item.mailbox);

  if (threadId === null || mailbox === null) {
    return null;
  }

  const fingerprint = buildOutboundEmailDuplicateFingerprint({
    subject: entry.item.subject,
    body: firstNonEmptyDuplicateText([
      entry.item.bodyPreview,
      entry.item.snippet,
      entry.item.summary,
    ]),
  });

  if (fingerprint === null) {
    return null;
  }

  return [
    "gmail-same-day",
    entry.canonicalEvent.contactId,
    threadId,
    mailbox,
    entry.canonicalEvent.occurredAt.slice(0, 10),
    fingerprint,
  ].join(":");
}

function isSameCampaignEmailDuplicate(
  left: CanonicalTimelineItemWithEvent,
  right: CanonicalTimelineItemWithEvent,
): boolean {
  const leftKey = timelineCampaignEmailDuplicateKey(left.item);
  const rightKey = timelineCampaignEmailDuplicateKey(right.item);

  return leftKey !== null && leftKey === rightKey;
}

function campaignEmailPresentationPriority(
  item: Extract<TimelineItem, { family: "campaign_email" }>,
): number {
  switch (item.activityType) {
    case "sent":
      return 4;
    case "opened":
      return 3;
    case "clicked":
      return 2;
    case "unsubscribed":
      return 1;
  }
}

function buildTimelineDuplicateSignature(item: TimelineItem): string | null {
  const parts = (() => {
    switch (item.family) {
      case "one_to_one_email":
        return [
          item.subject,
          item.bodyPreview,
          item.snippet,
          item.summary,
          item.mailbox,
        ];
      case "auto_email":
        return [item.subject, item.snippet, item.summary, item.sourceLabel];
      case "campaign_email":
        return [
          item.campaignName,
          item.activityType,
          item.snippet,
          item.summary,
        ];
      case "one_to_one_sms":
        return [item.messageTextPreview, item.summary, item.threadKey];
      case "auto_sms":
        return [item.messageTextPreview, item.summary, item.sourceLabel];
      case "campaign_sms":
        return [item.campaignName, item.messageTextPreview, item.summary];
      case "internal_note":
        return [item.body, item.noteId, item.summary];
      case "salesforce_event":
        return [item.milestone, item.projectName, item.expeditionName];
    }
  })()
    .map((value) => normalizeDuplicateText(value))
    .filter((value): value is string => value !== null);

  if (parts.length === 0) {
    return null;
  }

  return parts.join("|");
}

function buildTimelineDuplicateKeys(
  entry: CanonicalTimelineItemWithEvent,
): readonly string[] {
  const keys: string[] = [];
  const campaignDuplicateKey = timelineCampaignEmailDuplicateKey(entry.item);

  if (campaignDuplicateKey !== null) {
    keys.push(
      [
        "campaign",
        entry.canonicalEvent.contactId,
        entry.canonicalEvent.channel,
        campaignDuplicateKey,
      ].join(":"),
    );
  }

  const sameDayGmailDuplicateKey =
    timelineSameDayGmailOutboundDuplicateKey(entry);

  if (sameDayGmailDuplicateKey !== null) {
    keys.push(sameDayGmailDuplicateKey);
  }

  const fingerprint = normalizeDuplicateText(
    entry.canonicalEvent.contentFingerprint,
  );

  if (fingerprint !== null) {
    keys.push(
      [
        "fingerprint",
        entry.canonicalEvent.contactId,
        entry.canonicalEvent.eventType,
        entry.canonicalEvent.channel,
        fingerprint,
      ].join(":"),
    );
  }

  const signature = buildTimelineDuplicateSignature(entry.item);

  if (signature !== null) {
    keys.push(
      [
        "signature",
        entry.canonicalEvent.contactId,
        entry.canonicalEvent.eventType,
        entry.canonicalEvent.channel,
        signature,
      ].join(":"),
    );
  }

  return keys;
}

function timelineOccurredAtMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function timelinePresentationDuplicateWindowMs(
  left: CanonicalTimelineItemWithEvent,
  right: CanonicalTimelineItemWithEvent,
): number {
  if (left.item.family === "auto_email" && right.item.family === "auto_email") {
    // Auto-emails can legitimately repeat the same template minutes apart.
    return 30 * 1000;
  }

  return timelineDuplicateWindowMs;
}

function isTimelinePresentationDuplicate(
  left: CanonicalTimelineItemWithEvent,
  right: CanonicalTimelineItemWithEvent,
): boolean {
  if (
    left.canonicalEvent.contactId !== right.canonicalEvent.contactId ||
    left.canonicalEvent.channel !== right.canonicalEvent.channel
  ) {
    return false;
  }

  if (isSameCampaignEmailDuplicate(left, right)) {
    return true;
  }

  const leftSameDayGmailKey = timelineSameDayGmailOutboundDuplicateKey(left);
  const rightSameDayGmailKey = timelineSameDayGmailOutboundDuplicateKey(right);

  if (
    leftSameDayGmailKey !== null &&
    leftSameDayGmailKey === rightSameDayGmailKey
  ) {
    return true;
  }

  if (left.canonicalEvent.eventType !== right.canonicalEvent.eventType) {
    return false;
  }

  return (
    Math.abs(
      timelineOccurredAtMs(left.canonicalEvent.occurredAt) -
        timelineOccurredAtMs(right.canonicalEvent.occurredAt),
    ) <= timelinePresentationDuplicateWindowMs(left, right)
  );
}

function timelineFamilyPriority(item: TimelineItem): number {
  switch (item.family) {
    case "one_to_one_email":
    case "one_to_one_sms":
      return 3;
    case "auto_email":
    case "auto_sms":
      return 2;
    case "campaign_email":
    case "campaign_sms":
      return 1;
    case "internal_note":
    case "salesforce_event":
      return 0;
  }
}

function timelineProviderPriority(
  provider: CanonicalEventRecord["provenance"]["primaryProvider"],
): number {
  switch (provider) {
    case "gmail":
    case "simpletexting":
      return 3;
    case "mailchimp":
      return 2;
    case "salesforce":
      return 1;
    default:
      return 0;
  }
}

function timelineDetailRichness(item: TimelineItem): number {
  const values = (() => {
    switch (item.family) {
      case "one_to_one_email":
        return [
          item.subject,
          item.bodyPreview,
          item.snippet,
          item.mailbox,
          item.threadId,
        ];
      case "auto_email":
        return [item.subject, item.snippet, item.sourceLabel];
      case "campaign_email":
        return [item.campaignName, item.activityType, item.snippet];
      case "one_to_one_sms":
        return [item.messageTextPreview, item.threadKey];
      case "auto_sms":
        return [item.messageTextPreview, item.sourceLabel];
      case "campaign_sms":
        return [item.campaignName, item.messageTextPreview];
      case "internal_note":
        return [item.body, item.authorDisplayName];
      case "salesforce_event":
        return [item.projectName, item.expeditionName, item.sourceField];
    }
  })();

  return values.reduce(
    (score, value) =>
      normalizeDuplicateText(value) === null ? score : score + 1,
    0,
  );
}

function preferTimelineDuplicate(
  existing: CanonicalTimelineItemWithEvent,
  candidate: CanonicalTimelineItemWithEvent,
): CanonicalTimelineItemWithEvent {
  const familyDelta =
    timelineFamilyPriority(candidate.item) -
    timelineFamilyPriority(existing.item);

  if (familyDelta > 0) {
    return candidate;
  }

  if (familyDelta < 0) {
    return existing;
  }

  const providerDelta =
    timelineProviderPriority(candidate.canonicalEvent.provenance.primaryProvider) -
    timelineProviderPriority(existing.canonicalEvent.provenance.primaryProvider);

  if (providerDelta > 0) {
    return candidate;
  }

  if (providerDelta < 0) {
    return existing;
  }

  if (
    existing.item.family === "campaign_email" &&
    candidate.item.family === "campaign_email" &&
    isSameCampaignEmailDuplicate(existing, candidate)
  ) {
    const activityDelta =
      campaignEmailPresentationPriority(candidate.item) -
      campaignEmailPresentationPriority(existing.item);

    if (activityDelta > 0) {
      return candidate;
    }

    if (activityDelta < 0) {
      return existing;
    }
  }

  const detailDelta =
    timelineDetailRichness(candidate.item) -
    timelineDetailRichness(existing.item);

  if (detailDelta > 0) {
    return candidate;
  }

  return existing;
}

function collapseDuplicateTimelineItems(input: {
  readonly canonicalItems: readonly TimelineItem[];
  readonly canonicalEventById: ReadonlyMap<string, CanonicalEventRecord>;
}): readonly TimelineItem[] {
  const deduped: CanonicalTimelineItemWithEvent[] = [];
  const lastIndexByKey = new Map<string, number>();

  for (const item of input.canonicalItems) {
    const canonicalEvent = input.canonicalEventById.get(item.canonicalEventId);

    if (canonicalEvent === undefined) {
      continue;
    }

    const candidate = {
      item,
      canonicalEvent,
    } satisfies CanonicalTimelineItemWithEvent;
    const keys = buildTimelineDuplicateKeys(candidate);
    let merged = false;

    for (const key of keys) {
      const existingIndex = lastIndexByKey.get(key);

      if (existingIndex === undefined) {
        continue;
      }

      const existing = deduped[existingIndex];

      if (
        existing !== undefined &&
        isTimelinePresentationDuplicate(existing, candidate)
      ) {
        deduped[existingIndex] = preferTimelineDuplicate(existing, candidate);

        for (const candidateKey of keys) {
          lastIndexByKey.set(candidateKey, existingIndex);
        }

        merged = true;
        break;
      }
    }

    if (merged) {
      continue;
    }

    for (const key of keys) {
      lastIndexByKey.set(key, deduped.length);
    }

    deduped.push(candidate);
  }

  return timelineItemListSchema.parse(deduped.map((entry) => entry.item));
}

function mergeTimelineItems(input: {
  readonly canonicalItems: readonly TimelineItem[];
  readonly pendingRows: readonly PendingComposerOutboundRecord[];
}): readonly TimelineItem[] {
  // Keep unreconciled rows visible, but suppress pending rows once their
  // reconciled canonical event is present in the current page.
  const canonicalIds = new Set(
    input.canonicalItems.map((item) => item.canonicalEventId),
  );
  const filteredPending = input.pendingRows.filter(
    (row) =>
      row.reconciledEventId === null ||
      !canonicalIds.has(row.reconciledEventId),
  );
  return timelineItemListSchema.parse(
    [
      ...input.canonicalItems,
      ...buildPendingTimelineItems(filteredPending),
    ].sort((left, right) => left.sortKey.localeCompare(right.sortKey)),
  );
}

function isDisplayableCommunicationEvent(input: {
  readonly event: CanonicalEventRecord;
  readonly context: TimelinePresentationContext;
}): boolean {
  if (!input.event.eventType.startsWith("communication.")) {
    return false;
  }

  try {
    resolveFamily(
      input.event,
      input.context.salesforceCommunicationBySourceEvidenceId.get(
        input.event.sourceEvidenceId,
      ),
    );
    return true;
  } catch {
    return false;
  }
}

function warnTimelineProjectionGaps(input: {
  readonly contactId: string;
  readonly canonicalEvents: readonly CanonicalEventRecord[];
  readonly timelineRows: readonly TimelineProjectionRow[];
  readonly context: TimelinePresentationContext;
}): void {
  try {
    const projectedCanonicalEventIds = new Set(
      input.timelineRows.map((row) => row.canonicalEventId),
    );

    for (const event of input.canonicalEvents) {
      if (
        !isDisplayableCommunicationEvent({
          event,
          context: input.context,
        }) ||
        projectedCanonicalEventIds.has(event.id)
      ) {
        continue;
      }

      console.warn(
        "Timeline projection gap detected for canonical communication event.",
        {
          contactId: input.contactId,
          canonicalEventId: event.id,
          eventType: event.eventType,
          provider: event.provenance.primaryProvider,
          timestamp: event.occurredAt,
        },
      );
    }
  } catch {
    // Projection-gap diagnostics must never block timeline rendering.
  }
}

export interface Stage1TimelinePresentationService {
  listTimelineItemsByContactId(
    contactId: string,
  ): Promise<readonly TimelineItem[]>;
  listTimelineItemsPageByContactId(
    contactId: string,
    input: {
      readonly limit: number;
      readonly beforeSortKey: string | null;
    },
  ): Promise<{
    readonly items: readonly TimelineItem[];
    readonly hasMore: boolean;
    readonly nextBeforeSortKey: string | null;
    readonly total: number;
  }>;
  findLastInboundAliasForContact(contactId: string): Promise<string | null>;
}

function uniqueStrings(
  values: readonly (string | null | undefined)[],
): string[] {
  return Array.from(
    new Set(
      values.filter((value): value is string => typeof value === "string"),
    ),
  );
}

async function loadTimelinePresentationContext(
  repositories: Stage1RepositoryBundle,
  canonicalEvents: readonly CanonicalEventRecord[],
): Promise<TimelinePresentationContext> {
  const sourceEvidenceIds = uniqueStrings(
    canonicalEvents.map((event) => event.sourceEvidenceId),
  );
  const sourceEvidence =
    await repositories.sourceEvidence.listByIds(sourceEvidenceIds);
  const sourceEvidenceById = new Map(
    sourceEvidence.map((record) => [record.id, record]),
  );
  // Note: message attachments are loaded by the inbox selector layer in a
  // single batched query for the visible timeline page (see
  // `apps/web/app/inbox/_lib/selectors.ts`). We deliberately do NOT load them
  // here — this presentation context is built per timeline-presentation entry
  // point (full activity timeline + paged timeline), so loading attachments
  // here would duplicate the call. The view-model builder derives
  // `attachmentCount` from the selector-loaded attachments instead.
  const [
    gmailDetails,
    salesforceContexts,
    salesforceCommunicationDetails,
    simpleTextingMessageDetails,
    mailchimpCampaignActivityDetails,
  ] = (await Promise.all([
    repositories.gmailMessageDetails.listBySourceEvidenceIds(sourceEvidenceIds),
    repositories.salesforceEventContext.listBySourceEvidenceIds(
      sourceEvidenceIds,
    ),
    repositories.salesforceCommunicationDetails.listBySourceEvidenceIds(
      sourceEvidenceIds,
    ),
    repositories.simpleTextingMessageDetails.listBySourceEvidenceIds(
      sourceEvidenceIds,
    ),
    repositories.mailchimpCampaignActivityDetails.listBySourceEvidenceIds(
      sourceEvidenceIds,
    ),
  ])) as [
    readonly GmailMessageDetailRecord[],
    readonly SalesforceEventContextDetail[],
    readonly SalesforceCommunicationDetail[],
    readonly SimpleTextingMessageDetail[],
    readonly MailchimpCampaignActivityDetail[],
  ];

  const [projectDimensions, expeditionDimensions] = await Promise.all([
    repositories.projectDimensions.listByIds(
      uniqueStrings(salesforceContexts.map((context) => context.projectId)),
    ),
    repositories.expeditionDimensions.listByIds(
      uniqueStrings(salesforceContexts.map((context) => context.expeditionId)),
    ),
  ]);
  return {
    sourceEvidenceById,
    salesforceContextBySourceEvidenceId: new Map(
      salesforceContexts.map((detail) => [detail.sourceEvidenceId, detail]),
    ),
    gmailDetailBySourceEvidenceId: new Map(
      gmailDetails.map((detail) => [detail.sourceEvidenceId, detail]),
    ),
    salesforceCommunicationBySourceEvidenceId: new Map(
      salesforceCommunicationDetails.map((detail) => [
        detail.sourceEvidenceId,
        detail,
      ]),
    ),
    simpleTextingDetailBySourceEvidenceId: new Map(
      simpleTextingMessageDetails.map((detail) => [
        detail.sourceEvidenceId,
        detail,
      ]),
    ),
    mailchimpDetailBySourceEvidenceId: new Map(
      mailchimpCampaignActivityDetails.map((detail) => [
        detail.sourceEvidenceId,
        detail,
      ]),
    ),
    projectNameById: new Map(
      projectDimensions.map((dimension) => [
        dimension.projectId,
        dimension.projectAlias ?? dimension.projectName,
      ]),
    ),
    expeditionNameById: new Map(
      expeditionDimensions.map((dimension) => [
        dimension.expeditionId,
        dimension.expeditionName,
      ]),
    ),
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

    if (event === undefined || isInternalNoteEvent(event)) {
      continue;
    }

    const evidence = input.context.sourceEvidenceById.get(
      event.sourceEvidenceId,
    );

    if (evidence === undefined) {
      continue;
    }

    const salesforceCommunicationDetail =
      input.context.salesforceCommunicationBySourceEvidenceId.get(evidence.id);
    const family = resolveFamily(event, salesforceCommunicationDetail);
    const base = commonFields(row);
    const provenance = event.provenance as TimelineProvenance;
    const salesforceContext =
      input.context.salesforceContextBySourceEvidenceId.get(evidence.id);
    const gmailDetail = input.context.gmailDetailBySourceEvidenceId.get(
      evidence.id,
    );
    const simpleTextingDetail =
      input.context.simpleTextingDetailBySourceEvidenceId.get(evidence.id);
    const mailchimpDetail = input.context.mailchimpDetailBySourceEvidenceId.get(
      evidence.id,
    );

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
              : (input.context.projectNameById.get(
                  salesforceContext.projectId,
                ) ?? null),
          expeditionName:
            salesforceContext?.expeditionId === null ||
            salesforceContext?.expeditionId === undefined
              ? null
              : (input.context.expeditionNameById.get(
                  salesforceContext.expeditionId,
                ) ?? null),
          sourceField: salesforceContext?.sourceField ?? null,
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
            salesforceCommunicationDetail?.sourceLabel ?? "Salesforce Flow",
        });
        break;
      case "auto_sms":
        items.push({
          ...base,
          family,
          direction: "outbound",
          messageTextPreview: salesforceCommunicationDetail?.snippet ?? "",
          sourceLabel:
            salesforceCommunicationDetail?.sourceLabel ?? "Salesforce Flow",
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
              "",
            ) as CampaignEmailTimelineItem["activityType"]),
          campaignName: mailchimpDetail?.campaignName ?? null,
          campaignId: mailchimpDetail?.campaignId ?? null,
          audienceId: mailchimpDetail?.audienceId ?? null,
          snippet: mailchimpDetail?.snippet ?? "",
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
            null,
        });
        break;
      case "one_to_one_email":
        items.push({
          ...base,
          family,
          direction:
            gmailDetail?.direction ?? provenance.direction ?? "outbound",
          subject:
            gmailDetail?.subject ??
            salesforceCommunicationDetail?.subject ??
            null,
          fromHeader: gmailDetail?.fromHeader ?? null,
          toHeader: gmailDetail?.toHeader ?? null,
          ccHeader: gmailDetail?.ccHeader ?? null,
          snippet:
            gmailDetail?.snippetClean ??
            salesforceCommunicationDetail?.snippet ??
            "",
          bodyPreview: gmailDetail?.bodyTextPreview ?? null,
          mailbox:
            gmailDetail?.projectInboxAlias ??
            gmailDetail?.capturedMailbox ??
            null,
          threadId:
            gmailDetail?.gmailThreadId ??
            provenance.threadRef?.providerThreadId ??
            null,
          rfc822MessageId: gmailDetail?.rfc822MessageId ?? null,
          inReplyToRfc822: null,
          sendStatus: null,
          // attachmentCount is derived in the inbox selector view-model
          // layer from the (singly-batched) attachments load — see
          // `apps/web/app/inbox/_lib/selectors.ts:buildTimelineEntry`.
          attachmentCount: 0,
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
            null,
        });
        break;
    }
  }

  return timelineItemListSchema.parse(items);
}

export function createStage1TimelinePresentationService(
  repositories: Stage1RepositoryBundle,
): Stage1TimelinePresentationService {
  return {
    async listTimelineItemsByContactId(contactId) {
      const [canonicalEvents, timelineRows, pendingRows, internalNotes] =
        await Promise.all([
        repositories.canonicalEvents.listByContactId(contactId),
        repositories.timelineProjection.listByContactId(contactId),
        repositories.pendingOutbounds.findForContact(contactId, {
          limit: Number.MAX_SAFE_INTEGER,
        }),
          repositories.internalNotes.findByContactId(contactId),
        ]);
      const canonicalTimelineEvents = canonicalEvents.filter(
        (event) => !isInternalNoteEvent(event),
      );
      const canonicalEventById = new Map(
        canonicalTimelineEvents.map((event) => [event.id, event]),
      );
      const context = await loadTimelinePresentationContext(
        repositories,
        canonicalTimelineEvents,
      );
      const mergedCanonicalItems = collapseDuplicateTimelineItems({
        canonicalItems: buildTimelineItemsFromRows({
          timelineRows,
          canonicalEventById,
          context,
        }),
        canonicalEventById,
      });
      const canonicalItems = [...mergedCanonicalItems, ...buildInternalNoteTimelineItems(internalNotes)].sort(
        (left, right) => left.sortKey.localeCompare(right.sortKey),
      );

      return mergeTimelineItems({
        canonicalItems,
        pendingRows,
      });
    },

    async listTimelineItemsPageByContactId(contactId, input) {
      const [canonicalEvents, rows, pendingRows, internalNotes] =
        await Promise.all([
        repositories.canonicalEvents.listByContactId(contactId),
        repositories.timelineProjection.listByContactId(contactId),
        repositories.pendingOutbounds.findForContact(contactId, {
          limit: Number.MAX_SAFE_INTEGER,
        }),
          repositories.internalNotes.findByContactId(contactId),
        ]);
      const canonicalTimelineEvents = canonicalEvents.filter(
        (event) => !isInternalNoteEvent(event),
      );
      const canonicalEventById = new Map(
        canonicalTimelineEvents.map((event) => [event.id, event]),
      );
      const context = await loadTimelinePresentationContext(
        repositories,
        canonicalTimelineEvents,
      );
      warnTimelineProjectionGaps({
        contactId,
        canonicalEvents: canonicalTimelineEvents,
        timelineRows: rows,
        context,
      });
      const mergedCanonicalItems = collapseDuplicateTimelineItems({
        canonicalItems: buildTimelineItemsFromRows({
          timelineRows: rows,
          canonicalEventById,
          context,
        }),
        canonicalEventById,
      });
      const canonicalItems = [...mergedCanonicalItems, ...buildInternalNoteTimelineItems(internalNotes)].sort(
        (left, right) => left.sortKey.localeCompare(right.sortKey),
      );
      const mergedItems = mergeTimelineItems({
        canonicalItems,
        pendingRows,
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
        total: mergedItems.length,
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
            inboundEmailEvents.map((event) => event.sourceEvidenceId),
          ),
        );
      const aliasBySourceEvidenceId = new Map(
        gmailDetails.map((detail) => [
          detail.sourceEvidenceId,
          detail.projectInboxAlias,
        ]),
      );

      for (const event of inboundEmailEvents) {
        const alias = aliasBySourceEvidenceId.get(event.sourceEvidenceId);

        if (typeof alias === "string" && alias.trim().length > 0) {
          return alias;
        }
      }

      return null;
    },
  };
}
