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
  expeditionDimensions,
  gmailMessageDetails,
  identityResolutionQueue,
  projectDimensions,
  routingReviewQueue,
  salesforceEventContext,
  sourceEvidenceLog,
  syncState
} from "./tables.js";

export const databaseSchema = {
  sourceEvidenceLog,
  contacts,
  contactIdentities,
  contactMemberships,
  projectDimensions,
  expeditionDimensions,
  gmailMessageDetails,
  salesforceEventContext,
  canonicalEventLedger,
  identityResolutionQueue,
  routingReviewQueue,
  contactInboxProjection,
  contactTimelineProjection,
  syncState,
  auditPolicyEvidence
};

export type DatabaseSchema = typeof databaseSchema;
