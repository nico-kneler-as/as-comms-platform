import { describe, expect, it } from "vitest";

import {
  buildSourceEvidenceId,
  type GmailMessageMetadata,
} from "@as-comms/integrations";

import {
  recoverGmailDateWindow,
  type RecoverGmailDateWindowLogEntry,
} from "../src/ops/recover-gmail-date-window.js";
import { createTestWorkerContext } from "./helpers.js";

const contactId = "contact:recover-date-window";

function buildFullMessagePayload(input: {
  readonly bodyText: string;
  readonly headers: Readonly<Record<string, string>>;
}): GmailMessageMetadata["payload"] {
  return {
    mimeType: "text/plain",
    filename: "",
    headers: [
      ...Object.entries(input.headers).map(([name, value]) => ({
        name,
        value,
      })),
      {
        name: "Content-Type",
        value: "text/plain; charset=UTF-8",
      },
      {
        name: "Content-Transfer-Encoding",
        value: "7bit",
      },
    ],
    body: {
      data: Buffer.from(input.bodyText, "utf8").toString("base64url"),
    },
    parts: [],
  };
}

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
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
    },
    identities: [
      {
        id: `identity:${contactId}:email`,
        contactId,
        kind: "email",
        normalizedValue: "nathanielmc@outlook.com",
        isPrimary: true,
        source: "manual",
        verifiedAt: "2026-06-04T00:00:00.000Z",
      },
    ],
    memberships: [],
  });
}

async function appendExistingSourceEvidence(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
  providerRecordId: string,
): Promise<void> {
  await context.repositories.sourceEvidence.append({
    id: buildSourceEvidenceId("gmail", "message", providerRecordId),
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId,
    receivedAt: "2026-06-04T22:05:00.000Z",
    occurredAt: "2026-06-04T20:05:00.000Z",
    payloadRef: `gmail://volunteers%40adventurescientists.org/messages/${providerRecordId}`,
    idempotencyKey: `gmail:message:${providerRecordId}`,
    checksum: `checksum:${providerRecordId}`,
  });
}

function buildMessageMetadata(messageId: string): GmailMessageMetadata {
  return {
    id: messageId,
    threadId: `thread-${messageId}`,
    labelIds: ["INBOX"],
    snippet: "Can my friends join me on Hex 34571?",
    internalDate: String(Date.parse("2026-06-04T20:05:00.000Z")),
    payload: buildFullMessagePayload({
      bodyText: "Can my friends join me on Hex 34571?",
      headers: {
        Date: "Thu, 04 Jun 2026 14:05:00 -0600",
        From: "Nathaniel McCrady <nathanielmc@outlook.com>",
        To: "PNW Bio <pnwbio@adventurescientists.org>",
        Subject: `Adding others to a Hex (${messageId})`,
        "Message-ID": `<${messageId}@example.org>`,
      },
    }),
  };
}

describe("recover-gmail-date-window", () => {
  it("captures missing messages in the window and is idempotent on re-run", async () => {
    const context = await createTestWorkerContext();
    const logs: RecoverGmailDateWindowLogEntry[] = [];
    const logger = {
      log(value: unknown) {
        if (typeof value === "string") {
          logs.push(JSON.parse(value) as RecoverGmailDateWindowLogEntry);
        }
      },
      error() {
        return undefined;
      },
    };

    try {
      await seedContact(context);
      await appendExistingSourceEvidence(context, "gmail-existing-1");

      const apiClient = {
        listMessageIds: () =>
          Promise.resolve([
            "gmail-existing-1",
            "gmail-missing-1",
            "gmail-missing-2",
          ]),
        getMessage: ({ messageId }: { readonly messageId: string }) =>
          Promise.resolve(buildMessageMetadata(messageId)),
      };

      const firstRun = await recoverGmailDateWindow({
        repositories: context.repositories,
        ingest: context.ingest,
        apiClient,
        mailbox: "volunteers@adventurescientists.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["pnwbio@adventurescientists.org"],
        windowStart: "2026-06-04T20:00:00.000Z",
        windowEnd: "2026-06-05T00:00:00.000Z",
        execute: true,
        logger,
      });

      expect(firstRun).toMatchObject({
        checked: 3,
        foundInDb: 1,
        missing: 2,
        skipped: 1,
        captured: 2,
        notFoundInMailbox: 0,
      });

      const capturedEvidenceIds = await Promise.all(
        ["gmail-missing-1", "gmail-missing-2"].map(async (providerRecordId) => {
          const rows =
            await context.repositories.sourceEvidence.listByProviderRecord({
              provider: "gmail",
              providerRecordType: "message",
              providerRecordId,
            });

          expect(rows).toHaveLength(1);
          return rows[0]?.id ?? "";
        }),
      );

      const gmailDetails =
        await context.repositories.gmailMessageDetails.listBySourceEvidenceIds(
          capturedEvidenceIds,
        );

      expect(gmailDetails).toEqual([
        expect.objectContaining({
          providerRecordId: "gmail-missing-1",
          direction: "inbound",
          capturedMailbox: "volunteers@adventurescientists.org",
        }),
        expect.objectContaining({
          providerRecordId: "gmail-missing-2",
          direction: "inbound",
          capturedMailbox: "volunteers@adventurescientists.org",
        }),
      ]);

      expect(logs).toContainEqual({
        id: "gmail-existing-1",
        foundInDb: true,
        action: "skipped",
        labelIds: null,
      });
      expect(logs).toContainEqual({
        id: "gmail-missing-1",
        foundInDb: false,
        action: "captured",
        labelIds: ["INBOX"],
      });
      expect(logs).toContainEqual({
        id: "gmail-missing-2",
        foundInDb: false,
        action: "captured",
        labelIds: ["INBOX"],
      });

      logs.length = 0;

      const secondRun = await recoverGmailDateWindow({
        repositories: context.repositories,
        ingest: context.ingest,
        apiClient,
        mailbox: "volunteers@adventurescientists.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["pnwbio@adventurescientists.org"],
        windowStart: "2026-06-04T20:00:00.000Z",
        windowEnd: "2026-06-05T00:00:00.000Z",
        execute: true,
        logger,
      });

      expect(secondRun).toMatchObject({
        checked: 3,
        foundInDb: 3,
        missing: 0,
        skipped: 3,
        captured: 0,
        notFoundInMailbox: 0,
      });
    } finally {
      await context.dispose();
    }
  });
});
