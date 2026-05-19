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
    statuses: ["Active"],
    contactIds: [],
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

async function installGraphileJobsTable(context: WorkerContext): Promise<void> {
  await context.client.exec(`
    create schema if not exists graphile_worker;
    create table if not exists graphile_worker.jobs (
      id text primary key,
      task_identifier text not null,
      payload jsonb not null default '{}'::jsonb,
      run_at timestamptz not null default now(),
      attempts integer not null default 0,
      max_attempts integer not null default 25,
      locked_at timestamptz null
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
      await installGraphileJobsTable(context)
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
      await installGraphileJobsTable(context)
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
})
