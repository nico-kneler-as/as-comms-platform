import { describe, expect, it } from "vitest";

import {
  buildGmailMessageRecord,
} from "@as-comms/integrations";

import { createTestWorkerContext } from "./helpers.js";

const contactId = "contact:spam-volunteer";

async function seedContact(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
): Promise<void> {
  await context.normalization.upsertNormalizedContactGraph({
    contact: {
      id: contactId,
      salesforceContactId: null,
      displayName: "Nathaniel McCrady",
      primaryEmail: "nathanielmc@outlook.com",
      primaryPhone: null,
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
    },
    identities: [
      {
        id: `identity:${contactId}:email`,
        contactId,
        kind: "email",
        normalizedValue: "nathanielmc@outlook.com",
        isPrimary: true,
        source: "manual",
        verifiedAt: "2026-05-16T00:00:00.000Z",
      },
    ],
    memberships: [],
  });
}

describe("Stage 1 Gmail spam capture", () => {
  it("normalizes a spam-labeled inbound Gmail message into source evidence, gmail detail, and inbox projection", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedContact(context);

      const record = buildGmailMessageRecord({
        recordId: "gmail-spam-1",
        threadId: "thread-spam-1",
        labelIds: ["INBOX", "SPAM"],
        snippet: "Can my friends join me on Hex 34571?",
        snippetClean: "Can my friends join me on Hex 34571?",
        bodyTextPreview: "Can my friends join me on Hex 34571?",
        internalDate: "2026-05-17T00:05:00.000Z",
        headers: {
          Date: "Sat, 16 May 2026 17:05:00 -0700",
          From: "Nathaniel McCrady <nathanielmc@outlook.com>",
          To: "PNW Bio <pnwbio@adventurescientists.org>",
          Subject: "Adding others to a Hex",
          "Message-ID": "<gmail-spam-1@example.org>",
        },
        payloadRef:
          "gmail://volunteers%40adventurescientists.org/messages/gmail-spam-1",
        checksum: "checksum:gmail-spam-1",
        capturedMailbox: "volunteers@adventurescientists.org",
        receivedAt: "2026-05-18T22:05:00.000Z",
        internalAddresses: [
          "volunteers@adventurescientists.org",
          "pnwbio@adventurescientists.org",
        ],
        projectInboxAliases: ["pnwbio@adventurescientists.org"],
      });

      const result = await context.ingest.ingestGmailHistoricalRecord(record);

      expect(result.outcome).toBe("normalized");

      const sourceEvidence =
        await context.repositories.sourceEvidence.listByProviderRecord({
          provider: "gmail",
          providerRecordType: "message",
          providerRecordId: "gmail-spam-1",
        });

      expect(sourceEvidence).toHaveLength(1);

      const sourceEvidenceId = sourceEvidence[0]?.id;

      if (sourceEvidenceId === undefined) {
        throw new Error("Expected Gmail source evidence to be persisted.");
      }

      await expect(
        context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId,
        ]),
      ).resolves.toEqual([
        expect.objectContaining({
          sourceEvidenceId,
          providerRecordId: "gmail-spam-1",
          direction: "inbound",
          subject: "Adding others to a Hex",
          labelIds: ["INBOX", "SPAM"],
        }),
      ]);

      await expect(
        context.repositories.canonicalEvents.listByContactId(contactId),
      ).resolves.toEqual([
        expect.objectContaining({
          contactId,
          eventType: "communication.email.inbound",
          sourceEvidenceId,
        }),
      ]);

      await expect(
        context.repositories.inboxProjection.findByContactId(contactId),
      ).resolves.toMatchObject({
        contactId,
        bucket: "New",
        lastEventType: "communication.email.inbound",
        snippet: "Can my friends join me on Hex 34571?",
      });
    } finally {
      await context.dispose();
    }
  });
});
