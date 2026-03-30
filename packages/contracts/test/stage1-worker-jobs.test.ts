import { describe, expect, it } from "vitest";

import {
  cutoverCheckpointBatchPayloadSchema,
  gmailHistoricalCaptureBatchPayloadSchema,
  parityCheckBatchPayloadSchema,
  projectionRebuildBatchPayloadSchema,
  replayBatchPayloadSchema,
  stage1WorkerJobNames
} from "../src/index.js";

describe("Stage 1 worker job contracts", () => {
  it("keeps first-scope job names explicit and stable", () => {
    expect(stage1WorkerJobNames).toEqual([
      "stage1.gmail.capture.historical",
      "stage1.gmail.capture.live",
      "stage1.salesforce.capture.historical",
      "stage1.salesforce.capture.live",
      "stage1.simpletexting.capture.historical",
      "stage1.simpletexting.capture.live",
      "stage1.mailchimp.capture.historical",
      "stage1.mailchimp.capture.transition",
      "stage1.replay.batch",
      "stage1.projection.rebuild",
      "stage1.parity.check",
      "stage1.cutover.checkpoint"
    ]);
  });

  it("validates provider capture payloads with explicit sync and batching fields", () => {
    const payload = gmailHistoricalCaptureBatchPayloadSchema.parse({
      version: 1,
      jobId: "job-1",
      correlationId: "corr-1",
      traceId: null,
      batchId: "batch-1",
      syncStateId: "sync-1",
      attempt: 1,
      maxAttempts: 3,
      provider: "gmail",
      mode: "historical",
      jobType: "historical_backfill",
      cursor: "cursor-1",
      checkpoint: "checkpoint-1",
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-01T01:00:00.000Z",
      recordIds: ["gmail-message-1"],
      maxRecords: 100
    });

    expect(payload.provider).toBe("gmail");
    expect(payload.mode).toBe("historical");
    expect(payload.cursor).toBe("cursor-1");
  });

  it("validates replay, rebuild, parity, and cutover payloads as separate contracts", () => {
    const replay = replayBatchPayloadSchema.parse({
      version: 1,
      jobId: "job-replay",
      correlationId: "corr-replay",
      traceId: null,
      batchId: "batch-replay",
      syncStateId: "sync-replay",
      attempt: 1,
      maxAttempts: 3,
      provider: "gmail",
      mode: "historical",
      jobType: "dead_letter_reprocess",
      items: [
        {
          providerRecordType: "message",
          providerRecordId: "gmail-message-1"
        }
      ]
    });
    const rebuild = projectionRebuildBatchPayloadSchema.parse({
      version: 1,
      jobId: "job-rebuild",
      correlationId: "corr-rebuild",
      traceId: null,
      batchId: "batch-rebuild",
      syncStateId: "sync-rebuild",
      attempt: 1,
      maxAttempts: 3,
      jobType: "projection_rebuild",
      projection: "all",
      contactIds: ["contact-1"],
      includeReviewOverlayRefresh: true
    });
    const parity = parityCheckBatchPayloadSchema.parse({
      version: 1,
      jobId: "job-parity",
      correlationId: "corr-parity",
      traceId: null,
      batchId: "batch-parity",
      syncStateId: "sync-parity",
      attempt: 1,
      maxAttempts: 3,
      jobType: "parity_snapshot",
      checkpointId: "checkpoint-1",
      providers: ["gmail", "salesforce"],
      sampleContactIds: [],
      sampleSize: 10,
      queueParityThresholdPercent: 99.5,
      timelineParityThresholdPercent: 99,
      evaluatedAt: "2026-01-01T01:00:00.000Z"
    });
    const cutover = cutoverCheckpointBatchPayloadSchema.parse({
      version: 1,
      jobId: "job-cutover",
      correlationId: "corr-cutover",
      traceId: null,
      batchId: "batch-cutover",
      syncStateId: "sync-cutover",
      attempt: 1,
      maxAttempts: 3,
      jobType: "final_delta_sync",
      checkpointId: "cutover-1",
      providers: ["gmail", "simpletexting"],
      evaluatedAt: "2026-01-01T01:00:00.000Z",
      requireHistoricalBackfillComplete: true,
      requireLiveIngestCoverage: true
    });

    expect(replay.items).toHaveLength(1);
    expect(rebuild.projection).toBe("all");
    expect(parity.providers).toEqual(["gmail", "salesforce"]);
    expect(cutover.jobType).toBe("final_delta_sync");
  });
});
