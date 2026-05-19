import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"

import {
  campaignSendJobName,
} from "@as-comms/contracts"
import {
  type Stage1Database,
} from "@as-comms/db"
import type { Stage1RepositoryBundle } from "@as-comms/domain"

export interface ReconcileStrandedCampaignRunsError {
  readonly runId: string
  readonly message: string
}

export interface ReconcileStrandedCampaignRunsReport {
  readonly scanned: number
  readonly reenqueued: number
  readonly agedOut: number
  readonly errors: readonly ReconcileStrandedCampaignRunsError[]
  readonly runIds: readonly string[]
}

interface StrandedCampaignRunRow {
  readonly runId: string
  readonly startedAt: Date | null
}

export interface ReconcileStrandedCampaignRunsDependencies {
  readonly db: Stage1Database
  readonly repositories: Pick<Stage1RepositoryBundle, "auditEvidence">
  readonly scheduleRecovery: (runId: string) => Promise<void>
  readonly now?: () => Date
  readonly maxRunAgeHours?: number
  readonly logger?: Pick<Console, "log">
}

function subtractHours(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000)
}

export async function reconcileStrandedCampaignRuns(
  dependencies: ReconcileStrandedCampaignRunsDependencies,
): Promise<ReconcileStrandedCampaignRunsReport> {
  const now = dependencies.now ?? (() => new Date())
  const logger = dependencies.logger ?? console
  const maxRunAgeHours = dependencies.maxRunAgeHours ?? 24
  const cutoff = subtractHours(now(), maxRunAgeHours)

  const strandedRuns = (
    (await dependencies.db.execute(sql<StrandedCampaignRunRow>`
      select
        campaign_runs.id as "runId",
        campaign_runs.started_at as "startedAt"
      from campaign_runs
      where campaign_runs.state = 'sending'
        and not exists (
          select 1
          from graphile_worker.jobs jobs
          where jobs.task_identifier = ${campaignSendJobName}
            and jobs.payload::jsonb ->> 'runId' = campaign_runs.id
            and jobs.attempts < jobs.max_attempts
        )
    `)) as {
      readonly rows: readonly StrandedCampaignRunRow[]
    }
  ).rows
  const errors: ReconcileStrandedCampaignRunsError[] = []
  const runIds: string[] = []
  let reenqueued = 0
  let agedOut = 0

  for (const row of strandedRuns) {
    if (row.startedAt === null || row.startedAt < cutoff) {
      agedOut += 1
      continue
    }

    try {
      await dependencies.scheduleRecovery(row.runId)
      await dependencies.repositories.auditEvidence.append({
        id: randomUUID(),
        actorType: "system",
        actorId: "campaign-send-reconcile",
        action: "campaign_run.stranded_reconciled",
        entityType: "campaign_run",
        entityId: row.runId,
        occurredAt: now().toISOString(),
        result: "recorded",
        policyCode: "stage5a.campaign_run.stranded_reconciled",
        metadataJson: {
          detail:
            "Re-enqueued campaign-send after finding a sending run without a live worker job.",
        },
      })
      runIds.push(row.runId)
      reenqueued += 1
      logger.log(
        JSON.stringify({
          event: "campaign_send.stranded_run.reenqueued",
          runId: row.runId,
        }),
      )
    } catch (error) {
      errors.push({
        runId: row.runId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    scanned: strandedRuns.length,
    reenqueued,
    agedOut,
    errors,
    runIds,
  }
}
