import { describe, expect, it } from "vitest";

import { createReconcileSupersededProjectionsTask } from "../src/jobs/reconcile-superseded-projections.js";
import { createTestWorkerContext } from "./helpers.js";

interface PgliteShape {
  query(query: string): Promise<{ readonly rows: readonly unknown[] }>;
}

function pgliteSqlRunner(client: PgliteShape) {
  return {
    async unsafe<T extends readonly object[]>(query: string): Promise<T> {
      const result = await client.query(query);
      return result.rows as unknown as T;
    },
  };
}

interface MockJobLogger {
  log(entry: unknown): void;
  error(entry: unknown): void;
  readonly events: unknown[];
}

function createCapturedLogger(): MockJobLogger {
  const events: unknown[] = [];
  return {
    events,
    log: (entry: unknown) => {
      const text = typeof entry === "string" ? entry : String(entry);
      try {
        events.push(JSON.parse(text));
      } catch {
        events.push(text);
      }
    },
    error: () => {
      // Silent for these tests; would surface as Stage1NonRetryableJobError
      // up the stack if it mattered.
    },
  };
}

async function seedStaleLifecycle(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly idempotencyKey: string;
  readonly priorOccurredAt: string;
  readonly newOccurredAt: string;
}): Promise<{ readonly sourceEvidenceId: string; readonly contactId: string }> {
  const { context, idempotencyKey, priorOccurredAt, newOccurredAt } = input;
  const sourceEvidenceId = `sev:${idempotencyKey}`;
  const contactId = `contact:salesforce:cron-${idempotencyKey.slice(-6)}`;

  await context.repositories.contacts.upsert({
    id: contactId,
    salesforceContactId: `SF-${idempotencyKey.slice(-6)}`,
    displayName: "Cron Test Volunteer",
    primaryEmail: `${idempotencyKey.slice(-6)}@example.org`,
    primaryPhone: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: "lifecycle_milestone",
    providerRecordId: `a15VK${idempotencyKey.slice(-6)}`,
    receivedAt: "2026-06-06T15:05:01.000Z",
    occurredAt: newOccurredAt,
    payloadRef: `salesforce://Expedition_Members__c/a15VK#milestone-${idempotencyKey.slice(-6)}`,
    idempotencyKey,
    checksum: `chk-corrected-${idempotencyKey.slice(-6)}`,
  });

  await context.repositories.canonicalEvents.upsert({
    id: `cel:${idempotencyKey}`,
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
      sourceRecordId: `a15VK${idempotencyKey.slice(-6)}`,
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

  await context.repositories.sourceEvidenceQuarantine.record({
    provider: "salesforce",
    idempotencyKey,
    checksum: `chk-prior-${idempotencyKey.slice(-6)}`,
    attemptedAt: new Date("2026-06-06T15:05:01.000Z"),
    reason: "superseded_canonical",
    payloadRef: `salesforce://Expedition_Members__c/a15VK#prior-${idempotencyKey.slice(-6)}`,
    details: {
      id: `${sourceEvidenceId}:prior`,
      provider: "salesforce",
      providerRecordType: "lifecycle_milestone",
      providerRecordId: `a15VK${idempotencyKey.slice(-6)}`,
      receivedAt: "2026-04-02T20:35:04.000Z",
      occurredAt: priorOccurredAt,
      payloadRef: `salesforce://Expedition_Members__c/a15VK#prior-${idempotencyKey.slice(-6)}`,
      idempotencyKey,
      checksum: `chk-prior-${idempotencyKey.slice(-6)}`,
    },
  });

  return { sourceEvidenceId, contactId };
}

describe("reconcile-superseded-projections cron task", () => {
  it("updates canonical occurred_at + enqueues projection rebuild for affected contacts", async () => {
    const context = await createTestWorkerContext();
    try {
      await seedStaleLifecycle({
        context,
        idempotencyKey:
          "source-evidence:salesforce:lifecycle_milestone:cronXX:Expedition_Members__c.Date_Training_Sent__c",
        priorOccurredAt: "2026-02-13T00:00:00.000Z",
        newOccurredAt: "2026-02-18T00:00:00.000Z",
      });
      await seedStaleLifecycle({
        context,
        idempotencyKey:
          "source-evidence:salesforce:lifecycle_milestone:cronYY:Expedition_Members__c.Date_Training_Completed__c",
        priorOccurredAt: "2026-03-01T00:00:00.000Z",
        newOccurredAt: "2026-03-05T00:00:00.000Z",
      });

      const logger = createCapturedLogger();
      const enqueueCalls: { readonly contactIds: readonly string[] }[] = [];

      const task = createReconcileSupersededProjectionsTask({
        db: context.db,
        sql: pgliteSqlRunner(context.client),
        connectionString: "postgres://test/unused-when-mock-is-supplied",
        logger,
        enqueueProjectionRebuild: (input) => {
          enqueueCalls.push(input);
          return Promise.resolve({ enqueuedJobId: "test-rebuild-job-1" });
        },
      });

      // Graphile tasks are invoked with (payload, helpers). Our task body
      // ignores both since it derives all state from injected deps.
      await task(
        {},
        {
          job: { id: "test-job" },
        } as unknown as Parameters<typeof task>[1],
      );

      // Canonical rows updated
      const cronXX = await context.repositories.canonicalEvents.findById(
        "cel:source-evidence:salesforce:lifecycle_milestone:cronXX:Expedition_Members__c.Date_Training_Sent__c",
      );
      const cronYY = await context.repositories.canonicalEvents.findById(
        "cel:source-evidence:salesforce:lifecycle_milestone:cronYY:Expedition_Members__c.Date_Training_Completed__c",
      );
      expect(cronXX?.occurredAt).toBe("2026-02-18T00:00:00.000Z");
      expect(cronYY?.occurredAt).toBe("2026-03-05T00:00:00.000Z");

      // Cron emitted the completed event + enqueue event
      const completed = logger.events.find(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as Record<string, unknown>).event ===
            "reconcile_superseded_projections.cron.completed",
      );
      expect(completed).toMatchObject({
        targetCount: 2,
        summary: { occurredAtUpdated: 2 },
        contactCount: 2,
      });

      const enqueued = logger.events.find(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as Record<string, unknown>).event ===
            "reconcile_superseded_projections.cron.enqueued_rebuild",
      );
      expect(enqueued).toMatchObject({
        contactCount: 2,
        enqueuedJobId: "test-rebuild-job-1",
      });

      // Enqueue was called exactly once with both contact IDs
      expect(enqueueCalls).toHaveLength(1);
      expect(enqueueCalls[0]?.contactIds).toHaveLength(2);
    } finally {
      await context.dispose();
    }
  });

  it("skips enqueue when nothing is stale", async () => {
    const context = await createTestWorkerContext();
    try {
      const logger = createCapturedLogger();
      const enqueueCalls: unknown[] = [];

      const task = createReconcileSupersededProjectionsTask({
        db: context.db,
        sql: pgliteSqlRunner(context.client),
        connectionString: "postgres://test/unused",
        logger,
        enqueueProjectionRebuild: () => {
          enqueueCalls.push("called");
          return Promise.resolve({ enqueuedJobId: "should-not-be-used" });
        },
      });

      await task(
        {},
        { job: { id: "test-job" } } as unknown as Parameters<typeof task>[1],
      );

      const completed = logger.events.find(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as Record<string, unknown>).event ===
            "reconcile_superseded_projections.cron.completed",
      );
      expect(completed).toMatchObject({
        targetCount: 0,
        contactCount: 0,
      });

      // No projection-rebuild dispatched when there's nothing to rebuild
      expect(enqueueCalls).toHaveLength(0);
      const enqueued = logger.events.find(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as Record<string, unknown>).event ===
            "reconcile_superseded_projections.cron.enqueued_rebuild",
      );
      expect(enqueued).toBeUndefined();
    } finally {
      await context.dispose();
    }
  });
});
