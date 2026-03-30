import { describe, expect, it } from "vitest";

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
      expect(progressed.cursor).toBe("checkpoint:1");
      expect(progressed.deadLetterCount).toBe(1);
      expect(completed.status).toBe("succeeded");
      expect(completed.cursor).toBe("cursor:complete");
      expect(completed.parityPercent).toBe(100);
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
      expect(failed.deadLetterCount).toBe(1);
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
});
