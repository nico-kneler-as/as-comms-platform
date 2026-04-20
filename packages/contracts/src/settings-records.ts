import { z } from "zod";

const idSchema = z.string().min(1);
const timestampSchema = z.string().datetime();
const nullableTimestampSchema = timestampSchema.nullable();
const nullableStringSchema = z.string().min(1).nullable();
const metadataJsonSchema = z.record(z.string(), z.unknown());

export const integrationHealthCategoryValues = [
  "crm",
  "messaging",
  "knowledge",
  "ai"
] as const;
export const integrationHealthCategorySchema = z.enum(
  integrationHealthCategoryValues
);
export type IntegrationHealthCategory = z.infer<
  typeof integrationHealthCategorySchema
>;

export const integrationHealthStatusValues = [
  "healthy",
  "needs_attention",
  "disconnected",
  "not_configured",
  "not_checked"
] as const;
export const integrationHealthStatusSchema = z.enum(
  integrationHealthStatusValues
);
export type IntegrationHealthStatus = z.infer<
  typeof integrationHealthStatusSchema
>;

export const integrationHealthSchema = z.object({
  id: idSchema,
  serviceName: z.string().min(1),
  category: integrationHealthCategorySchema,
  status: integrationHealthStatusSchema,
  lastCheckedAt: nullableTimestampSchema,
  detail: nullableStringSchema,
  metadataJson: metadataJsonSchema.default({}),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
});
export type IntegrationHealthRecord = z.infer<typeof integrationHealthSchema>;
