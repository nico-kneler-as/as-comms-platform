export * from "./enums.js";
export * from "./tables.js";
import {
  auditPolicyEvidence,
  canonicalEventLedger,
  contactIdentities,
  contactInboxProjection,
  contactMemberships,
  contactTimelineProjection,
  contacts,
  identityResolutionQueue,
  routingReviewQueue,
  sourceEvidenceLog,
  syncState
} from "./tables.js";

export const databaseSchema = {
  sourceEvidenceLog,
  contacts,
  contactIdentities,
  contactMemberships,
  canonicalEventLedger,
  identityResolutionQueue,
  routingReviewQueue,
  contactInboxProjection,
  contactTimelineProjection,
  syncState,
  auditPolicyEvidence
};

export type DatabaseSchema = typeof databaseSchema;
