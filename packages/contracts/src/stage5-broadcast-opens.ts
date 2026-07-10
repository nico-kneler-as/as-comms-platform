import { z } from "zod";

import {
  broadcastActivityBotReasonSchema,
  broadcastLinkClickClientSchema,
  broadcastLinkClickGeoSchema,
} from "./stage5-broadcast-link-clicks.js";

const idSchema = z.string().min(1);
const timestampSchema = z.string().datetime();
const nullableStringSchema = z.string().min(1).nullable();

export const broadcastOpenRecordSchema = z.object({
  id: idSchema,
  campaignRunId: idSchema,
  audienceSnapshotId: nullableStringSchema.default(null),
  contactId: nullableStringSchema.default(null),
  openedAt: timestampSchema,
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
export type BroadcastOpenRecord = z.infer<typeof broadcastOpenRecordSchema>;
export type BroadcastOpenRecordInput = z.input<typeof broadcastOpenRecordSchema>;
