import { z } from "zod";

export const providerValues = [
  "gmail",
  "salesforce",
  "simpletexting",
  "mailchimp"
] as const;
export const providerSchema = z.enum(providerValues);
export type Provider = z.infer<typeof providerSchema>;

export const recordSourceValues = [
  "gmail",
  "salesforce",
  "simpletexting",
  "mailchimp",
  "manual",
  "system"
] as const;
export const recordSourceSchema = z.enum(recordSourceValues);
export type RecordSource = z.infer<typeof recordSourceSchema>;

export const channelValues = [
  "email",
  "sms",
  "lifecycle",
  "campaign_email"
] as const;
export const channelSchema = z.enum(channelValues);
export type Channel = z.infer<typeof channelSchema>;

export const canonicalEventTypeValues = [
  "communication.email.inbound",
  "communication.email.outbound",
  "communication.sms.inbound",
  "communication.sms.outbound",
  "communication.sms.opt_in",
  "communication.sms.opt_out",
  "lifecycle.signed_up",
  "lifecycle.received_training",
  "lifecycle.completed_training",
  "lifecycle.submitted_first_data",
  "campaign.email.sent",
  "campaign.email.opened",
  "campaign.email.clicked",
  "campaign.email.unsubscribed"
] as const;
export const canonicalEventTypeSchema = z.enum(canonicalEventTypeValues);
export type CanonicalEventType = z.infer<typeof canonicalEventTypeSchema>;

export const inboxDrivingEventTypeValues = [
  "communication.email.inbound",
  "communication.email.outbound",
  "communication.sms.inbound",
  "communication.sms.outbound"
] as const;
export const inboxDrivingEventTypeSchema = z.enum(inboxDrivingEventTypeValues);
export type InboxDrivingEventType = z.infer<typeof inboxDrivingEventTypeSchema>;

export const canonicalEventTypeChannel = {
  "communication.email.inbound": "email",
  "communication.email.outbound": "email",
  "communication.sms.inbound": "sms",
  "communication.sms.outbound": "sms",
  "communication.sms.opt_in": "sms",
  "communication.sms.opt_out": "sms",
  "lifecycle.signed_up": "lifecycle",
  "lifecycle.received_training": "lifecycle",
  "lifecycle.completed_training": "lifecycle",
  "lifecycle.submitted_first_data": "lifecycle",
  "campaign.email.sent": "campaign_email",
  "campaign.email.opened": "campaign_email",
  "campaign.email.clicked": "campaign_email",
  "campaign.email.unsubscribed": "campaign_email"
} as const satisfies Record<CanonicalEventType, Channel>;

export function resolveCanonicalChannel(
  eventType: CanonicalEventType
): Channel {
  return canonicalEventTypeChannel[eventType];
}

export const reviewStateValues = [
  "clear",
  "needs_identity_review",
  "needs_routing_review",
  "quarantined"
] as const;
export const reviewStateSchema = z.enum(reviewStateValues);
export type ReviewState = z.infer<typeof reviewStateSchema>;

export const provenanceWinnerReasonValues = [
  "single_source",
  "manual_review_resolution",
  "gmail_wins_duplicate_collapse",
  "simpletexting_wins_duplicate_collapse",
  "salesforce_only_best_evidence"
] as const;
export const provenanceWinnerReasonSchema = z.enum(
  provenanceWinnerReasonValues
);
export type ProvenanceWinnerReason = z.infer<
  typeof provenanceWinnerReasonSchema
>;

export const contactIdentityKindValues = [
  "salesforce_contact_id",
  "volunteer_id_plain",
  "email",
  "phone"
] as const;
export const contactIdentityKindSchema = z.enum(contactIdentityKindValues);
export type ContactIdentityKind = z.infer<typeof contactIdentityKindSchema>;

export const inboxBucketValues = ["New", "Opened"] as const;
export const inboxBucketSchema = z.enum(inboxBucketValues);
export type InboxBucket = z.infer<typeof inboxBucketSchema>;

export const identityResolutionReasonCodeValues = [
  "identity_missing_anchor",
  "identity_multi_candidate",
  "identity_conflict",
  "identity_anchor_mismatch"
] as const;
export const identityResolutionReasonCodeSchema = z.enum(
  identityResolutionReasonCodeValues
);
export type IdentityResolutionReasonCode = z.infer<
  typeof identityResolutionReasonCodeSchema
>;

export const routingReviewReasonCodeValues = [
  "routing_missing_membership",
  "routing_multiple_memberships",
  "routing_context_conflict"
] as const;
export const routingReviewReasonCodeSchema = z.enum(
  routingReviewReasonCodeValues
);
export type RoutingReviewReasonCode = z.infer<
  typeof routingReviewReasonCodeSchema
>;

export const quarantineReasonCodeValues = [
  "replay_checksum_mismatch",
  "duplicate_collapse_conflict"
] as const;
export const quarantineReasonCodeSchema = z.enum(quarantineReasonCodeValues);
export type QuarantineReasonCode = z.infer<typeof quarantineReasonCodeSchema>;

export const reviewQueueReasonCodeValues = [
  ...identityResolutionReasonCodeValues,
  ...routingReviewReasonCodeValues,
  ...quarantineReasonCodeValues
] as const;
export const reviewQueueReasonCodeSchema = z.enum(reviewQueueReasonCodeValues);
export type ReviewQueueReasonCode = z.infer<typeof reviewQueueReasonCodeSchema>;

export const reviewCaseStatusValues = [
  "open",
  "resolved",
  "quarantined"
] as const;
export const reviewCaseStatusSchema = z.enum(reviewCaseStatusValues);
export type ReviewCaseStatus = z.infer<typeof reviewCaseStatusSchema>;

export const syncJobTypeValues = [
  "historical_backfill",
  "live_ingest",
  "projection_rebuild",
  "parity_snapshot",
  "final_delta_sync",
  "dead_letter_reprocess"
] as const;
export const syncJobTypeSchema = z.enum(syncJobTypeValues);
export type SyncJobType = z.infer<typeof syncJobTypeSchema>;

export const syncScopeValues = ["provider", "orchestration"] as const;
export const syncScopeSchema = z.enum(syncScopeValues);
export type SyncScope = z.infer<typeof syncScopeSchema>;

export const syncStatusValues = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "quarantined",
  "cancelled"
] as const;
export const syncStatusSchema = z.enum(syncStatusValues);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const auditActorTypeValues = [
  "system",
  "user",
  "worker",
  "provider"
] as const;
export const auditActorTypeSchema = z.enum(auditActorTypeValues);
export type AuditActorType = z.infer<typeof auditActorTypeSchema>;

export const auditResultValues = ["allowed", "denied", "recorded"] as const;
export const auditResultSchema = z.enum(auditResultValues);
export type AuditResult = z.infer<typeof auditResultSchema>;
