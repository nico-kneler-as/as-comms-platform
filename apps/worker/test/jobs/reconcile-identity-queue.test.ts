import { describe, expect, it, vi } from "vitest";

import { reconcileIdentityQueueJobName } from "../../src/jobs/reconcile-identity-queue.js";
import { createTaskList } from "../../src/tasks.js";
import {
  createTestWorkerContext,
  type TestWorkerContext
} from "../helpers.js";

async function seedStoredGmailCase(
  context: TestWorkerContext,
  input: {
    readonly recordId: string;
    readonly email: string;
    readonly occurredAt: string;
    readonly receivedAt: string;
  }
): Promise<string> {
  const sourceEvidenceId = `source-evidence:gmail:message:${input.recordId}`;
  const caseId = `identity-review:${sourceEvidenceId}:identity_missing_anchor`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.recordId,
    receivedAt: input.receivedAt,
    occurredAt: input.occurredAt,
    payloadRef: `capture://gmail/${input.recordId}`,
    idempotencyKey: `source-evidence:gmail:message:${input.recordId}`,
    checksum: `checksum:${input.recordId}`
  });
  await context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.recordId,
    gmailThreadId: `thread:${input.recordId}`,
    rfc822MessageId: `<${input.recordId}@example.org>`,
    direction: "inbound",
    subject: `Subject ${input.recordId}`,
    fromHeader: `Volunteer <${input.email}>`,
    toHeader: "volunteers@adventurescientists.org",
    ccHeader: null,
    snippetClean: `snippet:${input.recordId}`,
    bodyTextPreview: `body:${input.recordId}`,
    capturedMailbox: "volunteers@adventurescientists.org",
    projectInboxAlias: null
  });
  await context.repositories.identityResolutionQueue.upsert({
    id: caseId,
    sourceEvidenceId,
    candidateContactIds: [],
    reasonCode: "identity_missing_anchor",
    status: "open",
    openedAt: input.receivedAt,
    resolvedAt: null,
    normalizedIdentityValues: [input.email],
    anchoredContactId: null,
    explanation: "Seeded scheduled reconcile case."
  });

  return caseId;
}

async function seedBrokenStoredSalesforceCase(
  context: TestWorkerContext,
  input: {
    readonly recordId: string;
    readonly email: string;
    readonly occurredAt: string;
    readonly receivedAt: string;
  }
): Promise<void> {
  const sourceEvidenceId =
    `source-evidence:salesforce:task_communication:${input.recordId}`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: "task_communication",
    providerRecordId: input.recordId,
    receivedAt: input.receivedAt,
    occurredAt: input.occurredAt,
    payloadRef: `capture://salesforce/${input.recordId}`,
    idempotencyKey:
      `source-evidence:salesforce:task_communication:${input.recordId}`,
    checksum: `checksum:${input.recordId}`
  });
  await context.repositories.salesforceEventContext.upsert({
    sourceEvidenceId,
    salesforceContactId: null,
    projectId: null,
    expeditionId: null,
    sourceField: null
  });
  await context.repositories.identityResolutionQueue.upsert({
    id: `identity-review:${sourceEvidenceId}:identity_missing_anchor`,
    sourceEvidenceId,
    candidateContactIds: [],
    reasonCode: "identity_missing_anchor",
    status: "open",
    openedAt: input.receivedAt,
    resolvedAt: null,
    normalizedIdentityValues: [input.email],
    anchoredContactId: null,
    explanation: "Seeded broken scheduled reconcile case."
  });
}

describe("reconcile identity queue task", () => {
  it("reconciles open cases up to the configured limit and logs the report", async () => {
    const context = await createTestWorkerContext();
    const logger = { log: vi.fn() };

    try {
      const [firstCaseId, secondCaseId] = await Promise.all([
        seedStoredGmailCase(context, {
          recordId: "gmail-scheduled-1",
          email: "first@example.org",
          occurredAt: "2026-04-28T12:00:00.000Z",
          receivedAt: "2026-04-28T12:00:00.000Z"
        }),
        seedStoredGmailCase(context, {
          recordId: "gmail-scheduled-2",
          email: "second@example.org",
          occurredAt: "2026-04-28T12:01:00.000Z",
          receivedAt: "2026-04-28T12:01:00.000Z"
        })
      ]);

      const taskList = createTaskList(undefined, {
        reconcileIdentityQueue: {
          db: context.db,
          repositories: context.repositories,
          capture: context.capture,
          gmailHistoricalReplay: {
            liveAccount: "volunteers@adventurescientists.org",
            projectInboxAliases: ["orcas@adventurescientists.org"]
          },
          logger
        }
      });

      const task = taskList[reconcileIdentityQueueJobName];

      if (task === undefined) {
        throw new Error("Expected reconcile identity queue task to be registered.");
      }

      await task({}, {} as never);

      const [firstCase, secondCase] = await Promise.all([
        context.repositories.identityResolutionQueue.findById(firstCaseId),
        context.repositories.identityResolutionQueue.findById(secondCaseId)
      ]);

      expect(await context.repositories.canonicalEvents.countAll()).toBe(2);
      expect(
        [firstCase?.status, secondCase?.status].sort()
      ).toEqual(["resolved", "resolved"]);
      expect(logger.log).toHaveBeenCalledWith(
        JSON.stringify({
          event: "identity_queue.reconcile.completed",
          scanned: 2,
          resolved: 0,
          created: 2,
          skipped: 0,
          errors: 0,
          dryRun: false
        })
      );
    } finally {
      await context.dispose();
    }
  });

  it("throws on systemic per-target failure", async () => {
    const context = await createTestWorkerContext();
    const logger = { log: vi.fn() };

    try {
      await Promise.all([
        seedBrokenStoredSalesforceCase(context, {
          recordId: "sf-broken-1",
          email: "broken-1@example.org",
          occurredAt: "2026-04-28T12:10:00.000Z",
          receivedAt: "2026-04-28T12:10:00.000Z"
        }),
        seedBrokenStoredSalesforceCase(context, {
          recordId: "sf-broken-2",
          email: "broken-2@example.org",
          occurredAt: "2026-04-28T12:11:00.000Z",
          receivedAt: "2026-04-28T12:11:00.000Z"
        }),
        seedBrokenStoredSalesforceCase(context, {
          recordId: "sf-broken-3",
          email: "broken-3@example.org",
          occurredAt: "2026-04-28T12:12:00.000Z",
          receivedAt: "2026-04-28T12:12:00.000Z"
        })
      ]);

      const taskList = createTaskList(undefined, {
        reconcileIdentityQueue: {
          db: context.db,
          repositories: context.repositories,
          capture: context.capture,
          gmailHistoricalReplay: {
            liveAccount: "volunteers@adventurescientists.org",
            projectInboxAliases: ["orcas@adventurescientists.org"]
          },
          logger
        }
      });
      const task = taskList[reconcileIdentityQueueJobName];

      if (task === undefined) {
        throw new Error("Expected reconcile identity queue task to be registered.");
      }

      await expect(task({}, {} as never)).rejects.toThrow(
        "Identity queue reconcile made no progress and produced 3 errors."
      );

      const loggedEntries: Record<string, unknown>[] =
        logger.log.mock.calls.map(
          ([entry]) => JSON.parse(entry as string) as Record<string, unknown>
        );

      expect(loggedEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "identity_queue.reconcile.errors"
          }),
          expect.objectContaining({
            event: "identity_queue.reconcile.completed",
            scanned: 3,
            resolved: 0,
            created: 0,
            skipped: 0,
            errors: 3,
            dryRun: false
          })
        ])
      );
    } finally {
      await context.dispose();
    }
  });
});
