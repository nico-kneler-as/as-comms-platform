import { z } from "zod";

import {
  providerSchema,
  reviewStateSchema
} from "./stage1-taxonomy.js";

const idSchema = z.string().min(1);
const timestampSchema = z.string().datetime();
const nullableStringSchema = z.string().min(1).nullable();
const timelineFamilySchema = z.enum([
  "salesforce_event",
  "auto_email",
  "campaign_email",
  "campaign_sms",
  "one_to_one_email",
  "one_to_one_sms",
  "internal_note"
]);
const campaignEmailActivityTypeSchema = z.enum([
  "sent",
  "opened",
  "clicked",
  "unsubscribed"
]);

const timelineItemBaseSchema = z.object({
  id: idSchema,
  contactId: idSchema,
  canonicalEventId: idSchema,
  family: timelineFamilySchema,
  occurredAt: timestampSchema,
  sortKey: z.string().min(1),
  reviewState: reviewStateSchema,
  primaryProvider: providerSchema,
  summary: z.string().min(1)
});

export const salesforceTimelineItemSchema = timelineItemBaseSchema.extend({
  family: z.literal("salesforce_event"),
  milestone: z.enum([
    "signed_up",
    "received_training",
    "completed_training",
    "submitted_first_data"
  ]),
  projectName: nullableStringSchema,
  expeditionName: nullableStringSchema,
  sourceField: nullableStringSchema
});
export type SalesforceTimelineItem = z.infer<
  typeof salesforceTimelineItemSchema
>;

export const autoEmailTimelineItemSchema = timelineItemBaseSchema.extend({
  family: z.literal("auto_email"),
  direction: z.literal("outbound"),
  subject: nullableStringSchema,
  snippet: z.string(),
  sourceLabel: z.string().min(1)
});
export type AutoEmailTimelineItem = z.infer<typeof autoEmailTimelineItemSchema>;

export const autoSmsTimelineItemSchema = timelineItemBaseSchema.extend({
  family: z.literal("auto_sms"),
  direction: z.literal("outbound"),
  messageTextPreview: z.string(),
  sourceLabel: z.string().min(1)
});
export type AutoSmsTimelineItem = z.infer<typeof autoSmsTimelineItemSchema>;

export const campaignEmailTimelineItemSchema = timelineItemBaseSchema.extend({
  family: z.literal("campaign_email"),
  activityType: campaignEmailActivityTypeSchema,
  campaignName: nullableStringSchema,
  campaignId: nullableStringSchema,
  audienceId: nullableStringSchema,
  snippet: z.string()
});
export type CampaignEmailTimelineItem = z.infer<
  typeof campaignEmailTimelineItemSchema
>;

export const campaignSmsTimelineItemSchema = timelineItemBaseSchema.extend({
  family: z.literal("campaign_sms"),
  direction: z.literal("outbound"),
  messageTextPreview: z.string(),
  campaignName: nullableStringSchema,
  campaignId: nullableStringSchema
});
export type CampaignSmsTimelineItem = z.infer<
  typeof campaignSmsTimelineItemSchema
>;

export const oneToOneEmailTimelineItemSchema = timelineItemBaseSchema.extend({
  family: z.literal("one_to_one_email"),
  direction: z.enum(["inbound", "outbound"]),
  subject: nullableStringSchema,
  snippet: z.string(),
  bodyPreview: nullableStringSchema,
  mailbox: nullableStringSchema,
  threadId: nullableStringSchema
});
export type OneToOneEmailTimelineItem = z.infer<
  typeof oneToOneEmailTimelineItemSchema
>;

export const oneToOneSmsTimelineItemSchema = timelineItemBaseSchema.extend({
  family: z.literal("one_to_one_sms"),
  direction: z.enum(["inbound", "outbound"]),
  messageTextPreview: z.string(),
  phone: nullableStringSchema,
  threadKey: nullableStringSchema
});
export type OneToOneSmsTimelineItem = z.infer<
  typeof oneToOneSmsTimelineItemSchema
>;

export const internalNoteTimelineItemSchema = timelineItemBaseSchema.extend({
  family: z.literal("internal_note"),
  body: z.string().min(1),
  authorDisplayName: nullableStringSchema
});
export type InternalNoteTimelineItem = z.infer<
  typeof internalNoteTimelineItemSchema
>;

export const timelineItemSchema = z.discriminatedUnion("family", [
  salesforceTimelineItemSchema,
  autoEmailTimelineItemSchema,
  autoSmsTimelineItemSchema,
  campaignEmailTimelineItemSchema,
  campaignSmsTimelineItemSchema,
  oneToOneEmailTimelineItemSchema,
  oneToOneSmsTimelineItemSchema,
  internalNoteTimelineItemSchema
]);
export type TimelineItem = z.infer<typeof timelineItemSchema>;

export const timelineItemListSchema = z.array(timelineItemSchema);
export type TimelineItemList = z.infer<typeof timelineItemListSchema>;
