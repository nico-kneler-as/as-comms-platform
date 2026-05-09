import { describe, expect, it } from "vitest";

import {
  applyReconcileTarget,
  buildLoadQuarantineSql,
  loadReconcileTargets,
  type ReconcileTarget,
} from "../src/ops/reconcile-stale-canonical.js";
import { createTestWorkerContext } from "./helpers.js";

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

interface PgliteShape {
  query(query: string): Promise<{ readonly rows: readonly unknown[] }>;
}

// PGlite exposes a Postgres-shaped query API but doesn't ship the postgres-js
// `sql.unsafe` surface. Adapt for the ops' SqlRunner protocol so tests can
// drive loadReconcileTargets without spinning up a real Postgres.
function pgliteSqlRunner(client: PgliteShape): SqlRunner {
  return {
    async unsafe<T extends readonly object[]>(query: string): Promise<T> {
      const result = await client.query(query);
      return result.rows as unknown as T;
    },
  };
}

async function seedSuperseded(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly idempotencyKey: string;
  readonly priorChecksum: string;
  readonly newChecksum: string;
  readonly priorReceivedAt: string;
  readonly newReceivedAt: string;
  readonly newOccurredAt?: string;
}): Promise<void> {
  const {
    context,
    idempotencyKey,
    priorChecksum,
    newChecksum,
    newOccurredAt = "2026-02-18T00:00:00.000Z",
  } = input;
  await context.repositories.sourceEvidence.append({
    id: `sev_prior:${idempotencyKey}`,
    provider: "salesforce",
    providerRecordType: "lifecycle_milestone",
    providerRecordId: "a15VK00000example",
    receivedAt: input.priorReceivedAt,
    occurredAt: "2026-02-13T00:00:00.000Z",
    payloadRef: "salesforce://Expedition_Members__c/a15VK00000example#prior",
    idempotencyKey,
    checksum: priorChecksum,
  });

  await context.repositories.sourceEvidenceQuarantine.record({
    provider: "salesforce",
    idempotencyKey,
    checksum: newChecksum,
    attemptedAt: new Date(input.newReceivedAt),
    reason: "checksum_mismatch",
    payloadRef: "salesforce://Expedition_Members__c/a15VK00000example#corrected",
    details: {
      id: `sev_corrected:${idempotencyKey}`,
      provider: "salesforce",
      providerRecordType: "lifecycle_milestone",
      providerRecordId: "a15VK00000example",
      receivedAt: input.newReceivedAt,
      occurredAt: newOccurredAt,
      payloadRef: "salesforce://Expedition_Members__c/a15VK00000example#corrected",
      idempotencyKey,
      checksum: newChecksum,
    },
  });
}

describe("reconcile-stale-canonical", () => {
  describe("buildLoadQuarantineSql", () => {
    it("includes provider and record-type filters when set", () => {
      const sqlAll = buildLoadQuarantineSql({
        provider: null,
        recordType: null,
        limit: null,
      });
      expect(sqlAll).toContain("reason = 'checksum_mismatch'");
      expect(sqlAll).not.toContain("provider =");
      expect(sqlAll).not.toContain("LIKE");

      const sqlScoped = buildLoadQuarantineSql({
        provider: "salesforce",
        recordType: "lifecycle_milestone",
        limit: 250,
      });
      expect(sqlScoped).toContain("provider = 'salesforce'");
      expect(sqlScoped).toContain(
        "idempotency_key LIKE 'source-evidence:%:lifecycle_milestone:%'",
      );
      expect(sqlScoped).toContain("LIMIT 250");
    });

    it("escapes single quotes in filters", () => {
      const sql = buildLoadQuarantineSql({
        provider: "sales'force",
        recordType: null,
        limit: null,
      });
      expect(sql).toContain("provider = 'sales''force'");
    });
  });

  describe("loadReconcileTargets", () => {
    it("picks the latest attempted_at per idempotency key", async () => {
      const context = await createTestWorkerContext();
      try {
        const idempotencyKey =
          "source-evidence:salesforce:lifecycle_milestone:a15VK00000a:Expedition_Members__c.Date_Training_Sent__c";
        await context.repositories.sourceEvidence.append({
          id: "sev_prior_1",
          provider: "salesforce",
          providerRecordType: "lifecycle_milestone",
          providerRecordId: "a15VK00000a",
          receivedAt: "2026-04-01T00:00:00.000Z",
          occurredAt: "2026-02-13T00:00:00.000Z",
          payloadRef: "salesforce://prior",
          idempotencyKey,
          checksum: "checksum-prior",
        });

        for (const entry of [
          {
            checksum: "checksum-corrected-old",
            attemptedAt: "2026-05-01T04:00:00.000Z",
            occurredAt: "2026-02-15T00:00:00.000Z",
          },
          {
            checksum: "checksum-corrected-new",
            attemptedAt: "2026-05-07T05:00:00.000Z",
            occurredAt: "2026-02-18T00:00:00.000Z",
          },
        ]) {
          await context.repositories.sourceEvidenceQuarantine.record({
            provider: "salesforce",
            idempotencyKey,
            checksum: entry.checksum,
            attemptedAt: new Date(entry.attemptedAt),
            reason: "checksum_mismatch",
            payloadRef: "salesforce://corrected",
            details: {
              id: `sev_${entry.checksum}`,
              provider: "salesforce",
              providerRecordType: "lifecycle_milestone",
              providerRecordId: "a15VK00000a",
              receivedAt: entry.attemptedAt,
              occurredAt: entry.occurredAt,
              payloadRef: "salesforce://corrected",
              idempotencyKey,
              checksum: entry.checksum,
            },
          });
        }

        const { targets, invalid } = await loadReconcileTargets({
          sql: pgliteSqlRunner(context.client),
          provider: "salesforce",
          recordType: "lifecycle_milestone",
          limit: null,
        });

        expect(invalid).toBe(0);
        expect(targets).toHaveLength(1);
        expect(targets[0]?.record.checksum).toBe("checksum-corrected-new");
      } finally {
        await context.dispose();
      }
    });

    it("counts invalid quarantine details_jsonb without crashing", async () => {
      const context = await createTestWorkerContext();
      try {
        await context.repositories.sourceEvidenceQuarantine.record({
          provider: "salesforce",
          idempotencyKey:
            "source-evidence:salesforce:lifecycle_milestone:bad:Expedition_Members__c.Date_Training_Sent__c",
          checksum: "checksum-bad",
          attemptedAt: new Date("2026-05-07T05:00:00.000Z"),
          reason: "checksum_mismatch",
          payloadRef: "salesforce://bad",
          details: {
            // Intentionally missing required fields like provider, idempotencyKey,
            // etc. — represents a historical quarantine row whose payload no
            // longer schema-validates.
            note: "incomplete payload",
          },
        });

        const { targets, invalid } = await loadReconcileTargets({
          sql: pgliteSqlRunner(context.client),
          provider: null,
          recordType: null,
          limit: null,
        });

        expect(targets).toHaveLength(0);
        expect(invalid).toBe(1);
      } finally {
        await context.dispose();
      }
    });
  });

  describe("applyReconcileTarget", () => {
    it("dry-run leaves canonical and quarantine untouched", async () => {
      const context = await createTestWorkerContext();
      try {
        const idempotencyKey =
          "source-evidence:salesforce:lifecycle_milestone:a15VK00000b:Expedition_Members__c.Date_Training_Sent__c";
        await seedSuperseded({
          context,
          idempotencyKey,
          priorChecksum: "checksum-prior-b",
          newChecksum: "checksum-corrected-b",
          priorReceivedAt: "2026-04-02T20:35:04.000Z",
          newReceivedAt: "2026-05-07T17:20:00.000Z",
        });

        const { targets } = await loadReconcileTargets({
          sql: pgliteSqlRunner(context.client),
          provider: null,
          recordType: null,
          limit: null,
        });
        expect(targets).toHaveLength(1);
        const [target] = targets as [ReconcileTarget];

        const outcome = await applyReconcileTarget({
          db: context.db,
          target,
          dryRun: true,
        });

        expect(outcome).toBe("superseded");

        const canonical =
          await context.repositories.sourceEvidence.findByIdempotencyKey(
            idempotencyKey,
          );
        expect(canonical?.checksum).toBe("checksum-prior-b");

        const quarantineRows =
          await context.repositories.sourceEvidenceQuarantine.listRecent({
            limit: 10,
          });
        expect(
          quarantineRows.entries.filter(
            (entry) => entry.reason === "superseded_canonical",
          ),
        ).toHaveLength(0);
      } finally {
        await context.dispose();
      }
    });

    it("execute mode supersedes canonical in place and parks the prior canonical", async () => {
      const context = await createTestWorkerContext();
      try {
        const idempotencyKey =
          "source-evidence:salesforce:lifecycle_milestone:a15VK00000c:Expedition_Members__c.Date_Training_Sent__c";
        await seedSuperseded({
          context,
          idempotencyKey,
          priorChecksum: "checksum-prior-c",
          newChecksum: "checksum-corrected-c",
          priorReceivedAt: "2026-04-02T20:35:04.000Z",
          newReceivedAt: "2026-05-07T17:20:00.000Z",
          newOccurredAt: "2026-02-18T00:00:00.000Z",
        });

        const { targets } = await loadReconcileTargets({
          sql: pgliteSqlRunner(context.client),
          provider: null,
          recordType: null,
          limit: null,
        });
        const [target] = targets as [ReconcileTarget];

        const outcome = await applyReconcileTarget({
          db: context.db,
          target,
          dryRun: false,
        });

        expect(outcome).toBe("superseded");

        const canonical =
          await context.repositories.sourceEvidence.findByIdempotencyKey(
            idempotencyKey,
          );
        expect(canonical?.id).toBe(`sev_prior:${idempotencyKey}`);
        expect(canonical?.checksum).toBe("checksum-corrected-c");
        expect(canonical?.occurredAt).toBe("2026-02-18T00:00:00.000Z");

        const quarantineRows =
          await context.repositories.sourceEvidenceQuarantine.listRecent({
            limit: 10,
          });
        const supersedeRows = quarantineRows.entries.filter(
          (entry) => entry.reason === "superseded_canonical",
        );
        expect(supersedeRows).toHaveLength(1);
        expect(supersedeRows[0]).toMatchObject({
          idempotencyKey,
          checksum: "checksum-prior-c",
        });
      } finally {
        await context.dispose();
      }
    });

    it("re-applying the same target after supersede returns duplicate (no churn)", async () => {
      const context = await createTestWorkerContext();
      try {
        const idempotencyKey =
          "source-evidence:salesforce:lifecycle_milestone:a15VK00000d:Expedition_Members__c.Date_Training_Sent__c";
        await seedSuperseded({
          context,
          idempotencyKey,
          priorChecksum: "checksum-prior-d",
          newChecksum: "checksum-corrected-d",
          priorReceivedAt: "2026-04-02T20:35:04.000Z",
          newReceivedAt: "2026-05-07T17:20:00.000Z",
        });

        const sql = pgliteSqlRunner(context.client);
        const { targets } = await loadReconcileTargets({
          sql,
          provider: null,
          recordType: null,
          limit: null,
        });
        const [target] = targets as [ReconcileTarget];

        await applyReconcileTarget({
          db: context.db,
          target,
          dryRun: false,
        });

        const secondOutcome = await applyReconcileTarget({
          db: context.db,
          target,
          dryRun: false,
        });

        expect(secondOutcome).toBe("duplicate");

        const supersedeRows = (
          await context.repositories.sourceEvidenceQuarantine.listRecent({
            limit: 10,
          })
        ).entries.filter((entry) => entry.reason === "superseded_canonical");
        expect(supersedeRows).toHaveLength(1);
      } finally {
        await context.dispose();
      }
    });
  });
});
