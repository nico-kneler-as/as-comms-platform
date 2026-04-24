import { describe, expect, it, vi, afterEach } from "vitest";

import {
  gmailLiveCaptureBatchJobName,
  salesforceLiveCaptureBatchJobName
} from "@as-comms/contracts";

import {
  createStage1TaskList,
  pollGmailLiveJobName,
  pollSalesforceLiveJobName
} from "../src/orchestration/tasks.js";
import { createTestWorkerContext } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

async function saveLiveSyncState(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
  input: {
    readonly id: string;
    readonly provider: "gmail" | "salesforce";
    readonly status: "running" | "succeeded";
    readonly cursor: string | null;
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
    readonly lastSuccessfulAt: string | null;
  }
): Promise<void> {
  await context.persistence.saveSyncState({
    id: input.id,
    scope: "provider",
    provider: input.provider,
    jobType: "live_ingest",
    status: input.status,
    cursor: input.cursor,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    parityPercent: null,
    lastSuccessfulAt: input.lastSuccessfulAt,
    deadLetterCount: 0,
    freshnessP95Seconds: null,
    freshnessP99Seconds: null
  });
}

describe("Stage 1 live polling scheduler tasks", () => {
  it("enqueues a Gmail live capture batch with a 10-minute sliding window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T00:06:00.000Z"));

    const context = await createTestWorkerContext();

    try {
      await saveLiveSyncState(context, {
        id: "sync:gmail:live:latest",
        provider: "gmail",
        status: "succeeded",
        cursor: "gmail:checkpoint:ignored",
        windowStart: "2026-01-05T00:04:00.000Z",
        windowEnd: "2026-01-05T00:05:00.000Z",
        lastSuccessfulAt: "2026-01-05T00:05:00.000Z"
      });

      const addJob = vi.fn(() => Promise.resolve({ id: "job:gmail:live:enqueued" }));
      const task = createStage1TaskList(context.orchestration)[pollGmailLiveJobName];

      expect(task).toBeTypeOf("function");
      if (task === undefined) {
        throw new Error("Expected Gmail poll task to be registered.");
      }

      await task({}, { addJob } as never);

      expect(addJob).toHaveBeenCalledTimes(1);
      expect(addJob).toHaveBeenCalledWith(
        gmailLiveCaptureBatchJobName,
        expect.objectContaining({
          provider: "gmail",
          mode: "live",
          jobType: "live_ingest",
          checkpoint: "2026-01-05T00:05:00.000Z",
          windowStart: "2026-01-04T23:56:00.000Z",
          windowEnd: "2026-01-05T00:06:00.000Z",
          attempt: 1,
          maxAttempts: 3,
          cursor: null,
          maxRecords: 1000,
          recordIds: []
        }),
        {
          maxAttempts: 1
        }
      );
    } finally {
      await context.dispose();
    }
  });

  it("does not enqueue Gmail live capture while a prior window is still running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T00:06:00.000Z"));

    const context = await createTestWorkerContext();

    try {
      await saveLiveSyncState(context, {
        id: "sync:gmail:live:running",
        provider: "gmail",
        status: "running",
        cursor: "2026-01-05T00:05:00.000Z",
        windowStart: "2026-01-05T00:05:00.000Z",
        windowEnd: "2026-01-05T00:06:00.000Z",
        lastSuccessfulAt: null
      });

      const addJob = vi.fn(() => Promise.resolve({ id: "job:gmail:live:enqueued" }));
      const task = createStage1TaskList(context.orchestration)[pollGmailLiveJobName];

      expect(task).toBeTypeOf("function");
      if (task === undefined) {
        throw new Error("Expected Gmail poll task to be registered.");
      }

      await task({}, { addJob } as never);

      expect(addJob).not.toHaveBeenCalled();
    } finally {
      await context.dispose();
    }
  });

  it("enqueues a Salesforce live capture batch from the latest checkpoint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T00:10:00.000Z"));

    const context = await createTestWorkerContext();

    try {
      await saveLiveSyncState(context, {
        id: "sync:salesforce:live:latest",
        provider: "salesforce",
        status: "succeeded",
        cursor: "salesforce:checkpoint:ignored",
        windowStart: "2026-01-05T00:00:00.000Z",
        windowEnd: "2026-01-05T00:05:00.000Z",
        lastSuccessfulAt: "2026-01-05T00:05:00.000Z"
      });

      const addJob = vi.fn(() =>
        Promise.resolve({
          id: "job:salesforce:live:enqueued"
        })
      );
      const task =
        createStage1TaskList(context.orchestration)[pollSalesforceLiveJobName];

      expect(task).toBeTypeOf("function");
      if (task === undefined) {
        throw new Error("Expected Salesforce poll task to be registered.");
      }

      await task({}, { addJob } as never);

      expect(addJob).toHaveBeenCalledTimes(1);
      expect(addJob).toHaveBeenCalledWith(
        salesforceLiveCaptureBatchJobName,
        expect.objectContaining({
          provider: "salesforce",
          mode: "live",
          jobType: "live_ingest",
          checkpoint: "2026-01-05T00:05:00.000Z",
          windowStart: "2026-01-05T00:05:00.000Z",
          windowEnd: "2026-01-05T00:10:00.000Z",
          attempt: 1,
          maxAttempts: 3,
          cursor: null,
          maxRecords: 1000,
          recordIds: []
        }),
        {
          maxAttempts: 1
        }
      );
    } finally {
      await context.dispose();
    }
  });

  it("does not enqueue Salesforce live capture while a prior window is still running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T00:10:00.000Z"));

    const context = await createTestWorkerContext();

    try {
      await saveLiveSyncState(context, {
        id: "sync:salesforce:live:running",
        provider: "salesforce",
        status: "running",
        cursor: "2026-01-05T00:05:00.000Z",
        windowStart: "2026-01-05T00:05:00.000Z",
        windowEnd: "2026-01-05T00:10:00.000Z",
        lastSuccessfulAt: null
      });

      const addJob = vi.fn(() =>
        Promise.resolve({
          id: "job:salesforce:live:enqueued"
        })
      );
      const task =
        createStage1TaskList(context.orchestration)[pollSalesforceLiveJobName];

      expect(task).toBeTypeOf("function");
      if (task === undefined) {
        throw new Error("Expected Salesforce poll task to be registered.");
      }

      await task({}, { addJob } as never);

      expect(addJob).not.toHaveBeenCalled();
    } finally {
      await context.dispose();
    }
  });
});
