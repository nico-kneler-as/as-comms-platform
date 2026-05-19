import type { Task } from "graphile-worker"

import {
  campaignSendJobMaxAttempts,
  campaignSendJobName,
  campaignSendPayloadSchema,
} from "@as-comms/contracts"
import type { Stage1Database } from "@as-comms/db"
import type { Stage1RepositoryBundle } from "@as-comms/domain"

import { reconcileStrandedCampaignRuns } from "../ops/reconcile-stranded-campaign-runs.js"

export const reconcileStrandedCampaignRunsJobName =
  "reconcile-stranded-campaign-runs" as const

export interface ReconcileStrandedCampaignRunsTaskDependencies {
  readonly db: Stage1Database
  readonly repositories: Pick<Stage1RepositoryBundle, "auditEvidence">
  readonly now?: () => Date
  readonly maxRunAgeHours?: number
  readonly logger?: Pick<Console, "log">
}

export function createReconcileStrandedCampaignRunsTask(
  dependencies: ReconcileStrandedCampaignRunsTaskDependencies,
): Task {
  const logger = dependencies.logger ?? console

  return (_payload, helpers) =>
    reconcileStrandedCampaignRuns({
      db: dependencies.db,
      repositories: dependencies.repositories,
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      ...(dependencies.maxRunAgeHours === undefined
        ? {}
        : { maxRunAgeHours: dependencies.maxRunAgeHours }),
      scheduleRecovery: async (runId) => {
        await helpers.addJob(
          campaignSendJobName,
          campaignSendPayloadSchema.parse({ runId }),
          {
            jobKey: `campaign-send:${runId}`,
            jobKeyMode: "replace",
            maxAttempts: campaignSendJobMaxAttempts,
          },
        )
      },
      logger,
    }).then((report) => {
      if (report.errors.length > 0) {
        logger.log(
          JSON.stringify({
            event: "campaign_send.stranded_run.reconcile.errors",
            sample: report.errors.slice(0, 5),
          }),
        )
      }

      logger.log(
        JSON.stringify({
          event: "campaign_send.stranded_run.reconcile.completed",
          scanned: report.scanned,
          reenqueued: report.reenqueued,
          agedOut: report.agedOut,
          errors: report.errors.length,
        }),
      )

      if (report.errors.length > 0 && report.reenqueued === 0) {
        throw new Error(
          `Stranded campaign run reconcile made no progress and produced ${report.errors.length.toString()} errors.`,
        )
      }
    })
}
