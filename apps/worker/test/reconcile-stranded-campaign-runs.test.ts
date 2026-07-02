import { describe, expect, it, vi } from "vitest"

import type { CreateDraftInput } from "@as-comms/contracts"
import {
  campaignSendJobMaxAttempts,
  campaignSendJobName,
} from "@as-comms/contracts"
import { createStage5RepositoryBundle } from "@as-comms/db"

import {
  createReconcileStrandedCampaignRunsTask,
  reconcileStrandedCampaignRunsJobName,
} from "../src/jobs/reconcile-stranded-campaign-runs.js"
import { reconcileStrandedCampaignRuns } from "../src/ops/reconcile-stranded-campaign-runs.js"
import { createTaskList } from "../src/tasks.js"
import { createTestWorkerContext } from "./helpers.js"

type WorkerContext = Awaited<ReturnType<typeof createTestWorkerContext>>

function buildAudienceCriteria(): CreateDraftInput["audienceCriteria"] {
  return {
    projectId: "project-1",
    projectIds: ["project-1"],
    statuses: ["Confirmed"],
    contactIds: [],
    newsletterSubscriberIds: [],
    expeditionIds: [],
    lastActivityWindow: "all_time",
    hasReplied: "either",
    hasClicked: "either",
  }
}

function buildDraftInput(
  overrides: Partial<CreateDraftInput> = {},
): CreateDraftInput {
  return {
    id: "run-1",
    kind: "project",
    launchType: "normal_email",
    projectId: "project-1",
    name: null,
    fromEmail: null,
    fromName: null,
    replyToEmail: null,
    subjectTemplate: "Hello {{firstName}}",
    bodyHtmlTemplate: "<p>{{projectName}}</p>",
    bodyTextTemplate: "{{aliasEmail}}",
    preheader: null,
    audienceCriteria: buildAudienceCriteria(),
    audienceSize: null,
    createdByUserId: null,
    lastEditedByUserId: null,
    ...overrides,
  }
}

async function installGraphileWorkerSchema(context: WorkerContext): Promise<void> {
  await context.client.exec(`
    create schema if not exists graphile_worker;

    create table if not exists graphile_worker._private_tasks (
      id integer primary key,
      identifier text not null unique
    );

    create table if not exists graphile_worker._private_jobs (
      id text primary key,
      task_id integer not null references graphile_worker._private_tasks(id),
      payload json not null default '{}'::json,
      run_at timestamptz not null default now(),
      attempts integer not null default 0,
      max_attempts integer not null default 25,
      locked_at timestamptz null
    );

    create or replace view graphile_worker.jobs as
      select
        jobs.id,
        tasks.identifier as task_identifier,
        jobs.run_at,
        jobs.attempts,
        jobs.max_attempts,
        jobs.locked_at
      from graphile_worker._private_jobs jobs
      join graphile_worker._private_tasks tasks on tasks.id = jobs.task_id;
  `)
}

async function seedGraphileWorkerJob(
  context: WorkerContext,
  input: {
    readonly id: string
    readonly taskIdentifier: string
    readonly payload: string
    readonly attempts?: number
    readonly maxAttempts?: number
  },
): Promise<void> {
  await context.client.exec(`
    insert into graphile_worker._private_tasks (id, identifier)
    values (1, '${input.taskIdentifier}')
    on conflict (id) do update
      set identifier = excluded.identifier;

    insert into graphile_worker._private_jobs (
      id,
      task_id,
      payload,
      attempts,
      max_attempts
    )
    values (
      '${input.id}',
      1,
      '${input.payload}'::json,
      ${String(input.attempts ?? 0)},
      ${String(input.maxAttempts ?? campaignSendJobMaxAttempts)}
    );
  `)
}

async function seedProject(context: WorkerContext): Promise<void> {
  await context.repositories.projectDimensions.upsert({
    projectId: "project-1",
    projectName: "Project One",
    projectAlias: "project-one",
    connectedToProjectId: null,
    source: "manual",
    isActive: true,
    aiKnowledgeUrl: null,
    aiKnowledgeSyncedAt: null,
    aiKnowledgeSources: [],
    aiOperatingContext: "",
    aiAutoSyncSchedule: "never",
    aiOptimizedSynthesizedAt: null,
    aiOptimizedInputHash: null,
  })
  await context.settings.aliases.create({
    id: "alias-project-1",
    alias: "project-one@example.org",
    signature: "",
    projectId: "project-1",
    createdAt: new Date("2026-05-15T12:00:00.000Z"),
    updatedAt: new Date("2026-05-15T12:00:00.000Z"),
    createdBy: null,
    updatedBy: null,
  })
}

async function seedSendingRun(
  context: WorkerContext,
  input?: {
    readonly runId?: string
    readonly startedAt?: string
  },
): Promise<string> {
  const campaigns = createStage5RepositoryBundle(context.db)
  const run = await campaigns.campaignRuns.create(
    buildDraftInput({ id: input?.runId ?? "run-stranded" }),
  )

  await campaigns.campaignRuns.transitionState(run.id, "draft", "scheduled", {
    scheduledAt: "2026-05-15T12:30:00.000Z",
  })
  await campaigns.campaignRuns.transitionState(run.id, "scheduled", "sending", {
    startedAt: input?.startedAt ?? "2026-05-15T13:00:00.000Z",
  })

  return run.id
}

describe("reconcile stranded campaign runs", () => {
  it("returns stranded sending runs and records an audit when it re-enqueues them", async () => {
    const context = await createTestWorkerContext()
    const scheduled: string[] = []

    try {
      await installGraphileWorkerSchema(context)
      await seedProject(context)
      const runId = await seedSendingRun(context)

      const report = await reconcileStrandedCampaignRuns({
        db: context.db,
        repositories: context.repositories,
        scheduleRecovery: (candidateRunId) => {
          scheduled.push(candidateRunId)
          return Promise.resolve()
        },
        now: () => new Date("2026-05-15T14:00:00.000Z"),
        logger: {
          log: () => undefined,
        },
      })

      expect(report).toMatchObject({
        scanned: 1,
        reenqueued: 1,
        agedOut: 0,
        runIds: [runId],
      })
      expect(scheduled).toEqual([runId])

      await expect(
        context.repositories.auditEvidence.listByEntity({
          entityType: "campaign_run",
          entityId: runId,
        }),
      ).resolves.toContainEqual(
        expect.objectContaining({
          action: "campaign_run.stranded_reconciled",
        }),
      )
    } finally {
      await context.dispose()
    }
  })

  it("registers a Graphile task that re-enqueues stranded campaign sends with retry semantics", async () => {
    const context = await createTestWorkerContext()
    const addJob = vi.fn(() => Promise.resolve(null))

    try {
      await installGraphileWorkerSchema(context)
      await seedProject(context)
      const runId = await seedSendingRun(context, {
        runId: "run-stranded-task",
      })

      const task = createReconcileStrandedCampaignRunsTask({
        db: context.db,
        repositories: context.repositories,
        now: () => new Date("2026-05-15T14:00:00.000Z"),
        logger: {
          log: () => undefined,
        },
      })

      await task({} as never, { addJob } as never)

      expect(addJob).toHaveBeenCalledWith(
        campaignSendJobName,
        { runId },
        {
          jobKey: `campaign-send:${runId}`,
          jobKeyMode: "replace",
          maxAttempts: campaignSendJobMaxAttempts,
        },
      )

      const taskList = createTaskList(undefined, {
        reconcileStrandedCampaignRuns: {
          db: context.db,
          repositories: context.repositories,
        },
      })

      expect(taskList[reconcileStrandedCampaignRunsJobName]).toBeDefined()
    } finally {
      await context.dispose()
    }
  })

  it("iterates rows when db.execute returns a postgres-js Array (no .rows wrapper)", async () => {
    // postgres-js returns query results as an Array directly, while PGlite
    // wraps them in { rows: [...] }. The Drizzle type permits both, so the
    // op needs to normalize the shape before iterating. Regression test for
    // the production `TypeError: strandedRuns is not iterable` failure.
    const context = await createTestWorkerContext()
    const scheduled: string[] = []

    try {
      await seedProject(context)
      const runId = await seedSendingRun(context, {
        runId: "run-array-shape",
      })

      const arrayShapeRow = {
        runId,
        startedAt: new Date("2026-05-15T13:00:00.000Z"),
      }
      const fakeDb = {
        execute: () =>
          Promise.resolve(
            [arrayShapeRow] as unknown as ReturnType<
              typeof context.db.execute
            >,
          ),
      } as unknown as typeof context.db

      const report = await reconcileStrandedCampaignRuns({
        db: fakeDb,
        repositories: context.repositories,
        scheduleRecovery: (candidateRunId) => {
          scheduled.push(candidateRunId)
          return Promise.resolve()
        },
        now: () => new Date("2026-05-15T14:00:00.000Z"),
        logger: {
          log: () => undefined,
        },
      })

      expect(report).toMatchObject({
        scanned: 1,
        reenqueued: 1,
        agedOut: 0,
        runIds: [runId],
      })
      expect(scheduled).toEqual([runId])
    } finally {
      await context.dispose()
    }
  })

  it("does not re-enqueue sending runs that still have a live campaign-send job", async () => {
    const context = await createTestWorkerContext()
    const scheduled: string[] = []

    try {
      await installGraphileWorkerSchema(context)
      await seedProject(context)
      const runId = await seedSendingRun(context, {
        runId: "run-live-job",
      })

      await seedGraphileWorkerJob(context, {
        id: "job-live-run",
        taskIdentifier: campaignSendJobName,
        payload: JSON.stringify({ runId }),
      })

      const report = await reconcileStrandedCampaignRuns({
        db: context.db,
        repositories: context.repositories,
        scheduleRecovery: (candidateRunId) => {
          scheduled.push(candidateRunId)
          return Promise.resolve()
        },
        now: () => new Date("2026-05-15T14:00:00.000Z"),
        logger: {
          log: () => undefined,
        },
      })

      expect(report).toMatchObject({
        scanned: 0,
        reenqueued: 0,
        agedOut: 0,
        runIds: [],
      })
      expect(scheduled).toEqual([])
    } finally {
      await context.dispose()
    }
  })
})
