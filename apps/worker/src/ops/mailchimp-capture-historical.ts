#!/usr/bin/env tsx
import process from "node:process";

import {
  mailchimpHistoricalCaptureBatchJobName,
  mailchimpHistoricalCaptureBatchPayloadSchema,
  stage1JobVersion,
  type MailchimpHistoricalCaptureBatchPayload,
} from "@as-comms/contracts";
import {
  createMailchimpCapturePort,
  type MailchimpRecord,
} from "@as-comms/integrations";

import { readWorkerConfig } from "../runtime.js";
import { buildOperationId, parseCliFlags, readOptionalIntegerFlag, readRequiredFlag } from "./helpers.js";
import { enqueueStage1Job } from "./enqueue.js";

const DEFAULT_MAX_RECORDS = 500;

interface Logger {
  log(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
}

interface MailchimpHistoricalCaptureCommandOptions {
  readonly since: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly dryRun: boolean;
  readonly confirm: boolean;
  readonly limitCampaigns: number | null;
}

export interface PlannedMailchimpHistoricalJob {
  readonly payload: MailchimpHistoricalCaptureBatchPayload;
  readonly expectedRecordCount: number;
}

export interface MailchimpHistoricalCapturePlan {
  readonly options: MailchimpHistoricalCaptureCommandOptions;
  readonly selectedCampaignIds: readonly string[] | null;
  readonly jobs: readonly PlannedMailchimpHistoricalJob[];
  readonly totalExpectedRecords: number;
}

function parseSinceFlag(rawValue: string): string {
  const trimmed = rawValue.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Flag --since must be a valid ISO date or timestamp.");
  }

  return parsed.toISOString();
}

export function parseMailchimpHistoricalCaptureArgs(
  args: readonly string[],
  now = new Date()
): MailchimpHistoricalCaptureCommandOptions {
  const flags = parseCliFlags(args);
  const confirm = flags.confirm === true;
  const dryRun = !confirm;
  const since = parseSinceFlag(readRequiredFlag(flags, "since"));
  const windowEnd = now.toISOString();

  if (Date.parse(since) >= Date.parse(windowEnd)) {
    throw new Error("Flag --since must be earlier than now.");
  }

  const limitCampaigns = (() => {
    const parsed = readOptionalIntegerFlag(flags, "limit-campaigns", 0);
    return parsed === 0 ? null : parsed;
  })();

  return {
    since,
    windowStart: since,
    windowEnd,
    dryRun,
    confirm,
    limitCampaigns,
  };
}

function buildHistoricalPayload(input: {
  readonly correlationId: string;
  readonly syncStateId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly cursor: string | null;
  readonly checkpoint: string | null;
  readonly recordIds?: readonly string[];
}): MailchimpHistoricalCaptureBatchPayload {
  return mailchimpHistoricalCaptureBatchPayloadSchema.parse({
    version: stage1JobVersion,
    jobId: buildOperationId("stage1:mailchimp:historical:job"),
    correlationId: input.correlationId,
    traceId: null,
    batchId: buildOperationId("stage1:mailchimp:historical:batch"),
    syncStateId: input.syncStateId,
    attempt: 1,
    maxAttempts: 1,
    provider: "mailchimp",
    mode: "historical",
    jobType: "historical_backfill",
    cursor: input.cursor,
    checkpoint: input.checkpoint,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    recordIds: [...(input.recordIds ?? [])],
    maxRecords: DEFAULT_MAX_RECORDS,
  });
}

function collectCampaignIds(records: readonly MailchimpRecord[]): readonly string[] {
  const campaignIds = new Set<string>();

  for (const record of records) {
    if (
      record.recordType === "campaign_member_activity" &&
      "campaignId" in record &&
      typeof record.campaignId === "string" &&
      record.campaignId.length > 0
    ) {
      campaignIds.add(record.campaignId);
    }
  }

  return [...campaignIds];
}

async function discoverCampaignIds(input: {
  readonly captureHistoricalBatch: (
    payload: MailchimpHistoricalCaptureBatchPayload
  ) => Promise<{
    readonly records: readonly MailchimpRecord[];
    readonly nextCursor: string | null;
    readonly checkpoint: string | null;
  }>;
  readonly options: MailchimpHistoricalCaptureCommandOptions;
  readonly correlationId: string;
  readonly syncStateId: string;
}): Promise<readonly string[]> {
  const selected = new Set<string>();
  let cursor: string | null = null;
  let checkpoint: string | null = null;

  for (;;) {
    const payload = buildHistoricalPayload({
      correlationId: input.correlationId,
      syncStateId: input.syncStateId,
      windowStart: input.options.windowStart,
      windowEnd: input.options.windowEnd,
      cursor,
      checkpoint,
    });
    const batch = await input.captureHistoricalBatch(payload);

    for (const campaignId of collectCampaignIds(batch.records)) {
      selected.add(campaignId);

      if (
        input.options.limitCampaigns !== null &&
        selected.size >= input.options.limitCampaigns
      ) {
        return [...selected];
      }
    }

    if (batch.nextCursor === null) {
      return [...selected];
    }

    cursor = batch.nextCursor;
    checkpoint = batch.checkpoint;
  }
}

async function simulateHistoricalPlan(input: {
  readonly captureHistoricalBatch: (
    payload: MailchimpHistoricalCaptureBatchPayload
  ) => Promise<{
    readonly records: readonly MailchimpRecord[];
    readonly nextCursor: string | null;
    readonly checkpoint: string | null;
  }>;
  readonly options: MailchimpHistoricalCaptureCommandOptions;
  readonly correlationId: string;
  readonly syncStateId: string;
  readonly recordIds?: readonly string[];
}): Promise<readonly PlannedMailchimpHistoricalJob[]> {
  const jobs: PlannedMailchimpHistoricalJob[] = [];
  let cursor: string | null = null;
  let checkpoint: string | null = null;

  for (;;) {
    const payload = buildHistoricalPayload({
      correlationId: input.correlationId,
      syncStateId: input.syncStateId,
      windowStart: input.options.windowStart,
      windowEnd: input.options.windowEnd,
      cursor,
      checkpoint,
      ...(input.recordIds === undefined ? {} : { recordIds: input.recordIds }),
    });
    const batch = await input.captureHistoricalBatch(payload);

    if (jobs.length > 0 || batch.records.length > 0 || batch.nextCursor !== null) {
      jobs.push({
        payload,
        expectedRecordCount: batch.records.length,
      });
    }

    if (batch.nextCursor === null) {
      return jobs;
    }

    cursor = batch.nextCursor;
    checkpoint = batch.checkpoint;
  }
}

export async function planMailchimpHistoricalCapture(input: {
  readonly options: MailchimpHistoricalCaptureCommandOptions;
  readonly captureHistoricalBatch: (
    payload: MailchimpHistoricalCaptureBatchPayload
  ) => Promise<{
    readonly records: readonly MailchimpRecord[];
    readonly nextCursor: string | null;
    readonly checkpoint: string | null;
  }>;
}): Promise<MailchimpHistoricalCapturePlan> {
  const correlationId = buildOperationId("stage1:mailchimp:historical:correlation");
  const syncStateId = buildOperationId("stage1:mailchimp:historical:sync-state");
  const selectedCampaignIds =
    input.options.limitCampaigns === null
      ? null
      : await discoverCampaignIds({
          captureHistoricalBatch: input.captureHistoricalBatch,
          options: input.options,
          correlationId,
          syncStateId,
        });
  const jobs = await simulateHistoricalPlan({
    captureHistoricalBatch: input.captureHistoricalBatch,
    options: input.options,
    correlationId,
    syncStateId,
    ...(selectedCampaignIds === null ? {} : { recordIds: selectedCampaignIds }),
  });

  return {
    options: input.options,
    selectedCampaignIds,
    jobs,
    totalExpectedRecords: jobs.reduce(
      (total, job) => total + job.expectedRecordCount,
      0
    ),
  };
}

function logPlan(logger: Logger, plan: MailchimpHistoricalCapturePlan): void {
  logger.log("mailchimp-capture-historical");
  logger.log(`Mode: ${plan.options.dryRun ? "dry-run" : "confirm"}`);
  logger.log(`- since: ${plan.options.since}`);
  logger.log(`- window start: ${plan.options.windowStart}`);
  logger.log(`- window end: ${plan.options.windowEnd}`);
  logger.log(
    `- limit campaigns: ${
      plan.options.limitCampaigns === null
        ? "none"
        : String(plan.options.limitCampaigns)
    }`
  );

  if (plan.selectedCampaignIds !== null) {
    logger.log(
      `- selected campaigns: ${
        plan.selectedCampaignIds.length === 0
          ? "none"
          : plan.selectedCampaignIds.join(", ")
      }`
    );
  }

  logger.log(`- jobs planned: ${String(plan.jobs.length)}`);
  logger.log(`- expected records: ${String(plan.totalExpectedRecords)}`);

  for (const [index, job] of plan.jobs.entries()) {
    logger.log(
      `  ${String(index + 1)}. cursor=${
        job.payload.cursor ?? "null"
      } checkpoint=${job.payload.checkpoint ?? "null"} records=${String(
        job.expectedRecordCount
      )}`
    );
  }
}

export async function runMailchimpHistoricalCaptureCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input?: {
    readonly now?: Date;
    readonly logger?: Logger;
    readonly captureHistoricalBatch?: (
      payload: MailchimpHistoricalCaptureBatchPayload
    ) => Promise<{
      readonly records: readonly MailchimpRecord[];
      readonly nextCursor: string | null;
      readonly checkpoint: string | null;
    }>;
    readonly enqueueJob?: (payload: MailchimpHistoricalCaptureBatchPayload) => Promise<{
      readonly enqueuedJobId: string;
    }>;
  }
): Promise<MailchimpHistoricalCapturePlan> {
  const logger = input?.logger ?? console;
  const options = parseMailchimpHistoricalCaptureArgs(args, input?.now ?? new Date());
  const captureHistoricalBatch =
    input?.captureHistoricalBatch ??
    (() => {
      const config = readWorkerConfig({
        ...env,
        WORKER_BOOT_MODE: "run",
      });

      if (config?.capture.mailchimp === undefined) {
        throw new Error("Mailchimp capture is not configured for this worker runtime.");
      }

      const port = createMailchimpCapturePort(config.capture.mailchimp);
      return (payload: MailchimpHistoricalCaptureBatchPayload) =>
        port.captureHistoricalBatch(payload);
    })();
  const enqueueJob =
    input?.enqueueJob ??
    (async (payload: MailchimpHistoricalCaptureBatchPayload) => {
      const connectionString = env.WORKER_DATABASE_URL ?? env.DATABASE_URL;

      if (connectionString === undefined || connectionString.trim().length === 0) {
        throw new Error(
          "DATABASE_URL or WORKER_DATABASE_URL is required for this ops command."
        );
      }

      return enqueueStage1Job({
        connectionString,
        request: {
          jobName: mailchimpHistoricalCaptureBatchJobName,
          payload,
        },
      });
    });

  const plan = await planMailchimpHistoricalCapture({
    options,
    captureHistoricalBatch,
  });

  logPlan(logger, plan);

  if (options.dryRun) {
    logger.log(
      "Dry run complete. Re-run with --confirm to enqueue Mailchimp historical capture jobs."
    );
    return plan;
  }

  for (const job of plan.jobs) {
    const enqueued = await enqueueJob(job.payload);
    logger.log(`- enqueued ${enqueued.enqueuedJobId}`);
  }

  logger.log(
    `Enqueued ${String(plan.jobs.length)} Mailchimp historical capture job(s).`
  );
  return plan;
}

async function main(): Promise<void> {
  await runMailchimpHistoricalCaptureCommand(process.argv.slice(2), process.env);
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "mailchimp-capture-historical failed."
  );
  process.exitCode = 1;
});
