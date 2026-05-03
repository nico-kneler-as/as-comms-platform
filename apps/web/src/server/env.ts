import { z } from "zod";

function parseBooleanEnv(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveNumberEnv(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export const webEnvSchema = z.object({
  SMS_ENABLED: z.preprocess(parseBooleanEnv, z.boolean()).default(false),
  TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT: z
    .preprocess(parsePositiveNumberEnv, z.number().positive())
    .default(0.0079),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function readWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  return webEnvSchema.parse({
    SMS_ENABLED: env.SMS_ENABLED,
    TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT:
      env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT,
  });
}
