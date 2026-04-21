import { describe, expect, it } from "vitest";

import { reconcileIdentityQueue } from "../src/ops/reconcile-identity-queue.js";
import {
  createTestWorkerContext,
  type TestWorkerContext
} from "./helpers.js";

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

async function seedOpenIdentityMissingAnchorCase(
  context: TestWorkerContext,
  input: {
    readonly sourceEvidenceId: string;
    readonly normalizedIdentityValues: readonly string[];
    readonly openedAt: string;
  }
): Promise<void> {
  await context.repositories.identityResolutionQueue.upsert({
    id: `identity-review:${input.sourceEvidenceId}:identity_missing_anchor`,
    sourceEvidenceId: input.sourceEvidenceId,
    candidateContactIds: [],
    reasonCode: "identity_missing_anchor",
    status: "open",
    openedAt: input.openedAt,
    resolvedAt: null,
    normalizedIdentityValues: [...input.normalizedIdentityValues],
    anchoredContactId: null,
    explanation: "Seeded stuck identity review case for reconciliation."
  });
}

async function seedStoredGmailCase(
  context: TestWorkerContext,
  input: {
    readonly recordId: string;
    readonly payloadRef: string;
    readonly normalizedIdentityValues: readonly string[];
    readonly subject: string;
    readonly occurredAt: string;
    readonly receivedAt: string;
  }
): Promise<void> {
  const sourceEvidenceId = `source-evidence:gmail:message:${input.recordId}`;

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.recordId,
    receivedAt: input.receivedAt,
    occurredAt: input.occurredAt,
    payloadRef: input.payloadRef,
    idempotencyKey: `source-evidence:gmail:message:${input.recordId}`,
    checksum: `checksum:${input.recordId}`
  });
  await context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.recordId,
    gmailThreadId: `thread:${input.recordId}`,
    rfc822MessageId: `<${input.recordId}@example.org>`,
    direction: "inbound",
    subject: input.subject,
    snippetClean: `snippet:${input.recordId}`,
    bodyTextPreview: `body:${input.recordId}`,
    capturedMailbox: "volunteers@adventurescientists.org",
    projectInboxAlias: null
  });
  await seedOpenIdentityMissingAnchorCase(context, {
    sourceEvidenceId,
    normalizedIdentityValues: input.normalizedIdentityValues,
    openedAt: input.receivedAt
  });
}

async function seedStoredSalesforceCase(
  context: TestWorkerContext,
  input: {
    readonly recordId: string;
    readonly normalizedIdentityValues: readonly string[];
    readonly subject: string;
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
    idempotencyKey: `source-evidence:salesforce:task_communication:${input.recordId}`,
    checksum: `checksum:${input.recordId}`
  });
  await context.repositories.salesforceCommunicationDetails.upsert({
    sourceEvidenceId,
    providerRecordId: input.recordId,
    channel: "email",
    messageKind: "one_to_one",
    subject: input.subject,
    snippet: `snippet:${input.recordId}`,
    sourceLabel: "Salesforce Task"
  });
  await context.repositories.salesforceEventContext.upsert({
    sourceEvidenceId,
    salesforceContactId: null,
    projectId: null,
    expeditionId: null,
    sourceField: null
  });
  await seedOpenIdentityMissingAnchorCase(context, {
    sourceEvidenceId,
    normalizedIdentityValues: input.normalizedIdentityValues,
    openedAt: input.receivedAt
  });
}

async function createReconcileContext(): Promise<TestWorkerContext> {
  const context = await createTestWorkerContext();

  await seedExistingEmailContact(context, {
    contactId: "contact_live_known",
    email: "known-live@example.org",
    displayName: "Known Live Contact"
  });
  await seedExistingEmailContact(context, {
    contactId: "contact_mbox_known",
    email: "known-mbox@example.org",
    displayName: "Known Mbox Contact"
  });
  await seedExistingEmailContact(context, {
    contactId: "contact_salesforce_known",
    email: "known-salesforce@example.org",
    displayName: "Known Salesforce Contact"
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

  await seedStoredGmailCase(context, {
    recordId: "gmail-live-known",
    payloadRef: "capture://gmail/gmail-live-known",
    normalizedIdentityValues: ["known-live@example.org"],
    subject: "Known live message",
    occurredAt: "2026-01-01T00:01:00.000Z",
    receivedAt: "2026-01-01T00:01:00.000Z"
  });
  await seedStoredGmailCase(context, {
    recordId: "gmail-mbox-known",
    payloadRef:
      "mbox://%2Fdefinitely%2Fmissing%2Forcas.mbox#message=17",
    normalizedIdentityValues: ["known-mbox@example.org"],
    subject: "Known mbox message",
    occurredAt: "2026-01-01T00:02:00.000Z",
    receivedAt: "2026-01-01T00:02:00.000Z"
  });
  await seedStoredSalesforceCase(context, {
    recordId: "sf-known-1",
    normalizedIdentityValues: ["known-salesforce@example.org"],
    subject: "Re: Known Salesforce message",
    occurredAt: "2026-01-01T00:03:00.000Z",
    receivedAt: "2026-01-01T00:03:00.000Z"
  });
  await seedStoredGmailCase(context, {
    recordId: "gmail-new-1",
    payloadRef: "capture://gmail/gmail-new-1",
    normalizedIdentityValues: ["fresh@example.org"],
    subject: "Fresh message",
    occurredAt: "2026-01-01T00:04:00.000Z",
    receivedAt: "2026-01-01T00:04:00.000Z"
  });
  await seedStoredGmailCase(context, {
    recordId: "gmail-ambiguous-1",
    payloadRef: "capture://gmail/gmail-ambiguous-1",
    normalizedIdentityValues: ["shared@example.org"],
    subject: "Shared identity message",
    occurredAt: "2026-01-01T00:05:00.000Z",
    receivedAt: "2026-01-01T00:05:00.000Z"
  });

  return context;
}

describe("reconcileIdentityQueue", () => {
  it("reconstructs Gmail live, Gmail mbox, and Salesforce cases from stored rows in dry-run mode", async () => {
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
          log: () => undefined
        }
      });

      expect(report).toMatchObject({
        dryRun: true,
        scanned: 5,
        resolved: 3,
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
      ).resolves.toHaveLength(5);
      await expect(context.repositories.contacts.listAll()).resolves.toHaveLength(5);
    } finally {
      await context.dispose();
    }
  });

  it("reconciles stored Gmail live, Gmail mbox, and Salesforce cases without filesystem access when executed", async () => {
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
          log: () => undefined
        }
      });

      expect(report).toMatchObject({
        dryRun: false,
        scanned: 5,
        resolved: 3,
        created: 1,
        skipped: 1
      });
      expect(report.errors).toEqual([]);
      await expect(
        context.repositories.canonicalEvents.countAll()
      ).resolves.toBe(4);
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
      await expect(context.repositories.contacts.listAll()).resolves.toHaveLength(6);
    } finally {
      await context.dispose();
    }
  });

  it("is idempotent on rerun after the original stuck cases have already been cleared", async () => {
    const context = await createReconcileContext();

    try {
      const first = await reconcileIdentityQueue({
        db: context.db,
        repositories: context.repositories,
        capture: context.capture,
        gmailHistoricalReplay: {
          liveAccount: "volunteers@adventurescientists.org",
          projectInboxAliases: ["orcas@adventurescientists.org"]
        },
        dryRun: false,
        logger: {
          log: () => undefined
        }
      });
      const second = await reconcileIdentityQueue({
        db: context.db,
        repositories: context.repositories,
        capture: context.capture,
        gmailHistoricalReplay: {
          liveAccount: "volunteers@adventurescientists.org",
          projectInboxAliases: ["orcas@adventurescientists.org"]
        },
        dryRun: false,
        logger: {
          log: () => undefined
        }
      });

      expect(first).toMatchObject({
        scanned: 5,
        resolved: 3,
        created: 1,
        skipped: 1
      });
      expect(second).toEqual({
        dryRun: false,
        scanned: 0,
        resolved: 0,
        created: 0,
        skipped: 0,
        errors: []
      });
      await expect(
        context.repositories.canonicalEvents.countAll()
      ).resolves.toBe(4);
    } finally {
      await context.dispose();
    }
  });
});
