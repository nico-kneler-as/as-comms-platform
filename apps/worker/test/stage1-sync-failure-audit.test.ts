import { describe, expect, it } from "vitest";

import { recordSyncFailureAudit } from "../src/orchestration/sync-failure-audit.js";
import { createTestWorkerContext } from "./helpers.js";

describe("Stage 1 sync failure audit", () => {
  it("records repeated failures with the same occurredAt under unique audit ids", async () => {
    const context = await createTestWorkerContext();

    try {
      await context.persistence.saveSyncState({
        id: "sync:parity:collision-proof",
        scope: "orchestration",
        provider: null,
        jobType: "parity_snapshot",
        status: "failed",
        cursor: null,
        windowStart: null,
        windowEnd: "2026-01-05T00:00:00.000Z",
        parityPercent: null,
        lastSuccessfulAt: null,
        consecutiveFailureCount: 0,
        leaseOwner: null,
        heartbeatAt: null,
        deadLetterCount: 0,
        freshnessP95Seconds: null,
        freshnessP99Seconds: null
      });

      const failureInput = {
        syncStateId: "sync:parity:collision-proof",
        scope: "orchestration" as const,
        provider: null,
        jobType: "parity_snapshot" as const,
        checkpoint: "checkpoint:parity:collision-proof",
        windowStart: null,
        windowEnd: "2026-01-05T00:00:00.000Z",
        failure: {
          disposition: "non_retryable" as const,
          retryable: false,
          message: "Parity snapshot failed."
        },
        occurredAt: "2026-01-05T00:00:00.000Z",
        actorId: "stage1-orchestration"
      };

      const first = await recordSyncFailureAudit(context.persistence, failureInput);
      const second = await recordSyncFailureAudit(context.persistence, failureInput);
      const audits = await context.repositories.auditEvidence.listByEntity({
        entityType: "sync_state",
        entityId: "sync:parity:collision-proof"
      });

      expect(first.id).not.toBe(second.id);
      expect(audits).toHaveLength(2);
      expect(new Set(audits.map((audit) => audit.id)).size).toBe(2);
      expect(audits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: first.id,
            policyCode: "stage1.sync.failure"
          }),
          expect.objectContaining({
            id: second.id,
            policyCode: "stage1.sync.failure"
          })
        ])
      );
    } finally {
      await context.dispose();
    }
  });
});
