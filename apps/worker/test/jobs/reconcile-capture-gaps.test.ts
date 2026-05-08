import { describe, expect, it, vi } from "vitest";

import {
  gmailLiveCaptureBatchJobName,
  salesforceLiveCaptureBatchJobName
} from "@as-comms/contracts";

import { createReconcileCaptureGapsTask, reconcileCaptureGapsJobName } from "../../src/jobs/reconcile-capture-gaps.js";
import {
  reconcileCaptureGaps,
  type CaptureGapRecoveryPlan
} from "../../src/ops/reconcile-capture-gaps.js";
import { mailchimpTransitionSchedulerJobName } from "../../src/orchestration/mailchimp-transition-scheduler.js";
import { createTaskList } from "../../src/tasks.js";
import { createTestWorkerContext } from "../helpers.js";

function syncStateFixture(input: {
  readonly id: string;
  readonly provider: "gmail" | "salesforce" | "mailchimp";
  readonly status: "failed" | "quarantined" | "succeeded";
  readonly windowStart: string;
  readonly windowEnd: string;
}) {
  return {
    id: input.id,
    scope: "provider" as const,
    provider: input.provider,
    jobType: "live_ingest" as const,
    cursor: input.windowStart,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    status: input.status,
    parityPercent: null,
    freshnessP95Seconds: null,
    freshnessP99Seconds: null,
    lastSuccessfulAt:
      input.status === "succeeded" ? input.windowEnd : null,
    consecutiveFailureCount: input.status === "succeeded" ? 0 : 1,
    leaseOwner: null,
    heartbeatAt: null,
    deadLetterCount: input.status === "quarantined" ? 1 : 0
  };
}

describe("capture gap recovery", () => {
  it("coalesces uncovered recent live failures and skips covered or old windows", async () => {
    const context = await createTestWorkerContext();
    const scheduled: CaptureGapRecoveryPlan[] = [];
    let mailchimpScheduled = false;

    try {
      await Promise.all([
        context.repositories.syncState.upsert(
          syncStateFixture({
            id: "sync:gmail:failed:1",
            provider: "gmail",
            status: "failed",
            windowStart: "2026-05-07T02:15:00.000Z",
            windowEnd: "2026-05-07T02:25:00.000Z"
          })
        ),
        context.repositories.syncState.upsert(
          syncStateFixture({
            id: "sync:gmail:failed:2",
            provider: "gmail",
            status: "failed",
            windowStart: "2026-05-07T02:25:00.000Z",
            windowEnd: "2026-05-07T02:40:00.000Z"
          })
        ),
        context.repositories.syncState.upsert(
          syncStateFixture({
            id: "sync:gmail:covered",
            provider: "gmail",
            status: "failed",
            windowStart: "2026-05-07T04:00:00.000Z",
            windowEnd: "2026-05-07T04:10:00.000Z"
          })
        ),
        context.repositories.syncState.upsert(
          syncStateFixture({
            id: "sync:gmail:covering-success",
            provider: "gmail",
            status: "succeeded",
            windowStart: "2026-05-07T03:55:00.000Z",
            windowEnd: "2026-05-07T04:15:00.000Z"
          })
        ),
        context.repositories.syncState.upsert(
          syncStateFixture({
            id: "sync:salesforce:failed",
            provider: "salesforce",
            status: "quarantined",
            windowStart: "2026-05-06T23:00:00.000Z",
            windowEnd: "2026-05-06T23:05:00.000Z"
          })
        ),
        context.repositories.syncState.upsert(
          syncStateFixture({
            id: "sync:gmail:old",
            provider: "gmail",
            status: "failed",
            windowStart: "2026-04-20T00:00:00.000Z",
            windowEnd: "2026-04-20T00:10:00.000Z"
          })
        ),
        context.repositories.syncState.upsert(
          syncStateFixture({
            id: "sync:mailchimp:ignored",
            provider: "mailchimp",
            status: "failed",
            windowStart: "2026-05-07T02:00:00.000Z",
            windowEnd: "2026-05-07T02:05:00.000Z"
          })
        )
      ]);

      const report = await reconcileCaptureGaps({
        db: context.db,
        repositories: context.repositories,
        now: () => new Date("2026-05-07T12:00:00.000Z"),
        scheduleRecovery: (plan) => {
          scheduled.push(plan);
          return Promise.resolve();
        },
        scheduleMailchimpTransition: () => {
          mailchimpScheduled = true;
          return Promise.resolve();
        },
        logger: {
          log: () => undefined
        }
      });

      expect(report.scanned).toBe(4);
      expect(report.covered).toBe(1);
      expect(report.scheduled).toBe(2);
      expect(report.mailchimpSchedulerScheduled).toBe(true);
      expect(mailchimpScheduled).toBe(true);
      expect(scheduled).toHaveLength(2);
      expect(scheduled[0]).toMatchObject({
        provider: "gmail",
        sourceSyncStateIds: ["sync:gmail:failed:1", "sync:gmail:failed:2"],
        windowStart: "2026-05-07T02:15:00.000Z",
        windowEnd: "2026-05-07T02:40:00.000Z",
        payload: {
          provider: "gmail",
          mode: "live",
          jobType: "live_ingest",
          windowStart: "2026-05-07T02:15:00.000Z",
          windowEnd: "2026-05-07T02:40:00.000Z",
          maxRecords: 1000
        }
      });
      expect(scheduled[1]).toMatchObject({
        provider: "salesforce",
        sourceSyncStateIds: ["sync:salesforce:failed"],
        payload: {
          provider: "salesforce",
          mode: "live",
          jobType: "live_ingest"
        }
      });
      await expect(
        context.repositories.auditEvidence.listByEntity({
          entityType: "capture_gap_recovery",
          entityId: "2026-05-07"
        })
      ).resolves.toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });

  it("registers a Graphile task that enqueues provider recovery jobs", async () => {
    const context = await createTestWorkerContext();
    const addJob = vi.fn(() => Promise.resolve(null));

    try {
      await context.repositories.syncState.upsert(
        syncStateFixture({
          id: "sync:gmail:failed:task",
          provider: "gmail",
          status: "failed",
          windowStart: "2026-05-07T02:15:00.000Z",
          windowEnd: "2026-05-07T02:25:00.000Z"
        })
      );

      const task = createReconcileCaptureGapsTask({
        db: context.db,
        repositories: context.repositories,
        now: () => new Date("2026-05-07T12:00:00.000Z"),
        logger: {
          log: () => undefined
        }
      });

      await task({} as never, { addJob } as never);

      expect(addJob).toHaveBeenCalledWith(
        gmailLiveCaptureBatchJobName,
        expect.objectContaining({
          provider: "gmail",
          windowStart: "2026-05-07T02:15:00.000Z",
          windowEnd: "2026-05-07T02:25:00.000Z"
        }),
        { maxAttempts: 1 }
      );
      expect(addJob).toHaveBeenCalledWith(
        mailchimpTransitionSchedulerJobName,
        {},
        { maxAttempts: 1 }
      );

      const taskList = createTaskList(undefined, {
        reconcileCaptureGaps: {
          db: context.db,
          repositories: context.repositories
        }
      });

      expect(taskList[reconcileCaptureGapsJobName]).toBeDefined();
      expect(salesforceLiveCaptureBatchJobName).toBe("stage1.salesforce.capture.live");
    } finally {
      await context.dispose();
    }
  });
});
