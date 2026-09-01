import {
  automatedEmailSendJobMaxAttempts,
  automatedEmailSendJobName,
  automatedEmailSendPayloadSchema,
} from "@as-comms/contracts";

import type { getStage1WebRuntime } from "@/src/server/stage1-runtime";

type Stage1WebRuntime = Awaited<ReturnType<typeof getStage1WebRuntime>>;

export async function enqueueAutomatedEmailSendJob(input: {
  readonly runtime: Stage1WebRuntime;
  readonly sendId: string;
}): Promise<void> {
  if (input.runtime.connection === null) {
    return;
  }

  const payload = automatedEmailSendPayloadSchema.parse({
    sendId: input.sendId,
  });

  await input.runtime.connection.sql`
    select graphile_worker.add_job(
      identifier => ${automatedEmailSendJobName},
      payload => ${JSON.stringify(payload)}::json,
      job_key => ${`send-automated-email:${input.sendId}`},
      job_key_mode => 'replace',
      max_attempts => ${automatedEmailSendJobMaxAttempts}
    )
  `;
}
