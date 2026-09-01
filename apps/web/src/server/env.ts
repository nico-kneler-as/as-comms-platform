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
  POSTMARK_SERVER_TOKEN: z.string().trim().min(1).optional(),
  POSTMARK_ACCOUNT_TOKEN: z.string().trim().min(1).optional(),
  POSTMARK_WEBHOOK_SIGNING_SECRET: z.string().trim().min(1).optional(),
  AUTOMATED_EMAIL_WEBHOOK_SECRET: z.string().trim().min(1).optional(),
  POSTMARK_TRANSACTIONAL_STREAM_ID: z
    .string()
    .trim()
    .min(1)
    .default("outbound"),
  POSTMARK_BROADCAST_STREAM_ID: z.string().trim().min(1).default("broadcast"),
  NEWSLETTER_SIGNUP_ALLOWED_ORIGIN: z
    .string()
    .trim()
    .url()
    .default("https://adventurescientists.org"),
  POSTMARK_BASE_URL: z
    .string()
    .trim()
    .url()
    .default("https://api.postmarkapp.com"),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function readWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  return webEnvSchema.parse({
    SMS_ENABLED: env.SMS_ENABLED,
    TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT:
      env.TWILIO_OUTBOUND_RATE_USD_PER_SEGMENT,
    POSTMARK_SERVER_TOKEN: env.POSTMARK_SERVER_TOKEN,
    POSTMARK_ACCOUNT_TOKEN: env.POSTMARK_ACCOUNT_TOKEN,
    POSTMARK_WEBHOOK_SIGNING_SECRET: env.POSTMARK_WEBHOOK_SIGNING_SECRET,
    AUTOMATED_EMAIL_WEBHOOK_SECRET: env.AUTOMATED_EMAIL_WEBHOOK_SECRET,
    POSTMARK_TRANSACTIONAL_STREAM_ID: env.POSTMARK_TRANSACTIONAL_STREAM_ID,
    POSTMARK_BROADCAST_STREAM_ID: env.POSTMARK_BROADCAST_STREAM_ID,
    NEWSLETTER_SIGNUP_ALLOWED_ORIGIN: env.NEWSLETTER_SIGNUP_ALLOWED_ORIGIN,
    POSTMARK_BASE_URL: env.POSTMARK_BASE_URL,
  });
}
