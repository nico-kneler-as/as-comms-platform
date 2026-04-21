import {
  auditEvidenceSchema,
  canonicalEventSchema,
  contactIdentitySchema,
  contactMembershipSchema,
  contactSchema,
  expeditionDimensionSchema,
  gmailMessageDetailSchema,
  identityResolutionSchema,
  inboxProjectionSchema,
  mailchimpCampaignActivityDetailSchema,
  manualNoteDetailSchema,
  projectDimensionSchema,
  routingReviewSchema,
  salesforceCommunicationDetailSchema,
  salesforceEventContextSchema,
  simpleTextingMessageDetailSchema,
  sourceEvidenceSchema,
  syncStateSchema,
  timelineProjectionSchema,
  type AuditEvidenceRecord,
  type CanonicalEventRecord,
  type ContactIdentityRecord,
  type ContactMembershipRecord,
  type ContactRecord,
  type ExpeditionDimensionRecord,
  type GmailMessageDetailRecord,
  type IdentityResolutionCase,
  type InboxProjectionRow,
  type MailchimpCampaignActivityDetailRecord,
  type ManualNoteDetailRecord,
  type ProjectDimensionRecord,
  type RoutingReviewCase,
  type SalesforceCommunicationDetailRecord,
  type SalesforceEventContextRecord,
  type SimpleTextingMessageDetailRecord,
  type SourceEvidenceRecord,
  type SyncStateRecord,
  type TimelineProjectionRow
} from "@as-comms/contracts";

import type { Stage1RepositoryBundle } from "./repositories.js";

export type SourceEvidenceConflictReason =
  | "idempotency_key_mismatch"
  | "provider_record_mismatch";

export type CanonicalEventConflictReason = "idempotency_key_mismatch";

export type SourceEvidenceWriteResult =
  | {
      readonly outcome: "inserted" | "duplicate";
      readonly record: SourceEvidenceRecord;
    }
  | {
      readonly outcome: "conflict";
      readonly incoming: SourceEvidenceRecord;
      readonly conflictingRecords: readonly SourceEvidenceRecord[];
      readonly reason: SourceEvidenceConflictReason;
    };

export type CanonicalEventWriteResult =
  | {
      readonly outcome: "inserted" | "duplicate";
      readonly record: CanonicalEventRecord;
    }
  | {
      readonly outcome: "conflict";
      readonly incoming: CanonicalEventRecord;
      readonly existing: CanonicalEventRecord;
      readonly reason: CanonicalEventConflictReason;
    };

export interface Stage1PersistenceService {
  readonly repositories: Stage1RepositoryBundle;
  findSourceEvidenceByIdempotencyKey(
    idempotencyKey: string
  ): Promise<SourceEvidenceRecord | null>;
  recordSourceEvidence(
    record: SourceEvidenceRecord
  ): Promise<SourceEvidenceWriteResult>;
  findCanonicalEventByIdempotencyKey(
    idempotencyKey: string
  ): Promise<CanonicalEventRecord | null>;
  persistCanonicalEvent(
    record: CanonicalEventRecord
  ): Promise<CanonicalEventWriteResult>;
  upsertCanonicalContact(record: ContactRecord): Promise<ContactRecord>;
  upsertContactIdentity(
    record: ContactIdentityRecord
  ): Promise<ContactIdentityRecord>;
  upsertContactMembership(
    record: ContactMembershipRecord
  ): Promise<ContactMembershipRecord>;
  upsertProjectDimension(
    record: ProjectDimensionRecord
  ): Promise<ProjectDimensionRecord>;
  upsertExpeditionDimension(
    record: ExpeditionDimensionRecord
  ): Promise<ExpeditionDimensionRecord>;
  upsertGmailMessageDetail(
    record: GmailMessageDetailRecord
  ): Promise<GmailMessageDetailRecord>;
  upsertSalesforceEventContext(
    record: SalesforceEventContextRecord
  ): Promise<SalesforceEventContextRecord>;
  upsertSalesforceCommunicationDetail(
    record: SalesforceCommunicationDetailRecord
  ): Promise<SalesforceCommunicationDetailRecord>;
  upsertSimpleTextingMessageDetail(
    record: SimpleTextingMessageDetailRecord
  ): Promise<SimpleTextingMessageDetailRecord>;
  upsertMailchimpCampaignActivityDetail(
    record: MailchimpCampaignActivityDetailRecord
  ): Promise<MailchimpCampaignActivityDetailRecord>;
  upsertManualNoteDetail(
    record: ManualNoteDetailRecord
  ): Promise<ManualNoteDetailRecord>;
  saveIdentityResolutionCase(
    record: IdentityResolutionCase
  ): Promise<IdentityResolutionCase>;
  saveRoutingReviewCase(record: RoutingReviewCase): Promise<RoutingReviewCase>;
  saveInboxProjection(record: InboxProjectionRow): Promise<InboxProjectionRow>;
  saveTimelineProjection(
    record: TimelineProjectionRow
  ): Promise<TimelineProjectionRow>;
  saveSyncState(record: SyncStateRecord): Promise<SyncStateRecord>;
  recordAuditEvidence(record: AuditEvidenceRecord): Promise<AuditEvidenceRecord>;
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function sameSourceEvidenceRecord(
  incoming: SourceEvidenceRecord,
  existing: SourceEvidenceRecord
): boolean {
  return (
    incoming.provider === existing.provider &&
    incoming.providerRecordType === existing.providerRecordType &&
    incoming.providerRecordId === existing.providerRecordId &&
    incoming.occurredAt === existing.occurredAt &&
    incoming.idempotencyKey === existing.idempotencyKey &&
    incoming.checksum === existing.checksum
  );
}

function sameCanonicalEventRecord(
  incoming: CanonicalEventRecord,
  existing: CanonicalEventRecord
): boolean {
  const incomingCampaignRef = incoming.provenance.campaignRef ?? null;
  const existingCampaignRef = existing.provenance.campaignRef ?? null;
  const incomingThreadRef = incoming.provenance.threadRef ?? null;
  const existingThreadRef = existing.provenance.threadRef ?? null;

  return (
    incoming.contactId === existing.contactId &&
    incoming.eventType === existing.eventType &&
    incoming.channel === existing.channel &&
    incoming.occurredAt === existing.occurredAt &&
    (incoming.contentFingerprint ?? null) ===
      (existing.contentFingerprint ?? null) &&
    incoming.sourceEvidenceId === existing.sourceEvidenceId &&
    incoming.idempotencyKey === existing.idempotencyKey &&
    incoming.reviewState === existing.reviewState &&
    incoming.provenance.primaryProvider === existing.provenance.primaryProvider &&
    incoming.provenance.primarySourceEvidenceId ===
      existing.provenance.primarySourceEvidenceId &&
    incoming.provenance.winnerReason === existing.provenance.winnerReason &&
    (incoming.provenance.sourceRecordType ?? null) ===
      (existing.provenance.sourceRecordType ?? null) &&
    (incoming.provenance.sourceRecordId ?? null) ===
      (existing.provenance.sourceRecordId ?? null) &&
    (incoming.provenance.messageKind ?? null) ===
      (existing.provenance.messageKind ?? null) &&
    (incoming.provenance.direction ?? null) ===
      (existing.provenance.direction ?? null) &&
    (incomingCampaignRef?.providerCampaignId ?? null) ===
      (existingCampaignRef?.providerCampaignId ?? null) &&
    (incomingCampaignRef?.providerAudienceId ?? null) ===
      (existingCampaignRef?.providerAudienceId ?? null) &&
    (incomingCampaignRef?.providerMessageName ?? null) ===
      (existingCampaignRef?.providerMessageName ?? null) &&
    (incomingThreadRef?.crossProviderCollapseKey ?? null) ===
      (existingThreadRef?.crossProviderCollapseKey ?? null) &&
    (incomingThreadRef?.providerThreadId ?? null) ===
      (existingThreadRef?.providerThreadId ?? null) &&
    (incoming.provenance.notes ?? null) === (existing.provenance.notes ?? null) &&
    arraysEqual(
      incoming.provenance.supportingSourceEvidenceIds,
      existing.provenance.supportingSourceEvidenceIds
    )
  );
}

function mergeAnchoredContact(
  incoming: ContactRecord,
  anchored: ContactRecord
): ContactRecord {
  return contactSchema.parse({
    id: anchored.id,
    salesforceContactId:
      incoming.salesforceContactId ?? anchored.salesforceContactId,
    displayName: incoming.displayName,
    primaryEmail: incoming.primaryEmail ?? anchored.primaryEmail,
    primaryPhone: incoming.primaryPhone ?? anchored.primaryPhone,
    createdAt: anchored.createdAt,
    updatedAt: incoming.updatedAt
  });
}

export function createStage1PersistenceService(
  repositories: Stage1RepositoryBundle
): Stage1PersistenceService {
  return {
    repositories,

    findSourceEvidenceByIdempotencyKey(idempotencyKey) {
      return repositories.sourceEvidence.findByIdempotencyKey(idempotencyKey);
    },

    async recordSourceEvidence(record) {
      const parsed = sourceEvidenceSchema.parse(record);

      const existingByIdempotency =
        await repositories.sourceEvidence.findByIdempotencyKey(
          parsed.idempotencyKey
        );

      if (existingByIdempotency) {
        if (sameSourceEvidenceRecord(parsed, existingByIdempotency)) {
          return {
            outcome: "duplicate",
            record: existingByIdempotency
          };
        }

        return {
          outcome: "conflict",
          incoming: parsed,
          conflictingRecords: [existingByIdempotency],
          reason: "idempotency_key_mismatch"
        };
      }

      const providerRecordMatches =
        await repositories.sourceEvidence.listByProviderRecord({
          provider: parsed.provider,
          providerRecordType: parsed.providerRecordType,
          providerRecordId: parsed.providerRecordId
        });

      const exactProviderRecordMatch = providerRecordMatches.find((existing) =>
        sameSourceEvidenceRecord(parsed, existing)
      );

      if (exactProviderRecordMatch) {
        return {
          outcome: "duplicate",
          record: exactProviderRecordMatch
        };
      }

      if (providerRecordMatches.length > 0) {
        return {
          outcome: "conflict",
          incoming: parsed,
          conflictingRecords: providerRecordMatches,
          reason: "provider_record_mismatch"
        };
      }

      const inserted = await repositories.sourceEvidence.append(parsed);

      return {
        outcome: "inserted",
        record: inserted
      };
    },

    findCanonicalEventByIdempotencyKey(idempotencyKey) {
      return repositories.canonicalEvents.findByIdempotencyKey(idempotencyKey);
    },

    async persistCanonicalEvent(record) {
      const parsed = canonicalEventSchema.parse(record);
      const existing = await repositories.canonicalEvents.findByIdempotencyKey(
        parsed.idempotencyKey
      );

      if (existing) {
        if (sameCanonicalEventRecord(parsed, existing)) {
          return {
            outcome: "duplicate",
            record: existing
          };
        }

        return {
          outcome: "conflict",
          incoming: parsed,
          existing,
          reason: "idempotency_key_mismatch"
        };
      }

      const persisted = await repositories.canonicalEvents.upsert(parsed);

      return {
        outcome: "inserted",
        record: persisted
      };
    },

    async upsertCanonicalContact(record) {
      const parsed = contactSchema.parse(record);

      if (parsed.salesforceContactId === null) {
        return repositories.contacts.upsert(parsed);
      }

      const anchored = await repositories.contacts.findBySalesforceContactId(
        parsed.salesforceContactId
      );

      if (anchored === null || anchored.id === parsed.id) {
        return repositories.contacts.upsert(parsed);
      }

      return repositories.contacts.upsert(mergeAnchoredContact(parsed, anchored));
    },

    upsertContactIdentity(record) {
      return repositories.contactIdentities.upsert(
        contactIdentitySchema.parse(record)
      );
    },

    upsertContactMembership(record) {
      return repositories.contactMemberships.upsert(
        contactMembershipSchema.parse(record)
      );
    },

    upsertProjectDimension(record) {
      return repositories.projectDimensions.upsert(
        projectDimensionSchema.parse(record)
      );
    },

    upsertExpeditionDimension(record) {
      return repositories.expeditionDimensions.upsert(
        expeditionDimensionSchema.parse(record)
      );
    },

    upsertGmailMessageDetail(record) {
      return repositories.gmailMessageDetails.upsert(
        gmailMessageDetailSchema.parse(record)
      );
    },

    upsertSalesforceEventContext(record) {
      return repositories.salesforceEventContext.upsert(
        salesforceEventContextSchema.parse(record)
      );
    },

    upsertSalesforceCommunicationDetail(record) {
      return repositories.salesforceCommunicationDetails.upsert(
        salesforceCommunicationDetailSchema.parse(record)
      );
    },

    upsertSimpleTextingMessageDetail(record) {
      return repositories.simpleTextingMessageDetails.upsert(
        simpleTextingMessageDetailSchema.parse(record)
      );
    },

    upsertMailchimpCampaignActivityDetail(record) {
      return repositories.mailchimpCampaignActivityDetails.upsert(
        mailchimpCampaignActivityDetailSchema.parse(record)
      );
    },

    upsertManualNoteDetail(record) {
      return repositories.manualNoteDetails.upsert(
        manualNoteDetailSchema.parse(record)
      );
    },

    saveIdentityResolutionCase(record) {
      return repositories.identityResolutionQueue.upsert(
        identityResolutionSchema.parse(record)
      );
    },

    saveRoutingReviewCase(record) {
      return repositories.routingReviewQueue.upsert(
        routingReviewSchema.parse(record)
      );
    },

    saveInboxProjection(record) {
      return repositories.inboxProjection.upsert(
        inboxProjectionSchema.parse(record)
      );
    },

    saveTimelineProjection(record) {
      return repositories.timelineProjection.upsert(
        timelineProjectionSchema.parse(record)
      );
    },

    saveSyncState(record) {
      return repositories.syncState.upsert(syncStateSchema.parse(record));
    },

    recordAuditEvidence(record) {
      return repositories.auditEvidence.append(auditEvidenceSchema.parse(record));
    }
  };
}
