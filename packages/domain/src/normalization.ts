import {
  canonicalEventSchema,
  contactIdentitySchema,
  contactMembershipSchema,
  contactSchema,
  expeditionDimensionSchema,
  gmailMessageDetailSchema,
  identityAmbiguityInputSchema,
  identityResolutionReasonCodeValues,
  inboxProjectionApplyInputSchema,
  inboxReviewOverlayRefreshInputSchema,
  normalizedCanonicalEventIntakeSchema,
  normalizedContactGraphUpsertInputSchema,
  normalizedSourceEvidenceIntakeSchema,
  projectDimensionSchema,
  resolveCanonicalChannel,
  routingAmbiguityInputSchema,
  routingReviewReasonCodeValues,
  mailchimpCampaignActivityDetailSchema,
  manualNoteDetailSchema,
  salesforceCommunicationDetailSchema,
  salesforceEventContextSchema,
  simpleTextingMessageDetailSchema,
  syncStateUpdateInputSchema,
  timelineProjectionApplyInputSchema,
  type AuditEvidenceRecord,
  type CanonicalEventRecord,
  type ContactIdentityKind,
  type ContactIdentityRecord,
  type ContactMembershipRecord,
  type ContactRecord,
  type ExpeditionDimensionRecord,
  type GmailMessageDetailRecord,
  type IdentityAmbiguityInput,
  type IdentityResolutionCase,
  type InboxDrivingEventType,
  type InboxProjectionApplyInput,
  type InboxProjectionRow,
  type InboxReviewOverlayRefreshInput,
  type NormalizedCanonicalEventIntake,
  type NormalizedContactGraphUpsertInput,
  type NormalizedIdentityEvidence,
  type ProjectDimensionRecord,
  type NormalizedSourceEvidenceIntake,
  type Provider,
  type ProvenanceWinnerReason,
  type QuarantineReasonCode,
  type RoutingAmbiguityInput,
  type RoutingReviewCase,
  type SalesforceCommunicationDetailRecord,
  type SimpleTextingMessageDetailRecord,
  type SourceEvidenceRecord,
  type SyncStateRecord,
  type SyncStateUpdateInput,
  type TimelineProjectionApplyInput,
  type TimelineProjectionRow
} from "@as-comms/contracts";

import {
  isInboxDrivingCanonicalEvent
} from "./inbox-driving.js";
import {
  buildIncomingContentFingerprintSource,
  buildIncomingOutboundEmailFingerprintSource,
  buildOutboundEmailDuplicateFingerprint,
  computeContentFingerprint,
  computeSalesforceSnippetClusterFingerprint,
  isWithinContentFingerprintWindow,
  buildPersistedOutboundEmailFingerprintSource,
  isWithinOutboundEmailFingerprintWindow,
  resolveOutboundEmailMergedWinnerDecision,
  salesforceSnippetClusterWindowMs,
  selectOutboundEmailDuplicateWinner,
  selectSalesforceSelfDuplicateWinner
} from "./outbound-email-dedup.js";
import type { Stage1PersistenceService } from "./persistence.js";

type ContactLookupMap = ReadonlyMap<string, ContactRecord>;

interface IdentityResolutionContext {
  loadContactsForIdentityKind(
    kind: ContactIdentityKind,
    values: readonly string[]
  ): Promise<ContactLookupMap>;
  findAnchoredContact(salesforceContactId: string): Promise<ContactRecord | null>;
  clear(): void;
}

interface WinnerDecision {
  readonly winnerReason: ProvenanceWinnerReason;
  readonly notes: string | null;
}

export class CanonicalContactAmbiguityError extends Error {
  readonly normalizedEmail: string;
  readonly candidateContactIds: readonly string[];

  constructor(input: {
    readonly normalizedEmail: string;
    readonly candidateContactIds: readonly string[];
  }) {
    super(
      `Normalized email ${input.normalizedEmail} maps to multiple contacts.`
    );
    this.name = "CanonicalContactAmbiguityError";
    this.normalizedEmail = input.normalizedEmail;
    this.candidateContactIds = input.candidateContactIds;
  }
}

interface ProviderDetailMaps {
  readonly gmailMessageDetailBySourceEvidenceId: ReadonlyMap<
    string,
    GmailMessageDetailRecord
  >;
  readonly salesforceCommunicationDetailBySourceEvidenceId: ReadonlyMap<
    string,
    SalesforceCommunicationDetailRecord
  >;
  readonly simpleTextingMessageDetailBySourceEvidenceId: ReadonlyMap<
    string,
    SimpleTextingMessageDetailRecord
  >;
}

interface OutboundEmailDuplicateMatch {
  readonly existingEvent: CanonicalEventRecord;
  readonly existingTimelineProjection: TimelineProjectionRow | null;
  readonly winner: WinnerDecision & {
    readonly keepIncomingAsPrimary: boolean;
  };
}

type DuplicateCollapseDecision =
  | {
      readonly outcome: "accepted";
      readonly winner: WinnerDecision;
    }
  | {
      readonly outcome: "quarantined";
      readonly reasonCode: "duplicate_collapse_conflict";
      readonly explanation: string;
    };

type IdentityResolutionDecision =
  | {
      readonly outcome: "resolved";
      readonly contact: ContactRecord;
      readonly reviewInput: IdentityAmbiguityInput | null;
    }
  | {
      readonly outcome: "create_new_contact";
      readonly normalizedEmail: string | null;
      readonly normalizedPhone: string | null;
    }
  | {
      readonly outcome: "needs_identity_review";
      readonly reviewInput: IdentityAmbiguityInput;
    };

type RoutingResolutionDecision =
  | {
      readonly outcome: "clear";
      readonly reviewInput: null;
    }
  | {
      readonly outcome: "needs_routing_review";
      readonly reviewInput: RoutingAmbiguityInput;
    };

export type NormalizedSourceEvidenceResult =
  | {
      readonly outcome: "inserted" | "duplicate";
      readonly record: SourceEvidenceRecord;
      readonly auditEvidence: null;
    }
  | {
      readonly outcome: "quarantined";
      readonly incoming: SourceEvidenceRecord;
      readonly conflictingRecords: readonly SourceEvidenceRecord[];
      readonly reasonCode: "replay_checksum_mismatch";
      readonly auditEvidence: AuditEvidenceRecord;
    };

export interface NormalizedContactGraphResult {
  readonly contact: ContactRecord;
  readonly identities: readonly ContactIdentityRecord[];
  readonly memberships: readonly ContactMembershipRecord[];
}

export interface ReviewCaseSaveResult<TCase> {
  readonly caseRecord: TCase;
  readonly inboxProjection: InboxProjectionRow | null;
}

export type NormalizedCanonicalEventResult =
  | {
      readonly outcome: "applied" | "duplicate";
      readonly sourceEvidence: SourceEvidenceRecord;
      readonly canonicalEvent: CanonicalEventRecord;
      readonly timelineProjection: TimelineProjectionRow;
      readonly inboxProjection: InboxProjectionRow | null;
      readonly identityCase: IdentityResolutionCase | null;
      readonly routingCase: RoutingReviewCase | null;
      readonly auditEvidence: AuditEvidenceRecord | null;
    }
  | {
      readonly outcome: "needs_identity_review";
      readonly sourceEvidence: SourceEvidenceRecord;
      readonly identityCase: IdentityResolutionCase;
      readonly auditEvidence: null;
    }
  | {
      readonly outcome: "skipped";
      readonly sourceEvidence: SourceEvidenceRecord;
      readonly reasonCode: "skipped_non_volunteer_task";
      readonly explanation: string;
      readonly auditEvidence: AuditEvidenceRecord;
    }
  | {
      readonly outcome: "quarantined";
      readonly sourceEvidence: SourceEvidenceRecord;
      readonly reasonCode: QuarantineReasonCode;
      readonly explanation: string;
      readonly existingCanonicalEvent: CanonicalEventRecord | null;
      readonly auditEvidence: AuditEvidenceRecord;
    };

export interface Stage1NormalizationService {
  readonly persistence: Stage1PersistenceService;
  recordNormalizedSourceEvidence(
    input: NormalizedSourceEvidenceIntake
  ): Promise<NormalizedSourceEvidenceResult>;
  ensureCanonicalContactForEmail(input: {
    readonly emailAddress: string;
    readonly createdAt?: string;
    readonly source?: ContactIdentityRecord["source"];
  }): Promise<ContactRecord>;
  upsertNormalizedContactGraph(
    input: NormalizedContactGraphUpsertInput
  ): Promise<NormalizedContactGraphResult>;
  saveIdentityAmbiguityCase(
    input: IdentityAmbiguityInput
  ): Promise<ReviewCaseSaveResult<IdentityResolutionCase>>;
  saveRoutingAmbiguityCase(
    input: RoutingAmbiguityInput
  ): Promise<ReviewCaseSaveResult<RoutingReviewCase>>;
  applyTimelineProjection(
    input: TimelineProjectionApplyInput
  ): Promise<TimelineProjectionRow>;
  applyInboxProjection(
    input: InboxProjectionApplyInput
  ): Promise<InboxProjectionRow | null>;
  refreshInboxReviewOverlay(
    input: InboxReviewOverlayRefreshInput
  ): Promise<InboxProjectionRow | null>;
  updateSyncState(input: SyncStateUpdateInput): Promise<SyncStateRecord>;
  applyNormalizedCanonicalEvent(
    input: NormalizedCanonicalEventIntake,
    options?: {
      readonly overwriteDuplicateGmailMessageDetail?: boolean;
    }
  ): Promise<NormalizedCanonicalEventResult>;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right)
  );
}

function uniqueById<T extends { readonly id: string }>(
  values: readonly T[]
): T[] {
  const deduped = new Map<string, T>();

  for (const value of values) {
    deduped.set(value.id, value);
  }

  return Array.from(deduped.values()).sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}

function uniqueByKey<T>(
  values: readonly T[],
  getKey: (value: T) => string
): T[] {
  const deduped = new Map<string, T>();

  for (const value of values) {
    deduped.set(getKey(value), value);
  }

  return Array.from(deduped.values());
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }

  return value;
}

function assertVolunteerScopedSalesforceContactGraph(
  input: NormalizedContactGraphUpsertInput
): void {
  const memberships = input.memberships ?? [];

  if (
    input.contact.salesforceContactId !== null &&
    memberships.length === 0
  ) {
    throw new Error(
      `Salesforce contact ${input.contact.salesforceContactId} is missing expedition memberships and cannot be upserted into the Stage 1 volunteer contact graph.`
    );
  }
}

function isInboundEvent(eventType: InboxDrivingEventType): boolean {
  return (
    eventType === "communication.email.inbound" ||
    eventType === "communication.sms.inbound"
  );
}

function buildTimelineProjectionId(canonicalEventId: string): string {
  return `timeline:${canonicalEventId}`;
}

function buildTimelineSortKey(canonicalEventId: string, occurredAt: string): string {
  return `${occurredAt}::${canonicalEventId}`;
}

function buildIdentityCaseId(
  sourceEvidenceId: string,
  reasonCode: IdentityResolutionCase["reasonCode"]
): string {
  return `identity-review:${sourceEvidenceId}:${reasonCode}`;
}

function buildRoutingCaseId(
  sourceEvidenceId: string,
  contactId: string,
  reasonCode: RoutingReviewCase["reasonCode"]
): string {
  return `routing-review:${sourceEvidenceId}:${contactId}:${reasonCode}`;
}

function buildQuarantineAuditId(
  entityType: string,
  entityId: string,
  reasonCode: QuarantineReasonCode
): string {
  return `audit:${entityType}:${entityId}:${reasonCode}`;
}

function buildSkipAuditId(
  entityType: string,
  entityId: string,
  action: "skipped_non_volunteer_task"
): string {
  return `audit:${entityType}:${entityId}:${action}`;
}

function buildSyntheticContactId(input: {
  readonly normalizedEmail: string | null;
  readonly normalizedPhone: string | null;
}): string {
  if (input.normalizedEmail !== null) {
    return `contact:email:${input.normalizedEmail}`;
  }

  if (input.normalizedPhone !== null) {
    return `contact:phone:${input.normalizedPhone}`;
  }

  throw new Error("Cannot build a synthetic contact id without an email or phone.");
}

function buildSyntheticContactGraphInput(input: {
  readonly normalizedEmail: string | null;
  readonly normalizedPhone: string | null;
  readonly createdAt: string;
  readonly source: ContactIdentityRecord["source"];
}): NormalizedContactGraphUpsertInput {
  const contactId = buildSyntheticContactId({
    normalizedEmail: input.normalizedEmail,
    normalizedPhone: input.normalizedPhone
  });

  const identities: ContactIdentityRecord[] = [];

  if (input.normalizedEmail !== null) {
    identities.push(
      contactIdentitySchema.parse({
        id: `contact-identity:${contactId}:email:${input.normalizedEmail}`,
        contactId,
        kind: "email",
        normalizedValue: input.normalizedEmail,
        isPrimary: true,
        source: input.source,
        verifiedAt: input.createdAt
      })
    );
  }

  if (input.normalizedPhone !== null) {
    identities.push(
      contactIdentitySchema.parse({
        id: `contact-identity:${contactId}:phone:${input.normalizedPhone}`,
        contactId,
        kind: "phone",
        normalizedValue: input.normalizedPhone,
        isPrimary: true,
        source: input.source,
        verifiedAt: input.createdAt
      })
    );
  }

  return {
    contact: contactSchema.parse({
      id: contactId,
      salesforceContactId: null,
      displayName: input.normalizedEmail ?? input.normalizedPhone ?? "(unknown)",
      primaryEmail: input.normalizedEmail,
      primaryPhone: input.normalizedPhone,
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    }),
    identities,
    memberships: []
  };
}

function normalizeEmailAddress(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? null : normalized;
}

function logStructuredEvent(input: {
  readonly event: string;
  readonly metadata: Record<string, unknown>;
}): void {
  console.log(
    JSON.stringify({
      event: input.event,
      ...input.metadata
    })
  );
}

async function reconcilePendingComposerOutbound(
  persistence: Stage1PersistenceService,
  input: {
    readonly sourceEvidence: SourceEvidenceRecord;
    readonly canonicalEvent: CanonicalEventRecord;
  }
): Promise<void> {
  if (
    input.sourceEvidence.provider !== "gmail" ||
    input.canonicalEvent.eventType !== "communication.email.outbound"
  ) {
    return;
  }

  const fingerprint = input.canonicalEvent.contentFingerprint;

  if (fingerprint === null) {
    logStructuredEvent({
      event: "composer.reconciliation.unmatched",
      metadata: {
        reason: "missing_fingerprint",
        canonicalEventId: input.canonicalEvent.id,
        sourceEvidenceId: input.sourceEvidence.id,
        providerRecordId: input.sourceEvidence.providerRecordId
      }
    });
    return;
  }

  const pending = await persistence.repositories.pendingOutbounds.findByFingerprint(
    fingerprint
  );

  if (
    pending !== null &&
    (pending.status === "pending" ||
      (pending.status === "confirmed" && pending.reconciledEventId === null))
  ) {
    const via = pending.status === "pending" ? "fingerprint" : "event_link";
    await persistence.repositories.pendingOutbounds.markConfirmed(pending.id, {
      reconciledEventId: input.canonicalEvent.id
    });
    logStructuredEvent({
      event: "composer.reconciliation.matched",
      metadata: {
        pendingOutboundId: pending.id,
        fingerprint,
        canonicalEventId: input.canonicalEvent.id,
        sourceEvidenceId: input.sourceEvidence.id,
        providerRecordId: input.sourceEvidence.providerRecordId,
        via
      }
    });
    return;
  }

  logStructuredEvent({
    event: "composer.reconciliation.unmatched",
    metadata: {
      fingerprint,
      canonicalEventId: input.canonicalEvent.id,
      sourceEvidenceId: input.sourceEvidence.id,
      providerRecordId: input.sourceEvidence.providerRecordId,
      pendingOutboundId: pending?.id ?? null,
      pendingStatus: pending?.status ?? null
    }
  });
}

function newestTimestamp(
  left: string | null,
  right: string | null
): string | null {
  if (left === null) {
    return right;
  }

  if (right === null) {
    return left;
  }

  return left > right ? left : right;
}

const FORWARDED_SUBJECT_PATTERN = /^\s*fwd?:/i;
const FORWARDED_BODY_PATTERNS = [
  /(?:\n|^)\s*-{2,}\s*forwarded message\s*-{2,}\s*(?:\n|$)/i,
  /(?:\n|^)\s*forwarded message:/i,
  /(?:\n|^)\s*begin forwarded message:/i
];

function detectInboxProjectionExclusionReason(
  input: Pick<
    NormalizedCanonicalEventIntake,
    "canonicalEvent" | "gmailMessageDetail" | "sourceEvidence"
  >
): "forwarded_chain" | null {
  if (
    input.sourceEvidence.provider !== "gmail" ||
    (input.canonicalEvent.eventType !== "communication.email.inbound" &&
      input.canonicalEvent.eventType !== "communication.email.outbound")
  ) {
    return null;
  }

  const gmailMessageDetail = input.gmailMessageDetail;

  if (gmailMessageDetail === undefined) {
    return null;
  }

  if (
    gmailMessageDetail.subject !== null &&
    FORWARDED_SUBJECT_PATTERN.test(gmailMessageDetail.subject)
  ) {
    return "forwarded_chain";
  }

  const previewCandidates = [
    gmailMessageDetail.bodyTextPreview,
    gmailMessageDetail.snippetClean
  ];

  for (const preview of previewCandidates) {
    for (const pattern of FORWARDED_BODY_PATTERNS) {
      if (pattern.test(preview)) {
        return "forwarded_chain";
      }
    }
  }

  return null;
}

function buildNormalizedIdentityValues(
  identity: NormalizedIdentityEvidence
): string[] {
  return uniqueStrings([
    ...(identity.salesforceContactId === null ? [] : [identity.salesforceContactId]),
    ...identity.volunteerIdPlainValues,
    ...identity.normalizedEmails,
    ...identity.normalizedPhones
  ]);
}

function pickCanonicalReviewState(input: {
  readonly hasIdentityReview: boolean;
  readonly hasRoutingReview: boolean;
}): CanonicalEventRecord["reviewState"] {
  if (input.hasIdentityReview) {
    return "needs_identity_review";
  }

  if (input.hasRoutingReview) {
    return "needs_routing_review";
  }

  return "clear";
}

function mergeCanonicalReviewState(
  left: CanonicalEventRecord["reviewState"],
  right: CanonicalEventRecord["reviewState"]
): CanonicalEventRecord["reviewState"] {
  if (left === "quarantined" || right === "quarantined") {
    return "quarantined";
  }

  if (
    left === "needs_identity_review" ||
    right === "needs_identity_review"
  ) {
    return "needs_identity_review";
  }

  if (left === "needs_routing_review" || right === "needs_routing_review") {
    return "needs_routing_review";
  }

  return "clear";
}

function mapBySourceEvidenceId<TValue extends { readonly sourceEvidenceId: string }>(
  values: readonly TValue[]
): ReadonlyMap<string, TValue> {
  return new Map(values.map((value) => [value.sourceEvidenceId, value]));
}

async function loadProviderDetailMaps(
  persistence: Stage1PersistenceService,
  sourceEvidenceIds: readonly string[]
): Promise<ProviderDetailMaps> {
  const uniqueSourceEvidenceIds = uniqueStrings(sourceEvidenceIds);
  const [gmailMessageDetails, salesforceCommunicationDetails, simpleTextingMessageDetails] =
    await Promise.all([
      persistence.repositories.gmailMessageDetails.listBySourceEvidenceIds(
        uniqueSourceEvidenceIds
      ),
      persistence.repositories.salesforceCommunicationDetails.listBySourceEvidenceIds(
        uniqueSourceEvidenceIds
      ),
      persistence.repositories.simpleTextingMessageDetails.listBySourceEvidenceIds(
        uniqueSourceEvidenceIds
      )
    ]);

  return {
    gmailMessageDetailBySourceEvidenceId: mapBySourceEvidenceId(gmailMessageDetails),
    salesforceCommunicationDetailBySourceEvidenceId: mapBySourceEvidenceId(
      salesforceCommunicationDetails
    ),
    simpleTextingMessageDetailBySourceEvidenceId: mapBySourceEvidenceId(
      simpleTextingMessageDetails
    )
  };
}

function findCanonicalEventForSourceEvidence(
  events: readonly CanonicalEventRecord[],
  sourceEvidenceId: string
): CanonicalEventRecord | null {
  return (
    events.find(
      (event) =>
        event.sourceEvidenceId === sourceEvidenceId ||
        event.provenance.supportingSourceEvidenceIds.includes(sourceEvidenceId)
    ) ?? null
  );
}

function compareDuplicateCandidateEvents(
  left: CanonicalEventRecord,
  right: CanonicalEventRecord
): number {
  if (
    left.provenance.primaryProvider !== right.provenance.primaryProvider
  ) {
    return left.provenance.primaryProvider === "gmail" ? -1 : 1;
  }

  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt.localeCompare(right.occurredAt);
  }

  return left.id.localeCompare(right.id);
}

async function findOutboundEmailDuplicateMatch(
  persistence: Stage1PersistenceService,
  input: {
    readonly existingEvents: readonly CanonicalEventRecord[];
    readonly contactId: string;
    readonly incoming: Pick<
      NormalizedCanonicalEventIntake,
      | "canonicalEvent"
      | "communicationClassification"
      | "sourceEvidence"
      | "gmailMessageDetail"
      | "salesforceCommunicationDetail"
    >;
  }
): Promise<OutboundEmailDuplicateMatch | null> {
  if (
    input.incoming.canonicalEvent.eventType !== "communication.email.outbound"
  ) {
    return null;
  }

  const incomingSource = buildIncomingOutboundEmailFingerprintSource(
    input.incoming
  );

  if (incomingSource === null) {
    return null;
  }

  const incomingFingerprint = buildOutboundEmailDuplicateFingerprint({
    subject: incomingSource.subject,
    body: incomingSource.body
  });

  if (incomingFingerprint === null) {
    return null;
  }

  const candidateEvents = input.existingEvents
    .filter(
      (event) =>
        event.eventType === "communication.email.outbound" &&
        (event.provenance.primaryProvider === "gmail" ||
          event.provenance.primaryProvider === "salesforce") &&
        isWithinOutboundEmailFingerprintWindow({
          leftOccurredAt: event.occurredAt,
          rightOccurredAt: input.incoming.canonicalEvent.occurredAt
        })
    )
    .sort(compareDuplicateCandidateEvents);

  if (candidateEvents.length === 0) {
    return null;
  }

  const detailMaps = await loadProviderDetailMaps(
    persistence,
    candidateEvents.map((event) => event.sourceEvidenceId)
  );

  for (const existingEvent of candidateEvents) {
    const existingSource = buildPersistedOutboundEmailFingerprintSource({
      event: existingEvent,
      gmailMessageDetailBySourceEvidenceId:
        detailMaps.gmailMessageDetailBySourceEvidenceId,
      salesforceCommunicationDetailBySourceEvidenceId:
        detailMaps.salesforceCommunicationDetailBySourceEvidenceId
    });

    if (existingSource === null) {
      continue;
    }

    const existingFingerprint = buildOutboundEmailDuplicateFingerprint({
      subject: existingSource.subject,
      body: existingSource.body
    });

    if (existingFingerprint === null || existingFingerprint !== incomingFingerprint) {
      continue;
    }

    const winnerSelection = selectOutboundEmailDuplicateWinner({
      incoming: {
        provider: input.incoming.sourceEvidence.provider,
        occurredAt: input.incoming.canonicalEvent.occurredAt
      },
      existing: {
        provider: existingEvent.provenance.primaryProvider,
        occurredAt: existingEvent.occurredAt
      }
    });

    if (winnerSelection === null) {
      continue;
    }

    return {
      existingEvent,
      existingTimelineProjection:
        await persistence.repositories.timelineProjection.findByCanonicalEventId(
          existingEvent.id
        ),
      winner: {
        winnerReason: winnerSelection.winnerReason,
        notes: winnerSelection.notes,
        keepIncomingAsPrimary: winnerSelection.winner === "incoming"
      }
    };
  }

  const incomingContentFingerprintSource = buildIncomingContentFingerprintSource(
    input.incoming
  );
  const incomingContentFingerprint =
    incomingContentFingerprintSource === null
      ? null
      : computeContentFingerprint({
          ...incomingContentFingerprintSource,
          contactId: input.contactId
        });

  if (incomingContentFingerprint !== null) {
    const fingerprintCandidates =
      await persistence.repositories.canonicalEvents.listByContentFingerprintWindow({
        contactId: input.contactId,
        channel: "email",
        contentFingerprint: incomingContentFingerprint,
        occurredAt: input.incoming.canonicalEvent.occurredAt,
        windowMinutes: 5
      });

    for (const existingEvent of [...fingerprintCandidates].sort(
      compareDuplicateCandidateEvents
    )) {
      const winnerSelection = selectOutboundEmailDuplicateWinner({
        incoming: {
          provider: input.incoming.sourceEvidence.provider,
          occurredAt: input.incoming.canonicalEvent.occurredAt
        },
        existing: {
          provider: existingEvent.provenance.primaryProvider,
          occurredAt: existingEvent.occurredAt
        }
      });

      if (winnerSelection === null) {
        continue;
      }

      return {
        existingEvent,
        existingTimelineProjection:
          await persistence.repositories.timelineProjection.findByCanonicalEventId(
            existingEvent.id
          ),
        winner: {
          winnerReason: winnerSelection.winnerReason,
          notes: winnerSelection.notes,
          keepIncomingAsPrimary: winnerSelection.winner === "incoming"
        }
      };
    }
  }

  if (input.incoming.sourceEvidence.provider !== "salesforce") {
    return null;
  }

  const salesforceSnippetClusterFingerprint =
    computeSalesforceSnippetClusterFingerprint({
      subject: input.incoming.salesforceCommunicationDetail?.subject ?? null,
      snippet:
        input.incoming.salesforceCommunicationDetail?.snippet ??
        input.incoming.canonicalEvent.snippet ??
        "",
      contactId: input.contactId,
      channel: "email",
      direction: input.incoming.communicationClassification?.direction ?? null
    });

  if (salesforceSnippetClusterFingerprint === null) {
    return null;
  }

  const salesforceCandidateEvents = input.existingEvents
    .filter(
      (event) =>
        event.eventType === "communication.email.outbound" &&
        event.provenance.primaryProvider === "salesforce" &&
        isWithinContentFingerprintWindow({
          leftOccurredAt: event.occurredAt,
          rightOccurredAt: input.incoming.canonicalEvent.occurredAt,
          windowMs: salesforceSnippetClusterWindowMs
        })
    )
    .sort(compareDuplicateCandidateEvents);

  if (salesforceCandidateEvents.length === 0) {
    return null;
  }

  const salesforceDetailMaps = await loadProviderDetailMaps(
    persistence,
    salesforceCandidateEvents.map((event) => event.sourceEvidenceId)
  );

  for (const existingEvent of salesforceCandidateEvents) {
    const existingDetail =
      salesforceDetailMaps.salesforceCommunicationDetailBySourceEvidenceId.get(
        existingEvent.sourceEvidenceId
      );

    if (existingDetail === undefined) {
      continue;
    }

    const existingSalesforceSnippetClusterFingerprint =
      computeSalesforceSnippetClusterFingerprint({
        subject: existingDetail.subject,
        snippet: existingDetail.snippet,
        contactId: input.contactId,
        channel: existingEvent.channel,
        direction: existingEvent.provenance.direction
      });

    if (
      existingSalesforceSnippetClusterFingerprint === null ||
      existingSalesforceSnippetClusterFingerprint !==
        salesforceSnippetClusterFingerprint
    ) {
      continue;
    }

    const keepIncomingAsPrimary =
      selectSalesforceSelfDuplicateWinner({
        incomingOccurredAt: input.incoming.canonicalEvent.occurredAt,
        existingOccurredAt: existingEvent.occurredAt
      }) === "incoming";

    return {
      existingEvent,
      existingTimelineProjection:
        await persistence.repositories.timelineProjection.findByCanonicalEventId(
          existingEvent.id
        ),
      winner: {
        winnerReason: "salesforce_only_best_evidence",
        notes:
          "The earliest Salesforce Task remained canonical for the same subject and snippet within the 10 minute Flow double-fire window.",
        keepIncomingAsPrimary
      }
    };
  }

  return null;
}

function resolveInboxSnippet(
  event: CanonicalEventRecord,
  detailMaps: ProviderDetailMaps
): string {
  if (event.provenance.primaryProvider === "gmail") {
    const detail = detailMaps.gmailMessageDetailBySourceEvidenceId.get(
      event.sourceEvidenceId
    );

    if (detail === undefined) {
      return "";
    }

    return detail.snippetClean.length > 0
      ? detail.snippetClean
      : detail.bodyTextPreview;
  }

  if (event.provenance.primaryProvider === "salesforce") {
    return (
      detailMaps.salesforceCommunicationDetailBySourceEvidenceId.get(
        event.sourceEvidenceId
      )?.snippet ?? ""
    );
  }

  if (event.provenance.primaryProvider === "simpletexting") {
    return (
      detailMaps.simpleTextingMessageDetailBySourceEvidenceId.get(
        event.sourceEvidenceId
      )?.messageTextPreview ?? ""
    );
  }

  return "";
}

async function rebuildInboxProjectionForContact(
  persistence: Stage1PersistenceService,
  contactId: string
): Promise<InboxProjectionRow | null> {
  const existing = await persistence.repositories.inboxProjection.findByContactId(
    contactId
  );
  const events = await persistence.repositories.canonicalEvents.listByContactId(
    contactId
  );
  const inboxDrivingEvents = events.filter(
    (
      event
    ): event is CanonicalEventRecord & { readonly eventType: InboxDrivingEventType } =>
      isInboxDrivingCanonicalEvent(event)
  );

  if (inboxDrivingEvents.length === 0) {
    if (existing !== null) {
      await persistence.repositories.inboxProjection.deleteByContactId(contactId);
    }

    return null;
  }

  const detailMaps = await loadProviderDetailMaps(
    persistence,
    inboxDrivingEvents.map((event) => event.sourceEvidenceId)
  );
  const latestEvent = requireValue(
    inboxDrivingEvents[inboxDrivingEvents.length - 1],
    "Expected an inbox-driving event when rebuilding inbox projection."
  );
  let lastInboundAt: string | null = null;
  let lastOutboundAt: string | null = null;

  for (const event of inboxDrivingEvents) {
    if (isInboundEvent(event.eventType)) {
      lastInboundAt = newestTimestamp(lastInboundAt, event.occurredAt);
    } else {
      lastOutboundAt = newestTimestamp(lastOutboundAt, event.occurredAt);
    }
  }

  const lastActivityAt = newestTimestamp(lastInboundAt, lastOutboundAt);

  if (lastActivityAt === null) {
    return null;
  }

  const hasNewerInbound =
    lastInboundAt !== null &&
    (existing?.lastInboundAt == null || lastInboundAt > existing.lastInboundAt);

  return persistence.saveInboxProjection({
    contactId,
    bucket: hasNewerInbound
      ? "New"
      : existing?.bucket ??
        (isInboundEvent(latestEvent.eventType) ? "New" : "Opened"),
    needsFollowUp: existing?.needsFollowUp ?? false,
    hasUnresolved: await contactHasUnresolved(persistence, contactId),
    lastInboundAt,
    lastOutboundAt,
    lastActivityAt,
    snippet: resolveInboxSnippet(latestEvent, detailMaps),
    lastCanonicalEventId: latestEvent.id,
    lastEventType: latestEvent.eventType
  });
}

function buildIdentityMissingAnchorExplanation(
  identity: NormalizedIdentityEvidence
): string {
  if (identity.salesforceContactId !== null) {
    return `Salesforce Contact ID ${identity.salesforceContactId} did not resolve to an existing canonical contact.`;
  }

  return "No single safe contact match was available from the normalized email or phone evidence.";
}

function buildIdentityConflictExplanation(
  reasonCode: IdentityResolutionCase["reasonCode"]
): string {
  switch (reasonCode) {
    case "identity_multi_candidate":
      return "More than one canonical contact matched the normalized identity evidence.";
    case "identity_conflict":
      return "Normalized email and phone evidence resolved to different canonical contacts.";
    case "identity_anchor_mismatch":
      return "Salesforce Contact ID resolved safely, but weaker identity evidence points at a different canonical contact.";
    case "identity_missing_anchor":
      return "No safe canonical contact could be selected from the available identity evidence.";
  }
}

function buildRoutingExplanation(
  reasonCode: RoutingReviewCase["reasonCode"]
): string {
  switch (reasonCode) {
    case "routing_missing_membership":
      return "The contact is known, but no canonical membership context is available for routing.";
    case "routing_multiple_memberships":
      return "More than one canonical membership is plausible for this activity.";
    case "routing_context_conflict":
      return "Provider-supplied routing context conflicts with canonical membership state.";
  }
}

function isSalesforceTaskCommunicationIntake(
  input: Pick<NormalizedCanonicalEventIntake, "sourceEvidence">
): boolean {
  return (
    input.sourceEvidence.provider === "salesforce" &&
    input.sourceEvidence.providerRecordType === "task_communication"
  );
}

function buildSkippedNonVolunteerTaskExplanation(): string {
  return "Salesforce task communications for non-volunteer contacts are skipped in Stage 1.";
}

function decideDuplicateCollapse(
  input: NormalizedCanonicalEventIntake
): DuplicateCollapseDecision {
  const supportingProviders = new Set(
    (input.supportingSources ?? []).map((entry) => entry.provider)
  );
  const primaryProvider = input.sourceEvidence.provider;
  const { eventType } = input.canonicalEvent;

  if (eventType === "communication.email.outbound") {
    if (primaryProvider === "gmail" && supportingProviders.has("salesforce")) {
      return {
        outcome: "accepted",
        winner: {
          winnerReason: "gmail_wins_duplicate_collapse",
          notes:
            "Gmail remained the primary provenance winner over Salesforce for the same outbound one-to-one email."
        }
      };
    }

    if (primaryProvider === "salesforce" && supportingProviders.has("gmail")) {
      return {
        outcome: "quarantined",
        reasonCode: "duplicate_collapse_conflict",
        explanation:
          "Gmail must win duplicate collapse when Gmail and Salesforce describe the same outbound one-to-one email."
      };
    }
  }

  if (eventType === "communication.sms.outbound") {
    if (
      primaryProvider === "simpletexting" &&
      supportingProviders.has("salesforce")
    ) {
      return {
        outcome: "accepted",
        winner: {
          winnerReason: "simpletexting_wins_duplicate_collapse",
          notes:
            "SimpleTexting remained the primary provenance winner over Salesforce for the same outbound SMS."
        }
      };
    }

    if (
      primaryProvider === "salesforce" &&
      supportingProviders.has("simpletexting")
    ) {
      return {
        outcome: "quarantined",
        reasonCode: "duplicate_collapse_conflict",
        explanation:
          "SimpleTexting must remain the primary transport winner when Salesforce also describes the same outbound SMS."
      };
    }
  }

  if (
    primaryProvider === "salesforce" &&
    supportingProviders.size === 0 &&
    (eventType === "communication.email.outbound" ||
      eventType === "communication.sms.outbound")
  ) {
    return {
      outcome: "accepted",
      winner: {
        winnerReason: "salesforce_only_best_evidence",
        notes:
          "Salesforce was retained because no stronger transport evidence was attached."
      }
    };
  }

  return {
    outcome: "accepted",
    winner: {
      winnerReason: "single_source",
      notes: null
    }
  };
}

function createIdentityResolutionContext(
  persistence: Stage1PersistenceService
): IdentityResolutionContext {
  const contactByIdCache = new Map<string, Promise<ContactRecord | null>>();
  const contactsByIdentityValueCache = new Map<
    string,
    Promise<readonly ContactRecord[]>
  >();
  const anchoredContactCache = new Map<string, Promise<ContactRecord | null>>();

  const loadContactById = (contactId: string): Promise<ContactRecord | null> => {
    const cached = contactByIdCache.get(contactId);

    if (cached !== undefined) {
      return cached;
    }

    const lookup = persistence.repositories.contacts.findById(contactId);
    contactByIdCache.set(contactId, lookup);
    return lookup;
  };

  return {
    async loadContactsForIdentityKind(kind, values) {
      const contactGroups = await Promise.all(
        uniqueStrings(values).map(async (normalizedValue) => {
          const cacheKey = `${kind}:${normalizedValue}`;
          const cached = contactsByIdentityValueCache.get(cacheKey);

          if (cached !== undefined) {
            return cached;
          }

          const lookup = (async () => {
            const identities =
              await persistence.repositories.contactIdentities.listByNormalizedValue({
                kind,
                normalizedValue
              });
            const contacts = await Promise.all(
              uniqueStrings(identities.map((identity) => identity.contactId)).map(
                loadContactById
              )
            );

            return uniqueById(
              contacts.filter(
                (contact): contact is ContactRecord => contact !== null
              )
            );
          })();

          contactsByIdentityValueCache.set(cacheKey, lookup);
          return lookup;
        })
      );

      return new Map(
        uniqueById(contactGroups.flat()).map((contact) => [contact.id, contact] as const)
      );
    },

    findAnchoredContact(salesforceContactId) {
      const cached = anchoredContactCache.get(salesforceContactId);

      if (cached !== undefined) {
        return cached;
      }

      const lookup =
        persistence.repositories.contacts.findBySalesforceContactId(
          salesforceContactId
        );
      anchoredContactCache.set(salesforceContactId, lookup);
      return lookup;
    },

    clear() {
      contactByIdCache.clear();
      contactsByIdentityValueCache.clear();
      anchoredContactCache.clear();
    }
  };
}

async function resolveIdentityDecision(
  context: IdentityResolutionContext,
  sourceEvidenceId: string,
  openedAt: string,
  identity: NormalizedIdentityEvidence,
  provider: Provider
): Promise<IdentityResolutionDecision> {
  const emailMatches = await context.loadContactsForIdentityKind(
    "email",
    identity.normalizedEmails
  );
  const phoneMatches = await context.loadContactsForIdentityKind(
    "phone",
    identity.normalizedPhones
  );
  const volunteerMatches = await context.loadContactsForIdentityKind(
    "volunteer_id_plain",
    identity.volunteerIdPlainValues
  );
  const normalizedIdentityValues = buildNormalizedIdentityValues(identity);

  if (
    identity.salesforceContactId !== null &&
    provider === "salesforce"
  ) {
    const anchored = await context.findAnchoredContact(
      identity.salesforceContactId
    );

    if (anchored === null) {
      return {
        outcome: "needs_identity_review",
        reviewInput: identityAmbiguityInputSchema.parse({
          sourceEvidenceId,
          candidateContactIds: uniqueStrings([
            ...emailMatches.keys(),
            ...phoneMatches.keys(),
            ...volunteerMatches.keys()
          ]),
          reasonCode: "identity_missing_anchor",
          openedAt,
          normalizedIdentityValues,
          anchoredContactId: null,
          explanation: buildIdentityMissingAnchorExplanation(identity)
        })
      };
    }

    const conflictingContactIds = uniqueStrings(
      [...emailMatches.keys(), ...phoneMatches.keys(), ...volunteerMatches.keys()].filter(
        (contactId) => contactId !== anchored.id
      )
    );

    if (conflictingContactIds.length > 0) {
      return {
        outcome: "resolved",
        contact: anchored,
        reviewInput: identityAmbiguityInputSchema.parse({
          sourceEvidenceId,
          candidateContactIds: conflictingContactIds,
          reasonCode: "identity_anchor_mismatch",
          openedAt,
          normalizedIdentityValues,
          anchoredContactId: anchored.id,
          explanation: buildIdentityConflictExplanation(
            "identity_anchor_mismatch"
          )
        })
      };
    }

    return {
      outcome: "resolved",
      contact: anchored,
      reviewInput: null
    };
  }

  const emailMatchesList = uniqueById(Array.from(emailMatches.values()));
  const phoneMatchesList = uniqueById(Array.from(phoneMatches.values()));

  if (emailMatchesList.length > 1) {
    return {
      outcome: "needs_identity_review",
      reviewInput: identityAmbiguityInputSchema.parse({
        sourceEvidenceId,
        candidateContactIds: emailMatchesList.map((contact) => contact.id),
        reasonCode: "identity_multi_candidate",
        openedAt,
        normalizedIdentityValues,
        anchoredContactId: null,
        explanation: buildIdentityConflictExplanation("identity_multi_candidate")
      })
    };
  }

  if (emailMatchesList.length === 1) {
    const emailContact = requireValue(
      emailMatchesList[0],
      "Expected a single email-matched contact."
    );

    if (
      phoneMatchesList.length === 0 ||
      (phoneMatchesList.length === 1 &&
        requireValue(
          phoneMatchesList[0],
          "Expected a single phone-matched contact."
        ).id === emailContact.id)
    ) {
      return {
        outcome: "resolved",
        contact: emailContact,
        reviewInput: null
      };
    }

    const candidateContactIds = uniqueStrings([
      emailContact.id,
      ...phoneMatchesList.map((contact) => contact.id)
    ]);

    return {
      outcome: "needs_identity_review",
      reviewInput: identityAmbiguityInputSchema.parse({
        sourceEvidenceId,
        candidateContactIds,
        reasonCode:
          phoneMatchesList.length === 1
            ? "identity_conflict"
            : "identity_multi_candidate",
        openedAt,
        normalizedIdentityValues,
        anchoredContactId: null,
        explanation: buildIdentityConflictExplanation(
          phoneMatchesList.length === 1
            ? "identity_conflict"
            : "identity_multi_candidate"
        )
      })
    };
  }

  if (phoneMatchesList.length > 1) {
    return {
      outcome: "needs_identity_review",
      reviewInput: identityAmbiguityInputSchema.parse({
        sourceEvidenceId,
        candidateContactIds: phoneMatchesList.map((contact) => contact.id),
        reasonCode: "identity_multi_candidate",
        openedAt,
        normalizedIdentityValues,
        anchoredContactId: null,
        explanation: buildIdentityConflictExplanation("identity_multi_candidate")
      })
    };
  }

  if (phoneMatchesList.length === 1) {
    const phoneContact = requireValue(
      phoneMatchesList[0],
      "Expected a single phone-matched contact."
    );

    return {
      outcome: "resolved",
      contact: phoneContact,
      reviewInput: null
    };
  }

  if (identity.normalizedEmails.length > 1) {
    return {
      outcome: "needs_identity_review",
      reviewInput: identityAmbiguityInputSchema.parse({
        sourceEvidenceId,
        candidateContactIds: [],
        reasonCode: "identity_multi_candidate",
        openedAt,
        normalizedIdentityValues,
        anchoredContactId: null,
        explanation:
          "More than one external email participant was present and no safe canonical contact could be selected."
      })
    };
  }

  const fallbackNormalizedEmail = identity.normalizedEmails[0] ?? null;
  const fallbackNormalizedPhone = identity.normalizedPhones[0] ?? null;

  if (fallbackNormalizedEmail !== null || fallbackNormalizedPhone !== null) {
    return {
      outcome: "create_new_contact",
      normalizedEmail: fallbackNormalizedEmail,
      normalizedPhone: fallbackNormalizedPhone
    };
  }

  return {
    outcome: "needs_identity_review",
    reviewInput: identityAmbiguityInputSchema.parse({
      sourceEvidenceId,
      candidateContactIds: uniqueStrings(Array.from(volunteerMatches.keys())),
      reasonCode: "identity_missing_anchor",
      openedAt,
      normalizedIdentityValues,
      anchoredContactId: null,
      explanation: buildIdentityMissingAnchorExplanation(identity)
    })
  };
}

async function resolveRoutingDecision(
  persistence: Stage1PersistenceService,
  input: {
    readonly contactId: string;
    readonly sourceEvidenceId: string;
    readonly openedAt: string;
    readonly routing:
      | NonNullable<NormalizedCanonicalEventIntake["routing"]>
      | undefined;
  }
): Promise<RoutingResolutionDecision> {
  if (!input.routing?.required) {
    return {
      outcome: "clear",
      reviewInput: null
    };
  }

  const memberships = await persistence.repositories.contactMemberships.listByContactId(
    input.contactId
  );

  if (memberships.length === 0) {
    return {
      outcome: "needs_routing_review",
      reviewInput: routingAmbiguityInputSchema.parse({
        contactId: input.contactId,
        sourceEvidenceId: input.sourceEvidenceId,
        reasonCode: "routing_missing_membership",
        openedAt: input.openedAt,
        candidateMembershipIds: [],
        explanation: buildRoutingExplanation("routing_missing_membership")
      })
    };
  }

  const { projectId, expeditionId } = input.routing;
  const hasExplicitContext = projectId !== null || expeditionId !== null;

  if (hasExplicitContext) {
    const matchingMemberships = memberships.filter((membership) => {
      if (projectId !== null && membership.projectId !== projectId) {
        return false;
      }

      if (expeditionId !== null && membership.expeditionId !== expeditionId) {
        return false;
      }

      return true;
    });

    if (matchingMemberships.length === 1) {
      return {
        outcome: "clear",
        reviewInput: null
      };
    }

    if (matchingMemberships.length > 1) {
      return {
        outcome: "needs_routing_review",
        reviewInput: routingAmbiguityInputSchema.parse({
          contactId: input.contactId,
          sourceEvidenceId: input.sourceEvidenceId,
          reasonCode: "routing_multiple_memberships",
          openedAt: input.openedAt,
          candidateMembershipIds: matchingMemberships.map(
            (membership) => membership.id
          ),
          explanation: buildRoutingExplanation("routing_multiple_memberships")
        })
      };
    }

    return {
      outcome: "needs_routing_review",
      reviewInput: routingAmbiguityInputSchema.parse({
        contactId: input.contactId,
        sourceEvidenceId: input.sourceEvidenceId,
        reasonCode: "routing_context_conflict",
        openedAt: input.openedAt,
        candidateMembershipIds: memberships.map((membership) => membership.id),
        explanation: buildRoutingExplanation("routing_context_conflict")
      })
    };
  }

  if (memberships.length === 1) {
    return {
      outcome: "clear",
      reviewInput: null
    };
  }

  return {
    outcome: "needs_routing_review",
    reviewInput: routingAmbiguityInputSchema.parse({
      contactId: input.contactId,
      sourceEvidenceId: input.sourceEvidenceId,
      reasonCode: "routing_multiple_memberships",
      openedAt: input.openedAt,
      candidateMembershipIds: memberships.map((membership) => membership.id),
      explanation: buildRoutingExplanation("routing_multiple_memberships")
    })
  };
}

async function resolveNonVolunteerSalesforceTaskSkip(
  persistence: Stage1PersistenceService,
  context: IdentityResolutionContext,
  input: Pick<
    NormalizedCanonicalEventIntake,
    "identity" | "salesforceEventContext" | "sourceEvidence"
  >
): Promise<
  | {
      readonly outcome: "continue";
    }
  | {
      readonly outcome: "skipped";
      readonly whoId: string;
    }
> {
  if (!isSalesforceTaskCommunicationIntake(input)) {
    return {
      outcome: "continue"
    };
  }

  const whoId =
    input.identity.salesforceContactId ??
    input.salesforceEventContext?.salesforceContactId ??
    null;

  if (whoId === null) {
    return {
      outcome: "continue"
    };
  }

  const anchoredContact = await context.findAnchoredContact(whoId);

  if (anchoredContact === null) {
    return {
      outcome: "skipped",
      whoId
    };
  }

  const memberships = await persistence.repositories.contactMemberships.listByContactId(
    anchoredContact.id
  );

  if (memberships.length > 0) {
    return {
      outcome: "continue"
    };
  }

  return {
    outcome: "skipped",
    whoId
  };
}

async function listOpenIdentityCasesForContact(
  persistence: Stage1PersistenceService,
  contactId: string
): Promise<readonly IdentityResolutionCase[]> {
  const casesByReason = await Promise.all(
    identityResolutionReasonCodeValues.map((reasonCode) =>
      persistence.repositories.identityResolutionQueue.listOpenByReasonCode(
        reasonCode
      )
    )
  );

  return uniqueById(
    casesByReason
      .flat()
      .filter((record) => record.anchoredContactId === contactId)
  );
}

async function listOpenRoutingCasesForContact(
  persistence: Stage1PersistenceService,
  contactId: string
): Promise<readonly RoutingReviewCase[]> {
  const casesByReason = await Promise.all(
    routingReviewReasonCodeValues.map((reasonCode) =>
      persistence.repositories.routingReviewQueue.listOpenByReasonCode(reasonCode)
    )
  );

  return uniqueById(
    casesByReason.flat().filter((record) => record.contactId === contactId)
  );
}

async function contactHasUnresolved(
  persistence: Stage1PersistenceService,
  contactId: string
): Promise<boolean> {
  const [identityCases, routingCases] = await Promise.all([
    listOpenIdentityCasesForContact(persistence, contactId),
    listOpenRoutingCasesForContact(persistence, contactId)
  ]);

  return identityCases.length > 0 || routingCases.length > 0;
}

async function recordQuarantineAuditOnce(
  persistence: Stage1PersistenceService,
  input: {
    readonly entityType: string;
    readonly entityId: string;
    readonly occurredAt: string;
    readonly reasonCode: QuarantineReasonCode;
    readonly action: string;
    readonly metadataJson: Record<string, unknown>;
  }
): Promise<AuditEvidenceRecord> {
  const policyCode = `stage1.quarantine.${input.reasonCode}`;
  const existingRecords = await persistence.repositories.auditEvidence.listByEntity({
    entityType: input.entityType,
    entityId: input.entityId
  });
  const existingRecord = existingRecords.find(
    (record) => record.policyCode === policyCode
  );

  if (existingRecord !== undefined) {
    return existingRecord;
  }

  return persistence.recordAuditEvidence({
    id: buildQuarantineAuditId(
      input.entityType,
      input.entityId,
      input.reasonCode
    ),
    actorType: "system",
    actorId: "stage1-normalization",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    occurredAt: input.occurredAt,
    result: "recorded",
    policyCode,
    metadataJson: input.metadataJson
  });
}

async function recordSkipAuditOnce(
  persistence: Stage1PersistenceService,
  input: {
    readonly entityType: string;
    readonly entityId: string;
    readonly occurredAt: string;
    readonly action: "skipped_non_volunteer_task";
    readonly metadataJson: Record<string, unknown>;
  }
): Promise<AuditEvidenceRecord> {
  const policyCode = `stage1.skip.${input.action}`;
  const existingRecords = await persistence.repositories.auditEvidence.listByEntity({
    entityType: input.entityType,
    entityId: input.entityId
  });
  const existingRecord = existingRecords.find(
    (record) => record.policyCode === policyCode
  );

  if (existingRecord !== undefined) {
    return existingRecord;
  }

  return persistence.recordAuditEvidence({
    id: buildSkipAuditId(input.entityType, input.entityId, input.action),
    actorType: "system",
    actorId: "stage1-normalization",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    occurredAt: input.occurredAt,
    result: "recorded",
    policyCode,
    metadataJson: input.metadataJson
  });
}

async function upsertProjectAndExpeditionDimensions(
  persistence: Stage1PersistenceService,
  input: {
    readonly projectDimensions: readonly ProjectDimensionRecord[];
    readonly expeditionDimensions: readonly ExpeditionDimensionRecord[];
  }
): Promise<void> {
  for (const projectDimension of uniqueByKey(
    input.projectDimensions,
    (record) => record.projectId
  )) {
    await persistence.upsertProjectDimension(
      projectDimensionSchema.parse(projectDimension)
    );
  }

  for (const expeditionDimension of uniqueByKey(
    input.expeditionDimensions,
    (record) => record.expeditionId
  )) {
    await persistence.upsertExpeditionDimension(
      expeditionDimensionSchema.parse(expeditionDimension)
    );
  }
}

async function upsertProviderPresentationDetails(
  persistence: Stage1PersistenceService,
  input: Pick<
    NormalizedCanonicalEventIntake,
    | "gmailMessageDetail"
    | "salesforceCommunicationDetail"
    | "simpleTextingMessageDetail"
    | "mailchimpCampaignActivityDetail"
    | "manualNoteDetail"
    | "salesforceEventContext"
    | "projectDimensions"
    | "expeditionDimensions"
  >,
  options?: {
    readonly allowDuplicateGmailMessageDetailOverwrite?: boolean;
  }
): Promise<void> {
  await upsertProjectAndExpeditionDimensions(persistence, {
    projectDimensions: input.projectDimensions ?? [],
    expeditionDimensions: input.expeditionDimensions ?? []
  });

  if (
    input.gmailMessageDetail !== undefined &&
    (options?.allowDuplicateGmailMessageDetailOverwrite ?? true)
  ) {
    await persistence.upsertGmailMessageDetail(
      gmailMessageDetailSchema.parse(input.gmailMessageDetail)
    );
  }

  if (input.salesforceCommunicationDetail !== undefined) {
    await persistence.upsertSalesforceCommunicationDetail(
      salesforceCommunicationDetailSchema.parse(input.salesforceCommunicationDetail)
    );
  }

  if (input.simpleTextingMessageDetail !== undefined) {
    await persistence.upsertSimpleTextingMessageDetail(
      simpleTextingMessageDetailSchema.parse(input.simpleTextingMessageDetail)
    );
  }

  if (input.mailchimpCampaignActivityDetail !== undefined) {
    await persistence.upsertMailchimpCampaignActivityDetail(
      mailchimpCampaignActivityDetailSchema.parse(
        input.mailchimpCampaignActivityDetail
      )
    );
  }

  if (input.manualNoteDetail !== undefined) {
    await persistence.upsertManualNoteDetail(
      manualNoteDetailSchema.parse(input.manualNoteDetail)
    );
  }

  if (input.salesforceEventContext !== undefined) {
    await persistence.upsertSalesforceEventContext(
      salesforceEventContextSchema.parse(input.salesforceEventContext)
    );
  }
}

export function createStage1NormalizationService(
  persistence: Stage1PersistenceService
): Stage1NormalizationService {
  const identityResolutionContext = createIdentityResolutionContext(persistence);
  const service: Stage1NormalizationService = {
    persistence,

    async recordNormalizedSourceEvidence(input) {
      const parsed = normalizedSourceEvidenceIntakeSchema.parse(input);
      const result = await persistence.recordSourceEvidence(parsed.sourceEvidence);

      if (result.outcome === "conflict") {
        const auditEvidence = await recordQuarantineAuditOnce(persistence, {
          entityType: "source_evidence",
          entityId: `${parsed.sourceEvidence.provider}:${parsed.sourceEvidence.providerRecordType}:${parsed.sourceEvidence.providerRecordId}`,
          occurredAt: parsed.sourceEvidence.receivedAt,
          reasonCode: "replay_checksum_mismatch",
          action: "quarantine_source_evidence",
          metadataJson: {
            incomingId: parsed.sourceEvidence.id,
            incomingIdempotencyKey: parsed.sourceEvidence.idempotencyKey,
            conflictingRecordIds: result.conflictingRecords.map(
              (record) => record.id
            ),
            conflictReason: result.reason
          }
        });

        return {
          outcome: "quarantined",
          incoming: parsed.sourceEvidence,
          conflictingRecords: result.conflictingRecords,
          reasonCode: "replay_checksum_mismatch",
          auditEvidence
        };
      }

      return {
        outcome: result.outcome,
        record: result.record,
        auditEvidence: null
      };
    },

    async upsertNormalizedContactGraph(input) {
      const parsed = normalizedContactGraphUpsertInputSchema.parse(input);
      assertVolunteerScopedSalesforceContactGraph(parsed);
      const contact = await persistence.upsertCanonicalContact(
        contactSchema.parse(parsed.contact)
      );

      const identities: ContactIdentityRecord[] = [];
      for (const identity of parsed.identities) {
        const parsedIdentity = contactIdentitySchema.parse(identity);

        if (parsedIdentity.contactId !== parsed.contact.id) {
          throw new Error(
            `Contact identity ${parsedIdentity.id} does not belong to contact ${parsed.contact.id}.`
          );
        }

        identities.push(
          await persistence.upsertContactIdentity({
            ...parsedIdentity,
            contactId: contact.id
          })
        );
      }

      const memberships: ContactMembershipRecord[] = [];
      for (const membership of parsed.memberships) {
        const parsedMembership = contactMembershipSchema.parse(membership);

        if (parsedMembership.contactId !== parsed.contact.id) {
          throw new Error(
            `Contact membership ${parsedMembership.id} does not belong to contact ${parsed.contact.id}.`
          );
        }

        memberships.push(
          await persistence.upsertContactMembership({
            ...parsedMembership,
            contactId: contact.id
          })
        );
      }

      await upsertProjectAndExpeditionDimensions(persistence, {
        projectDimensions: parsed.projectDimensions,
        expeditionDimensions: parsed.expeditionDimensions
      });
      identityResolutionContext.clear();

      return {
        contact,
        identities,
        memberships
      };
    },

    async ensureCanonicalContactForEmail(input) {
      const normalizedEmail = normalizeEmailAddress(input.emailAddress);

      if (normalizedEmail === null) {
        throw new Error("Cannot ensure a canonical contact without an email.");
      }

      const identities =
        await persistence.repositories.contactIdentities.listByNormalizedValue({
          kind: "email",
          normalizedValue: normalizedEmail,
        });
      const existingContacts = uniqueById(
        (
          await Promise.all(
            uniqueStrings(identities.map((identity) => identity.contactId)).map(
              (contactId) => persistence.repositories.contacts.findById(contactId)
            )
          )
        ).filter((contact): contact is ContactRecord => contact !== null)
      );

      if (existingContacts.length > 0) {
        const [existingContact] = existingContacts;

      if (existingContact === undefined) {
        throw new Error(
          "Expected an existing contact when normalized email matches."
        );
      }

      if (existingContacts.length > 1) {
        throw new CanonicalContactAmbiguityError({
          normalizedEmail,
          candidateContactIds: existingContacts.map((contact) => contact.id)
        });
      }

      return existingContact;
    }

      return (
        await service.upsertNormalizedContactGraph(
          buildSyntheticContactGraphInput({
            normalizedEmail,
            normalizedPhone: null,
            createdAt: input.createdAt ?? new Date().toISOString(),
            source: input.source ?? "manual",
          })
        )
      ).contact;
    },

    async saveIdentityAmbiguityCase(input) {
      const parsed = identityAmbiguityInputSchema.parse(input);
      const caseRecord = await persistence.saveIdentityResolutionCase({
        id: buildIdentityCaseId(parsed.sourceEvidenceId, parsed.reasonCode),
        ...parsed
      });
      const inboxProjection =
        parsed.anchoredContactId === null
          ? null
          : await service.refreshInboxReviewOverlay({
              contactId: parsed.anchoredContactId
            });

      return {
        caseRecord,
        inboxProjection
      };
    },

    async saveRoutingAmbiguityCase(input) {
      const parsed = routingAmbiguityInputSchema.parse(input);
      const caseRecord = await persistence.saveRoutingReviewCase({
        id: buildRoutingCaseId(
          parsed.sourceEvidenceId,
          parsed.contactId,
          parsed.reasonCode
        ),
        ...parsed
      });
      const inboxProjection = await service.refreshInboxReviewOverlay({
        contactId: parsed.contactId
      });

      return {
        caseRecord,
        inboxProjection
      };
    },

    async applyTimelineProjection(input) {
      const parsed = timelineProjectionApplyInputSchema.parse(input);

      return persistence.saveTimelineProjection({
        id: buildTimelineProjectionId(parsed.canonicalEvent.id),
        contactId: parsed.canonicalEvent.contactId,
        canonicalEventId: parsed.canonicalEvent.id,
        occurredAt: parsed.canonicalEvent.occurredAt,
        sortKey: buildTimelineSortKey(
          parsed.canonicalEvent.id,
          parsed.canonicalEvent.occurredAt
        ),
        eventType: parsed.canonicalEvent.eventType,
        summary: parsed.summary,
        channel: parsed.canonicalEvent.channel,
        primaryProvider: parsed.canonicalEvent.provenance.primaryProvider,
        reviewState: parsed.canonicalEvent.reviewState
      });
    },

    async applyInboxProjection(input) {
      const parsed = inboxProjectionApplyInputSchema.parse(input);

      if (!isInboxDrivingCanonicalEvent(parsed.canonicalEvent)) {
        return persistence.repositories.inboxProjection.findByContactId(
          parsed.canonicalEvent.contactId
        );
      }

      const existing = await persistence.repositories.inboxProjection.findByContactId(
        parsed.canonicalEvent.contactId
      );
      const incomingIsInbound = isInboundEvent(parsed.canonicalEvent.eventType);
      const lastInboundAt = incomingIsInbound
        ? newestTimestamp(
            existing?.lastInboundAt ?? null,
            parsed.canonicalEvent.occurredAt
          )
        : existing?.lastInboundAt ?? null;
      const lastOutboundAt = incomingIsInbound
        ? existing?.lastOutboundAt ?? null
        : newestTimestamp(
            existing?.lastOutboundAt ?? null,
            parsed.canonicalEvent.occurredAt
          );
      const currentLatestKnownAt =
        existing === null
          ? null
          : newestTimestamp(existing.lastInboundAt, existing.lastOutboundAt);
      const incomingIsLatestKnown =
        currentLatestKnownAt === null ||
        parsed.canonicalEvent.occurredAt >= currentLatestKnownAt;
      const lastActivityAt = newestTimestamp(lastInboundAt, lastOutboundAt);

      if (lastActivityAt === null) {
        return null;
      }
      const hasUnresolved = await contactHasUnresolved(
        persistence,
        parsed.canonicalEvent.contactId
      );
      const bucket =
        existing === null
          ? incomingIsInbound
            ? "New"
            : "Opened"
          : incomingIsInbound && incomingIsLatestKnown
            ? "New"
            : existing.bucket;

      return persistence.saveInboxProjection({
        contactId: parsed.canonicalEvent.contactId,
        bucket,
        needsFollowUp: existing?.needsFollowUp ?? false,
        hasUnresolved,
        lastInboundAt,
        lastOutboundAt,
        lastActivityAt,
        snippet: incomingIsLatestKnown
          ? parsed.snippet
          : existing?.snippet ?? parsed.snippet,
        lastCanonicalEventId: incomingIsLatestKnown
          ? parsed.canonicalEvent.id
          : existing?.lastCanonicalEventId ?? parsed.canonicalEvent.id,
        lastEventType: incomingIsLatestKnown
          ? parsed.canonicalEvent.eventType
          : existing?.lastEventType ?? parsed.canonicalEvent.eventType
      });
    },

    async refreshInboxReviewOverlay(input) {
      const parsed = inboxReviewOverlayRefreshInputSchema.parse(input);
      const existing = await persistence.repositories.inboxProjection.findByContactId(
        parsed.contactId
      );

      if (existing === null) {
        return null;
      }

      const hasUnresolved = await contactHasUnresolved(
        persistence,
        parsed.contactId
      );

      if (existing.hasUnresolved === hasUnresolved) {
        return existing;
      }

      return persistence.saveInboxProjection({
        ...existing,
        hasUnresolved
      });
    },

    updateSyncState(input) {
      const parsed = syncStateUpdateInputSchema.parse(input);

      return persistence.saveSyncState(parsed.syncState);
    },

    async applyNormalizedCanonicalEvent(input, options) {
      const parsed = normalizedCanonicalEventIntakeSchema.parse(input);
      const sourceEvidenceResult = await service.recordNormalizedSourceEvidence({
        sourceEvidence: parsed.sourceEvidence
      });

      if (sourceEvidenceResult.outcome === "quarantined") {
        return {
          outcome: "quarantined",
          sourceEvidence: parsed.sourceEvidence,
          reasonCode: sourceEvidenceResult.reasonCode,
          explanation:
            "The incoming source evidence replay conflicted with previously recorded evidence.",
          existingCanonicalEvent: null,
          auditEvidence: sourceEvidenceResult.auditEvidence
        };
      }

      if (
        sourceEvidenceResult.outcome === "duplicate" &&
        options?.overwriteDuplicateGmailMessageDetail === false
      ) {
        const existingCanonicalEvent =
          await persistence.findCanonicalEventByIdempotencyKey(
            parsed.canonicalEvent.idempotencyKey
          );

        if (
          existingCanonicalEvent !== null &&
          findCanonicalEventForSourceEvidence(
            [existingCanonicalEvent],
            sourceEvidenceResult.record.id
          ) !== null
        ) {
          const existingTimelineProjection =
            await persistence.repositories.timelineProjection.findByCanonicalEventId(
              existingCanonicalEvent.id
            );
          const timelineProjection =
            existingTimelineProjection ??
            (await service.applyTimelineProjection({
              canonicalEvent: existingCanonicalEvent,
              summary: parsed.canonicalEvent.summary
            }));
          const inboxProjection = isInboxDrivingCanonicalEvent(
            existingCanonicalEvent
          )
            ? await persistence.repositories.inboxProjection.findByContactId(
                existingCanonicalEvent.contactId
              )
            : await service.refreshInboxReviewOverlay({
                contactId: existingCanonicalEvent.contactId
              });

          return {
            outcome: "duplicate",
            sourceEvidence: sourceEvidenceResult.record,
            canonicalEvent: existingCanonicalEvent,
            timelineProjection,
            inboxProjection,
            identityCase: null,
            routingCase: null,
            auditEvidence: null
          };
        }
      }

      const nonVolunteerTaskDecision =
        await resolveNonVolunteerSalesforceTaskSkip(
          persistence,
          identityResolutionContext,
          parsed
        );

      if (nonVolunteerTaskDecision.outcome === "skipped") {
        const auditEvidence = await recordSkipAuditOnce(persistence, {
          entityType: "source_evidence",
          entityId: sourceEvidenceResult.record.id,
          occurredAt: parsed.sourceEvidence.receivedAt,
          action: "skipped_non_volunteer_task",
          metadataJson: {
            salesforceTaskId: parsed.sourceEvidence.providerRecordId,
            whoId: nonVolunteerTaskDecision.whoId
          }
        });

        return {
          outcome: "skipped",
          sourceEvidence: sourceEvidenceResult.record,
          reasonCode: "skipped_non_volunteer_task",
          explanation: buildSkippedNonVolunteerTaskExplanation(),
          auditEvidence
        };
      }

      await upsertProviderPresentationDetails(persistence, {
        gmailMessageDetail: parsed.gmailMessageDetail,
        salesforceCommunicationDetail: parsed.salesforceCommunicationDetail,
        simpleTextingMessageDetail: parsed.simpleTextingMessageDetail,
        mailchimpCampaignActivityDetail: parsed.mailchimpCampaignActivityDetail,
        manualNoteDetail: parsed.manualNoteDetail,
        salesforceEventContext: parsed.salesforceEventContext,
        projectDimensions: parsed.projectDimensions,
        expeditionDimensions: parsed.expeditionDimensions
      }, {
        allowDuplicateGmailMessageDetailOverwrite:
          sourceEvidenceResult.outcome !== "duplicate" ||
          (options?.overwriteDuplicateGmailMessageDetail ?? true)
      });

      const duplicateCollapseDecision = decideDuplicateCollapse(parsed);

      if (duplicateCollapseDecision.outcome === "quarantined") {
        const auditEvidence = await recordQuarantineAuditOnce(persistence, {
          entityType: "canonical_event",
          entityId: parsed.canonicalEvent.idempotencyKey,
          occurredAt: parsed.sourceEvidence.receivedAt,
          reasonCode: duplicateCollapseDecision.reasonCode,
          action: "quarantine_duplicate_collapse",
          metadataJson: {
            canonicalEventId: parsed.canonicalEvent.id,
            eventType: parsed.canonicalEvent.eventType,
            primaryProvider: parsed.sourceEvidence.provider,
            supportingProviders: parsed.supportingSources.map(
              (entry) => entry.provider
            )
          }
        });

        return {
          outcome: "quarantined",
          sourceEvidence: sourceEvidenceResult.record,
          reasonCode: duplicateCollapseDecision.reasonCode,
          explanation: duplicateCollapseDecision.explanation,
          existingCanonicalEvent: null,
          auditEvidence
        };
      }

      const identityDecision = await resolveIdentityDecision(
        identityResolutionContext,
        sourceEvidenceResult.record.id,
        parsed.sourceEvidence.receivedAt,
        parsed.identity,
        parsed.sourceEvidence.provider
      );

      if (identityDecision.outcome === "needs_identity_review") {
        const { caseRecord } = await service.saveIdentityAmbiguityCase(
          identityDecision.reviewInput
        );

        return {
          outcome: "needs_identity_review",
          sourceEvidence: sourceEvidenceResult.record,
          identityCase: caseRecord,
          auditEvidence: null
        };
      }

      const resolvedContact =
        identityDecision.outcome === "create_new_contact"
          ? (
              await service.upsertNormalizedContactGraph(
                buildSyntheticContactGraphInput({
                  normalizedEmail: identityDecision.normalizedEmail,
                  normalizedPhone: identityDecision.normalizedPhone,
                  createdAt: parsed.sourceEvidence.receivedAt,
                  source: parsed.sourceEvidence.provider
                })
              )
            ).contact
          : identityDecision.contact;
      const identityReviewInput =
        identityDecision.outcome === "resolved"
          ? identityDecision.reviewInput
          : null;

      const routingDecision = await resolveRoutingDecision(persistence, {
        contactId: resolvedContact.id,
        sourceEvidenceId: sourceEvidenceResult.record.id,
        openedAt: parsed.sourceEvidence.receivedAt,
        routing: parsed.routing
      });
      const reviewState = pickCanonicalReviewState({
        hasIdentityReview: identityReviewInput !== null,
        hasRoutingReview: routingDecision.reviewInput !== null
      });
      const supportingSourceEvidenceIds = uniqueStrings(
        parsed.supportingSources.map((entry) => entry.sourceEvidenceId)
      );
      const communicationClassification =
        parsed.communicationClassification ?? null;
      const inboxProjectionExclusionReason =
        detectInboxProjectionExclusionReason(parsed);
      const contentFingerprintSource = buildIncomingContentFingerprintSource(
        parsed
      );
      const contentFingerprint =
        contentFingerprintSource === null
          ? null
          : computeContentFingerprint({
              ...contentFingerprintSource,
              contactId: resolvedContact.id
            });
      const canonicalEvent = canonicalEventSchema.parse({
        id: parsed.canonicalEvent.id,
        contactId: resolvedContact.id,
        eventType: parsed.canonicalEvent.eventType,
        channel: resolveCanonicalChannel(parsed.canonicalEvent.eventType),
        occurredAt: parsed.canonicalEvent.occurredAt,
        contentFingerprint,
        sourceEvidenceId: sourceEvidenceResult.record.id,
        idempotencyKey: parsed.canonicalEvent.idempotencyKey,
        provenance: {
          primaryProvider: parsed.sourceEvidence.provider,
          primarySourceEvidenceId: sourceEvidenceResult.record.id,
          supportingSourceEvidenceIds,
          winnerReason: duplicateCollapseDecision.winner.winnerReason,
          sourceRecordType:
            communicationClassification?.sourceRecordType ??
            parsed.sourceEvidence.providerRecordType,
          sourceRecordId:
            communicationClassification?.sourceRecordId ??
            parsed.sourceEvidence.providerRecordId,
          messageKind: communicationClassification?.messageKind ?? null,
          campaignRef: communicationClassification?.campaignRef ?? null,
          threadRef: communicationClassification?.threadRef ?? null,
          direction: communicationClassification?.direction ?? null,
          ...(inboxProjectionExclusionReason === null
            ? {}
            : { inboxProjectionExclusionReason }),
          notes: duplicateCollapseDecision.winner.notes
        },
        reviewState
      });
      let contactEvents: readonly CanonicalEventRecord[] | null = null;
      const getContactEvents = async (): Promise<
        readonly CanonicalEventRecord[]
      > => {
        if (contactEvents !== null) {
          return contactEvents;
        }

        contactEvents = await persistence.repositories.canonicalEvents.listByContactId(
          resolvedContact.id
        );
        return contactEvents;
      };
      const alreadyMergedEvent =
        sourceEvidenceResult.outcome === "duplicate"
          ? findCanonicalEventForSourceEvidence(
              await getContactEvents(),
              sourceEvidenceResult.record.id
            )
          : null;

      if (alreadyMergedEvent !== null) {
        const persistedEvent =
          alreadyMergedEvent.reviewState === reviewState
            ? alreadyMergedEvent
            : await persistence.repositories.canonicalEvents.upsert({
                ...alreadyMergedEvent,
                reviewState: mergeCanonicalReviewState(
                  alreadyMergedEvent.reviewState,
                  reviewState
                )
              });
        const identityCase =
          identityReviewInput === null
            ? null
            : (
                await service.saveIdentityAmbiguityCase(
                  identityReviewInput
                )
              ).caseRecord;
        const routingCase =
          routingDecision.reviewInput === null
            ? null
            : (
                await service.saveRoutingAmbiguityCase(
                  routingDecision.reviewInput
                )
              )
                .caseRecord;
        const existingTimelineProjection =
          await persistence.repositories.timelineProjection.findByCanonicalEventId(
            persistedEvent.id
          );
        const timelineProjection =
          existingTimelineProjection === null
            ? await service.applyTimelineProjection({
                canonicalEvent: persistedEvent,
                summary: parsed.canonicalEvent.summary
              })
            : persistedEvent.reviewState === alreadyMergedEvent.reviewState
              ? existingTimelineProjection
              : await service.applyTimelineProjection({
                  canonicalEvent: persistedEvent,
                  summary: existingTimelineProjection.summary
                });
        const inboxProjection = isInboxDrivingCanonicalEvent(persistedEvent)
          ? await rebuildInboxProjectionForContact(
              persistence,
              persistedEvent.contactId
            )
          : await service.refreshInboxReviewOverlay({
              contactId: persistedEvent.contactId
            });
        await reconcilePendingComposerOutbound(persistence, {
          sourceEvidence: sourceEvidenceResult.record,
          canonicalEvent: persistedEvent
        });

        return {
          outcome: "duplicate",
          sourceEvidence: sourceEvidenceResult.record,
          canonicalEvent: persistedEvent,
          timelineProjection,
          inboxProjection,
          identityCase,
          routingCase,
          auditEvidence: null
        };
      }

      const duplicateMatch =
        parsed.canonicalEvent.eventType === "communication.email.outbound"
          ? await findOutboundEmailDuplicateMatch(persistence, {
              existingEvents: await getContactEvents(),
              contactId: resolvedContact.id,
              incoming: {
                canonicalEvent: {
                  ...parsed.canonicalEvent,
                  contentFingerprint
                },
                ...(communicationClassification === null
                  ? {}
                  : { communicationClassification }),
                sourceEvidence: sourceEvidenceResult.record,
                gmailMessageDetail: parsed.gmailMessageDetail,
                salesforceCommunicationDetail:
                  parsed.salesforceCommunicationDetail
              }
            })
          : null;

      if (duplicateMatch !== null) {
        const mergedSupportingSourceEvidenceIds = uniqueStrings([
          ...duplicateMatch.existingEvent.provenance.supportingSourceEvidenceIds,
          ...supportingSourceEvidenceIds,
          duplicateMatch.existingEvent.sourceEvidenceId,
          sourceEvidenceResult.record.id
        ]).filter(
          (sourceEvidenceId) =>
            sourceEvidenceId !==
            (duplicateMatch.winner.keepIncomingAsPrimary
              ? sourceEvidenceResult.record.id
              : duplicateMatch.existingEvent.sourceEvidenceId)
        );
        const supportingProviders = new Set<
          CanonicalEventRecord["provenance"]["primaryProvider"]
        >([
          ...parsed.supportingSources.map((entry) => entry.provider),
          duplicateMatch.winner.keepIncomingAsPrimary
            ? duplicateMatch.existingEvent.provenance.primaryProvider
            : parsed.sourceEvidence.provider
        ]);

        if (
          duplicateMatch.existingEvent.provenance.winnerReason ===
          "gmail_wins_duplicate_collapse"
        ) {
          supportingProviders.add("salesforce");
        }

        if (
          duplicateMatch.existingEvent.provenance.winnerReason ===
          "earliest_gmail_wins_duplicate_collapse"
        ) {
          supportingProviders.add("gmail");
        }

        const mergedWinner = resolveOutboundEmailMergedWinnerDecision({
          primaryProvider: duplicateMatch.winner.keepIncomingAsPrimary
            ? canonicalEvent.provenance.primaryProvider
            : duplicateMatch.existingEvent.provenance.primaryProvider,
          supportingProviders: [...supportingProviders],
          fallback: duplicateMatch.winner
        });
        const persistedEvent = await persistence.repositories.canonicalEvents.upsert(
          canonicalEventSchema.parse({
            id: duplicateMatch.existingEvent.id,
            contactId: resolvedContact.id,
            eventType: canonicalEvent.eventType,
            channel: canonicalEvent.channel,
            occurredAt: duplicateMatch.winner.keepIncomingAsPrimary
              ? canonicalEvent.occurredAt
              : duplicateMatch.existingEvent.occurredAt,
            contentFingerprint: duplicateMatch.winner.keepIncomingAsPrimary
              ? canonicalEvent.contentFingerprint
              : duplicateMatch.existingEvent.contentFingerprint,
            sourceEvidenceId: duplicateMatch.winner.keepIncomingAsPrimary
              ? sourceEvidenceResult.record.id
              : duplicateMatch.existingEvent.sourceEvidenceId,
            idempotencyKey: duplicateMatch.winner.keepIncomingAsPrimary
              ? canonicalEvent.idempotencyKey
              : duplicateMatch.existingEvent.idempotencyKey,
            provenance: {
              primaryProvider: duplicateMatch.winner.keepIncomingAsPrimary
                ? canonicalEvent.provenance.primaryProvider
                : duplicateMatch.existingEvent.provenance.primaryProvider,
              primarySourceEvidenceId: duplicateMatch.winner.keepIncomingAsPrimary
                ? sourceEvidenceResult.record.id
                : duplicateMatch.existingEvent.sourceEvidenceId,
              supportingSourceEvidenceIds: mergedSupportingSourceEvidenceIds,
              winnerReason: mergedWinner.winnerReason,
              sourceRecordType: duplicateMatch.winner.keepIncomingAsPrimary
                ? canonicalEvent.provenance.sourceRecordType
                : duplicateMatch.existingEvent.provenance.sourceRecordType,
              sourceRecordId: duplicateMatch.winner.keepIncomingAsPrimary
                ? canonicalEvent.provenance.sourceRecordId
                : duplicateMatch.existingEvent.provenance.sourceRecordId,
              messageKind: duplicateMatch.winner.keepIncomingAsPrimary
                ? canonicalEvent.provenance.messageKind
                : duplicateMatch.existingEvent.provenance.messageKind,
              campaignRef: duplicateMatch.winner.keepIncomingAsPrimary
                ? canonicalEvent.provenance.campaignRef
                : duplicateMatch.existingEvent.provenance.campaignRef,
              threadRef: duplicateMatch.winner.keepIncomingAsPrimary
                ? canonicalEvent.provenance.threadRef
                : duplicateMatch.existingEvent.provenance.threadRef,
              direction: duplicateMatch.winner.keepIncomingAsPrimary
                ? canonicalEvent.provenance.direction
                : duplicateMatch.existingEvent.provenance.direction,
              ...((duplicateMatch.winner.keepIncomingAsPrimary
                ? canonicalEvent.provenance.inboxProjectionExclusionReason
                : duplicateMatch.existingEvent.provenance
                    .inboxProjectionExclusionReason) === undefined
                ? {}
                : {
                    inboxProjectionExclusionReason:
                      duplicateMatch.winner.keepIncomingAsPrimary
                        ? canonicalEvent.provenance.inboxProjectionExclusionReason
                        : duplicateMatch.existingEvent.provenance
                            .inboxProjectionExclusionReason
                  }),
              notes: mergedWinner.notes
            },
            reviewState: mergeCanonicalReviewState(
              duplicateMatch.existingEvent.reviewState,
              canonicalEvent.reviewState
            )
          })
        );
        const identityCase =
          identityReviewInput === null
            ? null
            : (
                await service.saveIdentityAmbiguityCase(
                  identityReviewInput
                )
              ).caseRecord;
        const routingCase =
          routingDecision.reviewInput === null
            ? null
            : (
                await service.saveRoutingAmbiguityCase(
                  routingDecision.reviewInput
                )
              )
                .caseRecord;
        const timelineProjection = await service.applyTimelineProjection({
          canonicalEvent: persistedEvent,
          summary: duplicateMatch.winner.keepIncomingAsPrimary
            ? parsed.canonicalEvent.summary
            : duplicateMatch.existingTimelineProjection?.summary ??
              parsed.canonicalEvent.summary
        });
        const inboxProjection = await rebuildInboxProjectionForContact(
          persistence,
          persistedEvent.contactId
        );
        await reconcilePendingComposerOutbound(persistence, {
          sourceEvidence: sourceEvidenceResult.record,
          canonicalEvent: persistedEvent
        });

        return {
          outcome: "applied",
          sourceEvidence: sourceEvidenceResult.record,
          canonicalEvent: persistedEvent,
          timelineProjection,
          inboxProjection,
          identityCase,
          routingCase,
          auditEvidence: null
        };
      }

      const eventWriteResult = await persistence.persistCanonicalEvent(canonicalEvent);

      if (eventWriteResult.outcome === "conflict") {
        const auditEvidence = await recordQuarantineAuditOnce(persistence, {
          entityType: "canonical_event",
          entityId: parsed.canonicalEvent.idempotencyKey,
          occurredAt: parsed.sourceEvidence.receivedAt,
          reasonCode: "duplicate_collapse_conflict",
          action: "quarantine_canonical_event",
          metadataJson: {
            incomingCanonicalEventId: parsed.canonicalEvent.id,
            existingCanonicalEventId: eventWriteResult.existing.id,
            reason: eventWriteResult.reason
          }
        });

        return {
          outcome: "quarantined",
          sourceEvidence: sourceEvidenceResult.record,
          reasonCode: "duplicate_collapse_conflict",
          explanation:
            "The canonical event idempotency key already exists with a different canonical interpretation.",
          existingCanonicalEvent: eventWriteResult.existing,
          auditEvidence
        };
      }

      const persistedEvent = eventWriteResult.record;
      const identityCase =
        identityReviewInput === null
          ? null
          : (
              await service.saveIdentityAmbiguityCase(
                identityReviewInput
              )
            ).caseRecord;
      const routingCase =
        routingDecision.reviewInput === null
          ? null
          : (
              await service.saveRoutingAmbiguityCase(
                routingDecision.reviewInput
              )
            )
              .caseRecord;
      const timelineProjection = await service.applyTimelineProjection({
        canonicalEvent: persistedEvent,
        summary: parsed.canonicalEvent.summary
      });
      const inboxProjection = isInboxDrivingCanonicalEvent(persistedEvent)
        ? await service.applyInboxProjection({
            canonicalEvent: persistedEvent,
            snippet: parsed.canonicalEvent.snippet
          })
        : await service.refreshInboxReviewOverlay({
            contactId: persistedEvent.contactId
          });
      await reconcilePendingComposerOutbound(persistence, {
        sourceEvidence: sourceEvidenceResult.record,
        canonicalEvent: persistedEvent
      });

      return {
        outcome: eventWriteResult.outcome === "inserted" ? "applied" : "duplicate",
        sourceEvidence: sourceEvidenceResult.record,
        canonicalEvent: persistedEvent,
        timelineProjection,
        inboxProjection,
        identityCase,
        routingCase,
        auditEvidence: null
      };
    }
  };

  return service;
}
