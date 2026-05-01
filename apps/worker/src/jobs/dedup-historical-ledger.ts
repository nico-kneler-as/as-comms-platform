import type { Task } from "graphile-worker";

import type { Stage1Database } from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

import { dedupHistoricalLedger } from "../ops/dedup-historical-ledger.js";

export const dedupHistoricalLedgerJobName = "dedup-historical-ledger" as const;

export interface DedupHistoricalLedgerTaskDependencies {
  readonly db: Stage1Database;
  readonly repositories: Stage1RepositoryBundle;
  readonly logger?: Pick<Console, "log" | "error">;
}

export function createDedupHistoricalLedgerTask(
  dependencies: DedupHistoricalLedgerTaskDependencies,
): Task {
  const logger = dependencies.logger ?? console;

  return () =>
    dedupHistoricalLedger({
      db: dependencies.db,
      repositories: dependencies.repositories,
      dryRun: true,
      logger,
      auditWriter: { writeLine: () => undefined },
    }).then((result) => {
      logger.log(
        JSON.stringify({
          event: "dedup_historical_ledger.dry_run.completed",
          scannedCandidates: result.scannedCandidateCount,
          plannedClusters: result.plannedClusterCount,
          plannedLosers: result.plannedLoserCount,
        }),
      );
    });
}
