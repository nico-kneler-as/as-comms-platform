import { z } from "zod";

import { integrationHealthStatusSchema } from "./settings-records.js";

export const stageStatusSchema = z.enum(["ok", "warn", "fail"]);
export type StageStatus = z.infer<typeof stageStatusSchema>;

export const integrationHealthServiceSchema = z.enum([
  "salesforce",
  "gmail",
  "simpletexting",
  "mailchimp",
  "notion",
  "openai"
]);
export type IntegrationHealthService = z.infer<
  typeof integrationHealthServiceSchema
>;

export const integrationHealthCheckResponseSchema = z.object({
  service: integrationHealthServiceSchema,
  status: integrationHealthStatusSchema,
  checkedAt: z.string().datetime(),
  detail: z.string().nullable(),
  version: z.string().nullable().default(null)
});
export type IntegrationHealthCheckResponse = z.infer<
  typeof integrationHealthCheckResponseSchema
>;

export const serviceHealthSchema = z.object({
  service: z.string().min(1),
  stage: z.literal(0),
  status: stageStatusSchema,
  generatedAt: z.string().datetime()
});
export type ServiceHealth = z.infer<typeof serviceHealthSchema>;

export const readinessCheckSchema = z.object({
  name: z.string().min(1),
  status: stageStatusSchema,
  message: z.string().min(1)
});
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;

export const stage0ReadinessReportSchema = z.object({
  stage: z.literal(0),
  status: stageStatusSchema,
  generatedAt: z.string().datetime(),
  checks: z.array(readinessCheckSchema).min(1)
});
export type Stage0ReadinessReport = z.infer<typeof stage0ReadinessReportSchema>;
