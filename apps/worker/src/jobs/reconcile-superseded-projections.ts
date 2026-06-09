import { quickAddJob, type Task } from "graphile-worker";

import {
  projectionRebuildBatchJobName,
  projectionRebuildBatchPayloadSchema,
  stage1JobVersion,
} from "@as-comms/contracts";
import type { Stage1Database } from "@as-comms/db";

import { buildOperationId } from "../ops/helpers.js";
import { reconcileSupersededProjections } from "../ops/reconcile-superseded-projections.js";

export const reconcileSupersededProjectionsJobName =
  "reconcile-superseded-projections" as const;

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

export interface ReconcileSupersededProjectionsTaskDependencies {
  readonly db: Stage1Database;
  readonly sql: SqlRunner;
  readonly connectionString: string;
  readonly limit?: number;
  readonly logger?: Pick<Console, "log" | "error">;
  // Override for tests so the projection-rebuild enqueue is observable
  // without spinning up a real graphile_worker schema.
  readonly enqueueProjectionRebuild?: (input: {
    readonly contactIds: readonly string[];
  }) => Promise<{ readonly enqueuedJobId: string }>;
}

export function createReconcileSupersededProjectionsTask(
  deps: ReconcileSupersededProjectionsTaskDependencies,
): Task {
  const logger = deps.logger ?? console;

  return async () => {
    const report = await reconcileSupersededProjections({
      db: deps.db,
      sql: deps.sql,
      dryRun: false,
      limit: deps.limit ?? null,
      logger,
      emitPlanEvent: false,
    });

    logger.log(
      JSON.stringify({
        event: "reconcile_superseded_projections.cron.completed",
        targetCount: report.targetCount,
        summary: report.summary,
        errors: report.errorExamples.length,
        contactCount: report.contactIds.length,
      }),
    );

    if (report.contactIds.length === 0) {
      return;
    }

    const enqueue =
      deps.enqueueProjectionRebuild ??
      (async (input) => {
        const payload = projectionRebuildBatchPayloadSchema.parse({
          version: stage1JobVersion,
          jobId: buildOperationId(
            "stage1:projection-rebuild:cron:job",
          ),
          correlationId: buildOperationId(
            "stage1:projection-rebuild:cron:correlation",
          ),
          traceId: null,
          batchId: buildOperationId(
            "stage1:projection-rebuild:cron:batch",
          ),
          syncStateId: buildOperationId(
            "stage1:projection-rebuild:cron:sync-state",
          ),
          attempt: 1,
          maxAttempts: 3,
          jobType: "projection_rebuild",
          projection: "all",
          contactIds: input.contactIds,
          includeReviewOverlayRefresh: true,
        });
        const job = await quickAddJob(
          { connectionString: deps.connectionString },
          projectionRebuildBatchJobName,
          payload,
        );
        // `job.id` is typed as a string by graphile-worker, but cast through
        // unknown to keep the eslint @typescript-eslint/no-unnecessary-type-conversion
        // rule happy if the upstream type changes.
        return { enqueuedJobId: job.id as unknown as string };
      });

    const enqueued = await enqueue({ contactIds: report.contactIds });

    logger.log(
      JSON.stringify({
        event: "reconcile_superseded_projections.cron.enqueued_rebuild",
        contactCount: report.contactIds.length,
        enqueuedJobId: enqueued.enqueuedJobId,
      }),
    );
  };
}
