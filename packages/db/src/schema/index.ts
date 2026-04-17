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
  mailchimpCampaignActivityDetails,
  manualNoteDetails,
  projectDimensions,
  routingReviewQueue,
  salesforceCommunicationDetails,
  salesforceEventContext,
  simpleTextingMessageDetails,
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
  salesforceCommunicationDetails,
  simpleTextingMessageDetails,
  mailchimpCampaignActivityDetails,
  manualNoteDetails,
  canonicalEventLedger,
  identityResolutionQueue,
  routingReviewQueue,
  contactInboxProjection,
  contactTimelineProjection,
  syncState,
  auditPolicyEvidence
};

export type DatabaseSchema = typeof databaseSchema;
