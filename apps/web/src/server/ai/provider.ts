import { z } from "zod";

import {
  createAnthropicClient,
  estimateCostUsd,
  generateDraft,
} from "@as-comms/integrations";

const aiServerConfigSchema = z.object({
  anthropicApiKey: z.string().optional(),
  model: z.string().min(1).default("claude-sonnet-4-6"),
  dailyCapUsd: z.number().finite().positive().default(20),
  maxTokens: z.number().int().positive().default(1_200),
  temperature: z.number().min(0).max(1).default(0.3),
});

function readAiServerConfig(env: NodeJS.ProcessEnv) {
  return aiServerConfigSchema.parse({
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim(),
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentionally treat empty string as "not set" and fall back
    model: env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6",
    dailyCapUsd:
      env.AI_DAILY_CAP_USD === undefined ||
      Number.isNaN(Number.parseFloat(env.AI_DAILY_CAP_USD))
        ? 20
        : Number.parseFloat(env.AI_DAILY_CAP_USD),
    maxTokens: 1_200,
    temperature: 0.3,
  });
}

const aiServerConfig = readAiServerConfig(process.env);
let anthropicClient:
  | ReturnType<typeof createAnthropicClient>
  | null
  | undefined;

function getAnthropicClient() {
  if (anthropicClient !== undefined) {
    return anthropicClient;
  }

  const apiKey = aiServerConfig.anthropicApiKey?.trim() ?? "";
  if (apiKey.length === 0) {
    anthropicClient = null;
    return anthropicClient;
  }

  anthropicClient = createAnthropicClient({
    ANTHROPIC_API_KEY: apiKey,
  });

  return anthropicClient;
}

export function getAiProviderConfig() {
  const client = getAnthropicClient();

  return {
    model: aiServerConfig.model,
    dailyCapUsd: aiServerConfig.dailyCapUsd,
    maxTokens: aiServerConfig.maxTokens,
    temperature: aiServerConfig.temperature,
    invokeModel:
      client === null
        ? null
        : (input: Parameters<typeof generateDraft>[1]) =>
            generateDraft(client, input),
    estimateCostUsd,
  };
}
