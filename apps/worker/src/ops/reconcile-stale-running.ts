import { and, eq, isNull, lt, or } from "drizzle-orm";

import { syncState, type Stage1Database } from "@as-comms/db";
import type { Stage1RepositoryBundle } from "@as-comms/domain";

import type { Stage1SyncStateService } from "../orchestration/index.js";

export interface ReconcileStaleRunningError {
  readonly syncStateId: string;
  readonly message: string;
}

export interface ReconcileStaleRunningReport {
  readonly scanned: number;
  readonly swept: number;
  readonly errors: readonly ReconcileStaleRunningError[];
}

interface ReconcileStaleRunningDependencies {
  readonly db: Stage1Database;
  readonly repositories: Stage1RepositoryBundle;
  readonly syncState: Stage1SyncStateService;
  readonly leaseThresholdMs: number;
  readonly now?: () => Date;
  readonly logger?: Pick<Console, "log">;
}

function subtractLeaseThreshold(now: Date, leaseThresholdMs: number): Date {
  return new Date(now.getTime() - leaseThresholdMs);
}

export async function reconcileStaleRunning(
  dependencies: ReconcileStaleRunningDependencies
): Promise<ReconcileStaleRunningReport> {
  const now = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? console;
  const cutoff = subtractLeaseThreshold(now(), dependencies.leaseThresholdMs);
  const staleRows = await dependencies.db
    .select()
    .from(syncState)
    .where(
      and(
        eq(syncState.status, "running"),
        or(
          lt(syncState.heartbeatAt, cutoff),
          and(isNull(syncState.heartbeatAt), lt(syncState.updatedAt, cutoff))
        )
      )
    );
  const errors: ReconcileStaleRunningError[] = [];
  let swept = 0;

  for (const row of staleRows) {
    try {
      await dependencies.syncState.failWindow({
        syncStateId: row.id,
        scope: row.scope,
        provider: row.provider,
        jobType: row.jobType,
        cursor: row.cursor,
        checkpoint: row.cursor,
        windowStart: row.windowStart === null ? null : row.windowStart.toISOString(),
        windowEnd: row.windowEnd === null ? null : row.windowEnd.toISOString(),
        deadLetterCountIncrement: 1,
        deadLettered: false
      });
      logger.log(
        JSON.stringify({
          event: "sync_state.stale_running_sweep.recovered",
          syncStateId: row.id,
          reason: "stale_running_sweep"
        })
      );
      swept += 1;
    } catch (error) {
      errors.push({
        syncStateId: row.id,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    scanned: staleRows.length,
    swept,
    errors
  };
}
