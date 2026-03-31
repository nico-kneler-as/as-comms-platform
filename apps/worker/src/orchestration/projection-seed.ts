import type { Stage1PersistenceService } from "@as-comms/domain";

export const projectionSeedPolicyCode = "stage1.projection.seed";

export async function recordProjectionSeedOnce(
  persistence: Stage1PersistenceService,
  input: {
    readonly canonicalEventId: string;
    readonly summary: string;
    readonly snippet: string;
    readonly occurredAt: string;
  }
): Promise<void> {
  const existingRecords = await persistence.repositories.auditEvidence.listByEntity({
    entityType: "canonical_event",
    entityId: input.canonicalEventId
  });

  const alreadyRecorded = existingRecords.some(
    (record) => record.policyCode === projectionSeedPolicyCode
  );

  if (alreadyRecorded) {
    return;
  }

  await persistence.recordAuditEvidence({
    id: `audit:canonical_event:${input.canonicalEventId}:projection-seed`,
    actorType: "worker",
    actorId: "stage1-orchestration",
    action: "record_projection_seed",
    entityType: "canonical_event",
    entityId: input.canonicalEventId,
    occurredAt: input.occurredAt,
    result: "recorded",
    policyCode: projectionSeedPolicyCode,
    metadataJson: {
      summary: input.summary,
      snippet: input.snippet
    }
  });
}
