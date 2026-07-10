import { z } from "zod";

const idSchema = z.string().min(1);
const timestampSchema = z.string().datetime();
const nullableStringSchema = z.string().min(1).nullable();

export const broadcastActivityBotReasonSchema = z.enum([
  "machine_user_agent",
  "fast_activity",
]);
export type BroadcastActivityBotReason = z.infer<
  typeof broadcastActivityBotReasonSchema
>;

export const broadcastLinkClickClientSchema = z.object({
  Name: nullableStringSchema.default(null),
  Company: nullableStringSchema.default(null),
  Family: nullableStringSchema.default(null),
});
export type BroadcastLinkClickClient = z.infer<
  typeof broadcastLinkClickClientSchema
>;

export const broadcastLinkClickGeoSchema = z.object({
  CountryISOCode: nullableStringSchema.default(null),
  Country: nullableStringSchema.default(null),
  RegionISOCode: nullableStringSchema.default(null),
  Region: nullableStringSchema.default(null),
  City: nullableStringSchema.default(null),
  Zip: nullableStringSchema.default(null),
  Coords: nullableStringSchema.default(null),
  IP: nullableStringSchema.default(null),
});
export type BroadcastLinkClickGeo = z.infer<
  typeof broadcastLinkClickGeoSchema
>;

export const broadcastLinkClickRecordSchema = z.object({
  id: idSchema,
  campaignRunId: idSchema,
  audienceSnapshotId: nullableStringSchema.default(null),
  contactId: nullableStringSchema.default(null),
  originalLink: z.string().url(),
  clickedAt: timestampSchema,
  userAgent: nullableStringSchema.default(null),
  platform: nullableStringSchema.default(null),
  client: broadcastLinkClickClientSchema.nullable().default(null),
  os: broadcastLinkClickClientSchema.nullable().default(null),
  geo: broadcastLinkClickGeoSchema.nullable().default(null),
  isBot: z.boolean().default(false),
  botReason: broadcastActivityBotReasonSchema.nullable().default(null),
  idempotencyKey: z.string().min(1),
  createdAt: timestampSchema,
});
export type BroadcastLinkClickRecord = z.infer<
  typeof broadcastLinkClickRecordSchema
>;
export type BroadcastLinkClickRecordInput = z.input<
  typeof broadcastLinkClickRecordSchema
>;

export const broadcastLinkClickAggregateSchema = z.object({
  originalLink: z.string().url(),
  totalClicks: z.number().int().nonnegative(),
  botClicks: z.number().int().nonnegative(),
  uniqueClickers: z.number().int().nonnegative(),
});
export type BroadcastLinkClickAggregate = z.infer<
  typeof broadcastLinkClickAggregateSchema
>;
