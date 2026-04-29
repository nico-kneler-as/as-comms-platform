import type { Task } from "graphile-worker";

import type { Stage1Database } from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

import { reconcileRoutingReviewQueue } from "../ops/reconcile-routing-review-queue.js";

export const reconcileRoutingReviewQueueJobName =
  "reconcile-routing-review-queue" as const;

export interface ReconcileRoutingReviewQueueTaskDependencies {
  readonly db: Stage1Database;
  readonly repositories: Stage1RepositoryBundle;
  readonly logger?: Pick<Console, "log">;
}

export function createReconcileRoutingReviewQueueTask(
  dependencies: ReconcileRoutingReviewQueueTaskDependencies,
): Task {
  const logger = dependencies.logger ?? console;

  return () =>
    reconcileRoutingReviewQueue({
      db: dependencies.db,
      repositories: dependencies.repositories,
      dryRun: false,
      limit: 200,
      logger,
    }).then((report) => {
      if (report.errors.length > 0) {
        logger.log(
          JSON.stringify({
            event: "routing_review_queue.reconcile.errors",
            sample: report.errors.slice(0, 5),
          }),
        );
      }

      logger.log(
        JSON.stringify({
          event: "routing_review_queue.reconcile.completed",
          scanned: report.scanned,
          resolved: report.resolved,
          skipped: report.skipped,
          errors: report.errors.length,
          dryRun: report.dryRun,
        }),
      );

      if (report.errors.length > 0 && report.resolved + report.skipped === 0) {
        throw new Error(
          `Routing review queue reconcile made no progress and produced ${report.errors.length.toString()} errors.`,
        );
      }
    });
}
