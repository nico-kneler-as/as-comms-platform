import { describe, expect, it } from "vitest";

import { asc } from "drizzle-orm";

import {
  canonicalEventLedger,
  contactInboxProjection,
  contactTimelineProjection,
  gmailMessageDetails,
  sourceEvidenceLog,
} from "@as-comms/db";

import {
  cleanupGmailDraftEvents,
} from "../src/ops/cleanup-gmail-draft-events.js";
import { createTestWorkerContext } from "./helpers.js";

const contactId = "contact:salesforce:0031R00002cD7xJQAS";

function buildProvenance(input: {
  readonly sourceEvidenceId: string;
  readonly sourceRecordId: string;
  readonly occurredAt: string;
}): (typeof canonicalEventLedger.$inferInsert)["provenance"] {
  return {
    primaryProvider: "gmail",
    primarySourceEvidenceId: input.sourceEvidenceId,
    supportingSourceEvidenceIds: [],
    winnerReason: "single_source",
    sourceRecordType: "message",
    sourceRecordId: input.sourceRecordId,
    messageKind: "one_to_one",
    campaignRef: null,
    threadRef: {
      crossProviderCollapseKey: `rfc822:<${input.sourceRecordId}@example.org>`,
      providerThreadId: "gmail-thread-1",
    },
    direction: "outbound",
    notes: null,
  };
}

async function seedOutboundGmailEvent(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly sourceEvidenceId: string;
  readonly canonicalEventId: string;
  readonly providerRecordId: string;
  readonly occurredAt: string;
  readonly labels?: string[] | null;
  readonly snippet: string;
  readonly subject: string;
}): Promise<void> {
  await input.context.repositories.sourceEvidence.append({
    id: input.sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.providerRecordId,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `gmail://volunteers%40example.org/messages/${input.providerRecordId}`,
    idempotencyKey: input.sourceEvidenceId,
    checksum: `checksum:${input.providerRecordId}`,
  });

  await input.context.repositories.canonicalEvents.upsert({
    id: input.canonicalEventId,
    contactId,
    eventType: "communication.email.outbound",
    channel: "email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId: input.sourceEvidenceId,
    idempotencyKey: `canonical:${input.providerRecordId}`,
    provenance: buildProvenance({
      sourceEvidenceId: input.sourceEvidenceId,
      sourceRecordId: input.providerRecordId,
      occurredAt: input.occurredAt,
    }),
    reviewState: "clear",
  });

  await input.context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId: input.sourceEvidenceId,
    providerRecordId: input.providerRecordId,
    gmailThreadId: "gmail-thread-1",
    rfc822MessageId: `<${input.providerRecordId}@example.org>`,
    direction: "outbound",
    subject: input.subject,
    fromHeader: "Project Team <project@example.org>",
    toHeader: "Steve Herman <steve@example.org>",
    ccHeader: null,
    labelIds: input.labels ?? null,
    snippetClean: input.snippet,
    bodyTextPreview: input.snippet,
    capturedMailbox: "volunteers@example.org",
    projectInboxAlias: "project@example.org",
  });
}

async function seedContactWithTwoOutboundEvents() {
  const context = await createTestWorkerContext();

  await context.repositories.contacts.upsert({
    id: contactId,
    salesforceContactId: "0031R00002cD7xJQAS",
    displayName: "Steve Herman",
    primaryEmail: "steve@example.org",
    primaryPhone: null,
    createdAt: "2026-04-20T18:00:00.000Z",
    updatedAt: "2026-04-20T18:00:00.000Z",
  });

  await seedOutboundGmailEvent({
    context,
    sourceEvidenceId: "source-evidence:gmail:message:gmail-sent-1",
    canonicalEventId: "canonical-event:gmail-sent-1",
    providerRecordId: "gmail-sent-1",
    occurredAt: "2026-04-20T18:00:00.000Z",
    labels: ["SENT"],
    snippet: "Final sent email",
    subject: "Re: Training details",
  });
  await seedOutboundGmailEvent({
    context,
    sourceEvidenceId: "source-evidence:gmail:message:gmail-draft-1",
    canonicalEventId: "canonical-event:gmail-draft-1",
    providerRecordId: "gmail-draft-1",
    occurredAt: "2026-04-20T18:05:00.000Z",
    labels: null,
    snippet: "Draft autosave body",
    subject: "Re: Training details",
  });

  await context.repositories.timelineProjection.upsert({
    id: "timeline:gmail-sent-1",
    contactId,
    canonicalEventId: "canonical-event:gmail-sent-1",
    occurredAt: "2026-04-20T18:00:00.000Z",
    sortKey: "2026-04-20T18:00:00.000Z::canonical-event:gmail-sent-1",
    eventType: "communication.email.outbound",
    summary: "Outbound email sent",
    channel: "email",
    primaryProvider: "gmail",
    reviewState: "clear",
  });
  await context.repositories.timelineProjection.upsert({
    id: "timeline:gmail-draft-1",
    contactId,
    canonicalEventId: "canonical-event:gmail-draft-1",
    occurredAt: "2026-04-20T18:05:00.000Z",
    sortKey: "2026-04-20T18:05:00.000Z::canonical-event:gmail-draft-1",
    eventType: "communication.email.outbound",
    summary: "Outbound email sent",
    channel: "email",
    primaryProvider: "gmail",
    reviewState: "clear",
  });
  await context.repositories.inboxProjection.upsert({
    contactId,
    bucket: "Opened",
    needsFollowUp: false,
    hasUnresolved: false,
    lastInboundAt: null,
    lastOutboundAt: "2026-04-20T18:05:00.000Z",
    lastActivityAt: "2026-04-20T18:05:00.000Z",
    snippet: "Draft autosave body",
    lastCanonicalEventId: "canonical-event:gmail-draft-1",
    lastEventType: "communication.email.outbound",
  });

  return context;
}

describe("Stage 1 Gmail draft cleanup ops", () => {
  it("emits JSONL audit lines for draft-only candidates during dry-run", async () => {
    const context = await seedContactWithTwoOutboundEvents();
    const auditLines: string[] = [];

    try {
      const result = await cleanupGmailDraftEvents({
        db: context.db,
        mailbox: "volunteers@example.org",
        labelLookup: ({ providerRecordId }) =>
          Promise.resolve({
            status: "found" as const,
            labels:
              providerRecordId === "gmail-draft-1" ? ["DRAFT"] : ["SENT"],
          }),
        writer: {
          writeLine(line) {
            auditLines.push(line);
          },
        },
      });

      expect(result).toMatchObject({
        dryRun: true,
        scannedCount: 2,
        draftCandidateCount: 1,
        apiConfirmedCount: 1,
        storedFallbackCount: 0,
        apiGoneCount: 0,
        unknownCount: 0,
        affectedContactCount: 1,
        timelineProjectionDeleteCount: 1,
      });
      expect(auditLines).toHaveLength(1);
      expect(JSON.parse(auditLines[0] ?? "")).toEqual({
        sourceEvidenceId: "source-evidence:gmail:message:gmail-draft-1",
        canonicalEventId: "canonical-event:gmail-draft-1",
        contactId,
        gmailThreadId: "gmail-thread-1",
        subject: "Re: Training details",
        occurredAt: "2026-04-20T18:05:00.000Z",
        labels: ["DRAFT"],
        labelSource: "gmail_api",
      });
    } finally {
      await context.dispose();
    }
  });

  it("deletes draft-only rows and rebuilds projections onto the remaining sent event", async () => {
    const context = await seedContactWithTwoOutboundEvents();

    try {
      const result = await cleanupGmailDraftEvents({
        db: context.db,
        mailbox: "volunteers@example.org",
        labelLookup: ({ providerRecordId }) =>
          Promise.resolve({
            status: "found" as const,
            labels:
              providerRecordId === "gmail-draft-1" ? ["DRAFT"] : ["SENT"],
          }),
        execute: true,
        orchestration: context.orchestration,
        writer: {
          writeLine: () => undefined,
        },
        logger: {
          log: () => undefined,
          error: () => undefined,
        },
      });

      expect(result).toMatchObject({
        dryRun: false,
        draftCandidateCount: 1,
        deletedCanonicalCount: 1,
        deletedGmailDetailCount: 1,
        deletedSourceEvidenceCount: 1,
        deletedInboxProjectionCount: 1,
        deletedTimelineProjectionCount: 1,
        rebuiltContactCount: 1,
      });

      const [remainingCanonical, remainingSourceEvidence, remainingGmailDetails, inboxRows, timelineRows] =
        await Promise.all([
          context.db.select().from(canonicalEventLedger).orderBy(asc(canonicalEventLedger.id)),
          context.db.select().from(sourceEvidenceLog).orderBy(asc(sourceEvidenceLog.id)),
          context.db.select().from(gmailMessageDetails).orderBy(asc(gmailMessageDetails.sourceEvidenceId)),
          context.db.select().from(contactInboxProjection),
          context.db.select().from(contactTimelineProjection).orderBy(asc(contactTimelineProjection.id)),
        ]);

      expect(remainingCanonical.map((row) => row.id)).toEqual([
        "canonical-event:gmail-sent-1",
      ]);
      expect(remainingSourceEvidence.map((row) => row.id)).toEqual([
        "source-evidence:gmail:message:gmail-sent-1",
      ]);
      expect(remainingGmailDetails.map((row) => row.sourceEvidenceId)).toEqual([
        "source-evidence:gmail:message:gmail-sent-1",
      ]);
      expect(inboxRows).toHaveLength(1);
      expect(inboxRows[0]?.lastCanonicalEventId).toBe("canonical-event:gmail-sent-1");
      expect(timelineRows).toHaveLength(1);
      expect(timelineRows[0]?.canonicalEventId).toBe("canonical-event:gmail-sent-1");
    } finally {
      await context.dispose();
    }
  });
});
