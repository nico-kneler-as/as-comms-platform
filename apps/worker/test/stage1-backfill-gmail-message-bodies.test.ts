import { describe, expect, it } from "vitest";

import {
  buildGmailMessageRecord,
  type GmailRecord
} from "@as-comms/integrations";

import {
  backfillGmailMessageBodies
} from "../src/ops/backfill-gmail-message-bodies.js";
import { createTestWorkerContext } from "./helpers.js";

function buildCleanLiveRecord(providerRecordId: string): GmailRecord {
  return buildGmailMessageRecord({
    recordId: providerRecordId,
    threadId: "thread-live-1",
    snippet: "Short Gmail snippet",
    snippetClean: "Short Gmail snippet",
    bodyTextPreview:
      "Hello there.\n\nWe can confirm your training is complete.",
    internalDate: "2026-03-26T10:15:00.000Z",
    headers: {
      Date: "Thu, 26 Mar 2026 10:15:00 +0000",
      From: "PNW Forest Biodiversity <pnw@example.org>",
      To: "Silvia Maldonado <silvia@example.org>",
      Subject: "Re: Last Call: PNW Training",
      "Message-ID": `<${providerRecordId}@example.org>`
    },
    payloadRef: `gmail://volunteers%40example.org/messages/${providerRecordId}`,
    checksum: `checksum:${providerRecordId}`,
    capturedMailbox: "volunteers@example.org",
    receivedAt: "2026-03-26T10:16:00.000Z",
    internalAddresses: ["volunteers@example.org", "pnw@example.org"],
    projectInboxAliases: ["pnw@example.org"]
  });
}

async function seedSuspiciousGmailDetail(input: {
  readonly providerRecordId: string;
  readonly sourceEvidenceId: string;
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly bodyTextPreview: string;
}): Promise<void> {
  await input.context.repositories.sourceEvidence.append({
    id: input.sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.providerRecordId,
    receivedAt: "2026-03-26T10:16:00.000Z",
    occurredAt: "2026-03-26T10:15:00.000Z",
    payloadRef: `gmail://volunteers%40example.org/messages/${input.providerRecordId}`,
    idempotencyKey: input.sourceEvidenceId,
    checksum: `checksum:${input.providerRecordId}`
  });

  await input.context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId: input.sourceEvidenceId,
    providerRecordId: input.providerRecordId,
    gmailThreadId: "thread-live-1",
    rfc822MessageId: `<${input.providerRecordId}@example.org>`,
    direction: "outbound",
    subject: "Re: Last Call: PNW Training",
    snippetClean: "Short Gmail snippet",
    bodyTextPreview: input.bodyTextPreview,
    capturedMailbox: "volunteers@example.org",
    projectInboxAlias: "pnw@example.org"
  });
}

describe("Stage 1 Gmail body backfill ops", () => {
  it("reports would-update rows in dry-run mode without mutating stored previews", async () => {
    const context = await createTestWorkerContext();
    const sourceEvidenceId = "source-evidence:gmail:message:gmail-live-1";

    try {
      await seedSuspiciousGmailDetail({
        context,
        sourceEvidenceId,
        providerRecordId: "gmail-live-1",
        bodyTextPreview:
          'Content-Type: text/plain; charset="UTF-8" Content-Transfer-Encoding: quoted-printable Hello there =C3=B3'
      });

      const result = await backfillGmailMessageBodies({
        db: context.db,
        repositories: context.repositories,
        capture: {
          captureLiveBatch: () =>
            Promise.resolve({
              records: [buildCleanLiveRecord("gmail-live-1")],
              nextCursor: null,
              checkpoint: null
            })
        },
        dryRun: true
      });

      expect(result).toMatchObject({
        dryRun: true,
        scannedCount: 1,
        eligibleCount: 1,
        wouldUpdateCount: 1,
        updatedCount: 0
      });

      const persisted = await context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
        sourceEvidenceId
      ]);

      expect(persisted[0]?.bodyTextPreview).toContain("Content-Type:");
    } finally {
      await context.dispose();
    }
  });

  it("upserts cleaned Gmail bodies and becomes a no-op on a later pass", async () => {
    const context = await createTestWorkerContext();
    const sourceEvidenceId = "source-evidence:gmail:message:gmail-live-2";

    try {
      await seedSuspiciousGmailDetail({
        context,
        sourceEvidenceId,
        providerRecordId: "gmail-live-2",
        bodyTextPreview:
          "--00000000000027fc9f064e932947 Content-Type: text/plain; charset=\"UTF-8\""
      });

      const capture = {
        captureLiveBatch: () =>
          Promise.resolve({
            records: [buildCleanLiveRecord("gmail-live-2")],
            nextCursor: null,
            checkpoint: null
          })
      };

      const firstPass = await backfillGmailMessageBodies({
        db: context.db,
        repositories: context.repositories,
        capture
      });
      const secondPass = await backfillGmailMessageBodies({
        db: context.db,
        repositories: context.repositories,
        capture
      });
      const persisted = await context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
        sourceEvidenceId
      ]);

      expect(firstPass).toMatchObject({
        scannedCount: 1,
        updatedCount: 1,
        wouldUpdateCount: 1
      });
      expect(secondPass).toMatchObject({
        scannedCount: 0,
        updatedCount: 0,
        wouldUpdateCount: 0
      });
      expect(persisted[0]?.bodyTextPreview).toBe(
        "Hello there.\n\nWe can confirm your training is complete."
      );
      expect(persisted[0]?.bodyTextPreview).not.toContain("Content-Type:");
    } finally {
      await context.dispose();
    }
  });

  it("skips suspicious historical mbox rows that cannot be re-fetched through live capture", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedSuspiciousGmailDetail({
        context,
        sourceEvidenceId:
          "source-evidence:gmail:message:mbox:historical-message-1",
        providerRecordId: "mbox:historical-message-1",
        bodyTextPreview:
          'Content-Type: text/plain; charset="UTF-8" Content-Transfer-Encoding: quoted-printable Historical body =C3=B3'
      });

      const result = await backfillGmailMessageBodies({
        db: context.db,
        repositories: context.repositories,
        capture: {
          captureLiveBatch: () =>
            Promise.reject(
              new Error("Historical .mbox rows should be skipped before capture.")
            )
        },
        dryRun: true
      });

      expect(result).toMatchObject({
        scannedCount: 1,
        eligibleCount: 0,
        skippedHistoricalCount: 1,
        updatedCount: 0
      });
    } finally {
      await context.dispose();
    }
  });
});
