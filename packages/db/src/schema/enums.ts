import {
  auditActorTypeValues,
  auditResultValues,
  canonicalEventTypeValues,
  channelValues,
  contactIdentityKindValues,
  identityResolutionReasonCodeValues,
  inboxBucketValues,
  providerValues,
  recordSourceValues,
  reviewCaseStatusValues,
  reviewStateValues,
  routingReviewReasonCodeValues,
  syncScopeValues,
  syncJobTypeValues,
  syncStatusValues
} from "@as-comms/contracts";
import { pgEnum } from "drizzle-orm/pg-core";

export const providerEnum = pgEnum("provider", providerValues);
export const recordSourceEnum = pgEnum("record_source", recordSourceValues);
export const channelEnum = pgEnum("channel", channelValues);
export const canonicalEventTypeEnum = pgEnum(
  "canonical_event_type",
  canonicalEventTypeValues
);
export const reviewStateEnum = pgEnum("review_state", reviewStateValues);
export const contactIdentityKindEnum = pgEnum(
  "contact_identity_kind",
  contactIdentityKindValues
);
export const inboxBucketEnum = pgEnum("inbox_bucket", inboxBucketValues);
export const identityResolutionReasonCodeEnum = pgEnum(
  "identity_resolution_reason_code",
  identityResolutionReasonCodeValues
);
export const routingReviewReasonCodeEnum = pgEnum(
  "routing_review_reason_code",
  routingReviewReasonCodeValues
);
export const reviewCaseStatusEnum = pgEnum(
  "review_case_status",
  reviewCaseStatusValues
);
export const syncScopeEnum = pgEnum("sync_scope", syncScopeValues);
export const syncJobTypeEnum = pgEnum("sync_job_type", syncJobTypeValues);
export const syncStatusEnum = pgEnum("sync_status", syncStatusValues);
export const auditActorTypeEnum = pgEnum(
  "audit_actor_type",
  auditActorTypeValues
);
export const auditResultEnum = pgEnum("audit_result", auditResultValues);
export const userRoleEnum = pgEnum("user_role", ["admin", "operator"]);
export const pendingOutboundStatusEnum = pgEnum("pending_outbound_status", [
  "pending",
  "confirmed",
  "failed",
  "orphaned",
  "superseded"
]);
