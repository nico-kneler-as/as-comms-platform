import { randomUUID } from "node:crypto";

import {
  syncStateSchema,
  type Provider,
  type SyncJobType,
  type SyncScope,
  type SyncStateRecord
} from "@as-comms/contracts";
import type { Stage1PersistenceService } from "@as-comms/domain";

const WORKER_INSTANCE_ID = randomUUID();
export const workerInstanceId = WORKER_INSTANCE_ID;

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
  readonly leaseOwner: string | null;
  readonly heartbeatAt: string | null;
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
    leaseOwner: input.leaseOwner,
    heartbeatAt: input.heartbeatAt,
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
  heartbeat(input: {
    readonly syncStateId: string;
  }): Promise<SyncStateRecord | null>;
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
  const heartbeatTimestamp = (): string => new Date().toISOString();

  return {
    async startWindow(input) {
      const existing = await persistence.repositories.syncState.findById(
        input.syncStateId
      );
      const latestForComposite =
        existing === null
          ? await persistence.repositories.syncState.findLatest({
              scope: input.scope,
              provider: input.provider,
              jobType: input.jobType
            })
          : null;

      if (existing?.status === "succeeded") {
        return existing;
      }

      const carriedFailureCount =
        existing?.consecutiveFailureCount ??
        (latestForComposite?.status === "failed"
          ? latestForComposite.consecutiveFailureCount
          : 0);

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
          consecutiveFailureCount: carriedFailureCount,
          leaseOwner: WORKER_INSTANCE_ID,
          heartbeatAt: heartbeatTimestamp(),
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
          leaseOwner: existing?.leaseOwner ?? WORKER_INSTANCE_ID,
          heartbeatAt: heartbeatTimestamp(),
          deadLetterCount:
            (existing?.deadLetterCount ?? 0) + input.deadLetterCountIncrement
        })
      );
    },

    async heartbeat(input) {
      const existing = await persistence.repositories.syncState.findById(
        input.syncStateId
      );

      if (existing === null) {
        return null;
      }

      if (
        existing.status !== "running" ||
        existing.leaseOwner !== WORKER_INSTANCE_ID
      ) {
        return existing;
      }

      return persistence.saveSyncState(
        toSyncState({
          existing,
          id: existing.id,
          scope: existing.scope,
          provider: existing.provider,
          jobType: existing.jobType,
          cursor: existing.cursor,
          checkpoint: null,
          windowStart: existing.windowStart,
          windowEnd: existing.windowEnd,
          status: existing.status,
          parityPercent: existing.parityPercent,
          freshnessP95Seconds: existing.freshnessP95Seconds,
          freshnessP99Seconds: existing.freshnessP99Seconds,
          lastSuccessfulAt: existing.lastSuccessfulAt,
          consecutiveFailureCount: existing.consecutiveFailureCount,
          leaseOwner: existing.leaseOwner,
          heartbeatAt: heartbeatTimestamp(),
          deadLetterCount: existing.deadLetterCount
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
          leaseOwner: null,
          heartbeatAt: null,
          deadLetterCount: existing?.deadLetterCount ?? 0
        })
      );
    },

    async failWindow(input) {
      const existing = await persistence.repositories.syncState.findById(
        input.syncStateId
      );

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
          leaseOwner: null,
          heartbeatAt: null,
          deadLetterCount:
            (existing?.deadLetterCount ?? 0) + input.deadLetterCountIncrement
        })
      );
    }
  };
}
