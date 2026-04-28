import { describe, expect, it } from "vitest";

import { backfillGarbledMessageBodies } from "../src/ops/backfill-garbled-message-bodies.js";
import { createTestWorkerContext } from "./helpers.js";

const BINARY_FALLBACK_PLACEHOLDER =
  "[Message body could not be extracted — open in Gmail]";

function buildGarbledBody(): string {
  return "A�".repeat(20);
}

function buildCleanBody(): string {
  return "Hello there.\n\nThis message is readable and should stay untouched.";
}

async function seedGmailMessageDetail(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly bodyTextPreview: string;
  readonly bodyKind?: "binary_fallback" | null;
}): Promise<void> {
  await input.context.repositories.sourceEvidence.append({
    id: input.sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.providerRecordId,
    receivedAt: "2026-04-28T00:00:00.000Z",
    occurredAt: "2026-04-28T00:00:00.000Z",
    payloadRef: `gmail://volunteers%40example.org/messages/${input.providerRecordId}`,
    idempotencyKey: input.sourceEvidenceId,
    checksum: `checksum:${input.providerRecordId}`,
  });

  await input.context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId: input.sourceEvidenceId,
    providerRecordId: input.providerRecordId,
    gmailThreadId: "thread-garbled-1",
    rfc822MessageId: `<${input.providerRecordId}@example.org>`,
    direction: "inbound",
    subject: "Security alert",
    fromHeader: "Google <no-reply@accounts.google.com>",
    toHeader: "Volunteer <volunteer@example.org>",
    ccHeader: null,
    labelIds: null,
    snippetClean: input.bodyTextPreview,
    bodyTextPreview: input.bodyTextPreview,
    bodyKind: input.bodyKind ?? null,
    capturedMailbox: "volunteers@example.org",
    projectInboxAlias: "volunteers@example.org",
  });
}

describe("Stage 1 garbled Gmail message body backfill", () => {
  it("reports dry-run updates without mutating the stored row", async () => {
    const context = await createTestWorkerContext();
    const sourceEvidenceId = "source-evidence:gmail:message:garbled-dry-run";
    const garbledBody = buildGarbledBody();

    try {
      await seedGmailMessageDetail({
        context,
        sourceEvidenceId,
        providerRecordId: "garbled-dry-run",
        bodyTextPreview: garbledBody,
      });

      const result = await backfillGarbledMessageBodies({
        db: context.db,
        dryRun: true,
      });
      const [persisted] =
        await context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId,
        ]);

      expect(result).toMatchObject({
        dryRun: true,
        scanned: 1,
        garbled: 1,
        dryRunWouldUpdate: 1,
        updated: 0,
      });
      expect(persisted).toMatchObject({
        bodyTextPreview: garbledBody,
        snippetClean: garbledBody,
        bodyKind: null,
      });
    } finally {
      await context.dispose();
    }
  });

  it("writes the placeholder and body kind in execute mode", async () => {
    const context = await createTestWorkerContext();
    const sourceEvidenceId = "source-evidence:gmail:message:garbled-execute";

    try {
      await seedGmailMessageDetail({
        context,
        sourceEvidenceId,
        providerRecordId: "garbled-execute",
        bodyTextPreview: buildGarbledBody(),
      });

      const result = await backfillGarbledMessageBodies({
        db: context.db,
        dryRun: false,
      });
      const [persisted] =
        await context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId,
        ]);

      expect(result).toMatchObject({
        dryRun: false,
        scanned: 1,
        garbled: 1,
        dryRunWouldUpdate: 0,
        updated: 1,
      });
      expect(persisted).toMatchObject({
        bodyTextPreview: BINARY_FALLBACK_PLACEHOLDER,
        snippetClean: BINARY_FALLBACK_PLACEHOLDER,
        bodyKind: "binary_fallback",
      });
    } finally {
      await context.dispose();
    }
  });

  it("leaves readable bodies untouched", async () => {
    const context = await createTestWorkerContext();
    const sourceEvidenceId = "source-evidence:gmail:message:garbled-clean";
    const cleanBody = buildCleanBody();

    try {
      await seedGmailMessageDetail({
        context,
        sourceEvidenceId,
        providerRecordId: "garbled-clean",
        bodyTextPreview: cleanBody,
      });

      const result = await backfillGarbledMessageBodies({
        db: context.db,
        dryRun: false,
      });
      const [persisted] =
        await context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId,
        ]);

      expect(result).toMatchObject({
        scanned: 1,
        garbled: 0,
        dryRunWouldUpdate: 0,
        updated: 0,
      });
      expect(persisted).toMatchObject({
        bodyTextPreview: cleanBody,
        snippetClean: cleanBody,
        bodyKind: null,
      });
    } finally {
      await context.dispose();
    }
  });

  it("skips rows that already have a classified body kind", async () => {
    const context = await createTestWorkerContext();
    const sourceEvidenceId = "source-evidence:gmail:message:garbled-skipped";
    const garbledBody = buildGarbledBody();

    try {
      await seedGmailMessageDetail({
        context,
        sourceEvidenceId,
        providerRecordId: "garbled-skipped",
        bodyTextPreview: garbledBody,
        bodyKind: "binary_fallback",
      });

      const result = await backfillGarbledMessageBodies({
        db: context.db,
        dryRun: false,
      });
      const [persisted] =
        await context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId,
        ]);

      expect(result).toMatchObject({
        scanned: 0,
        garbled: 0,
        dryRunWouldUpdate: 0,
        updated: 0,
      });
      expect(persisted).toMatchObject({
        bodyTextPreview: garbledBody,
        snippetClean: garbledBody,
        bodyKind: "binary_fallback",
      });
    } finally {
      await context.dispose();
    }
  });
});
