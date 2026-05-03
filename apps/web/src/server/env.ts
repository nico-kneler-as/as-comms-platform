import { z } from "zod";

function parseBooleanEnv(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export const webEnvSchema = z.object({
  SMS_ENABLED: z.preprocess(parseBooleanEnv, z.boolean()).default(false),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function readWebEnv(env: NodeJS.ProcessEnv = process.env): WebEnv {
  return webEnvSchema.parse({
    SMS_ENABLED: env.SMS_ENABLED,
  });
}
