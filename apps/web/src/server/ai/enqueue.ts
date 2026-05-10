import {
  notionKnowledgeSyncJobName,
  notionKnowledgeSyncPayloadSchema,
  synthesizeProjectKnowledgeJobName,
  synthesizeProjectKnowledgePayloadSchema,
} from "@as-comms/contracts";

import type { getStage1WebRuntime } from "@/src/server/stage1-runtime";

/**
 * Shared worker-job enqueue helpers for AI Knowledge.
 *
 * These thin wrappers used to live inline in `apps/web/app/settings/actions.ts`,
 * but Phase 3 of PRD #366 reuses
 * {@link enqueueSynthesizeProjectKnowledgeJob} from the inbox capture path
 * (apps/web/app/inbox/actions.ts -> captureKnowledgeFromSend) when the
 * approved-reply threshold trips. Extracting them here keeps the trigger
 * site free of boundary concerns.
 *
 * Production code should import from this module via the absolute alias:
 *   `import { ... } from "@/src/server/ai/enqueue"`.
 */
type Stage1WebRuntime = Awaited<ReturnType<typeof getStage1WebRuntime>>;

export async function enqueueNotionKnowledgeSyncJob(input: {
  readonly runtime: Stage1WebRuntime;
  readonly projectId: string;
  readonly trigger: "manual" | "url_save" | "activation";
}): Promise<void> {
  if (input.runtime.connection === null) {
    return;
  }

  const payload = notionKnowledgeSyncPayloadSchema.parse({
    projectId: input.projectId,
    trigger: input.trigger,
  });

  await input.runtime.connection.sql`
    select graphile_worker.add_job(
      identifier => ${notionKnowledgeSyncJobName},
      payload => ${JSON.stringify(payload)}::json,
      job_key => ${`notion-knowledge-sync:${input.projectId}`},
      job_key_mode => 'replace',
      max_attempts => 1
    )
  `;
}

export type SynthesizeProjectKnowledgeTrigger =
  | "activation"
  | "wizard_sources"
  | "source_added"
  | "source_updated"
  | "sync_one"
  | "sync_all"
  | "capture_threshold";

export async function enqueueSynthesizeProjectKnowledgeJob(input: {
  readonly runtime: Stage1WebRuntime;
  readonly projectId: string;
  readonly trigger: SynthesizeProjectKnowledgeTrigger;
  readonly skipIfHashUnchanged?: boolean;
  readonly jobKey?: string;
}): Promise<void> {
  if (input.runtime.connection === null) {
    return;
  }

  const payload = synthesizeProjectKnowledgePayloadSchema.parse(
    input.skipIfHashUnchanged === undefined
      ? { projectId: input.projectId }
      : {
          projectId: input.projectId,
          skipIfHashUnchanged: input.skipIfHashUnchanged,
        },
  );
  const jobKey = input.jobKey ?? `synthesize-project-knowledge:${input.projectId}`;

  await input.runtime.connection.sql`
    select graphile_worker.add_job(
      identifier => ${synthesizeProjectKnowledgeJobName},
      payload => ${JSON.stringify(payload)}::json,
      job_key => ${jobKey},
      job_key_mode => 'replace',
      max_attempts => 1
    )
  `;
}
