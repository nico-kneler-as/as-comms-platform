import { randomUUID } from "node:crypto";

import type { Task } from "graphile-worker";
import type { Stage1PersistenceService } from "@as-comms/domain";

import {
  runGmailDateWindowRecovery,
  type RecoverGmailDateWindowResult,
} from "../ops/recover-gmail-date-window.js";

export const integrationBackfillGmailTaskName =
  "integration-backfill-gmail" as const;

type Logger = Pick<Console, "error" | "info" | "warn">;

type AddJobLike = (
  identifier: string,
  payload: unknown,
  spec?: {
    readonly jobKey?: string;
  },
) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFailureReason(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Integration backfill Gmail task failed.";
}

export async function enqueueIntegrationBackfillGmailJob(input: {
  readonly persistence: Stage1PersistenceService;
  readonly addJob: AddJobLike;
  readonly service: "gmail";
  readonly idempotencyKey: string;
  readonly triggeredBy: "manual" | "integration_health_transition";
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly mailbox?: string | null;
  readonly logger?: Logger;
}): Promise<{ readonly enqueued: boolean; readonly jobId: string }> {
  const logger = input.logger ?? console;
  const insertedJobId =
    await input.persistence.repositories.integrationBackfillJobs.insert({
      id: `integration_backfill_job:${randomUUID()}`,
      service: input.service,
      idempotencyKey: input.idempotencyKey,
      triggeredBy: input.triggeredBy,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      mailbox: input.mailbox ?? null,
    });
  const jobId =
    insertedJobId ??
    (
      await input.persistence.repositories.integrationBackfillJobs.findByIdempotencyKey(
        input.idempotencyKey,
      )
    )?.id;

  if (jobId === undefined) {
    throw new Error(
      `Expected integration backfill job for idempotency key ${input.idempotencyKey}.`,
    );
  }

  const existing = await input.persistence.repositories.integrationBackfillJobs.findById(
    jobId,
  );
  if (existing === null) {
    throw new Error(`Integration backfill job ${jobId} was not found.`);
  }

  if (insertedJobId !== null) {
    await input.addJob(
      integrationBackfillGmailTaskName,
      { jobId },
      { jobKey: `${integrationBackfillGmailTaskName}:${jobId}` },
    );

    logger.info(
      JSON.stringify({
        event: "integration_backfill.enqueued",
        service: input.service,
        window_start: input.windowStart,
        window_end: input.windowEnd,
        idempotency_key: input.idempotencyKey,
        triggered_by: input.triggeredBy,
        job_id: jobId,
      }),
    );

    return { enqueued: true, jobId };
  }

  logger.info(
    JSON.stringify({
      event: "integration_backfill.dedup_hit",
      service: input.service,
      idempotency_key: input.idempotencyKey,
      job_id: jobId,
    }),
  );

  return { enqueued: false, jobId };
}

export interface IntegrationBackfillGmailTaskDependencies {
  readonly persistence: Stage1PersistenceService;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly env?: NodeJS.ProcessEnv;
  readonly runRecovery?: (input: {
    readonly persistence: Stage1PersistenceService;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly mailbox?: string | null;
    readonly execute?: boolean;
    readonly env?: NodeJS.ProcessEnv;
    readonly logger?: Pick<Console, "error" | "log">;
  }) => Promise<RecoverGmailDateWindowResult>;
}

export function createIntegrationBackfillGmailTask(
  dependencies: IntegrationBackfillGmailTaskDependencies,
): Task {
  const logger = dependencies.logger ?? console;
  const now = dependencies.now ?? (() => new Date());
  const runRecovery = dependencies.runRecovery ?? runGmailDateWindowRecovery;

  return async (payload) => {
    const rawJobId =
      isRecord(payload) && typeof payload.jobId === "string" ? payload.jobId : null;
    if (rawJobId === null) {
      throw new Error("integration-backfill-gmail requires a string jobId.");
    }

    const job =
      await dependencies.persistence.repositories.integrationBackfillJobs.findById(
        rawJobId,
      );
    if (job === null) {
      throw new Error(`Integration backfill job ${rawJobId} was not found.`);
    }

    if (job.status !== "pending") {
      logger.info(
        JSON.stringify({
          event: "integration_backfill.skipped",
          job_id: job.id,
          service: job.service,
          detail: "already processed",
          status: job.status,
        }),
      );
      return;
    }

    const startedAt = now();
    const runningJob =
      await dependencies.persistence.repositories.integrationBackfillJobs.markRunning(
        {
          id: job.id,
          startedAt: startedAt.toISOString(),
        },
      );
    if (runningJob === null) {
      logger.info(
        JSON.stringify({
          event: "integration_backfill.skipped",
          job_id: job.id,
          service: job.service,
          detail: "already processed",
          status: job.status,
        }),
      );
      return;
    }

    logger.info(
      JSON.stringify({
        event: "integration_backfill.started",
        job_id: job.id,
        service: job.service,
      }),
    );

    try {
      const result = await runRecovery({
        persistence: dependencies.persistence,
        windowStart: job.windowStart,
        windowEnd: job.windowEnd,
        mailbox: job.mailbox,
        execute: true,
        logger: console,
        ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
      });

      const completedAt = now();
      await dependencies.persistence.repositories.integrationBackfillJobs.markCompleted(
        {
          id: job.id,
          completedAt: completedAt.toISOString(),
          resultJson: result as unknown as Record<string, unknown>,
        },
      );

      logger.info(
        JSON.stringify({
          event: "integration_backfill.completed",
          job_id: job.id,
          service: job.service,
          captured: result.captured,
          skipped: result.skipped,
          duration_ms: completedAt.getTime() - startedAt.getTime(),
        }),
      );
    } catch (error) {
      const completedAt = now();
      const failureReason = toFailureReason(error);

      await dependencies.persistence.repositories.integrationBackfillJobs.markFailed(
        {
          id: job.id,
          completedAt: completedAt.toISOString(),
          failureReason,
        },
      );

      logger.error(
        JSON.stringify({
          event: "integration_backfill.failed",
          job_id: job.id,
          service: job.service,
          reason: failureReason,
        }),
      );
      logger.error(
        JSON.stringify({
          event: "integration_backfill.failed.unhandled_error",
          job_id: job.id,
          service: job.service,
          name: error instanceof Error ? error.name : "UnknownError",
          message: failureReason,
          stack: error instanceof Error ? (error.stack ?? null) : null,
        }),
      );

      throw error;
    }
  };
}
