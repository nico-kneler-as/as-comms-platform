export * from "./enums.js";
export * from "./tables.js";
import {
  accounts,
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
  projectAliases,
  projectDimensions,
  routingReviewQueue,
  salesforceCommunicationDetails,
  salesforceEventContext,
  sessions,
  simpleTextingMessageDetails,
  sourceEvidenceLog,
  syncState,
  users,
  verificationTokens
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
  auditPolicyEvidence,
  users,
  accounts,
  sessions,
  verificationTokens,
  projectAliases
};

export type DatabaseSchema = typeof databaseSchema;
