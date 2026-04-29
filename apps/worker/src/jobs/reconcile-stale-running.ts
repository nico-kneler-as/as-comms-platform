import type { Task } from "graphile-worker";

import type { Stage1Database } from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

import { reconcileStaleRunning } from "../ops/reconcile-stale-running.js";
import type { Stage1SyncStateService } from "../orchestration/index.js";

export const reconcileStaleRunningJobName = "reconcile-stale-running" as const;

export interface ReconcileStaleRunningTaskDependencies {
  readonly db: Stage1Database;
  readonly repositories: Stage1RepositoryBundle;
  readonly syncState: Stage1SyncStateService;
  readonly leaseThresholdMs: number;
  readonly now?: () => Date;
  readonly logger?: Pick<Console, "log">;
}

export function createReconcileStaleRunningTask(
  dependencies: ReconcileStaleRunningTaskDependencies
): Task {
  const logger = dependencies.logger ?? console;

  return () =>
    reconcileStaleRunning({
      db: dependencies.db,
      repositories: dependencies.repositories,
      syncState: dependencies.syncState,
      leaseThresholdMs: dependencies.leaseThresholdMs,
      ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      logger
    }).then((report) => {
      if (report.errors.length > 0) {
        logger.log(
          JSON.stringify({
            event: "sync_state.stale_running.reconcile.errors",
            sample: report.errors.slice(0, 5)
          })
        );
      }

      logger.log(
        JSON.stringify({
          event: "sync_state.stale_running.reconcile.completed",
          scanned: report.scanned,
          swept: report.swept,
          errors: report.errors.length
        })
      );

      if (report.errors.length > 0 && report.swept === 0) {
        throw new Error(
          `Stale running reconcile made no progress and produced ${report.errors.length.toString()} errors.`
        );
      }
    });
}
