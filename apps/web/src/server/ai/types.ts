import { z } from "zod";

import { aiKnowledgeEntrySchema, contactSchema } from "@as-comms/contracts";

export const aiDraftRequestModeSchema = z.enum(["draft", "fill", "reprompt"]);
export type AiDraftRequestMode = z.infer<typeof aiDraftRequestModeSchema>;

export const aiDraftWarningCodeSchema = z.enum([
  "provider_not_configured",
  "provider_timeout",
  "provider_rate_limited",
  "provider_unavailable",
  "validation_blocked",
  "grounding_empty",
  "budget_warn",
  "grounding_contradiction",
]);
export type AiDraftWarningCode = z.infer<typeof aiDraftWarningCodeSchema>;

export const aiDraftWarningSchema = z.object({
  code: aiDraftWarningCodeSchema,
  message: z.string().min(1),
});
export type AiDraftWarning = z.infer<typeof aiDraftWarningSchema>;

export const aiDraftGroundingSchema = z.object({
  tier: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  sourceProvider: z.string().min(1),
  sourceId: z.string().min(1),
  sourceUrl: z.string().nullable(),
  title: z.string().nullable(),
});
export type AiDraftGrounding = z.infer<typeof aiDraftGroundingSchema>;

export const aiDraftResponseModeSchema = z.enum([
  "generated",
  "deterministic_fallback",
]);
export type AiDraftResponseMode = z.infer<typeof aiDraftResponseModeSchema>;

export const aiDraftProviderStatusSchema = z.enum([
  "ready",
  "provider_not_configured",
  "provider_timeout",
  "provider_rate_limited",
  "provider_unavailable",
  "validation_blocked",
]);
export type AiDraftProviderStatus = z.infer<typeof aiDraftProviderStatusSchema>;

export const aiDraftModelParamsSchema = z.object({
  name: z.string().min(1),
  temperature: z.number(),
  maxTokens: z.number().int().positive(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  stopReason: z.string().nullable(),
});
export type AiDraftModelParams = z.infer<typeof aiDraftModelParamsSchema>;

const aiDraftBaseRequestSchema = z.object({
  contactId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional().default(null),
  threadCursor: z.string().min(1).nullable().optional().default(null),
  repromptIndex: z.number().int().nonnegative().optional().default(0),
});

export const aiDraftRequestSchema = z.discriminatedUnion("mode", [
  aiDraftBaseRequestSchema.extend({
    mode: z.literal("draft"),
  }),
  aiDraftBaseRequestSchema.extend({
    mode: z.literal("fill"),
    operatorPrompt: z.string().min(1),
  }),
  aiDraftBaseRequestSchema.extend({
    mode: z.literal("reprompt"),
    previousDraft: z.string().min(1),
    repromptDirection: z.string().min(1),
  }),
]);
export type AiDraftRequest = z.infer<typeof aiDraftRequestSchema>;
export type AiDraftRequestPayload = z.input<typeof aiDraftRequestSchema>;

export const aiThreadContextEventSchema = z.object({
  canonicalEventId: z.string().min(1),
  occurredAt: z.string().datetime(),
  direction: z.enum(["inbound", "outbound"]),
  channel: z.enum(["email", "sms"]),
  subject: z.string().nullable(),
  summary: z.string(),
  body: z.string(),
  threadId: z.string().nullable(),
});
export type AiThreadContextEvent = z.infer<typeof aiThreadContextEventSchema>;

export const groundingBundleSchema = z.object({
  contact: contactSchema.nullable(),
  generalTraining: aiKnowledgeEntrySchema.nullable(),
  projectContext: aiKnowledgeEntrySchema.nullable(),
  targetInbound: aiThreadContextEventSchema.nullable(),
  recentEvents: z.array(aiThreadContextEventSchema),
  grounding: z.array(aiDraftGroundingSchema),
});
export type GroundingBundle = z.infer<typeof groundingBundleSchema>;

export const aiDraftResponseSchema = z.object({
  draft: z.string(),
  requestMode: aiDraftRequestModeSchema,
  mode: aiDraftResponseModeSchema,
  grounding: z.array(aiDraftGroundingSchema),
  warnings: z.array(aiDraftWarningSchema),
  costEstimateUsd: z.number().nonnegative(),
  providerStatus: aiDraftProviderStatusSchema,
  draftId: z.string().uuid(),
  repromptIndex: z.number().int().nonnegative(),
  promptPreview: z.string(),
  model: aiDraftModelParamsSchema,
});
export type AiDraftResponse = z.infer<typeof aiDraftResponseSchema>;

