import { describe, expect, it } from "vitest";

import {
  applyOccurredAtUpdate,
  buildLoadStaleCanonicalsSql,
  loadStaleCanonicals,
  type StaleCanonicalTarget,
} from "../src/ops/reconcile-superseded-projections.js";
import { createTestWorkerContext } from "./helpers.js";

interface SqlRunner {
  unsafe<T extends readonly object[]>(query: string): Promise<T>;
}

interface PgliteShape {
  query(query: string): Promise<{ readonly rows: readonly unknown[] }>;
}

function pgliteSqlRunner(client: PgliteShape): SqlRunner {
  return {
    async unsafe<T extends readonly object[]>(query: string): Promise<T> {
      const result = await client.query(query);
      return result.rows as unknown as T;
    },
  };
}

async function seedSupersededLifecycle(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly idempotencyKey: string;
  readonly priorOccurredAt: string;
  readonly newOccurredAt: string;
}): Promise<{
  readonly sourceEvidenceId: string;
  readonly canonicalEventId: string;
  readonly contactId: string;
}> {
  const { context, idempotencyKey, priorOccurredAt, newOccurredAt } = input;
  const sourceEvidenceId = `sev:${idempotencyKey}`;
  const canonicalEventId = `cel:${idempotencyKey}`;
  const contactId = "contact:salesforce:0031VOLUNTEERA";

  // Seed contact (FK target for canonical_event_ledger.contact_id)
  await context.repositories.contacts.upsert({
    id: contactId,
    salesforceContactId: "0031VOLUNTEERA",
    displayName: "Test Volunteer",
    primaryEmail: "test@example.org",
    primaryPhone: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  // Seed source-evidence at the NEW (post-supersede) occurred_at
  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: "lifecycle_milestone",
    providerRecordId: "a15VKxxx",
    receivedAt: "2026-05-09T12:05:03.000Z",
    occurredAt: newOccurredAt,
    payloadRef: `salesforce://Expedition_Members__c/a15VKxxx#milestone`,
    idempotencyKey,
    checksum: "checksum-corrected",
  });

  // Seed canonical_event_ledger at the OLD occurred_at (the staleness)
  await context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId,
    eventType: "lifecycle.received_training",
    channel: "lifecycle",
    occurredAt: priorOccurredAt,
    contentFingerprint: null,
    sourceEvidenceId,
    idempotencyKey: `canonical-event:${idempotencyKey}`,
    provenance: {
      primaryProvider: "salesforce",
      primarySourceEvidenceId: sourceEvidenceId,
      sourceRecordType: "lifecycle_milestone",
      sourceRecordId: "a15VKxxx",
      messageKind: null,
      direction: null,
      campaignRef: null,
      threadRef: null,
      winnerReason: "single_source",
      supportingSourceEvidenceIds: [],
      notes: null,
    },
    reviewState: "clear",
  });

  // Seed a superseded_canonical quarantine row representing the prior canonical
  await context.repositories.sourceEvidenceQuarantine.record({
    provider: "salesforce",
    idempotencyKey,
    checksum: "checksum-prior",
    attemptedAt: new Date("2026-05-09T12:05:03.000Z"),
    reason: "superseded_canonical",
    payloadRef: `salesforce://Expedition_Members__c/a15VKxxx#prior`,
    details: {
      id: `${sourceEvidenceId}:prior`,
      provider: "salesforce",
      providerRecordType: "lifecycle_milestone",
      providerRecordId: "a15VKxxx",
      receivedAt: "2026-04-02T20:35:04.000Z",
      occurredAt: priorOccurredAt,
      payloadRef: `salesforce://Expedition_Members__c/a15VKxxx#prior`,
      idempotencyKey,
      checksum: "checksum-prior",
    },
  });

  return { sourceEvidenceId, canonicalEventId, contactId };
}

describe("reconcile-superseded-projections", () => {
  describe("buildLoadStaleCanonicalsSql", () => {
    it("filters on superseded_canonical exists + occurred_at delta", () => {
      const sql = buildLoadStaleCanonicalsSql({ limit: null });
      expect(sql).toContain("source_evidence_quarantine");
      expect(sql).toContain("superseded_canonical");
      expect(sql).toContain("sel.occurred_at <> cel.occurred_at");
    });

    it("applies LIMIT when set", () => {
      const sql = buildLoadStaleCanonicalsSql({ limit: 50 });
      expect(sql).toContain("LIMIT 50");
    });
  });

  describe("loadStaleCanonicals", () => {
    it("returns rows where canonical occurred_at differs from source", async () => {
      const context = await createTestWorkerContext();
      try {
        await seedSupersededLifecycle({
          context,
          idempotencyKey:
            "source-evidence:salesforce:lifecycle_milestone:a15VKaaa:Expedition_Members__c.Date_Training_Sent__c",
          priorOccurredAt: "2026-02-13T00:00:00.000Z",
          newOccurredAt: "2026-02-18T00:00:00.000Z",
        });

        const targets = await loadStaleCanonicals({
          sql: pgliteSqlRunner(context.client),
          limit: null,
        });

        expect(targets).toHaveLength(1);
        expect(targets[0]?.canonicalOccurredAt).toContain("2026-02-13");
        expect(targets[0]?.sourceOccurredAt).toContain("2026-02-18");
      } finally {
        await context.dispose();
      }
    });

    it("excludes already-aligned canonicals (no occurred_at delta)", async () => {
      const context = await createTestWorkerContext();
      try {
        // Same occurred_at on both sides — should NOT show up
        await seedSupersededLifecycle({
          context,
          idempotencyKey:
            "source-evidence:salesforce:lifecycle_milestone:a15VKbbb:Expedition_Members__c.CreatedDate",
          priorOccurredAt: "2026-02-13T00:00:00.000Z",
          newOccurredAt: "2026-02-13T00:00:00.000Z",
        });

        const targets = await loadStaleCanonicals({
          sql: pgliteSqlRunner(context.client),
          limit: null,
        });

        expect(targets).toHaveLength(0);
      } finally {
        await context.dispose();
      }
    });
  });

  describe("applyOccurredAtUpdate", () => {
    it("dry-run leaves canonical unchanged", async () => {
      const context = await createTestWorkerContext();
      try {
        const seeded = await seedSupersededLifecycle({
          context,
          idempotencyKey:
            "source-evidence:salesforce:lifecycle_milestone:a15VKccc:Expedition_Members__c.Date_Training_Sent__c",
          priorOccurredAt: "2026-02-13T00:00:00.000Z",
          newOccurredAt: "2026-02-18T00:00:00.000Z",
        });

        const target: StaleCanonicalTarget = {
          canonicalEventId: seeded.canonicalEventId,
          sourceEvidenceId: seeded.sourceEvidenceId,
          contactId: seeded.contactId,
          canonicalOccurredAt: "2026-02-13T00:00:00.000Z",
          sourceOccurredAt: "2026-02-18T00:00:00.000Z",
        };

        const outcome = await applyOccurredAtUpdate({
          db: context.db,
          target,
          dryRun: true,
        });

        expect(outcome).toBe("updated");

        // Canonical untouched after dry-run rollback
        const canonical = await context.repositories.canonicalEvents.findById(
          seeded.canonicalEventId,
        );
        expect(canonical?.occurredAt).toBe("2026-02-13T00:00:00.000Z");
      } finally {
        await context.dispose();
      }
    });

    it("execute mode updates canonical occurred_at to source-evidence value", async () => {
      const context = await createTestWorkerContext();
      try {
        const seeded = await seedSupersededLifecycle({
          context,
          idempotencyKey:
            "source-evidence:salesforce:lifecycle_milestone:a15VKddd:Expedition_Members__c.Date_Training_Sent__c",
          priorOccurredAt: "2026-02-13T00:00:00.000Z",
          newOccurredAt: "2026-02-18T00:00:00.000Z",
        });

        const target: StaleCanonicalTarget = {
          canonicalEventId: seeded.canonicalEventId,
          sourceEvidenceId: seeded.sourceEvidenceId,
          contactId: seeded.contactId,
          canonicalOccurredAt: "2026-02-13T00:00:00.000Z",
          sourceOccurredAt: "2026-02-18T00:00:00.000Z",
        };

        const outcome = await applyOccurredAtUpdate({
          db: context.db,
          target,
          dryRun: false,
        });

        expect(outcome).toBe("updated");

        const canonical = await context.repositories.canonicalEvents.findById(
          seeded.canonicalEventId,
        );
        expect(canonical?.occurredAt).toBe("2026-02-18T00:00:00.000Z");
        // contact_id, eventType, channel, etc. preserved across the upsert
        expect(canonical?.contactId).toBe(seeded.contactId);
        expect(canonical?.eventType).toBe("lifecycle.received_training");
      } finally {
        await context.dispose();
      }
    });

    it("re-applying after update returns already_aligned (idempotent)", async () => {
      const context = await createTestWorkerContext();
      try {
        const seeded = await seedSupersededLifecycle({
          context,
          idempotencyKey:
            "source-evidence:salesforce:lifecycle_milestone:a15VKeee:Expedition_Members__c.Date_Training_Sent__c",
          priorOccurredAt: "2026-02-13T00:00:00.000Z",
          newOccurredAt: "2026-02-18T00:00:00.000Z",
        });

        const target: StaleCanonicalTarget = {
          canonicalEventId: seeded.canonicalEventId,
          sourceEvidenceId: seeded.sourceEvidenceId,
          contactId: seeded.contactId,
          canonicalOccurredAt: "2026-02-13T00:00:00.000Z",
          sourceOccurredAt: "2026-02-18T00:00:00.000Z",
        };

        await applyOccurredAtUpdate({ db: context.db, target, dryRun: false });
        const second = await applyOccurredAtUpdate({
          db: context.db,
          target,
          dryRun: false,
        });

        expect(second).toBe("already_aligned");
      } finally {
        await context.dispose();
      }
    });

    it("returns missing_canonical when canonical row no longer exists", async () => {
      const context = await createTestWorkerContext();
      try {
        const target: StaleCanonicalTarget = {
          canonicalEventId: "cel:nonexistent",
          sourceEvidenceId: "sev:nonexistent",
          contactId: "contact:nonexistent",
          canonicalOccurredAt: "2026-02-13T00:00:00.000Z",
          sourceOccurredAt: "2026-02-18T00:00:00.000Z",
        };

        const outcome = await applyOccurredAtUpdate({
          db: context.db,
          target,
          dryRun: false,
        });

        expect(outcome).toBe("missing_canonical");
      } finally {
        await context.dispose();
      }
    });
  });
});
