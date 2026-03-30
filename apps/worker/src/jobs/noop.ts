import type { JobHelpers } from "graphile-worker";

import { noopJobPayloadSchema } from "@as-comms/contracts";

export function runStage0NoopJob(
  rawPayload: unknown,
  helpers: JobHelpers
): void {
  const payload = noopJobPayloadSchema.parse(rawPayload);
  const message = payload.correlationId
    ? `Executed stage0.noop for correlation ${payload.correlationId}.`
    : "Executed stage0.noop without side effects.";

  helpers.logger.info(message);
}
