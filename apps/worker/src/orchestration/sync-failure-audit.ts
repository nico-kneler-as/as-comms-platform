import { randomUUID } from "node:crypto";

import type {
  AuditEvidenceRecord,
  Provider,
  SyncJobType,
  SyncScope,
  SyncStateRecord
} from "@as-comms/contracts";
import type { Stage1PersistenceService } from "@as-comms/domain";

import type { Stage1JobFailure } from "./types.js";

export const syncFailurePolicyCode = "stage1.sync.failure";

export interface Stage1SyncFailureAuditRecord {
  readonly auditEvidenceId: string;
  readonly occurredAt: string;
  readonly message: string;
  readonly disposition: Stage1JobFailure["disposition"];
  readonly retryable: boolean;
}

export async function recordSyncFailureAudit(
  persistence: Stage1PersistenceService,
  input: {
    readonly syncStateId: string;
    readonly scope: SyncScope;
    readonly provider: Provider | null;
    readonly jobType: SyncJobType;
    readonly checkpoint: string | null;
    readonly windowStart: string | null;
    readonly windowEnd: string | null;
    readonly failure: Stage1JobFailure;
    readonly occurredAt: string;
    readonly actorId: string;
  }
): Promise<AuditEvidenceRecord> {
  return persistence.recordAuditEvidence({
    id: `audit:sync_state:${input.syncStateId}:failure:${String(Date.parse(input.occurredAt))}:${randomUUID()}`,
    actorType: "worker",
    actorId: input.actorId,
    action: "record_sync_failure",
    entityType: "sync_state",
    entityId: input.syncStateId,
    occurredAt: input.occurredAt,
    result: "recorded",
    policyCode: syncFailurePolicyCode,
    metadataJson: {
      scope: input.scope,
      provider: input.provider,
      jobType: input.jobType,
      checkpoint: input.checkpoint,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      message: input.failure.message,
      disposition: input.failure.disposition,
      retryable: input.failure.retryable
    }
  });
}

export function extractLatestSyncFailure(
  syncState: SyncStateRecord,
  auditRecords: readonly AuditEvidenceRecord[]
): Stage1SyncFailureAuditRecord | null {
  const latestFailureRecord = auditRecords
    .filter((record) => record.policyCode === syncFailurePolicyCode)
    .at(-1);

  if (latestFailureRecord === undefined) {
    return null;
  }

  if (
    syncState.status === "succeeded" &&
    syncState.lastSuccessfulAt !== null &&
    latestFailureRecord.occurredAt <= syncState.lastSuccessfulAt
  ) {
    return null;
  }

  const metadata = latestFailureRecord.metadataJson;
  const message =
    typeof metadata.message === "string" && metadata.message.trim().length > 0
      ? metadata.message
      : "Stage 1 sync failed without a recorded message.";
  const disposition =
    metadata.disposition === "retryable" ||
    metadata.disposition === "non_retryable" ||
    metadata.disposition === "dead_letter"
      ? metadata.disposition
      : "non_retryable";
  const retryable = metadata.retryable === true;

  return {
    auditEvidenceId: latestFailureRecord.id,
    occurredAt: latestFailureRecord.occurredAt,
    message,
    disposition,
    retryable
  };
}
