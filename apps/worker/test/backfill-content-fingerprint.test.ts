import { describe, expect, it } from "vitest";

import {
  canonicalEventSchema,
  resolveCanonicalChannel,
} from "@as-comms/contracts";
import { computeContentFingerprint } from "@as-comms/domain";

import { backfillContentFingerprint } from "../src/ops/backfill-content-fingerprint.js";
import { createTestWorkerContext } from "./helpers.js";

const silentLogger = {
  error: (...args: readonly unknown[]) => void args.length,
};

const silentAuditWriter = {
  writeLine: (line: string) => void line.length,
};

async function seedContact(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly contactId: string;
  readonly salesforceContactId: string;
  readonly email: string;
}): Promise<void> {
  await input.context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: input.contactId,
      salesforceContactId: input.salesforceContactId,
      displayName: input.contactId,
      primaryEmail: input.email,
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    identities: [
      {
        id: `identity:${input.contactId}:email`,
        contactId: input.contactId,
        kind: "email",
        normalizedValue: input.email,
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    memberships: [
      {
        id: `membership:${input.contactId}:default`,
        contactId: input.contactId,
        salesforceMembershipId: `membership:${input.contactId}:default:sf`,
        projectId: "project_default",
        expeditionId: "expedition_default",
        role: "volunteer",
        status: "active",
        source: "salesforce",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
}

async function seedEmailEvent(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly key: string;
  readonly contactId: string;
  readonly provider: "gmail" | "salesforce";
  readonly eventType: "communication.email.outbound" | "communication.email.inbound";
  readonly occurredAt: string;
  readonly subject: string;
  readonly previewText: string | null;
  readonly persistedFingerprint: string | null;
}): Promise<string> {
  const sourceEvidenceId = `sev_${input.key}`;

  await input.context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: input.provider,
    providerRecordType:
      input.provider === "gmail" ? "message" : "task_communication",
    providerRecordId: `${input.provider}-${input.key}`,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `payloads/${input.provider}/${input.key}.json`,
    idempotencyKey: `${input.provider}:${input.key}`,
    checksum: `checksum:${input.key}`,
  });

  if (input.provider === "gmail") {
    await input.context.repositories.gmailMessageDetails.upsert({
      sourceEvidenceId,
      providerRecordId: `gmail-${input.key}`,
      gmailThreadId: `thread-${input.key}`,
      rfc822MessageId: `<${input.key}@example.org>`,
      direction: input.eventType === "communication.email.inbound" ? "inbound" : "outbound",
      subject: input.subject,
      fromHeader: "sender@example.org",
      toHeader: "recipient@example.org",
      ccHeader: null,
      snippetClean: input.previewText ?? "",
      bodyTextPreview: input.previewText ?? "",
      capturedMailbox: "volunteers@example.org",
      projectInboxAlias: null,
    });
  } else {
    await input.context.repositories.salesforceCommunicationDetails.upsert({
      sourceEvidenceId,
      providerRecordId: `salesforce-${input.key}`,
      channel: "email",
      messageKind: "one_to_one",
      subject: input.subject,
      snippet: input.previewText ?? "",
      sourceLabel: "Salesforce Task",
    });
  }

  const canonicalEvent = canonicalEventSchema.parse({
    id: `evt_${input.key}`,
    contactId: input.contactId,
    eventType: input.eventType,
    channel: resolveCanonicalChannel(input.eventType),
    occurredAt: input.occurredAt,
    contentFingerprint: input.persistedFingerprint,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.key}`,
    provenance: {
      primaryProvider: input.provider,
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason:
        input.provider === "gmail" ? "single_source" : "salesforce_only_best_evidence",
      sourceRecordType:
        input.provider === "gmail" ? "message" : "task_communication",
      sourceRecordId: `${input.provider}-${input.key}`,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: null,
      direction: input.eventType === "communication.email.inbound" ? "inbound" : "outbound",
      notes: null,
    },
    reviewState: "clear",
  });
  await input.context.repositories.canonicalEvents.upsert(canonicalEvent);

  return canonicalEvent.id;
}

describe("backfill-content-fingerprint", () => {
  it("dry-run emits audit lines but does not write", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact_1",
        salesforceContactId: "003-1",
        email: "one@example.org",
      });

      const expectedNewFingerprint = computeContentFingerprint({
        subject: "Re: Field logistics",
        occurredAt: "2026-04-20T21:27:03.000Z",
        contactId: "contact_1",
        channel: "email",
        direction: "outbound",
        previewText: "Different old preview text",
      });
      const eventId = await seedEmailEvent({
        context,
        key: "dry-run-change",
        contactId: "contact_1",
        provider: "gmail",
        eventType: "communication.email.outbound",
        occurredAt: "2026-04-20T21:27:03.000Z",
        subject: "Re: Field logistics",
        previewText: "Current persisted preview text",
        persistedFingerprint: "fp:legacy:different",
      });

      const writtenAuditLines: string[] = [];
      const result = await backfillContentFingerprint({
        db: context.db,
        repositories: context.repositories,
        dryRun: true,
        auditWriter: {
          writeLine(line: string) {
            writtenAuditLines.push(line);
          },
        },
        logger: silentLogger,
      });

      expect(result.categoryCounts.new_value).toBe(1);
      expect(result.updatedCount).toBe(0);
      expect(writtenAuditLines).toHaveLength(1);
      expect(JSON.parse(writtenAuditLines[0] ?? "")).toEqual({
        id: eventId,
        contactId: "contact_1",
        provider: "gmail",
        oldFingerprint: "fp:legacy:different",
        newFingerprint: expectedNewFingerprint,
        occurredAt: "2026-04-20T21:27:03.000Z",
        eventType: "communication.email.outbound",
      });

      const persisted = await context.repositories.canonicalEvents.findById(eventId);
      expect(persisted?.contentFingerprint).toBe("fp:legacy:different");
    } finally {
      await context.dispose();
    }
  });

  it("execute writes only rows in new_value or cleared categories", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact_2",
        salesforceContactId: "003-2",
        email: "two@example.org",
      });

      const unchangedFingerprint = computeContentFingerprint({
        subject: "Re: Same minute",
        occurredAt: "2026-04-20T22:10:03.000Z",
        contactId: "contact_2",
        channel: "email",
        direction: "inbound",
        previewText: "Persisted preview",
      });
      const newValueFingerprint = computeContentFingerprint({
        subject: "Re: Same minute",
        occurredAt: "2026-04-20T22:11:03.000Z",
        contactId: "contact_2",
        channel: "email",
        direction: "outbound",
        previewText: "Anything here is ignored by the current algorithm",
      });

      const unchangedId = await seedEmailEvent({
        context,
        key: "execute-unchanged",
        contactId: "contact_2",
        provider: "gmail",
        eventType: "communication.email.inbound",
        occurredAt: "2026-04-20T22:10:03.000Z",
        subject: "Re: Same minute",
        previewText: "Persisted preview",
        persistedFingerprint: unchangedFingerprint,
      });
      const changedId = await seedEmailEvent({
        context,
        key: "execute-changed",
        contactId: "contact_2",
        provider: "salesforce",
        eventType: "communication.email.outbound",
        occurredAt: "2026-04-20T22:11:03.000Z",
        subject: "Re: Same minute",
        previewText: "Salesforce snippet",
        persistedFingerprint: "fp:legacy:stale",
      });

      const result = await backfillContentFingerprint({
        db: context.db,
        repositories: context.repositories,
        dryRun: false,
        auditWriter: silentAuditWriter,
        logger: silentLogger,
      });

      expect(result.categoryCounts.unchanged).toBe(1);
      expect(result.categoryCounts.new_value).toBe(1);
      expect(result.updatedCount).toBe(1);

      const unchanged = await context.repositories.canonicalEvents.findById(unchangedId);
      const changed = await context.repositories.canonicalEvents.findById(changedId);
      expect(unchanged?.contentFingerprint).toBe(unchangedFingerprint);
      expect(changed?.contentFingerprint).toBe(newValueFingerprint);
    } finally {
      await context.dispose();
    }
  });

  it("honors --limit semantics when selecting rows", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact_3",
        salesforceContactId: "003-3",
        email: "three@example.org",
      });

      for (let index = 0; index < 12; index += 1) {
        await seedEmailEvent({
          context,
          key: `limit-${String(index)}`,
          contactId: "contact_3",
          provider: index % 2 === 0 ? "gmail" : "salesforce",
          eventType: "communication.email.outbound",
          occurredAt: `2026-04-21T10:${String(index).padStart(2, "0")}:00.000Z`,
          subject: `Subject ${String(index)}`,
          previewText: `Preview ${String(index)}`,
          persistedFingerprint: `fp:legacy:${String(index)}`,
        });
      }

      const result = await backfillContentFingerprint({
        db: context.db,
        repositories: context.repositories,
        dryRun: true,
        limit: 10,
        auditWriter: silentAuditWriter,
        logger: silentLogger,
      });

      expect(result.scannedCount).toBe(10);
      expect(result.categoryCounts.new_value).toBe(10);
    } finally {
      await context.dispose();
    }
  });

  it("is idempotent after execute", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact_4",
        salesforceContactId: "003-4",
        email: "four@example.org",
      });

      await seedEmailEvent({
        context,
        key: "idempotent",
        contactId: "contact_4",
        provider: "gmail",
        eventType: "communication.email.outbound",
        occurredAt: "2026-04-22T09:00:00.000Z",
        subject: "Re: Idempotent run",
        previewText: "Fresh preview",
        persistedFingerprint: "fp:legacy:old",
      });

      const first = await backfillContentFingerprint({
        db: context.db,
        repositories: context.repositories,
        dryRun: false,
        auditWriter: silentAuditWriter,
        logger: silentLogger,
      });
      const second = await backfillContentFingerprint({
        db: context.db,
        repositories: context.repositories,
        dryRun: false,
        auditWriter: silentAuditWriter,
        logger: silentLogger,
      });

      expect(first.categoryCounts.new_value).toBe(1);
      expect(first.updatedCount).toBe(1);
      expect(second.categoryCounts.new_value).toBe(0);
      expect(second.updatedCount).toBe(0);
      expect(second.categoryCounts.unchanged).toBe(1);
    } finally {
      await context.dispose();
    }
  });
});
