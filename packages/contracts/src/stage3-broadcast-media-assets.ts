import { z } from "zod";

const mediaAssetIdValueSchema = z.string().uuid();
const timestampSchema = z.string().datetime();

const mediaAssetBaseSchema = z.object({
  uploaderId: z.string().min(1).nullable(),
  storageKey: z.string().min(1),
  publicUrl: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});

export const mediaAssetRecordSchema = mediaAssetBaseSchema.extend({
  id: mediaAssetIdValueSchema,
  createdAt: timestampSchema,
  deletedAt: timestampSchema.nullable(),
});

export const createMediaAssetInputSchema = mediaAssetBaseSchema;

export const mediaAssetIdSchema = mediaAssetIdValueSchema;

export const mediaAssetsListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().nullable().optional(),
});

export type MediaAssetRecord = z.infer<typeof mediaAssetRecordSchema>;
export type MediaAssetRecordInput = z.input<typeof mediaAssetRecordSchema>;
export type CreateMediaAssetInput = z.infer<typeof createMediaAssetInputSchema>;
export type CreateMediaAssetInputValue = z.input<
  typeof createMediaAssetInputSchema
>;
export type MediaAssetId = z.infer<typeof mediaAssetIdSchema>;
export type MediaAssetsListInput = z.infer<typeof mediaAssetsListInputSchema>;
export type MediaAssetsListInputValue = z.input<
  typeof mediaAssetsListInputSchema
>;
