import { describe, expect, it } from "vitest";

import { reconcileIdentityQueue } from "../src/ops/reconcile-identity-queue.js";
import {
  createEmptyCapturePorts,
  createTestWorkerContext,
  type TestWorkerContext
} from "./helpers.js";

function buildGmailMessageRecord(input: {
  readonly recordId: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly normalizedParticipantEmails: readonly string[];
}) {
  return {
    recordType: "message" as const,
    recordId: input.recordId,
    direction: "inbound" as const,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    payloadRef: `capture://gmail/${input.recordId}`,
    checksum: `checksum:${input.recordId}`,
    snippet: `snippet:${input.recordId}`,
    subject: `subject:${input.recordId}`,
    snippetClean: `snippet:${input.recordId}`,
    bodyTextPreview: `body:${input.recordId}`,
    threadId: `thread:${input.recordId}`,
    rfc822MessageId: `<${input.recordId}@example.org>`,
    capturedMailbox: "volunteers@adventurescientists.org",
    projectInboxAlias: null,
    normalizedParticipantEmails: [...input.normalizedParticipantEmails],
    salesforceContactId: null,
    volunteerIdPlainValues: [],
    normalizedPhones: [],
    supportingRecords: [],
    crossProviderCollapseKey: null
  };
}

async function seedReplayCandidate(
  context: TestWorkerContext,
  input: {
    readonly sourceEvidenceId: string;
    readonly providerRecordId: string;
    readonly receivedAt: string;
  }
): Promise<void> {
  await context.repositories.sourceEvidence.append({
    id: input.sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.providerRecordId,
    receivedAt: input.receivedAt,
    occurredAt: input.receivedAt,
    payloadRef: `capture://gmail/${input.providerRecordId}`,
    idempotencyKey: `source-evidence:gmail:message:${input.providerRecordId}`,
    checksum: `checksum:${input.providerRecordId}`
  });
  await context.repositories.identityResolutionQueue.upsert({
    id: `identity-review:${input.sourceEvidenceId}:identity_missing_anchor`,
    sourceEvidenceId: input.sourceEvidenceId,
    candidateContactIds: [],
    reasonCode: "identity_missing_anchor",
    status: "open",
    openedAt: input.receivedAt,
    resolvedAt: null,
    normalizedIdentityValues: [],
    anchoredContactId: null,
    explanation: "Seeded stuck identity review case for reconciliation."
  });
}

async function seedExistingEmailContact(
  context: TestWorkerContext,
  input: {
    readonly contactId: string;
    readonly email: string;
    readonly displayName: string;
  }
): Promise<void> {
  await context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: input.contactId,
      salesforceContactId: null,
      displayName: input.displayName,
      primaryEmail: input.email,
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    identities: [
      {
        id: `identity:${input.contactId}:email`,
        contactId: input.contactId,
        kind: "email",
        normalizedValue: input.email,
        isPrimary: true,
        source: "gmail",
        verifiedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    memberships: []
  });
}

async function createReconcileContext(): Promise<TestWorkerContext> {
  const capture = createEmptyCapturePorts();
  const recordsById = new Map(
    [
      buildGmailMessageRecord({
        recordId: "gmail-known-1",
        occurredAt: "2026-01-01T00:01:00.000Z",
        receivedAt: "2026-01-01T00:01:00.000Z",
        normalizedParticipantEmails: ["known@example.org"]
      }),
      buildGmailMessageRecord({
        recordId: "gmail-new-1",
        occurredAt: "2026-01-01T00:02:00.000Z",
        receivedAt: "2026-01-01T00:02:00.000Z",
        normalizedParticipantEmails: ["fresh@example.org"]
      }),
      buildGmailMessageRecord({
        recordId: "gmail-ambiguous-1",
        occurredAt: "2026-01-01T00:03:00.000Z",
        receivedAt: "2026-01-01T00:03:00.000Z",
        normalizedParticipantEmails: ["shared@example.org"]
      })
    ].map((record) => [record.recordId, record] as const)
  );

  capture.gmail.captureLiveBatch = async (payload) => ({
    records: payload.recordIds.flatMap((recordId: string) => {
      const record = recordsById.get(recordId);
      return record === undefined ? [] : [record];
    }),
    nextCursor: null,
    checkpoint: payload.recordIds.at(-1) ?? null
  });

  const context = await createTestWorkerContext({
    capture
  });

  await seedExistingEmailContact(context, {
    contactId: "contact_known",
    email: "known@example.org",
    displayName: "Known Contact"
  });
  await seedExistingEmailContact(context, {
    contactId: "contact_shared_1",
    email: "shared@example.org",
    displayName: "Shared Contact One"
  });
  await seedExistingEmailContact(context, {
    contactId: "contact_shared_2",
    email: "shared@example.org",
    displayName: "Shared Contact Two"
  });

  await seedReplayCandidate(context, {
    sourceEvidenceId: "source-evidence:gmail:message:gmail-known-1",
    providerRecordId: "gmail-known-1",
    receivedAt: "2026-01-01T00:01:00.000Z"
  });
  await seedReplayCandidate(context, {
    sourceEvidenceId: "source-evidence:gmail:message:gmail-new-1",
    providerRecordId: "gmail-new-1",
    receivedAt: "2026-01-01T00:02:00.000Z"
  });
  await seedReplayCandidate(context, {
    sourceEvidenceId: "source-evidence:gmail:message:gmail-ambiguous-1",
    providerRecordId: "gmail-ambiguous-1",
    receivedAt: "2026-01-01T00:03:00.000Z"
  });

  return context;
}

describe("reconcileIdentityQueue", () => {
  it("reports resolved, created, and skipped counts in dry-run mode without mutating queue or ledger state", async () => {
    const context = await createReconcileContext();

    try {
      const report = await reconcileIdentityQueue({
        db: context.db,
        repositories: context.repositories,
        capture: context.capture,
        gmailHistoricalReplay: {
          liveAccount: "volunteers@adventurescientists.org",
          projectInboxAliases: ["orcas@adventurescientists.org"]
        },
        dryRun: true,
        logger: {
          log() {}
        }
      });

      expect(report).toMatchObject({
        dryRun: true,
        scanned: 3,
        resolved: 1,
        created: 1,
        skipped: 1
      });
      expect(report.errors).toEqual([]);
      await expect(
        context.repositories.canonicalEvents.countAll()
      ).resolves.toBe(0);
      await expect(
        context.repositories.identityResolutionQueue.listOpenByReasonCode(
          "identity_missing_anchor"
        )
      ).resolves.toHaveLength(3);
      await expect(context.repositories.contacts.listAll()).resolves.toHaveLength(3);
    } finally {
      await context.dispose();
    }
  });

  it("replays stuck items into resolved, created, and reclassified queue outcomes when executed", async () => {
    const context = await createReconcileContext();

    try {
      const report = await reconcileIdentityQueue({
        db: context.db,
        repositories: context.repositories,
        capture: context.capture,
        gmailHistoricalReplay: {
          liveAccount: "volunteers@adventurescientists.org",
          projectInboxAliases: ["orcas@adventurescientists.org"]
        },
        dryRun: false,
        logger: {
          log() {}
        }
      });

      expect(report).toMatchObject({
        dryRun: false,
        scanned: 3,
        resolved: 1,
        created: 1,
        skipped: 1
      });
      expect(report.errors).toEqual([]);
      await expect(
        context.repositories.canonicalEvents.countAll()
      ).resolves.toBe(2);
      await expect(
        context.repositories.contacts.findById("contact:email:fresh@example.org")
      ).resolves.toMatchObject({
        salesforceContactId: null,
        primaryEmail: "fresh@example.org"
      });
      await expect(
        context.repositories.identityResolutionQueue.listOpenByReasonCode(
          "identity_missing_anchor"
        )
      ).resolves.toHaveLength(0);
      await expect(
        context.repositories.identityResolutionQueue.listOpenByReasonCode(
          "identity_multi_candidate"
        )
      ).resolves.toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });
});
