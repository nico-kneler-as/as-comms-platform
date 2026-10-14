import { z } from "zod";

const nullableTextSchema = z.string().min(1).nullable();

export const salesforceAudienceListsCaptureRequestSchema = z.object({
  version: z.literal(1).default(1),
});
export type SalesforceAudienceListsCaptureRequest = z.infer<
  typeof salesforceAudienceListsCaptureRequestSchema
>;

export const salesforceAudienceListCampaignSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  campaignType: nullableTextSchema,
  campaignStatus: nullableTextSchema,
  isActive: z.boolean(),
  // Salesforce Campaign StartDate/EndDate are date-only fields.
  startDate: nullableTextSchema,
  endDate: nullableTextSchema,
  createdDate: z.string().datetime(),
  lastModifiedDate: z.string().datetime(),
  ownerName: nullableTextSchema,
  numberOfContacts: z.number().int().nonnegative(),
  numberOfLeads: z.number().int().nonnegative(),
});
export type SalesforceAudienceListCampaign = z.infer<
  typeof salesforceAudienceListCampaignSchema
>;

export const salesforceAudienceListMemberSchema = z.object({
  campaignId: z.string().min(1),
  contactId: nullableTextSchema,
  leadId: nullableTextSchema,
  email: z.string().trim().min(1),
  status: nullableTextSchema,
});
export type SalesforceAudienceListMember = z.infer<
  typeof salesforceAudienceListMemberSchema
>;

export const salesforceAudienceListInsiderSchema = z.object({
  id: z.string().min(1),
  email: z.string().trim().min(1),
});
export type SalesforceAudienceListInsider = z.infer<
  typeof salesforceAudienceListInsiderSchema
>;

export const salesforceAudienceListsSnapshotSchema = z.object({
  campaigns: z.array(salesforceAudienceListCampaignSchema),
  members: z.array(salesforceAudienceListMemberSchema),
  insiders: z.array(salesforceAudienceListInsiderSchema),
  capturedAt: z.string().datetime(),
});
export type SalesforceAudienceListsSnapshot = z.infer<
  typeof salesforceAudienceListsSnapshotSchema
>;

export const salesforceAudienceListsCaptureResponseSchema =
  salesforceAudienceListsSnapshotSchema;

export const salesforceAudienceListsSyncPayloadSchema = z.object({
  version: z.literal(1).default(1),
});
export type SalesforceAudienceListsSyncPayload = z.infer<
  typeof salesforceAudienceListsSyncPayloadSchema
>;

export const salesforceAudienceListsSyncJobName =
  "salesforce-audience-lists-sync" as const;
export const salesforceAudienceListsSyncJobMaxAttempts = 3;
