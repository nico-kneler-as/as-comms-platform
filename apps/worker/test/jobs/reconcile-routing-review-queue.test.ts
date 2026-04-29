import { describe, expect, it, vi } from "vitest";

import { reconcileRoutingReviewQueueJobName } from "../../src/jobs/reconcile-routing-review-queue.js";
import { createTaskList } from "../../src/tasks.js";
import { createTestWorkerContext, type TestWorkerContext } from "../helpers.js";

async function seedResolvableRoutingReviewCase(
  context: TestWorkerContext,
  input: {
    readonly recordId: string;
    readonly receivedAt: string;
  },
): Promise<string> {
  const sourceEvidenceId = `source-evidence:salesforce:task_communication:${input.recordId}`;
  const caseId = `routing-review:${sourceEvidenceId}:routing_missing_membership`;

  await context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: "contact-routing-reconcile",
      salesforceContactId: "003-routing-reconcile",
      displayName: "Routing Reconcile Contact",
      primaryEmail: "routing@example.org",
      primaryPhone: null,
      createdAt: "2026-04-28T12:00:00.000Z",
      updatedAt: "2026-04-28T12:00:00.000Z",
    },
    identities: [
      {
        id: "identity:contact-routing-reconcile:salesforce",
        contactId: "contact-routing-reconcile",
        kind: "salesforce_contact_id",
        normalizedValue: "003-routing-reconcile",
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-04-28T12:00:00.000Z",
      },
    ],
    memberships: [
      {
        id: "membership:routing-reconcile:project-stage1",
        contactId: "contact-routing-reconcile",
        projectId: "project-stage1",
        expeditionId: null,
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: "2026-04-28T12:00:00.000Z",
      },
    ],
  });
  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: "task_communication",
    providerRecordId: input.recordId,
    receivedAt: input.receivedAt,
    occurredAt: input.receivedAt,
    payloadRef: `capture://salesforce/${input.recordId}`,
    idempotencyKey: `source-evidence:salesforce:task_communication:${input.recordId}`,
    checksum: `checksum:${input.recordId}`,
  });
  await context.repositories.salesforceEventContext.upsert({
    sourceEvidenceId,
    salesforceContactId: "003-routing-reconcile",
    projectId: "project-stage1",
    expeditionId: null,
    sourceField: null,
  });
  await context.repositories.projectDimensions.upsert({
    projectId: "project-stage1",
    projectName: "Stage 1 Project",
    source: "salesforce",
  });
  await context.repositories.routingReviewQueue.upsert({
    id: caseId,
    contactId: "contact-routing-reconcile",
    sourceEvidenceId,
    reasonCode: "routing_missing_membership",
    status: "open",
    openedAt: input.receivedAt,
    resolvedAt: null,
    candidateMembershipIds: [],
    explanation: "Seeded scheduled routing reconcile case.",
  });

  return caseId;
}

async function seedBrokenRoutingReviewCase(
  context: TestWorkerContext,
  input: {
    readonly caseId: string;
    readonly sourceEvidenceId: string;
    readonly receivedAt: string;
  },
): Promise<void> {
  await context.repositories.routingReviewQueue.upsert({
    id: input.caseId,
    contactId: "contact-routing-broken",
    sourceEvidenceId: input.sourceEvidenceId,
    reasonCode: "routing_missing_membership",
    status: "open",
    openedAt: input.receivedAt,
    resolvedAt: null,
    candidateMembershipIds: [],
    explanation: "Seeded broken scheduled routing reconcile case.",
  });
}

describe("reconcile routing review queue task", () => {
  it("reconciles open cases up to the configured limit and logs the report", async () => {
    const context = await createTestWorkerContext();
    const logger = { log: vi.fn() };

    try {
      const caseId = await seedResolvableRoutingReviewCase(context, {
        recordId: "sf-routing-scheduled-1",
        receivedAt: "2026-04-28T12:00:00.000Z",
      });
      const taskList = createTaskList(undefined, {
        reconcileRoutingReviewQueue: {
          db: context.db,
          repositories: context.repositories,
          logger,
        },
      });
      const task = taskList[reconcileRoutingReviewQueueJobName];

      if (task === undefined) {
        throw new Error(
          "Expected reconcile routing review queue task to be registered.",
        );
      }

      await task({}, {} as never);

      const caseRecord =
        await context.repositories.routingReviewQueue.findById(caseId);

      expect(caseRecord?.status).toBe("resolved");
      expect(logger.log).toHaveBeenCalledWith(
        JSON.stringify({
          event: "routing_review_queue.reconcile.completed",
          scanned: 1,
          resolved: 1,
          skipped: 0,
          errors: 0,
          dryRun: false,
        }),
      );
    } finally {
      await context.dispose();
    }
  });

  it("throws on systemic per-target failure", async () => {
    const context = await createTestWorkerContext();
    const logger = { log: vi.fn() };

    try {
      await seedBrokenRoutingReviewCase(context, {
        caseId:
          "routing-review:missing-source-evidence-1:routing_missing_membership",
        sourceEvidenceId: "missing-source-evidence-1",
        receivedAt: "2026-04-28T12:10:00.000Z",
      });

      const taskList = createTaskList(undefined, {
        reconcileRoutingReviewQueue: {
          db: context.db,
          repositories: context.repositories,
          logger,
        },
      });
      const task = taskList[reconcileRoutingReviewQueueJobName];

      if (task === undefined) {
        throw new Error(
          "Expected reconcile routing review queue task to be registered.",
        );
      }

      await expect(task({}, {} as never)).rejects.toThrow(
        "Routing review queue reconcile made no progress and produced 1 errors.",
      );
    } finally {
      await context.dispose();
    }
  });
});
