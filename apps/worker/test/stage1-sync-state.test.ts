import { describe, expect, it } from "vitest";

import { workerInstanceId } from "../src/orchestration/sync-state.js";
import { createTestWorkerContext } from "./helpers.js";

describe("Stage 1 worker sync-state service", () => {
  it("starts, advances, and completes a sync window idempotently", async () => {
    const context = await createTestWorkerContext();

    try {
      const started = await context.syncState.startWindow({
        syncStateId: "sync:gmail:historical:1",
        scope: "provider",
        provider: "gmail",
        jobType: "historical_backfill",
        cursor: "cursor:start",
        checkpoint: null,
        windowStart: "2026-01-01T00:00:00.000Z",
        windowEnd: "2026-01-02T00:00:00.000Z"
      });

      const progressed = await context.syncState.recordBatchProgress({
        syncStateId: started.id,
        scope: started.scope,
        provider: started.provider,
        jobType: started.jobType,
        cursor: null,
        checkpoint: "checkpoint:1",
        windowStart: started.windowStart,
        windowEnd: started.windowEnd,
        deadLetterCountIncrement: 1
      });

      const completed = await context.syncState.completeWindow({
        syncStateId: started.id,
        scope: started.scope,
        provider: started.provider,
        jobType: started.jobType,
        cursor: "cursor:complete",
        checkpoint: "checkpoint:1",
        windowStart: started.windowStart,
        windowEnd: started.windowEnd,
        parityPercent: 100,
        freshnessP95Seconds: null,
        freshnessP99Seconds: null,
        completedAt: "2026-01-02T00:00:00.000Z"
      });

      const completedAgain = await context.syncState.completeWindow({
        syncStateId: started.id,
        scope: started.scope,
        provider: started.provider,
        jobType: started.jobType,
        cursor: "cursor:ignored",
        checkpoint: "checkpoint:ignored",
        windowStart: started.windowStart,
        windowEnd: started.windowEnd,
        parityPercent: 90,
        freshnessP95Seconds: null,
        freshnessP99Seconds: null,
        completedAt: "2026-01-03T00:00:00.000Z"
      });

      expect(started.status).toBe("running");
      expect(started.leaseOwner).toBe(workerInstanceId);
      expect(started.heartbeatAt).not.toBeNull();
      expect(progressed.cursor).toBe("checkpoint:1");
      expect(progressed.deadLetterCount).toBe(1);
      expect(progressed.consecutiveFailureCount).toBe(0);
      expect(progressed.leaseOwner).toBe(workerInstanceId);
      expect(progressed.heartbeatAt).not.toBeNull();
      expect(completed.status).toBe("succeeded");
      expect(completed.cursor).toBe("cursor:complete");
      expect(completed.parityPercent).toBe(100);
      expect(completed.consecutiveFailureCount).toBe(0);
      expect(completed.leaseOwner).toBeNull();
      expect(completed.heartbeatAt).toBeNull();
      expect(completedAgain).toEqual(completed);
    } finally {
      await context.dispose();
    }
  });

  it("marks exhausted retry failures as quarantined dead-letter state", async () => {
    const context = await createTestWorkerContext();

    try {
      const failed = await context.syncState.failWindow({
        syncStateId: "sync:gmail:dead-letter:1",
        scope: "provider",
        provider: "gmail",
        jobType: "dead_letter_reprocess",
        cursor: null,
        checkpoint: "replay:checkpoint:1",
        windowStart: null,
        windowEnd: "2026-01-02T00:00:00.000Z",
        deadLetterCountIncrement: 1,
        deadLettered: true
      });

      expect(failed.status).toBe("quarantined");
      expect(failed.cursor).toBe("replay:checkpoint:1");
      expect(failed.consecutiveFailureCount).toBe(1);
      expect(failed.deadLetterCount).toBe(1);
      expect(failed.leaseOwner).toBeNull();
      expect(failed.heartbeatAt).toBeNull();
    } finally {
      await context.dispose();
    }
  });

  it("refreshes heartbeats only for running rows owned by this worker", async () => {
    const context = await createTestWorkerContext();

    try {
      const started = await context.syncState.startWindow({
        syncStateId: "sync:gmail:heartbeat:1",
        scope: "provider",
        provider: "gmail",
        jobType: "historical_backfill",
        cursor: null,
        checkpoint: null,
        windowStart: null,
        windowEnd: null
      });
      const firstHeartbeatAt = started.heartbeatAt;
      const heartbeated = await context.syncState.heartbeat({
        syncStateId: started.id
      });

      expect(heartbeated?.leaseOwner).toBe(workerInstanceId);
      expect(heartbeated?.heartbeatAt).not.toBeNull();
      expect(Date.parse(heartbeated?.heartbeatAt ?? "")).toBeGreaterThanOrEqual(
        Date.parse(firstHeartbeatAt ?? "")
      );
      if (heartbeated === null) {
        throw new Error("Expected heartbeat to return the running sync state.");
      }

      await context.repositories.syncState.upsert({
        ...heartbeated,
        id: "sync:gmail:heartbeat:other-owner",
        leaseOwner: "worker:other",
        heartbeatAt: "2026-01-01T00:00:00.000Z"
      });
      await context.repositories.syncState.upsert({
        ...heartbeated,
        id: "sync:gmail:heartbeat:failed",
        status: "failed",
        leaseOwner: workerInstanceId,
        heartbeatAt: "2026-01-01T00:00:00.000Z"
      });
      await context.repositories.syncState.upsert({
        ...heartbeated,
        id: "sync:gmail:heartbeat:quarantined",
        status: "quarantined",
        leaseOwner: workerInstanceId,
        heartbeatAt: "2026-01-01T00:00:00.000Z"
      });
      await context.repositories.syncState.upsert({
        ...heartbeated,
        id: "sync:gmail:heartbeat:succeeded",
        status: "succeeded",
        leaseOwner: workerInstanceId,
        heartbeatAt: "2026-01-01T00:00:00.000Z"
      });

      await expect(
        context.syncState.heartbeat({
          syncStateId: "sync:gmail:heartbeat:other-owner"
        })
      ).resolves.toMatchObject({
        leaseOwner: "worker:other",
        heartbeatAt: "2026-01-01T00:00:00.000Z"
      });
      await expect(
        context.syncState.heartbeat({
          syncStateId: "sync:gmail:heartbeat:failed"
        })
      ).resolves.toMatchObject({
        status: "failed",
        heartbeatAt: "2026-01-01T00:00:00.000Z"
      });
      await expect(
        context.syncState.heartbeat({
          syncStateId: "sync:gmail:heartbeat:quarantined"
        })
      ).resolves.toMatchObject({
        status: "quarantined",
        heartbeatAt: "2026-01-01T00:00:00.000Z"
      });
      await expect(
        context.syncState.heartbeat({
          syncStateId: "sync:gmail:heartbeat:succeeded"
        })
      ).resolves.toMatchObject({
        status: "succeeded",
        heartbeatAt: "2026-01-01T00:00:00.000Z"
      });
    } finally {
      await context.dispose();
    }
  });

  it("stores orchestration-scoped sync state without a provider and preserves freshness metrics", async () => {
    const context = await createTestWorkerContext();

    try {
      const started = await context.syncState.startWindow({
        syncStateId: "sync:parity:1",
        scope: "orchestration",
        provider: null,
        jobType: "parity_snapshot",
        cursor: null,
        checkpoint: "checkpoint:parity:1",
        windowStart: null,
        windowEnd: "2026-01-02T00:00:00.000Z"
      });

      const completed = await context.syncState.completeWindow({
        syncStateId: started.id,
        scope: started.scope,
        provider: started.provider,
        jobType: started.jobType,
        cursor: null,
        checkpoint: "checkpoint:parity:1",
        windowStart: null,
        windowEnd: "2026-01-02T00:00:00.000Z",
        parityPercent: 99.8,
        freshnessP95Seconds: 45,
        freshnessP99Seconds: 90,
        completedAt: "2026-01-02T00:00:00.000Z"
      });

      const progressedAgain = await context.syncState.recordBatchProgress({
        syncStateId: completed.id,
        scope: completed.scope,
        provider: completed.provider,
        jobType: completed.jobType,
        cursor: null,
        checkpoint: "checkpoint:ignored",
        windowStart: completed.windowStart,
        windowEnd: completed.windowEnd,
        deadLetterCountIncrement: 0
      });

      expect(started.scope).toBe("orchestration");
      expect(started.provider).toBeNull();
      expect(completed.freshnessP95Seconds).toBe(45);
      expect(completed.freshnessP99Seconds).toBe(90);
      expect(progressedAgain).toEqual(completed);
    } finally {
      await context.dispose();
    }
  });

  it("increments consecutive failures and resets them only on terminal success", async () => {
    const context = await createTestWorkerContext();

    try {
      const firstFailure = await context.syncState.failWindow({
        syncStateId: "sync:salesforce:live:counter:1",
        scope: "provider",
        provider: "salesforce",
        jobType: "live_ingest",
        cursor: "salesforce:cursor:1",
        checkpoint: "salesforce:checkpoint:1",
        windowStart: "2026-01-05T00:00:00.000Z",
        windowEnd: "2026-01-05T00:05:00.000Z",
        deadLetterCountIncrement: 0,
        deadLettered: false
      });
      const secondFailure = await context.syncState.failWindow({
        syncStateId: firstFailure.id,
        scope: firstFailure.scope,
        provider: firstFailure.provider,
        jobType: firstFailure.jobType,
        cursor: firstFailure.cursor,
        checkpoint: "salesforce:checkpoint:2",
        windowStart: firstFailure.windowStart,
        windowEnd: firstFailure.windowEnd,
        deadLetterCountIncrement: 0,
        deadLettered: false
      });
      const progressed = await context.syncState.recordBatchProgress({
        syncStateId: secondFailure.id,
        scope: secondFailure.scope,
        provider: secondFailure.provider,
        jobType: secondFailure.jobType,
        cursor: secondFailure.cursor,
        checkpoint: "salesforce:checkpoint:3",
        windowStart: secondFailure.windowStart,
        windowEnd: secondFailure.windowEnd,
        deadLetterCountIncrement: 0
      });
      const completed = await context.syncState.completeWindow({
        syncStateId: progressed.id,
        scope: progressed.scope,
        provider: progressed.provider,
        jobType: progressed.jobType,
        cursor: progressed.cursor,
        checkpoint: "salesforce:checkpoint:4",
        windowStart: progressed.windowStart,
        windowEnd: progressed.windowEnd,
        parityPercent: null,
        freshnessP95Seconds: 60,
        freshnessP99Seconds: 120,
        completedAt: "2026-01-05T00:05:00.000Z"
      });
      const nextFailure = await context.syncState.failWindow({
        syncStateId: completed.id,
        scope: completed.scope,
        provider: completed.provider,
        jobType: completed.jobType,
        cursor: completed.cursor,
        checkpoint: "salesforce:checkpoint:5",
        windowStart: completed.windowStart,
        windowEnd: completed.windowEnd,
        deadLetterCountIncrement: 0,
        deadLettered: false
      });

      expect(firstFailure.consecutiveFailureCount).toBe(1);
      expect(secondFailure.consecutiveFailureCount).toBe(2);
      expect(progressed.consecutiveFailureCount).toBe(2);
      expect(progressed.leaseOwner).toBe(workerInstanceId);
      expect(progressed.heartbeatAt).not.toBeNull();
      expect(completed.consecutiveFailureCount).toBe(0);
      expect(nextFailure.consecutiveFailureCount).toBe(1);
      expect(nextFailure.leaseOwner).toBeNull();
      expect(nextFailure.heartbeatAt).toBeNull();
    } finally {
      await context.dispose();
    }
  });
});
