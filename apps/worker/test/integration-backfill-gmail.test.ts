import { afterEach, describe, expect, it, vi } from "vitest";

import { integrationBackfillJobs } from "@as-comms/db";

import { createTestWorkerContext, type TestWorkerContext } from "./helpers.js";
import {
  createIntegrationBackfillGmailTask,
  enqueueIntegrationBackfillGmailJob,
} from "../src/orchestration/integration-backfill.js";

const windowStart = "2026-06-04T17:00:00.000Z";
const windowEnd = "2026-06-04T22:00:00.000Z";

const contexts: TestWorkerContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.dispose()));
});

async function createContext(): Promise<TestWorkerContext> {
  const context = await createTestWorkerContext();
  contexts.push(context);
  return context;
}

async function seedJob(
  context: TestWorkerContext,
  input?: Partial<(typeof integrationBackfillJobs)["$inferInsert"]>,
) {
  const [row] = await context.db
    .insert(integrationBackfillJobs)
    .values({
      id: input?.id ?? "integration_backfill_job:test",
      service: input?.service ?? "gmail",
      idempotencyKey:
        input?.idempotencyKey ?? "gmail:2026-06-04T17:00:00.000Z",
      triggeredBy: input?.triggeredBy ?? "manual",
      windowStart: input?.windowStart ?? new Date(windowStart),
      windowEnd: input?.windowEnd ?? new Date(windowEnd),
      mailbox: input?.mailbox ?? null,
      status: input?.status ?? "pending",
      enqueuedAt: input?.enqueuedAt ?? new Date(windowStart),
      startedAt: input?.startedAt ?? null,
      completedAt: input?.completedAt ?? null,
      resultJson: input?.resultJson ?? null,
      failureReason: input?.failureReason ?? null,
      createdAt: input?.createdAt ?? new Date(windowStart),
      updatedAt: input?.updatedAt ?? new Date(windowStart),
    })
    .returning();

  if (row === undefined) {
    throw new Error("Expected integration_backfill_jobs seed row.");
  }

  return row;
}

describe("integration-backfill-gmail", () => {
  it("deduplicates enqueue helper calls by idempotency key", async () => {
    const context = await createContext();
    const addJob = vi.fn(() => Promise.resolve(undefined));

    const first = await enqueueIntegrationBackfillGmailJob({
      persistence: context.persistence,
      addJob,
      service: "gmail",
      idempotencyKey: "gmail:2026-06-04T17:00:00.000Z",
      triggeredBy: "manual",
      windowStart,
      windowEnd,
      mailbox: null,
    });
    const second = await enqueueIntegrationBackfillGmailJob({
      persistence: context.persistence,
      addJob,
      service: "gmail",
      idempotencyKey: "gmail:2026-06-04T17:00:00.000Z",
      triggeredBy: "manual",
      windowStart,
      windowEnd,
      mailbox: null,
    });

    expect(first.enqueued).toBe(true);
    expect(second).toEqual({
      enqueued: false,
      jobId: first.jobId,
    });
    expect(
      await context.persistence.repositories.integrationBackfillJobs.countAll(),
    ).toBe(1);
    expect(addJob).toHaveBeenCalledTimes(1);
  });

  it("marks the job completed and stores result_json on success", async () => {
    const context = await createContext();
    await seedJob(context, {
      id: "integration_backfill_job:success",
    });

    const result = {
      dryRun: false,
      mailbox: "volunteers@adventurescientists.org",
      windowStart,
      windowEnd,
      query: "after:2026/06/04 before:2026/06/05",
      checked: 5,
      foundInDb: 1,
      missing: 4,
      skipped: 1,
      captured: 3,
      notFoundInMailbox: 1,
    };

    const task = createIntegrationBackfillGmailTask({
      persistence: context.persistence,
      runRecovery: vi.fn(() => Promise.resolve(result)),
    });

    await task({ jobId: "integration_backfill_job:success" }, {} as never);

    const updated =
      await context.persistence.repositories.integrationBackfillJobs.findById(
        "integration_backfill_job:success",
      );
    expect(updated?.status).toBe("completed");
    expect(updated?.startedAt).not.toBeNull();
    expect(updated?.completedAt).not.toBeNull();
    expect(updated?.resultJson).toEqual(result);
  });

  it("skips already completed jobs without re-running recovery", async () => {
    const context = await createContext();
    const seeded = await seedJob(context, {
      id: "integration_backfill_job:already-complete",
      status: "completed",
      startedAt: new Date("2026-06-04T22:01:00.000Z"),
      completedAt: new Date("2026-06-04T22:02:00.000Z"),
      resultJson: { captured: 3, skipped: 1 },
      updatedAt: new Date("2026-06-04T22:02:00.000Z"),
    });
    const runRecovery = vi.fn();
    const logs: string[] = [];
    const task = createIntegrationBackfillGmailTask({
      persistence: context.persistence,
      runRecovery,
      logger: {
        info(...args: readonly unknown[]) {
          const first = args[0];
          logs.push(typeof first === "string" ? first : JSON.stringify(first));
        },
        warn(...args: readonly unknown[]) {
          void args;
          return undefined;
        },
        error(...args: readonly unknown[]) {
          void args;
          return undefined;
        },
      },
    });

    await task(
      { jobId: "integration_backfill_job:already-complete" },
      {} as never,
    );

    const updated =
      await context.persistence.repositories.integrationBackfillJobs.findById(
        "integration_backfill_job:already-complete",
      );
    expect(runRecovery).not.toHaveBeenCalled();
    expect(updated).toMatchObject({
      status: "completed",
      startedAt: seeded.startedAt?.toISOString() ?? null,
      completedAt: seeded.completedAt?.toISOString() ?? null,
      resultJson: { captured: 3, skipped: 1 },
      updatedAt: seeded.updatedAt.toISOString(),
    });
    expect(logs.some((entry) => entry.includes("already processed"))).toBe(true);
  });

  it("marks the job failed and rethrows when recovery throws", async () => {
    const context = await createContext();
    await seedJob(context, {
      id: "integration_backfill_job:failure",
    });
    const task = createIntegrationBackfillGmailTask({
      persistence: context.persistence,
      runRecovery: vi.fn(() => {
        throw new Error("boom");
      }),
    });

    await expect(
      task({ jobId: "integration_backfill_job:failure" }, {} as never),
    ).rejects.toThrow("boom");

    const updated =
      await context.persistence.repositories.integrationBackfillJobs.findById(
        "integration_backfill_job:failure",
      );
    expect(updated?.status).toBe("failed");
    expect(updated?.completedAt).not.toBeNull();
    expect(updated?.failureReason).toBe("boom");
  });
});
