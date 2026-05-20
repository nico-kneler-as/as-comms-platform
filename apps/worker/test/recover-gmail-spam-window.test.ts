import { describe, expect, it } from "vitest";

import {
  buildSourceEvidenceId,
  type GmailMessageMetadata,
} from "@as-comms/integrations";

import {
  recoverGmailSpamWindow,
  type RecoverGmailSpamWindowLogEntry,
} from "../src/ops/recover-gmail-spam-window.js";
import { createTestWorkerContext } from "./helpers.js";

const contactId = "contact:recover-spam";

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

async function appendExistingSourceEvidence(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
  providerRecordId: string,
): Promise<void> {
  await context.repositories.sourceEvidence.append({
    id: buildSourceEvidenceId("gmail", "message", providerRecordId),
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId,
    receivedAt: "2026-05-18T22:05:00.000Z",
    occurredAt: "2026-05-16T00:05:00.000Z",
    payloadRef: `gmail://volunteers%40adventurescientists.org/messages/${providerRecordId}`,
    idempotencyKey: `gmail:message:${providerRecordId}`,
    checksum: `checksum:${providerRecordId}`,
  });
}

function buildMessageMetadata(messageId: string): GmailMessageMetadata {
  return {
    id: messageId,
    threadId: "thread-recover-spam-1",
    labelIds: ["INBOX", "SPAM"],
    snippet: "Can my friends join me on Hex 34571?",
    internalDate: String(Date.parse("2026-05-17T00:05:00.000Z")),
    payload: buildFullMessagePayload({
      bodyText: "Can my friends join me on Hex 34571?",
      headers: {
        Date: "Sat, 16 May 2026 17:05:00 -0700",
        From: "Nathaniel McCrady <nathanielmc@outlook.com>",
        To: "PNW Bio <pnwbio@adventurescientists.org>",
        Subject: "Adding others to a Hex",
        "Message-ID": `<${messageId}@example.org>`,
      },
    }),
  };
}

describe("recover-gmail-spam-window", () => {
  it("reports dry-run counts without writing and captures the missing message on execute", async () => {
    const context = await createTestWorkerContext();
    const logs: RecoverGmailSpamWindowLogEntry[] = [];
    const logger = {
      log(value: unknown) {
        if (typeof value === "string") {
          logs.push(JSON.parse(value) as RecoverGmailSpamWindowLogEntry);
        }
      },
      error() {
        return undefined;
      },
    };

    try {
      await seedContact(context);
      await appendExistingSourceEvidence(context, "gmail-existing-1");
      await appendExistingSourceEvidence(context, "gmail-existing-2");

      const apiClient = {
        listMessageIds: () =>
          Promise.resolve([
            "gmail-existing-1",
            "gmail-existing-2",
            "gmail-missing-1",
          ]),
        getMessage: ({ messageId }: { readonly messageId: string }) =>
          Promise.resolve(
            messageId === "gmail-missing-1"
              ? buildMessageMetadata(messageId)
              : null,
          ),
      };

      const dryRun = await recoverGmailSpamWindow({
        repositories: context.repositories,
        ingest: context.ingest,
        apiClient,
        mailbox: "volunteers@adventurescientists.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["pnwbio@adventurescientists.org"],
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-05-20T00:00:00.000Z",
        execute: false,
        logger,
      });

      expect(dryRun).toMatchObject({
        checked: 3,
        missing: 1,
        captured: 0,
      });
      await expect(
        context.repositories.sourceEvidence.listByProviderRecord({
          provider: "gmail",
          providerRecordType: "message",
          providerRecordId: "gmail-missing-1",
        }),
      ).resolves.toEqual([]);

      logs.length = 0;

      const executeResult = await recoverGmailSpamWindow({
        repositories: context.repositories,
        ingest: context.ingest,
        apiClient,
        mailbox: "volunteers@adventurescientists.org",
        liveAccount: "volunteers@adventurescientists.org",
        projectInboxAliases: ["pnwbio@adventurescientists.org"],
        windowStart: "2026-04-01T00:00:00.000Z",
        windowEnd: "2026-05-20T00:00:00.000Z",
        execute: true,
        logger,
      });

      expect(executeResult).toMatchObject({
        checked: 3,
        missing: 1,
        captured: 1,
      });

      const sourceEvidence =
        await context.repositories.sourceEvidence.listByProviderRecord({
          provider: "gmail",
          providerRecordType: "message",
          providerRecordId: "gmail-missing-1",
        });

      expect(sourceEvidence).toHaveLength(1);

      const sourceEvidenceId = sourceEvidence[0]?.id;

      if (sourceEvidenceId === undefined) {
        throw new Error("Expected recovered Gmail source evidence to exist.");
      }

      await expect(
        context.repositories.gmailMessageDetails.listBySourceEvidenceIds([
          sourceEvidenceId,
        ]),
      ).resolves.toEqual([
        expect.objectContaining({
          sourceEvidenceId,
          providerRecordId: "gmail-missing-1",
          labelIds: ["INBOX", "SPAM"],
        }),
      ]);

      expect(logs).toContainEqual({
        id: "gmail-missing-1",
        foundInDb: false,
        action: "captured",
        labelIds: ["INBOX", "SPAM"],
      });
    } finally {
      await context.dispose();
    }
  });
});
