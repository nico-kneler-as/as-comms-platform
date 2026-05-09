import type { SourceEvidenceRecord } from "@as-comms/contracts";

export type SourceEvidenceSupersedeDecision =
  | { readonly kind: "duplicate" }
  | { readonly kind: "supersede" };

export function sameSourceEvidenceRecord(
  incoming: SourceEvidenceRecord,
  existing: SourceEvidenceRecord
): boolean {
  return (
    incoming.provider === existing.provider &&
    incoming.providerRecordType === existing.providerRecordType &&
    incoming.providerRecordId === existing.providerRecordId &&
    incoming.occurredAt === existing.occurredAt &&
    incoming.idempotencyKey === existing.idempotencyKey &&
    incoming.checksum === existing.checksum
  );
}

// When a re-capture of an existing canonical produces a different checksum,
// supersede replaces the canonical in place. The prior canonical is preserved
// in source_evidence_quarantine with reason "superseded_canonical" by the
// caller. This keeps capture-mapper iteration (channel classification,
// description capping, etc.) safe: corrected payloads land on canonical
// instead of being silently dropped on the floor.
export function decideSourceEvidenceSupersede(
  existing: SourceEvidenceRecord,
  incoming: SourceEvidenceRecord
): SourceEvidenceSupersedeDecision {
  if (sameSourceEvidenceRecord(incoming, existing)) {
    return { kind: "duplicate" };
  }
  return { kind: "supersede" };
}
