import {
  syncStateSchema,
  type Provider,
  type SyncJobType,
  type SyncScope,
  type SyncStateRecord
} from "@as-comms/contracts";
import type { Stage1PersistenceService } from "@as-comms/domain";

function chooseCursor(
  existing: SyncStateRecord | null,
  cursor: string | null,
  checkpoint: string | null
): string | null {
  if (cursor !== null) {
    return cursor;
  }

  if (checkpoint !== null) {
    return checkpoint;
  }

  return existing?.cursor ?? null;
}

function toSyncState(input: {
  readonly existing: SyncStateRecord | null;
  readonly id: string;
  readonly scope: SyncScope;
  readonly provider: Provider | null;
  readonly jobType: SyncJobType;
  readonly cursor: string | null;
  readonly checkpoint: string | null;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly status: SyncStateRecord["status"];
  readonly parityPercent: number | null;
  readonly freshnessP95Seconds: number | null;
  readonly freshnessP99Seconds: number | null;
  readonly lastSuccessfulAt: string | null;
  readonly consecutiveFailureCount: number;
  readonly deadLetterCount: number;
}): SyncStateRecord {
  return syncStateSchema.parse({
    id: input.id,
    scope: input.scope,
    provider: input.provider,
    jobType: input.jobType,
    cursor: chooseCursor(input.existing, input.cursor, input.checkpoint),
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    status: input.status,
    parityPercent: input.parityPercent,
    freshnessP95Seconds: input.freshnessP95Seconds,
    freshnessP99Seconds: input.freshnessP99Seconds,
    lastSuccessfulAt: input.lastSuccessfulAt,
    consecutiveFailureCount: input.consecutiveFailureCount,
    deadLetterCount: input.deadLetterCount
  });
}

export interface Stage1SyncStateService {
  startWindow(input: {
    readonly syncStateId: string;
    readonly scope: SyncScope;
    readonly provider: Provider | null;
    readonly jobType: SyncJobType;
    readonly cursor: string | null;
    readonly checkpoint: string | null;
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
  }): Promise<SyncStateRecord>;
  recordBatchProgress(input: {
    readonly syncStateId: string;
    readonly scope: SyncScope;
    readonly provider: Provider | null;
    readonly jobType: SyncJobType;
    readonly cursor: string | null;
    readonly checkpoint: string | null;
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
    readonly deadLetterCountIncrement: number;
  }): Promise<SyncStateRecord>;
  completeWindow(input: {
    readonly syncStateId: string;
    readonly scope: SyncScope;
    readonly provider: Provider | null;
    readonly jobType: SyncJobType;
    readonly cursor: string | null;
    readonly checkpoint: string | null;
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
    readonly parityPercent: number | null;
    readonly freshnessP95Seconds: number | null;
    readonly freshnessP99Seconds: number | null;
    readonly completedAt: string;
  }): Promise<SyncStateRecord>;
  failWindow(input: {
    readonly syncStateId: string;
    readonly scope: SyncScope;
    readonly provider: Provider | null;
    readonly jobType: SyncJobType;
    readonly cursor: string | null;
    readonly checkpoint: string | null;
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
    readonly deadLetterCountIncrement: number;
    readonly deadLettered: boolean;
  }): Promise<SyncStateRecord>;
}

export function createStage1SyncStateService(
  persistence: Stage1PersistenceService
): Stage1SyncStateService {
  return {
    async startWindow(input) {
      const existing = await persistence.repositories.syncState.findById(
        input.syncStateId
      );

      if (existing?.status === "succeeded") {
        return existing;
      }

      return persistence.saveSyncState(
        toSyncState({
          existing,
          id: input.syncStateId,
          scope: input.scope,
          provider: input.provider,
          jobType: input.jobType,
          cursor: input.cursor,
          checkpoint: input.checkpoint,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          status: "running",
          parityPercent: existing?.parityPercent ?? null,
          freshnessP95Seconds: existing?.freshnessP95Seconds ?? null,
          freshnessP99Seconds: existing?.freshnessP99Seconds ?? null,
          lastSuccessfulAt: existing?.lastSuccessfulAt ?? null,
          consecutiveFailureCount: existing?.consecutiveFailureCount ?? 0,
          deadLetterCount: existing?.deadLetterCount ?? 0
        })
      );
    },

    async recordBatchProgress(input) {
      const existing = await persistence.repositories.syncState.findById(
        input.syncStateId
      );

      if (existing?.status === "succeeded" || existing?.status === "quarantined") {
        return existing;
      }

      return persistence.saveSyncState(
        toSyncState({
          existing,
          id: input.syncStateId,
          scope: input.scope,
          provider: input.provider,
          jobType: input.jobType,
          cursor: input.cursor,
          checkpoint: input.checkpoint,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          status: "running",
          parityPercent: existing?.parityPercent ?? null,
          freshnessP95Seconds: existing?.freshnessP95Seconds ?? null,
          freshnessP99Seconds: existing?.freshnessP99Seconds ?? null,
          lastSuccessfulAt: existing?.lastSuccessfulAt ?? null,
          consecutiveFailureCount: existing?.consecutiveFailureCount ?? 0,
          deadLetterCount:
            (existing?.deadLetterCount ?? 0) + input.deadLetterCountIncrement
        })
      );
    },

    async completeWindow(input) {
      const existing = await persistence.repositories.syncState.findById(
        input.syncStateId
      );

      if (existing?.status === "succeeded") {
        return existing;
      }

      return persistence.saveSyncState(
        toSyncState({
          existing,
          id: input.syncStateId,
          scope: input.scope,
          provider: input.provider,
          jobType: input.jobType,
          cursor: input.cursor,
          checkpoint: input.checkpoint,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          status: "succeeded",
          parityPercent: input.parityPercent,
          freshnessP95Seconds:
            input.freshnessP95Seconds ?? existing?.freshnessP95Seconds ?? null,
          freshnessP99Seconds:
            input.freshnessP99Seconds ?? existing?.freshnessP99Seconds ?? null,
          lastSuccessfulAt: input.completedAt,
          consecutiveFailureCount: 0,
          deadLetterCount: existing?.deadLetterCount ?? 0
        })
      );
    },

    async failWindow(input) {
      const existing = await persistence.repositories.syncState.findById(
        input.syncStateId
      );

      if (existing?.status === "succeeded") {
        return existing;
      }

      return persistence.saveSyncState(
        toSyncState({
          existing,
          id: input.syncStateId,
          scope: input.scope,
          provider: input.provider,
          jobType: input.jobType,
          cursor: input.cursor,
          checkpoint: input.checkpoint,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          status: input.deadLettered ? "quarantined" : "failed",
          parityPercent: existing?.parityPercent ?? null,
          freshnessP95Seconds: existing?.freshnessP95Seconds ?? null,
          freshnessP99Seconds: existing?.freshnessP99Seconds ?? null,
          lastSuccessfulAt: existing?.lastSuccessfulAt ?? null,
          consecutiveFailureCount: (existing?.consecutiveFailureCount ?? 0) + 1,
          deadLetterCount:
            (existing?.deadLetterCount ?? 0) + input.deadLetterCountIncrement
        })
      );
    }
  };
}
