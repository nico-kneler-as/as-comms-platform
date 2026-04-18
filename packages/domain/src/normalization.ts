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
  type ProvenanceWinnerReason,
  type QuarantineReasonCode,
  type RoutingAmbiguityInput,
  type RoutingReviewCase,
  type SourceEvidenceRecord,
  type SyncStateRecord,
  type SyncStateUpdateInput,
  type TimelineProjectionApplyInput,
  type TimelineProjectionRow
} from "@as-comms/contracts";

import {
  isInboxDrivingCanonicalEvent
} from "./inbox-driving.js";
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
    input: NormalizedCanonicalEventIntake
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
  identity: NormalizedIdentityEvidence
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

  if (identity.salesforceContactId !== null) {
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
  >
): Promise<void> {
  await upsertProjectAndExpeditionDimensions(persistence, {
    projectDimensions: input.projectDimensions ?? [],
    expeditionDimensions: input.expeditionDimensions ?? []
  });

  if (input.gmailMessageDetail !== undefined) {
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

    async applyNormalizedCanonicalEvent(input) {
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

      await upsertProviderPresentationDetails(persistence, {
        gmailMessageDetail: parsed.gmailMessageDetail,
        salesforceCommunicationDetail: parsed.salesforceCommunicationDetail,
        simpleTextingMessageDetail: parsed.simpleTextingMessageDetail,
        mailchimpCampaignActivityDetail: parsed.mailchimpCampaignActivityDetail,
        manualNoteDetail: parsed.manualNoteDetail,
        salesforceEventContext: parsed.salesforceEventContext,
        projectDimensions: parsed.projectDimensions,
        expeditionDimensions: parsed.expeditionDimensions
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
        parsed.identity
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

      const routingDecision = await resolveRoutingDecision(persistence, {
        contactId: identityDecision.contact.id,
        sourceEvidenceId: sourceEvidenceResult.record.id,
        openedAt: parsed.sourceEvidence.receivedAt,
        routing: parsed.routing
      });
      const reviewState = pickCanonicalReviewState({
        hasIdentityReview: identityDecision.reviewInput !== null,
        hasRoutingReview: routingDecision.reviewInput !== null
      });
      const supportingSourceEvidenceIds = uniqueStrings(
        parsed.supportingSources.map((entry) => entry.sourceEvidenceId)
      );
      const communicationClassification =
        parsed.communicationClassification ?? null;
      const canonicalEvent = canonicalEventSchema.parse({
        id: parsed.canonicalEvent.id,
        contactId: identityDecision.contact.id,
        eventType: parsed.canonicalEvent.eventType,
        channel: resolveCanonicalChannel(parsed.canonicalEvent.eventType),
        occurredAt: parsed.canonicalEvent.occurredAt,
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
          notes: duplicateCollapseDecision.winner.notes
        },
        reviewState
      });
      const eventWriteResult = await persistence.persistCanonicalEvent(
        canonicalEvent
      );

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
        identityDecision.reviewInput === null
          ? null
          : (
              await service.saveIdentityAmbiguityCase(
                identityDecision.reviewInput
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
