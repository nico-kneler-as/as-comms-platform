import { describe, expect, it } from "vitest";

import { createTaskList } from "../../src/tasks.js";
import {
  createReconcileStaleRunningTask,
  reconcileStaleRunningJobName
} from "../../src/jobs/reconcile-stale-running.js";
import { createTestWorkerContext } from "../helpers.js";

describe("reconcile stale running task", () => {
  it("fails stale running rows and leaves fresh or terminal rows untouched", async () => {
    const context = await createTestWorkerContext();

    try {
      await context.repositories.syncState.upsert({
        id: "sync:stale-running:stale",
        scope: "provider",
        provider: "mailchimp",
        jobType: "historical_backfill",
        cursor: "cursor:stale",
        windowStart: "2026-01-01T00:00:00.000Z",
        windowEnd: "2026-01-01T00:05:00.000Z",
        status: "running",
        parityPercent: null,
        freshnessP95Seconds: null,
        freshnessP99Seconds: null,
        lastSuccessfulAt: null,
        consecutiveFailureCount: 0,
        leaseOwner: "worker:stale",
        heartbeatAt: "2026-01-01T00:00:00.000Z",
        deadLetterCount: 0
      });
      await context.repositories.syncState.upsert({
        id: "sync:stale-running:fresh",
        scope: "provider",
        provider: "mailchimp",
        jobType: "historical_backfill",
        cursor: "cursor:fresh",
        windowStart: "2026-01-01T00:00:00.000Z",
        windowEnd: "2026-01-01T00:05:00.000Z",
        status: "running",
        parityPercent: null,
        freshnessP95Seconds: null,
        freshnessP99Seconds: null,
        lastSuccessfulAt: null,
        consecutiveFailureCount: 0,
        leaseOwner: "worker:fresh",
        heartbeatAt: "2026-01-01T00:09:30.000Z",
        deadLetterCount: 0
      });
      await context.repositories.syncState.upsert({
        id: "sync:stale-running:succeeded",
        scope: "provider",
        provider: "mailchimp",
        jobType: "historical_backfill",
        cursor: "cursor:succeeded",
        windowStart: "2026-01-01T00:00:00.000Z",
        windowEnd: "2026-01-01T00:05:00.000Z",
        status: "succeeded",
        parityPercent: null,
        freshnessP95Seconds: null,
        freshnessP99Seconds: null,
        lastSuccessfulAt: "2026-01-01T00:10:00.000Z",
        consecutiveFailureCount: 0,
        leaseOwner: null,
        heartbeatAt: null,
        deadLetterCount: 0
      });

      const task = createReconcileStaleRunningTask({
        db: context.db,
        repositories: context.repositories,
        syncState: context.syncState,
        leaseThresholdMs: 5 * 60 * 1000,
        now: () => new Date("2026-01-01T00:10:00.000Z"),
        logger: {
          log: () => undefined
        }
      });

      await task({} as never, {} as never);

      await expect(
        context.repositories.syncState.findById("sync:stale-running:stale")
      ).resolves.toMatchObject({
        status: "failed",
        leaseOwner: null,
        heartbeatAt: null,
        deadLetterCount: 1
      });
      await expect(
        context.repositories.syncState.findById("sync:stale-running:fresh")
      ).resolves.toMatchObject({
        status: "running",
        leaseOwner: "worker:fresh",
        heartbeatAt: "2026-01-01T00:09:30.000Z",
        deadLetterCount: 0
      });
      await expect(
        context.repositories.syncState.findById("sync:stale-running:succeeded")
      ).resolves.toMatchObject({
        status: "succeeded",
        deadLetterCount: 0
      });

      const taskList = createTaskList(undefined, {
        reconcileStaleRunning: {
          db: context.db,
          repositories: context.repositories,
          syncState: context.syncState,
          leaseThresholdMs: 5 * 60 * 1000
        }
      });

      expect(taskList[reconcileStaleRunningJobName]).toBeDefined();
    } finally {
      await context.dispose();
    }
  });
});
