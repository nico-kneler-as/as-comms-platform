import { describe, expect, it } from "vitest";

import {
  salesforceHistoricalCaptureBatchJobName,
  salesforceHistoricalCaptureBatchPayloadSchema
} from "@as-comms/contracts";

import { Stage1NonRetryableJobError } from "../src/orchestration/index.js";
import { createStage1TaskList } from "../src/orchestration/tasks.js";
import { createEmptyCapturePorts, createTestWorkerContext } from "./helpers.js";

describe("Stage 1 task list", () => {
  it("rethrows failed orchestration outcomes so Graphile marks the job as failed", async () => {
    const capture = createEmptyCapturePorts();
    capture.salesforce.captureHistoricalBatch = () => {
      throw new Stage1NonRetryableJobError("Unsupported Salesforce batch shape.");
    };

    const context = await createTestWorkerContext({ capture });

    try {
      const taskList = createStage1TaskList(context.orchestration);
      const task = taskList[salesforceHistoricalCaptureBatchJobName];

      expect(task).toBeTypeOf("function");
      if (task === undefined) {
        throw new Error("Expected Salesforce historical task to be registered.");
      }

      await expect(
        task(
          salesforceHistoricalCaptureBatchPayloadSchema.parse({
            version: 1,
            jobId: "job:salesforce:task-wrapper:1",
            correlationId: "corr:salesforce:task-wrapper:1",
            traceId: null,
            batchId: "batch:salesforce:task-wrapper:1",
            syncStateId: "sync:salesforce:task-wrapper:1",
            attempt: 1,
            maxAttempts: 3,
            provider: "salesforce",
            mode: "historical",
            jobType: "historical_backfill",
            cursor: null,
            checkpoint: null,
            windowStart: null,
            windowEnd: null,
            recordIds: [],
            maxRecords: 10
          }),
          {} as never
        )
      ).rejects.toMatchObject({
        name: "Stage1TaskOutcomeError",
        message:
          expect.stringContaining(
            "Unsupported Salesforce batch shape. (syncStateId=sync:salesforce:task-wrapper:1, status=failed)"
          ) as unknown
      });
    } finally {
      await context.dispose();
    }
  });
});
