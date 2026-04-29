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

async function seedDurableEmailContact(
  context: TestWorkerContext,
  input: {
    readonly contactId: string;
    readonly email: string;
    readonly displayName: string;
    readonly salesforceContactId: string | null;
  }
): Promise<void> {
  await context.repositories.contacts.upsert({
    id: input.contactId,
    salesforceContactId: input.salesforceContactId,
    displayName: input.displayName,
    primaryEmail: input.email,
    primaryPhone: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  await context.repositories.contactIdentities.upsert({
    id: `identity:${input.contactId}:email`,
    contactId: input.contactId,
    kind: "email",
    normalizedValue: input.email,
    isPrimary: true,
    source: input.salesforceContactId === null ? "gmail" : "salesforce",
    verifiedAt: "2026-01-01T00:00:00.000Z"
  });

  if (input.salesforceContactId !== null) {
    await context.repositories.contactIdentities.upsert({
      id: `identity:${input.contactId}:salesforce`,
      contactId: input.contactId,
      kind: "salesforce_contact_id",
      normalizedValue: input.salesforceContactId,
      isPrimary: true,
      source: "salesforce",
      verifiedAt: "2026-01-01T00:00:00.000Z"
    });
  }
}

async function seedOpenIdentityCase(
  context: TestWorkerContext,
  input: {
    readonly sourceEvidenceId: string;
    readonly normalizedIdentityValues: readonly string[];
    readonly openedAt: string;
    readonly lastAttemptedAt?: string | null;
    readonly reasonCode?:
      | "identity_missing_anchor"
      | "identity_multi_candidate";
    readonly candidateContactIds?: readonly string[];
  }
): Promise<void> {
  const reasonCode = input.reasonCode ?? "identity_missing_anchor";

  await context.repositories.identityResolutionQueue.upsert({
    id: `identity-review:${input.sourceEvidenceId}:${reasonCode}`,
    sourceEvidenceId: input.sourceEvidenceId,
    candidateContactIds: [...(input.candidateContactIds ?? [])],
    reasonCode,
    status: "open",
    openedAt: input.openedAt,
    resolvedAt: null,
    lastAttemptedAt: input.lastAttemptedAt ?? null,
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
    readonly includeDetails?: boolean;
    readonly lastAttemptedAt?: string | null;
    readonly reasonCode?:
      | "identity_missing_anchor"
      | "identity_multi_candidate";
    readonly candidateContactIds?: readonly string[];
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

  if (input.includeDetails !== false) {
    await context.repositories.gmailMessageDetails.upsert({
      sourceEvidenceId,
      providerRecordId: input.recordId,
      gmailThreadId: `thread:${input.recordId}`,
      rfc822MessageId: `<${input.recordId}@example.org>`,
      direction: "inbound",
      subject: input.subject,
      fromHeader: "Volunteer <volunteer@example.org>",
      toHeader: "volunteers@adventurescientists.org",
      ccHeader: null,
      snippetClean: `snippet:${input.recordId}`,
      bodyTextPreview: `body:${input.recordId}`,
      capturedMailbox: "volunteers@adventurescientists.org",
      projectInboxAlias: null
    });
  }

  await seedOpenIdentityCase(context, {
    sourceEvidenceId,
    normalizedIdentityValues: input.normalizedIdentityValues,
    openedAt: input.receivedAt,
    ...(input.lastAttemptedAt === undefined
      ? {}
      : { lastAttemptedAt: input.lastAttemptedAt }),
    ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
    ...(input.candidateContactIds === undefined
      ? {}
      : { candidateContactIds: input.candidateContactIds })
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
    readonly includeCommunicationDetail?: boolean;
    readonly eventContextSalesforceContactId?: string | null;
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

  if (input.includeCommunicationDetail !== false) {
    await context.repositories.salesforceCommunicationDetails.upsert({
      sourceEvidenceId,
      providerRecordId: input.recordId,
      channel: "email",
      messageKind: "one_to_one",
      subject: input.subject,
      snippet: `snippet:${input.recordId}`,
      sourceLabel: "Salesforce Task"
    });
  }

  await context.repositories.salesforceEventContext.upsert({
    sourceEvidenceId,
    salesforceContactId: input.eventContextSalesforceContactId ?? null,
    projectId: null,
    expeditionId: null,
    sourceField: null
  });
  await seedOpenIdentityCase(context, {
    sourceEvidenceId,
    normalizedIdentityValues: input.normalizedIdentityValues,
    openedAt: input.receivedAt
  });
}

async function seedStoredSalesforceLifecycleCase(
  context: TestWorkerContext,
  input: {
    readonly recordId: string;
    readonly normalizedIdentityValues: readonly string[];
    readonly occurredAt: string;
    readonly receivedAt: string;
    readonly salesforceContactId: string | null;
  }
): Promise<void> {
  const sourceEvidenceId =
    `source-evidence:salesforce:lifecycle_milestone:${encodeURIComponent(input.recordId)}`;
  const separatorIndex = input.recordId.indexOf(":");
  const sourceField =
    separatorIndex === -1 ? null : input.recordId.slice(separatorIndex + 1);

  await context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "salesforce",
    providerRecordType: "lifecycle_milestone",
    providerRecordId: input.recordId,
    receivedAt: input.receivedAt,
    occurredAt: input.occurredAt,
    payloadRef: `capture://salesforce/${encodeURIComponent(input.recordId)}`,
    idempotencyKey:
      `source-evidence:salesforce:lifecycle_milestone:${input.recordId}`,
    checksum: `checksum:${input.recordId}`
  });
  await context.repositories.salesforceEventContext.upsert({
    sourceEvidenceId,
    salesforceContactId: input.salesforceContactId,
    projectId: null,
    expeditionId: null,
    sourceField
  });
  await seedOpenIdentityCase(context, {
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

  it("reconciles `identity_missing_anchor` when current contact has populated salesforce_contact_id", async () => {
    const context = await createTestWorkerContext();
    const recordId = "gmail-current-anchor-1";
    const caseId =
      "identity-review:source-evidence:gmail:message:gmail-current-anchor-1:identity_missing_anchor";

    try {
      await seedDurableEmailContact(context, {
        contactId: "contact_current_anchor",
        email: "anchor-now@example.org",
        displayName: "Anchored Contact",
        salesforceContactId: "003-current-anchor"
      });
      await seedStoredGmailCase(context, {
        recordId,
        payloadRef: `capture://gmail/${recordId}`,
        normalizedIdentityValues: ["anchor-now@example.org"],
        subject: "Anchor was backfilled after case creation",
        occurredAt: "2026-01-01T00:06:00.000Z",
        receivedAt: "2026-01-01T00:06:00.000Z"
      });

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
        scanned: 1,
        resolved: 1,
        created: 0,
        skipped: 0
      });
      expect(report.errors).toEqual([]);
      await expect(
        context.repositories.canonicalEvents.listByContactId(
          "contact_current_anchor"
        )
      ).resolves.toHaveLength(1);
      await expect(
        context.repositories.identityResolutionQueue.findById(caseId)
      ).resolves.toMatchObject({
        status: "resolved"
      });
    } finally {
      await context.dispose();
    }
  });

  it("closes case as `skipped_non_volunteer_task` when anchored contact has no memberships", async () => {
    const context = await createTestWorkerContext();
    const recordId = "sf-non-volunteer-1";
    const caseId =
      "identity-review:source-evidence:salesforce:task_communication:sf-non-volunteer-1:identity_missing_anchor";

    try {
      await seedDurableEmailContact(context, {
        contactId: "contact_non_volunteer",
        email: "donor@example.org",
        displayName: "Non Volunteer Contact",
        salesforceContactId: "003-non-volunteer"
      });
      await seedStoredSalesforceCase(context, {
        recordId,
        normalizedIdentityValues: [],
        subject: "Logged outbound follow-up",
        occurredAt: "2026-01-01T00:07:00.000Z",
        receivedAt: "2026-01-01T00:07:00.000Z",
        eventContextSalesforceContactId: "003-non-volunteer"
      });

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
        scanned: 1,
        resolved: 0,
        created: 0,
        skipped: 1
      });
      expect(report.errors).toEqual([]);
      await expect(
        context.repositories.canonicalEvents.countAll()
      ).resolves.toBe(0);
      const resolvedCase =
        await context.repositories.identityResolutionQueue.findById(caseId);

      expect(resolvedCase).toMatchObject({
        status: "resolved"
      });
      expect(resolvedCase?.explanation).toContain("outside volunteer scope");
    } finally {
      await context.dispose();
    }
  });

  it("reconciles a stuck salesforce lifecycle_milestone case", async () => {
    const context = await createTestWorkerContext();
    const recordId = "membership-stage1:Expedition_Members__c.Date_Training_Sent__c";
    const caseId =
      `identity-review:source-evidence:salesforce:lifecycle_milestone:${encodeURIComponent(recordId)}:identity_missing_anchor`;

    try {
      await seedDurableEmailContact(context, {
        contactId: "contact_lifecycle_anchor",
        email: "lifecycle@example.org",
        displayName: "Lifecycle Contact",
        salesforceContactId: "003-lifecycle-anchor"
      });
      await seedStoredSalesforceLifecycleCase(context, {
        recordId,
        normalizedIdentityValues: [],
        occurredAt: "2026-01-01T00:08:00.000Z",
        receivedAt: "2026-01-01T00:08:00.000Z",
        salesforceContactId: "003-lifecycle-anchor"
      });

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
        scanned: 1,
        resolved: 1,
        created: 0,
        skipped: 0
      });
      expect(report.errors).toEqual([]);
      await expect(
        context.repositories.canonicalEvents.listByContactId(
          "contact_lifecycle_anchor"
        )
      ).resolves.toEqual([
        expect.objectContaining({
          eventType: "lifecycle.received_training"
        })
      ]);
      await expect(
        context.repositories.identityResolutionQueue.findById(caseId)
      ).resolves.toMatchObject({
        status: "resolved"
      });
    } finally {
      await context.dispose();
    }
  });

  it("closes orphan gmail case as skipped when gmail_message_details missing", async () => {
    const context = await createTestWorkerContext();
    const recordId = "mbox:orphan-gmail-1";
    const caseId =
      "identity-review:source-evidence:gmail:message:mbox:orphan-gmail-1:identity_missing_anchor";

    try {
      await seedStoredGmailCase(context, {
        recordId,
        payloadRef: `mbox://archive.mbox#message=${encodeURIComponent(recordId)}`,
        normalizedIdentityValues: ["orphan@example.org"],
        subject: "Missing Gmail detail row",
        occurredAt: "2026-01-01T00:09:00.000Z",
        receivedAt: "2026-01-01T00:09:00.000Z",
        includeDetails: false
      });

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
        scanned: 1,
        resolved: 0,
        created: 0,
        skipped: 1
      });
      expect(report.errors).toEqual([]);
      const resolvedCase =
        await context.repositories.identityResolutionQueue.findById(caseId);

      expect(resolvedCase?.status).toBe("resolved");
      expect(resolvedCase?.explanation).toContain("gmail_message_details row");
      await expect(
        context.repositories.canonicalEvents.countAll()
      ).resolves.toBe(0);
    } finally {
      await context.dispose();
    }
  });

  it("still throws on orphan salesforce task_communication", async () => {
    const context = await createTestWorkerContext();
    const caseId =
      "identity-review:source-evidence:salesforce:task_communication:sf-orphan-task-1:identity_missing_anchor";

    try {
      await seedStoredSalesforceCase(context, {
        recordId: "sf-orphan-task-1",
        normalizedIdentityValues: ["orphan-salesforce@example.org"],
        subject: "Missing Salesforce detail row",
        occurredAt: "2026-01-01T00:10:00.000Z",
        receivedAt: "2026-01-01T00:10:00.000Z",
        includeCommunicationDetail: false
      });

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
        scanned: 1,
        resolved: 0,
        created: 0,
        skipped: 0
      });
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0]?.caseId).toBe(caseId);
      expect(report.errors[0]?.reason).toBe("target_execution_failed");
      expect(report.errors[0]?.message).toContain(
        "Expected salesforce_communication_details to exist"
      );
      await expect(
        context.repositories.identityResolutionQueue.findById(caseId)
      ).resolves.toMatchObject({
        status: "open"
      });
    } finally {
      await context.dispose();
    }
  });

  it("least-recently-attempted ordering", async () => {
    const context = await createTestWorkerContext();

    try {
      const orderedCases = [
        {
          recordId: "gmail-order-never",
          receivedAt: "2026-01-01T00:10:00.000Z",
          lastAttemptedAt: null
        },
        {
          recordId: "gmail-order-1",
          receivedAt: "2026-01-01T00:11:00.000Z",
          lastAttemptedAt: "2026-01-01T01:00:00.000Z"
        },
        {
          recordId: "gmail-order-2",
          receivedAt: "2026-01-01T00:12:00.000Z",
          lastAttemptedAt: "2026-01-01T02:00:00.000Z"
        },
        {
          recordId: "gmail-order-3",
          receivedAt: "2026-01-01T00:13:00.000Z",
          lastAttemptedAt: "2026-01-01T03:00:00.000Z"
        },
        {
          recordId: "gmail-order-4",
          receivedAt: "2026-01-01T00:14:00.000Z",
          lastAttemptedAt: "2026-01-01T04:00:00.000Z"
        },
        {
          recordId: "gmail-order-5",
          receivedAt: "2026-01-01T00:15:00.000Z",
          lastAttemptedAt: "2026-01-01T05:00:00.000Z"
        }
      ] as const;

      for (const item of orderedCases) {
        await seedStoredGmailCase(context, {
          recordId: item.recordId,
          payloadRef: `capture://gmail/${item.recordId}`,
          normalizedIdentityValues: [`${item.recordId}@example.org`],
          subject: `Subject ${item.recordId}`,
          occurredAt: item.receivedAt,
          receivedAt: item.receivedAt,
          lastAttemptedAt: item.lastAttemptedAt
        });
      }

      const openCases =
        await context.repositories.identityResolutionQueue.listOpenByReasonCode(
          "identity_missing_anchor"
        );

      expect(openCases.map((caseRecord) => caseRecord.id)).toEqual([
        "identity-review:source-evidence:gmail:message:gmail-order-never:identity_missing_anchor",
        "identity-review:source-evidence:gmail:message:gmail-order-1:identity_missing_anchor",
        "identity-review:source-evidence:gmail:message:gmail-order-2:identity_missing_anchor",
        "identity-review:source-evidence:gmail:message:gmail-order-3:identity_missing_anchor",
        "identity-review:source-evidence:gmail:message:gmail-order-4:identity_missing_anchor",
        "identity-review:source-evidence:gmail:message:gmail-order-5:identity_missing_anchor"
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("reconciles eligible Gmail multi-candidate cases once internal AS participants are filtered out", async () => {
    const context = await createTestWorkerContext();
    const sourceEvidenceId =
      "source-evidence:gmail:message:gmail-third-party-resolved-1";

    try {
      await seedExistingEmailContact(context, {
        contactId: "contact_external_volunteer",
        email: "shaina.dotson@gmail.com",
        displayName: "Shaina Dotson"
      });
      await seedExistingEmailContact(context, {
        contactId: "contact_internal_staff",
        email: "ricky@adventurescientists.org",
        displayName: "Ricky Jones"
      });
      await seedStoredGmailCase(context, {
        recordId: "gmail-third-party-resolved-1",
        payloadRef: "capture://gmail/gmail-third-party-resolved-1",
        normalizedIdentityValues: [
          "ricky@adventurescientists.org",
          "shaina.dotson@gmail.com"
        ],
        subject: "Re: Update on Hex 43191",
        occurredAt: "2026-01-01T00:06:00.000Z",
        receivedAt: "2026-01-01T00:06:00.000Z",
        reasonCode: "identity_multi_candidate",
        candidateContactIds: [
          "contact_external_volunteer",
          "contact_internal_staff"
        ]
      });

      const report = await reconcileIdentityQueue({
        db: context.db,
        repositories: context.repositories,
        capture: context.capture,
        gmailHistoricalReplay: {
          liveAccount: "volunteers@adventurescientists.org",
          projectInboxAliases: ["pnwbio@adventurescientists.org"]
        },
        dryRun: false,
        logger: {
          log: () => undefined
        }
      });

      expect(report).toMatchObject({
        dryRun: false,
        scanned: 1,
        resolved: 1,
        created: 0,
        skipped: 0
      });
      await expect(
        context.repositories.canonicalEvents.countAll()
      ).resolves.toBe(1);
      await expect(
        context.repositories.canonicalEvents.listByContactId(
          "contact_external_volunteer"
        )
      ).resolves.toHaveLength(1);
      await expect(
        context.repositories.identityResolutionQueue.findById(
          `identity-review:${sourceEvidenceId}:identity_multi_candidate`
        )
      ).resolves.toMatchObject({
        status: "resolved"
      });
      await expect(
        context.repositories.identityResolutionQueue.listOpenByReasonCode(
          "identity_multi_candidate"
        )
      ).resolves.toHaveLength(0);
    } finally {
      await context.dispose();
    }
  });
});
