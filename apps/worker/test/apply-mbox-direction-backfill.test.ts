import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import {
  canonicalEventLedger,
  gmailMessageDetails,
} from "@as-comms/db";
import { describe, expect, it } from "vitest";

import { applyMboxDirectionBackfill } from "../src/ops/apply-mbox-direction-backfill.js";
import { createTestWorkerContext, type TestWorkerContext } from "./helpers.js";

interface TestLogger {
  readonly lines: string[];
  readonly logger: {
    log(message: string): void;
    error(message: string): void;
  };
}

function createLogger(): TestLogger {
  const lines: string[] = [];

  return {
    lines,
    logger: {
      log(message: string) {
        lines.push(message);
      },
      error(message: string) {
        lines.push(message);
      },
    },
  };
}

async function seedContact(input: {
  readonly context: TestWorkerContext;
  readonly contactId: string;
  readonly email: string;
  readonly displayName: string;
}): Promise<void> {
  await input.context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: input.contactId,
      salesforceContactId: null,
      displayName: input.displayName,
      primaryEmail: input.email,
      primaryPhone: null,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    identities: [
      {
        id: `identity:${input.contactId}:email`,
        contactId: input.contactId,
        kind: "email",
        normalizedValue: input.email,
        isPrimary: true,
        source: "salesforce",
        verifiedAt: "2026-06-01T00:00:00.000Z",
      },
    ],
    memberships: [],
  });
}

async function seedMisclassifiedOutbound(input: {
  readonly context: TestWorkerContext;
  readonly key: string;
  readonly contactId: string;
  readonly occurredAt: string;
}): Promise<{
  readonly canonicalEventId: string;
  readonly sourceEvidenceId: string;
}> {
  const sourceEvidenceId = `sev:${input.key}`;
  const canonicalEventId = `event:${input.key}`;

  await input.context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: `gmail:${input.key}`,
    receivedAt: input.occurredAt,
    occurredAt: input.occurredAt,
    payloadRef: `gmail://message/${input.key}`,
    idempotencyKey: `source-evidence:${input.key}`,
    checksum: `checksum:${input.key}`,
  });

  await input.context.repositories.canonicalEvents.upsert({
    id: canonicalEventId,
    contactId: input.contactId,
    eventType: "communication.email.inbound",
    channel: "email",
    occurredAt: input.occurredAt,
    contentFingerprint: null,
    sourceEvidenceId,
    idempotencyKey: `canonical:${input.key}`,
    provenance: {
      primaryProvider: "gmail",
      primarySourceEvidenceId: sourceEvidenceId,
      supportingSourceEvidenceIds: [],
      winnerReason: "single_source",
      sourceRecordType: "message",
      sourceRecordId: `gmail:${input.key}`,
      messageKind: "one_to_one",
      campaignRef: null,
      threadRef: {
        crossProviderCollapseKey: `rfc822:<${input.key}@example.org>`,
        providerThreadId: `thread:${input.key}`,
      },
      direction: "inbound",
      notes: null,
    },
    reviewState: "clear",
  });

  await input.context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId,
    providerRecordId: `gmail:${input.key}`,
    gmailThreadId: `thread:${input.key}`,
    rfc822MessageId: `<${input.key}@example.org>`,
    direction: "inbound",
    subject: `Subject ${input.key}`,
    fromHeader: "Inbox <orcas@adventurescientists.org>",
    toHeader: "Inbox <orcas@adventurescientists.org>",
    ccHeader: null,
    fromEmails: [],
    toEmails: ["orcas@adventurescientists.org"],
    ccEmails: [],
    bccEmails: [],
    labelIds: ["INBOX"],
    snippetClean: `Snippet ${input.key}`,
    bodyTextPreview: `Hi there from ${input.key}`,
    bodyKind: "plaintext",
    capturedMailbox: "volunteers@adventurescientists.org",
    projectInboxAlias: "orcas@adventurescientists.org",
  });

  return {
    canonicalEventId,
    sourceEvidenceId,
  };
}

async function writeCsv(input: {
  readonly rows: readonly {
    readonly canonicalEventId: string;
    readonly sourceEvidenceId: string;
    readonly currentDirection: string;
    readonly suggestedDirection: string;
    readonly confidence: string;
  }[];
}): Promise<{
  readonly dir: string;
  readonly path: string;
}> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "apply-mbox-direction-"));
  const csvPath = path.join(dir, "report.csv");
  const header =
    "canonical_event_id,source_evidence_id,current_direction,suggested_direction,confidence\n";
  const body = input.rows
    .map(
      (row) =>
        `${row.canonicalEventId},${row.sourceEvidenceId},${row.currentDirection},${row.suggestedDirection},${row.confidence}`,
    )
    .join("\n");

  await writeFile(csvPath, `${header}${body}\n`, "utf8");

  return {
    dir,
    path: csvPath,
  };
}

async function readDirection(
  context: TestWorkerContext,
  sourceEvidenceId: string,
): Promise<string | null> {
  const [row] = await context.db
    .select({
      direction: gmailMessageDetails.direction,
    })
    .from(gmailMessageDetails)
    .where(eq(gmailMessageDetails.sourceEvidenceId, sourceEvidenceId));

  return row?.direction ?? null;
}

async function readEventType(
  context: TestWorkerContext,
  canonicalEventId: string,
): Promise<string | null> {
  const [row] = await context.db
    .select({
      eventType: canonicalEventLedger.eventType,
    })
    .from(canonicalEventLedger)
    .where(eq(canonicalEventLedger.id, canonicalEventId));

  return row?.eventType ?? null;
}

describe("apply-mbox-direction-backfill", () => {
  it("flips misclassified rows and rebuilds inbox projections for affected contacts", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact:one",
        email: "one@example.org",
        displayName: "Contact One",
      });
      await seedContact({
        context,
        contactId: "contact:two",
        email: "two@example.org",
        displayName: "Contact Two",
      });

      const first = await seedMisclassifiedOutbound({
        context,
        key: "one",
        contactId: "contact:one",
        occurredAt: "2026-06-03T10:00:00.000Z",
      });
      const second = await seedMisclassifiedOutbound({
        context,
        key: "two",
        contactId: "contact:two",
        occurredAt: "2026-06-03T11:00:00.000Z",
      });
      const csv = await writeCsv({
        rows: [
          {
            canonicalEventId: first.canonicalEventId,
            sourceEvidenceId: first.sourceEvidenceId,
            currentDirection: "inbound",
            suggestedDirection: "outbound",
            confidence: "high",
          },
          {
            canonicalEventId: second.canonicalEventId,
            sourceEvidenceId: second.sourceEvidenceId,
            currentDirection: "inbound",
            suggestedDirection: "outbound",
            confidence: "high",
          },
        ],
      });

      try {
        const result = await applyMboxDirectionBackfill({
          db: context.db,
          csvPath: csv.path,
          dryRun: false,
          logger: createLogger().logger,
        });

        expect(result).toMatchObject({
          csvRowsConsidered: 2,
          flipped: 2,
          skippedAlreadyOutbound: 0,
          skippedFilterMismatch: 0,
          skippedUnexpectedState: 0,
          contactsAffected: 2,
          projectionsRebuilt: 2,
          dryRun: false,
        });
      } finally {
        await rm(csv.dir, { recursive: true, force: true });
      }

      await expect(readDirection(context, first.sourceEvidenceId)).resolves.toBe(
        "outbound",
      );
      await expect(readDirection(context, second.sourceEvidenceId)).resolves.toBe(
        "outbound",
      );
      await expect(readEventType(context, first.canonicalEventId)).resolves.toBe(
        "communication.email.outbound",
      );
      await expect(readEventType(context, second.canonicalEventId)).resolves.toBe(
        "communication.email.outbound",
      );

      const firstProjection =
        await context.repositories.inboxProjection.findByContactId("contact:one");
      const secondProjection =
        await context.repositories.inboxProjection.findByContactId("contact:two");

      expect(firstProjection?.lastOutboundAt).toBe("2026-06-03T10:00:00.000Z");
      expect(secondProjection?.lastOutboundAt).toBe("2026-06-03T11:00:00.000Z");
    } finally {
      await context.dispose();
    }
  });

  it("is idempotent when the same CSV is applied twice", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact:one",
        email: "one@example.org",
        displayName: "Contact One",
      });
      await seedContact({
        context,
        contactId: "contact:two",
        email: "two@example.org",
        displayName: "Contact Two",
      });

      const first = await seedMisclassifiedOutbound({
        context,
        key: "one",
        contactId: "contact:one",
        occurredAt: "2026-06-03T10:00:00.000Z",
      });
      const second = await seedMisclassifiedOutbound({
        context,
        key: "two",
        contactId: "contact:two",
        occurredAt: "2026-06-03T11:00:00.000Z",
      });
      const csv = await writeCsv({
        rows: [
          {
            canonicalEventId: first.canonicalEventId,
            sourceEvidenceId: first.sourceEvidenceId,
            currentDirection: "inbound",
            suggestedDirection: "outbound",
            confidence: "high",
          },
          {
            canonicalEventId: second.canonicalEventId,
            sourceEvidenceId: second.sourceEvidenceId,
            currentDirection: "inbound",
            suggestedDirection: "outbound",
            confidence: "high",
          },
        ],
      });

      try {
        await applyMboxDirectionBackfill({
          db: context.db,
          csvPath: csv.path,
          dryRun: false,
          logger: createLogger().logger,
        });

        const secondRunLogger = createLogger();
        const secondRun = await applyMboxDirectionBackfill({
          db: context.db,
          csvPath: csv.path,
          dryRun: false,
          logger: secondRunLogger.logger,
        });

        expect(secondRun).toMatchObject({
          csvRowsConsidered: 2,
          flipped: 0,
          skippedAlreadyOutbound: 2,
          skippedFilterMismatch: 0,
          skippedUnexpectedState: 0,
          contactsAffected: 0,
          projectionsRebuilt: 0,
          dryRun: false,
        });
        expect(
          secondRunLogger.lines.filter((line) =>
            /^\[apply\] event=.* skipped \(already outbound\)$/u.test(line),
          ),
        ).toHaveLength(2);
      } finally {
        await rm(csv.dir, { recursive: true, force: true });
      }
    } finally {
      await context.dispose();
    }
  });

  it("skips rows that do not match the approved outbound/high/inbound filter", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact:one",
        email: "one@example.org",
        displayName: "Contact One",
      });

      const seeded = await seedMisclassifiedOutbound({
        context,
        key: "one",
        contactId: "contact:one",
        occurredAt: "2026-06-03T10:00:00.000Z",
      });
      const csv = await writeCsv({
        rows: [
          {
            canonicalEventId: seeded.canonicalEventId,
            sourceEvidenceId: seeded.sourceEvidenceId,
            currentDirection: "inbound",
            suggestedDirection: "outbound",
            confidence: "low",
          },
        ],
      });

      try {
        const result = await applyMboxDirectionBackfill({
          db: context.db,
          csvPath: csv.path,
          dryRun: false,
          logger: createLogger().logger,
        });

        expect(result).toMatchObject({
          csvRowsConsidered: 1,
          flipped: 0,
          skippedAlreadyOutbound: 0,
          skippedFilterMismatch: 1,
          skippedUnexpectedState: 0,
          contactsAffected: 0,
          projectionsRebuilt: 0,
          dryRun: false,
        });
      } finally {
        await rm(csv.dir, { recursive: true, force: true });
      }

      await expect(readDirection(context, seeded.sourceEvidenceId)).resolves.toBe(
        "inbound",
      );
      await expect(readEventType(context, seeded.canonicalEventId)).resolves.toBe(
        "communication.email.inbound",
      );
    } finally {
      await context.dispose();
    }
  });

  it("logs intended flips in dry-run mode without persisting changes", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact({
        context,
        contactId: "contact:one",
        email: "one@example.org",
        displayName: "Contact One",
      });

      const seeded = await seedMisclassifiedOutbound({
        context,
        key: "one",
        contactId: "contact:one",
        occurredAt: "2026-06-03T10:00:00.000Z",
      });
      const csv = await writeCsv({
        rows: [
          {
            canonicalEventId: seeded.canonicalEventId,
            sourceEvidenceId: seeded.sourceEvidenceId,
            currentDirection: "inbound",
            suggestedDirection: "outbound",
            confidence: "high",
          },
        ],
      });

      try {
        const logger = createLogger();
        const result = await applyMboxDirectionBackfill({
          db: context.db,
          csvPath: csv.path,
          dryRun: true,
          logger: logger.logger,
        });

        expect(result).toMatchObject({
          csvRowsConsidered: 1,
          flipped: 1,
          skippedAlreadyOutbound: 0,
          skippedFilterMismatch: 0,
          skippedUnexpectedState: 0,
          contactsAffected: 1,
          projectionsRebuilt: 0,
          dryRun: true,
        });
        expect(
          logger.lines.some((line) => line.includes("would flip inbound->outbound")),
        ).toBe(true);
      } finally {
        await rm(csv.dir, { recursive: true, force: true });
      }

      await expect(readDirection(context, seeded.sourceEvidenceId)).resolves.toBe(
        "inbound",
      );
      await expect(readEventType(context, seeded.canonicalEventId)).resolves.toBe(
        "communication.email.inbound",
      );
    } finally {
      await context.dispose();
    }
  });
});
