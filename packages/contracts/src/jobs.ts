import { z } from "zod";

export const noopJobName = "stage0.noop" as const;
export const stage0JobNames = [noopJobName] as const;

export const noopJobPayloadSchema = z.object({
  correlationId: z.string().min(1).max(128).optional()
});
export type NoopJobPayload = z.infer<typeof noopJobPayloadSchema>;
