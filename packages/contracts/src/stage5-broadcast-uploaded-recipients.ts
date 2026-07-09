import { z } from "zod";

const idSchema = z.string().min(1);
const timestampSchema = z.string().datetime();
const nullableStringSchema = z.string().min(1).nullable();

export const broadcastUploadedRecipientInputSchema = z.object({
  email: z.string().trim().email(),
  firstName: nullableStringSchema.default(null),
  lastName: nullableStringSchema.default(null),
});
export type BroadcastUploadedRecipientInput = z.infer<
  typeof broadcastUploadedRecipientInputSchema
>;

export const broadcastUploadedRecipientRecordSchema =
  broadcastUploadedRecipientInputSchema.extend({
    id: idSchema,
    campaignRunId: idSchema,
    createdAt: timestampSchema,
  });
export type BroadcastUploadedRecipientRecord = z.infer<
  typeof broadcastUploadedRecipientRecordSchema
>;
