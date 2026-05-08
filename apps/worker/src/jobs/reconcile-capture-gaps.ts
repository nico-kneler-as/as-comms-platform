import type { Task } from "graphile-worker";

import {
  gmailLiveCaptureBatchJobName,
  salesforceLiveCaptureBatchJobName
} from "@as-comms/contracts";
import type { Stage1Database } from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

import {
  reconcileCaptureGaps,
  type CaptureGapRecoveryPlan
} from "../ops/reconcile-capture-gaps.js";
import { mailchimpTransitionSchedulerJobName } from "../orchestration/mailchimp-transition-scheduler.js";

export const reconcileCaptureGapsJobName = "reconcile-capture-gaps" as const;

export interface ReconcileCaptureGapsTaskDependencies {
  readonly db: Stage1Database;
  readonly repositories: Stage1RepositoryBundle;
  readonly now?: () => Date;
  readonly lookbackDays?: number;
  readonly minimumAgeMinutes?: number;
  readonly maxRecoveryWindowMinutes?: number;
  readonly maxRecoveriesPerRun?: number;
  readonly includeMailchimpScheduler?: boolean;
  readonly logger?: Pick<Console, "log">;
}

function resolveRecoveryJobName(plan: CaptureGapRecoveryPlan): string {
  switch (plan.provider) {
    case "gmail":
      return gmailLiveCaptureBatchJobName;
    case "salesforce":
      return salesforceLiveCaptureBatchJobName;
  }
}

export function createReconcileCaptureGapsTask(
  dependencies: ReconcileCaptureGapsTaskDependencies
): Task {
  const logger = dependencies.logger ?? console;

  return (_rawPayload, helpers) =>
    reconcileCaptureGaps({
      db: dependencies.db,
      repositories: dependencies.repositories,
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      ...(dependencies.lookbackDays === undefined
        ? {}
        : { lookbackDays: dependencies.lookbackDays }),
      ...(dependencies.minimumAgeMinutes === undefined
        ? {}
        : { minimumAgeMinutes: dependencies.minimumAgeMinutes }),
      ...(dependencies.maxRecoveryWindowMinutes === undefined
        ? {}
        : { maxRecoveryWindowMinutes: dependencies.maxRecoveryWindowMinutes }),
      ...(dependencies.maxRecoveriesPerRun === undefined
        ? {}
        : { maxRecoveriesPerRun: dependencies.maxRecoveriesPerRun }),
      ...(dependencies.includeMailchimpScheduler === undefined
        ? {}
        : { includeMailchimpScheduler: dependencies.includeMailchimpScheduler }),
      scheduleRecovery: async (plan) => {
        await helpers.addJob(resolveRecoveryJobName(plan), plan.payload, {
          maxAttempts: 1
        });
      },
      scheduleMailchimpTransition: async () => {
        await helpers.addJob(mailchimpTransitionSchedulerJobName, {}, {
          maxAttempts: 1
        });
      },
      logger
    }).then((report) => {
      if (report.errors.length > 0) {
        logger.log(
          JSON.stringify({
            event: "capture_gap_recovery.errors",
            sample: report.errors.slice(0, 5)
          })
        );
      }

      if (report.errors.length > 0 && report.scheduled === 0) {
        throw new Error(
          `Capture gap recovery made no progress and produced ${report.errors.length.toString()} errors.`
        );
      }
    });
}
