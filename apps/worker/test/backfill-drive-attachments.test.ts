import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import {
  buildGmailMessageDriveAttachmentId,
  type GmailMailboxApiClient,
  type GmailMessageMetadata,
} from "@as-comms/integrations";

import {
  backfillDriveAttachments,
  type BackfillDriveAttachmentsLogEntry,
} from "../src/ops/backfill-drive-attachments.js";
import { createTestWorkerContext } from "./helpers.js";

function buildHtmlPayload(html: string): GmailMessageMetadata["payload"] {
  return {
    mimeType: "text/html",
    filename: "",
    headers: [
      {
        name: "Content-Type",
        value: "text/html; charset=UTF-8",
      },
      {
        name: "Content-Transfer-Encoding",
        value: "7bit",
      },
    ],
    body: {
      data: Buffer.from(html, "utf8").toString("base64url"),
    },
    parts: [],
  };
}

function buildGmailMessage(
  messageId: string,
  html: string,
): GmailMessageMetadata {
  return {
    id: messageId,
    threadId: `thread:${messageId}`,
    labelIds: ["INBOX"],
    snippet: "Drive link",
    internalDate: String(Date.parse("2026-06-01T12:00:00.000Z")),
    payload: buildHtmlPayload(html),
  };
}

function buildDriveAnchorHtml(input: {
  readonly driveFileId: string;
  readonly filename: string;
}): string {
  return `<div><a href="https://drive.google.com/file/d/${input.driveFileId}/view">${input.filename}</a></div>`;
}

function createApiClientStub(input: {
  readonly getMessage: GmailMailboxApiClient["getMessage"];
}): GmailMailboxApiClient {
  return {
    listMessageIds: () => Promise.resolve([]),
    getMessage: input.getMessage,
  };
}

async function seedCandidateMessage(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly sourceEvidenceId: string;
  readonly providerRecordId: string;
  readonly createdAt: string;
  readonly capturedMailbox?: string;
  readonly bodyTextPreview?: string;
}): Promise<void> {
  await input.context.repositories.sourceEvidence.append({
    id: input.sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.providerRecordId,
    receivedAt: input.createdAt,
    occurredAt: input.createdAt,
    payloadRef: `gmail://volunteers%40example.org/messages/${input.providerRecordId}`,
    idempotencyKey: input.sourceEvidenceId,
    checksum: `checksum:${input.providerRecordId}`,
  });

  await input.context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId: input.sourceEvidenceId,
    providerRecordId: input.providerRecordId,
    gmailThreadId: `thread:${input.providerRecordId}`,
    rfc822MessageId: `<${input.providerRecordId}@example.org>`,
    direction: "inbound",
    subject: "Shared file",
    fromHeader: "Volunteer <volunteer@example.org>",
    toHeader: "Project <project@example.org>",
    ccHeader: null,
    fromEmails: [],
    toEmails: [],
    ccEmails: [],
    bccEmails: [],
    labelIds: ["INBOX"],
    snippetClean: input.bodyTextPreview ?? "[image: shared-photo.jpg]",
    bodyTextPreview: input.bodyTextPreview ?? "[image: shared-photo.jpg]",
    capturedMailbox: input.capturedMailbox ?? "volunteers@example.org",
    projectInboxAlias: "project@example.org",
  });

  await input.context.db.execute(sql`
    update gmail_message_details
    set created_at = ${input.createdAt}::timestamptz,
        updated_at = ${input.createdAt}::timestamptz
    where source_evidence_id = ${input.sourceEvidenceId}
  `);
}

function createLoggerSink(logs: BackfillDriveAttachmentsLogEntry[]) {
  return {
    log(value: unknown) {
      if (typeof value === "string") {
        logs.push(JSON.parse(value) as BackfillDriveAttachmentsLogEntry);
      }
    },
    error() {
      return undefined;
    },
  };
}

describe("backfill-drive-attachments", () => {
  it("lists dry-run candidates but writes no rows", async () => {
    const context = await createTestWorkerContext();
    const logs: BackfillDriveAttachmentsLogEntry[] = [];
    const sourceEvidenceId = "source-evidence:gmail:message:drive-dry-run";

    try {
      await seedCandidateMessage({
        context,
        sourceEvidenceId,
        providerRecordId: "drive-dry-run",
        createdAt: "2026-05-28T00:00:00.000Z",
      });

      const result = await backfillDriveAttachments({
        repositories: context.repositories,
        db: context.db,
        apiClient: createApiClientStub({
          getMessage: ({ messageId }) =>
            Promise.resolve(
              buildGmailMessage(
                messageId,
                buildDriveAnchorHtml({
                  driveFileId: "drive-file-dry-run",
                  filename: "shared-photo.jpg",
                }),
              ),
            ),
        }),
        windowStart: "2026-05-01T00:00:00.000Z",
        windowEnd: null,
        execute: false,
        rateLimitMs: 0,
        logger: createLoggerSink(logs),
      });

      expect(result).toMatchObject({
        dryRun: true,
        candidatesScanned: 1,
        driveAttachmentsInserted: 0,
        messagesWithoutDriveAnchors: 0,
        messagesNotFoundInMailbox: 0,
        fetchFailures: 0,
      });
      expect(logs).toContainEqual({
        providerRecordId: "drive-dry-run",
        sourceEvidenceId,
        capturedMailbox: "volunteers@example.org",
        outcome: "would-insert",
        driveAttachmentCount: 1,
      });
      await expect(
        context.repositories.messageAttachments.findByMessageIds([sourceEvidenceId]),
      ).resolves.toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("inserts drive rows in execute mode", async () => {
    const context = await createTestWorkerContext();
    const sourceEvidenceId = "source-evidence:gmail:message:drive-execute";
    const driveAttachmentId = buildGmailMessageDriveAttachmentId({
      messageId: "drive-execute",
      driveFileId: "drive-file-execute",
    });

    try {
      await seedCandidateMessage({
        context,
        sourceEvidenceId,
        providerRecordId: "drive-execute",
        createdAt: "2026-05-28T00:00:00.000Z",
      });

      const result = await backfillDriveAttachments({
        repositories: context.repositories,
        db: context.db,
        apiClient: createApiClientStub({
          getMessage: ({ messageId }) =>
            Promise.resolve(
              buildGmailMessage(
                messageId,
                buildDriveAnchorHtml({
                  driveFileId: "drive-file-execute",
                  filename: "field-notes.pdf",
                }),
              ),
            ),
        }),
        windowStart: "2026-05-01T00:00:00.000Z",
        windowEnd: null,
        execute: true,
        rateLimitMs: 0,
      });

      expect(result).toMatchObject({
        dryRun: false,
        candidatesScanned: 1,
        driveAttachmentsInserted: 1,
      });
      await expect(
        context.repositories.messageAttachments.findByMessageIds([sourceEvidenceId]),
      ).resolves.toMatchObject([
        {
          id: driveAttachmentId,
          provider: "drive",
          gmailAttachmentId: null,
          mimeType: "application/octet-stream",
          filename: "field-notes.pdf",
          sizeBytes: 0,
          storageKey: null,
          externalUrl:
            "https://drive.google.com/file/d/drive-file-execute/view",
          isDecoration: false,
        },
      ]);
    } finally {
      await context.dispose();
    }
  });

  it("is idempotent on repeated execute runs", async () => {
    const context = await createTestWorkerContext();
    const sourceEvidenceId = "source-evidence:gmail:message:drive-idempotent";

    try {
      await seedCandidateMessage({
        context,
        sourceEvidenceId,
        providerRecordId: "drive-idempotent",
        createdAt: "2026-05-28T00:00:00.000Z",
      });

      const apiClient = createApiClientStub({
        getMessage: ({ messageId }) =>
          Promise.resolve(
            buildGmailMessage(
              messageId,
              buildDriveAnchorHtml({
                driveFileId: "drive-file-idempotent",
                filename: "shared-map.png",
              }),
            ),
          ),
      });

      const firstRun = await backfillDriveAttachments({
        repositories: context.repositories,
        db: context.db,
        apiClient,
        windowStart: "2026-05-01T00:00:00.000Z",
        windowEnd: null,
        execute: true,
        rateLimitMs: 0,
      });
      const secondRun = await backfillDriveAttachments({
        repositories: context.repositories,
        db: context.db,
        apiClient,
        windowStart: "2026-05-01T00:00:00.000Z",
        windowEnd: null,
        execute: true,
        rateLimitMs: 0,
      });

      expect(firstRun.driveAttachmentsInserted).toBe(1);
      expect(secondRun.driveAttachmentsInserted).toBe(0);
      await expect(
        context.repositories.messageAttachments.findByMessageIds([sourceEvidenceId]),
      ).resolves.toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });

  it("skips messages with existing drive rows", async () => {
    const context = await createTestWorkerContext();
    const logs: BackfillDriveAttachmentsLogEntry[] = [];
    const sourceEvidenceId = "source-evidence:gmail:message:drive-existing";
    const existingAttachment = {
      id: buildGmailMessageDriveAttachmentId({
        messageId: "drive-existing",
        driveFileId: "drive-file-existing",
      }),
      sourceEvidenceId,
      provider: "drive" as const,
      gmailAttachmentId: null,
      mimeType: "application/octet-stream",
      filename: "already-there.pdf",
      sizeBytes: 0,
      storageKey: null,
      externalUrl:
        "https://drive.google.com/file/d/drive-file-existing/view",
      isDecoration: false,
      createdAt: "2026-05-28T00:00:00.000Z",
    };

    try {
      await seedCandidateMessage({
        context,
        sourceEvidenceId,
        providerRecordId: "drive-existing",
        createdAt: "2026-05-28T00:00:00.000Z",
      });

      const result = await backfillDriveAttachments({
        repositories: {
          ...context.repositories,
          messageAttachments: {
            ...context.repositories.messageAttachments,
            findByMessageIds: () => Promise.resolve([existingAttachment]),
          },
        },
        db: context.db,
        apiClient: createApiClientStub({
          getMessage: ({ messageId }) =>
            Promise.resolve(
              buildGmailMessage(
                messageId,
                buildDriveAnchorHtml({
                  driveFileId: "drive-file-existing",
                  filename: "already-there.pdf",
                }),
              ),
            ),
        }),
        windowStart: "2026-05-01T00:00:00.000Z",
        windowEnd: null,
        execute: true,
        rateLimitMs: 0,
        logger: createLoggerSink(logs),
      });

      expect(result.driveAttachmentsInserted).toBe(0);
      expect(logs).toContainEqual({
        providerRecordId: "drive-existing",
        sourceEvidenceId,
        capturedMailbox: "volunteers@example.org",
        outcome: "skipped-existing",
        driveAttachmentCount: 0,
      });
      await expect(
        context.repositories.messageAttachments.findByMessageIds([sourceEvidenceId]),
      ).resolves.toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("skips messages whose payload has no drive anchors", async () => {
    const context = await createTestWorkerContext();
    const logs: BackfillDriveAttachmentsLogEntry[] = [];
    const sourceEvidenceId = "source-evidence:gmail:message:no-drive-anchor";

    try {
      await seedCandidateMessage({
        context,
        sourceEvidenceId,
        providerRecordId: "no-drive-anchor",
        createdAt: "2026-05-28T00:00:00.000Z",
      });

      const result = await backfillDriveAttachments({
        repositories: context.repositories,
        db: context.db,
        apiClient: createApiClientStub({
          getMessage: ({ messageId }) =>
            Promise.resolve(
              buildGmailMessage(
                messageId,
                "<div><img src=\"cid:inline-image-1\" alt=\"inline image\"></div>",
              ),
            ),
        }),
        windowStart: "2026-05-01T00:00:00.000Z",
        windowEnd: null,
        execute: true,
        rateLimitMs: 0,
        logger: createLoggerSink(logs),
      });

      expect(result.messagesWithoutDriveAnchors).toBe(1);
      expect(logs).toContainEqual({
        providerRecordId: "no-drive-anchor",
        sourceEvidenceId,
        capturedMailbox: "volunteers@example.org",
        outcome: "no-drive-attachments",
        driveAttachmentCount: 0,
      });
      await expect(
        context.repositories.messageAttachments.findByMessageIds([sourceEvidenceId]),
      ).resolves.toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("skips messages not found in mailbox", async () => {
    const context = await createTestWorkerContext();
    const logs: BackfillDriveAttachmentsLogEntry[] = [];
    const sourceEvidenceId = "source-evidence:gmail:message:not-found";

    try {
      await seedCandidateMessage({
        context,
        sourceEvidenceId,
        providerRecordId: "not-found",
        createdAt: "2026-05-28T00:00:00.000Z",
      });

      const result = await backfillDriveAttachments({
        repositories: context.repositories,
        db: context.db,
        apiClient: createApiClientStub({
          getMessage: () => Promise.resolve(null),
        }),
        windowStart: "2026-05-01T00:00:00.000Z",
        windowEnd: null,
        execute: true,
        rateLimitMs: 0,
        logger: createLoggerSink(logs),
      });

      expect(result.messagesNotFoundInMailbox).toBe(1);
      expect(logs).toContainEqual({
        providerRecordId: "not-found",
        sourceEvidenceId,
        capturedMailbox: "volunteers@example.org",
        outcome: "not-found-in-mailbox",
        driveAttachmentCount: 0,
      });
      await expect(
        context.repositories.messageAttachments.findByMessageIds([sourceEvidenceId]),
      ).resolves.toEqual([]);
    } finally {
      await context.dispose();
    }
  });

  it("continues past fetch failures", async () => {
    const context = await createTestWorkerContext();
    const logs: BackfillDriveAttachmentsLogEntry[] = [];
    const firstSourceEvidenceId =
      "source-evidence:gmail:message:fetch-failure-first";
    const secondSourceEvidenceId =
      "source-evidence:gmail:message:fetch-failure-second";

    try {
      await seedCandidateMessage({
        context,
        sourceEvidenceId: firstSourceEvidenceId,
        providerRecordId: "fetch-failure-first",
        createdAt: "2026-05-28T00:00:00.000Z",
      });
      await seedCandidateMessage({
        context,
        sourceEvidenceId: secondSourceEvidenceId,
        providerRecordId: "fetch-failure-second",
        createdAt: "2026-05-29T00:00:00.000Z",
      });

      const result = await backfillDriveAttachments({
        repositories: context.repositories,
        db: context.db,
        apiClient: createApiClientStub({
          getMessage: ({ messageId }) => {
            if (messageId === "fetch-failure-first") {
              return Promise.reject(new Error("gmail exploded"));
            }

            return Promise.resolve(
              buildGmailMessage(
                messageId,
                buildDriveAnchorHtml({
                  driveFileId: "drive-file-second",
                  filename: "shared-photo.jpg",
                }),
              ),
            );
          },
        }),
        windowStart: "2026-05-01T00:00:00.000Z",
        windowEnd: null,
        execute: true,
        rateLimitMs: 0,
        logger: createLoggerSink(logs),
      });

      expect(result).toMatchObject({
        candidatesScanned: 2,
        driveAttachmentsInserted: 1,
        fetchFailures: 1,
      });
      expect(logs).toContainEqual({
        providerRecordId: "fetch-failure-first",
        sourceEvidenceId: firstSourceEvidenceId,
        capturedMailbox: "volunteers@example.org",
        outcome: "fetch-failed",
        driveAttachmentCount: 0,
        errorMessage: "gmail exploded",
      });
      expect(logs).toContainEqual({
        providerRecordId: "fetch-failure-second",
        sourceEvidenceId: secondSourceEvidenceId,
        capturedMailbox: "volunteers@example.org",
        outcome: "inserted",
        driveAttachmentCount: 1,
      });
      await expect(
        context.repositories.messageAttachments.findByMessageIds([
          firstSourceEvidenceId,
          secondSourceEvidenceId,
        ]),
      ).resolves.toHaveLength(1);
    } finally {
      await context.dispose();
    }
  });

  it("applies the window filter to candidate selection", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedCandidateMessage({
        context,
        sourceEvidenceId: "source-evidence:gmail:message:drive-old",
        providerRecordId: "drive-old",
        createdAt: "2026-04-07T00:00:00.000Z",
      });
      await seedCandidateMessage({
        context,
        sourceEvidenceId: "source-evidence:gmail:message:drive-recent",
        providerRecordId: "drive-recent",
        createdAt: "2026-05-27T00:00:00.000Z",
      });

      const result = await backfillDriveAttachments({
        repositories: context.repositories,
        db: context.db,
        apiClient: createApiClientStub({
          getMessage: ({ messageId }) =>
            Promise.resolve(
              buildGmailMessage(
                messageId,
                buildDriveAnchorHtml({
                  driveFileId: `drive-file-${messageId}`,
                  filename: `${messageId}.pdf`,
                }),
              ),
            ),
        }),
        windowStart: "2026-05-07T00:00:00.000Z",
        windowEnd: null,
        execute: false,
        rateLimitMs: 0,
      });

      expect(result.candidatesScanned).toBe(1);
    } finally {
      await context.dispose();
    }
  });
});
