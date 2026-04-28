import type { Task } from "graphile-worker";

import type { Stage1Database } from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

import { reconcileIdentityQueue } from "../ops/reconcile-identity-queue.js";
import type { Stage1ProviderCapturePorts } from "../orchestration/index.js";

export const reconcileIdentityQueueJobName = "reconcile-identity-queue" as const;

interface GmailHistoricalReplayConfig {
  readonly liveAccount: string;
  readonly projectInboxAliases: readonly string[];
}

export interface ReconcileIdentityQueueTaskDependencies {
  readonly db: Stage1Database;
  readonly repositories: Stage1RepositoryBundle;
  readonly capture: Stage1ProviderCapturePorts;
  readonly gmailHistoricalReplay: GmailHistoricalReplayConfig;
  readonly logger?: Pick<Console, "log">;
}

export function createReconcileIdentityQueueTask(
  dependencies: ReconcileIdentityQueueTaskDependencies
): Task {
  const logger = dependencies.logger ?? console;

  return () =>
    Promise.resolve(
      reconcileIdentityQueue({
        db: dependencies.db,
        repositories: dependencies.repositories,
        capture: dependencies.capture,
        gmailHistoricalReplay: dependencies.gmailHistoricalReplay,
        dryRun: false,
        limit: 1,
        logger: {
          log: () => undefined
        }
      })
    ).then((report) => {
      logger.log(
        JSON.stringify({
          event: "identity_queue.reconcile.completed",
          scanned: report.scanned,
          resolved: report.resolved,
          created: report.created,
          skipped: report.skipped,
          errors: report.errors.length,
          dryRun: report.dryRun
        })
      );
    });
}
