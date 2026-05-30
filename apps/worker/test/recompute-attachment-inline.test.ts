import { describe, expect, it } from "vitest";

import {
  buildGmailMessageAttachmentId,
  buildSourceEvidenceId,
  type GmailMessageMetadata,
} from "@as-comms/integrations";
import { messageAttachments } from "@as-comms/db";

import {
  recomputeAttachmentInline,
  type RecomputeAttachmentInlineLogEntry,
} from "../src/ops/recompute-attachment-inline.js";
import { createTestWorkerContext } from "./helpers.js";

function buildAttachmentPayload(input: {
  readonly gmailAttachmentId: string;
  readonly contentDisposition: string;
  readonly contentId?: string;
  readonly attachmentAtRoot?: boolean;
}): GmailMessageMetadata["payload"] {
  const html = input.contentId
    ? `<html><body><img src="cid:${input.contentId.replace(/^<|>$/gu, "")}" /></body></html>`
    : "<html><body><p>No inline image</p></body></html>";

  return {
    mimeType: "multipart/related",
    filename: "",
    headers: [
      {
        name: "Content-Type",
        value: 'multipart/related; boundary="boundary-1"',
      },
    ],
    body: {
      size: 0,
    },
    parts: input.attachmentAtRoot
      ? [
          {
            mimeType: "text/html",
            filename: "",
            headers: [
              {
                name: "Content-Type",
                value: "text/html; charset=UTF-8",
              },
            ],
            body: {
              data: Buffer.from(html, "utf8").toString("base64url"),
              size: html.length,
            },
            parts: [],
          },
        ]
      : [
          {
            mimeType: "text/html",
            filename: "",
            headers: [
              {
                name: "Content-Type",
                value: "text/html; charset=UTF-8",
              },
            ],
            body: {
              data: Buffer.from(html, "utf8").toString("base64url"),
              size: html.length,
            },
            parts: [],
          },
          {
            mimeType: "image/png",
            filename: "screenshot.png",
            headers: [
              {
                name: "Content-Type",
                value: 'image/png; name="screenshot.png"',
              },
              {
                name: "Content-Disposition",
                value: input.contentDisposition,
              },
              ...(input.contentId === undefined
                ? []
                : [
                    {
                      name: "Content-ID",
                      value: input.contentId,
                    },
                  ]),
            ],
            body: {
              attachmentId: input.gmailAttachmentId,
              size: 128,
            },
            parts: [],
          },
        ],
  };
}

function buildMessageMetadata(input: {
  readonly messageId: string;
  readonly gmailAttachmentId: string;
  readonly contentDisposition: string;
  readonly contentId?: string;
  readonly attachmentAtRoot?: boolean;
}): GmailMessageMetadata {
  return {
    id: input.messageId,
    threadId: `thread:${input.messageId}`,
    labelIds: ["INBOX"],
    snippet: "Quoted screenshot",
    internalDate: String(Date.parse("2026-05-20T10:00:00.000Z")),
    payload: buildAttachmentPayload(input),
  };
}

async function seedGmailMessageContext(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly sourceEvidenceId: string;
  readonly messageId: string;
  readonly createdAt: string;
  readonly mimeType?: string;
  readonly gmailAttachmentId?: string;
  readonly partIndexPath?: string;
}): Promise<{
  readonly attachmentId: string;
  readonly gmailAttachmentId: string;
  readonly partIndexPath: string;
}> {
  const gmailAttachmentId = input.gmailAttachmentId ?? "gmail-attachment-1";
  const partIndexPath = input.partIndexPath ?? "1";
  const attachmentId = buildGmailMessageAttachmentId({
    messageId: input.messageId,
    partIndexPath,
  });

  await input.context.repositories.sourceEvidence.append({
    id: input.sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.messageId,
    receivedAt: input.createdAt,
    occurredAt: input.createdAt,
    payloadRef: `gmail://volunteers/messages/${input.messageId}`,
    idempotencyKey: `gmail:message:${input.messageId}`,
    checksum: `checksum:${input.messageId}`,
  });

  await input.context.repositories.gmailMessageDetails.upsert({
    sourceEvidenceId: input.sourceEvidenceId,
    providerRecordId: input.messageId,
    gmailThreadId: `thread:${input.messageId}`,
    rfc822MessageId: `<${input.messageId}@example.test>`,
    direction: "inbound",
    subject: "Screenshot follow-up",
    fromHeader: "Michael Gast <michael@example.com>",
    toHeader: "volunteers@adventurescientists.org",
    ccHeader: null,
    fromEmails: [],
    toEmails: [],
    ccEmails: [],
    bccEmails: [],
    labelIds: ["INBOX"],
    snippetClean: "Quoted screenshot",
    bodyTextPreview: "Quoted screenshot",
    bodyKind: "plaintext",
    capturedMailbox: "volunteers@adventurescientists.org",
    projectInboxAlias: null,
  });

  await input.context.db.insert(messageAttachments).values({
    id: attachmentId,
    sourceEvidenceId: input.sourceEvidenceId,
    provider: "gmail",
    gmailAttachmentId,
    mimeType: input.mimeType ?? "image/png",
    filename: "screenshot.png",
    sizeBytes: 128,
    storageKey: `attachments/${attachmentId}`,
    isInline: false,
    createdAt: new Date(input.createdAt),
  });

  return {
    attachmentId,
    gmailAttachmentId,
    partIndexPath,
  };
}

function createLogger(logs: RecomputeAttachmentInlineLogEntry[]) {
  return {
    log(value: unknown) {
      if (typeof value === "string" && value.startsWith("{")) {
        logs.push(JSON.parse(value) as RecomputeAttachmentInlineLogEntry);
      }
    },
    error() {
      return undefined;
    },
  };
}

describe("recompute-attachment-inline", () => {
  it("reports recompute in dry-run mode without writing the row", async () => {
    const context = await createTestWorkerContext();
    const logs: RecomputeAttachmentInlineLogEntry[] = [];

    try {
      const sourceEvidenceId = buildSourceEvidenceId("gmail", "message", "msg-1");
      const seeded = await seedGmailMessageContext({
        context,
        sourceEvidenceId,
        messageId: "msg-1",
        createdAt: "2026-05-20T10:00:00.000Z",
      });

      const result = await recomputeAttachmentInline({
        db: context.db,
        repositories: context.repositories,
        apiClient: {
          listMessageIds: () => Promise.resolve([]),
          getMessage: () =>
            Promise.resolve(
              buildMessageMetadata({
                messageId: "msg-1",
                gmailAttachmentId: "ephemeral-live-id-1",
                contentDisposition: "inline",
                contentId: "<inline-image-1>",
              }),
            ),
        },
        mailbox: "volunteers@adventurescientists.org",
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: false,
        limit: 1000,
        logger: createLogger(logs),
      });

      expect(result).toMatchObject({
        dryRun: true,
        candidates: 1,
        recomputed: 1,
      });
      await expect(
        context.repositories.messageAttachments.findById(seeded.attachmentId),
      ).resolves.toMatchObject({
        isInline: false,
      });
      expect(logs).toContainEqual({
        id: seeded.attachmentId,
        sourceEvidenceId,
        gmailAttachmentId: seeded.gmailAttachmentId,
        action: "recomputed",
        before: false,
        after: true,
        dryRun: true,
      });
    } finally {
      await context.dispose();
    }
  });

  it("writes the updated inline flag when execute is enabled", async () => {
    const context = await createTestWorkerContext();

    try {
      const sourceEvidenceId = buildSourceEvidenceId("gmail", "message", "msg-2");
      const seeded = await seedGmailMessageContext({
        context,
        sourceEvidenceId,
        messageId: "msg-2",
        createdAt: "2026-05-20T10:00:00.000Z",
      });

      const result = await recomputeAttachmentInline({
        db: context.db,
        repositories: context.repositories,
        apiClient: {
          listMessageIds: () => Promise.resolve([]),
          getMessage: () =>
            Promise.resolve(
              buildMessageMetadata({
                messageId: "msg-2",
                gmailAttachmentId: "ephemeral-live-id-2",
                contentDisposition: "inline",
                contentId: "<inline-image-2>",
              }),
            ),
        },
        mailbox: "volunteers@adventurescientists.org",
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: true,
        limit: 1000,
      });

      expect(result).toMatchObject({
        dryRun: false,
        recomputed: 1,
      });
      await expect(
        context.repositories.messageAttachments.findById(seeded.attachmentId),
      ).resolves.toMatchObject({
        isInline: true,
      });
    } finally {
      await context.dispose();
    }
  });

  it("leaves non-inline attachments unchanged", async () => {
    const context = await createTestWorkerContext();

    try {
      const sourceEvidenceId = buildSourceEvidenceId("gmail", "message", "msg-3");
      const seeded = await seedGmailMessageContext({
        context,
        sourceEvidenceId,
        messageId: "msg-3",
        createdAt: "2026-05-20T10:00:00.000Z",
      });

      const result = await recomputeAttachmentInline({
        db: context.db,
        repositories: context.repositories,
        apiClient: {
          listMessageIds: () => Promise.resolve([]),
          getMessage: () =>
            Promise.resolve(
              buildMessageMetadata({
                messageId: "msg-3",
                gmailAttachmentId: "ephemeral-live-id-3",
                contentDisposition: "attachment",
              }),
            ),
        },
        mailbox: "volunteers@adventurescientists.org",
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: true,
        limit: 1000,
      });

      expect(result).toMatchObject({
        unchanged: 1,
        recomputed: 0,
      });
      await expect(
        context.repositories.messageAttachments.findById(seeded.attachmentId),
      ).resolves.toMatchObject({
        isInline: false,
      });
    } finally {
      await context.dispose();
    }
  });

  it("does not consider non-image attachments as candidates", async () => {
    const context = await createTestWorkerContext();

    try {
      await seedGmailMessageContext({
        context,
        sourceEvidenceId: buildSourceEvidenceId("gmail", "message", "msg-4"),
        messageId: "msg-4",
        createdAt: "2026-05-20T10:00:00.000Z",
        mimeType: "application/pdf",
      });

      const result = await recomputeAttachmentInline({
        db: context.db,
        repositories: context.repositories,
        apiClient: {
          listMessageIds: () => Promise.resolve([]),
          getMessage: () => Promise.resolve(null),
        },
        mailbox: "volunteers@adventurescientists.org",
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: false,
        limit: 1000,
      });

      expect(result).toMatchObject({
        candidates: 0,
        recomputed: 0,
      });
    } finally {
      await context.dispose();
    }
  });

  it("skips rows whose Gmail message is no longer available", async () => {
    const context = await createTestWorkerContext();
    const logs: RecomputeAttachmentInlineLogEntry[] = [];

    try {
      const sourceEvidenceId = buildSourceEvidenceId("gmail", "message", "msg-5");
      const seeded = await seedGmailMessageContext({
        context,
        sourceEvidenceId,
        messageId: "msg-5",
        createdAt: "2026-05-20T10:00:00.000Z",
      });

      const result = await recomputeAttachmentInline({
        db: context.db,
        repositories: context.repositories,
        apiClient: {
          listMessageIds: () => Promise.resolve([]),
          getMessage: () => Promise.resolve(null),
        },
        mailbox: "volunteers@adventurescientists.org",
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: false,
        limit: 1000,
        logger: createLogger(logs),
      });

      expect(result).toMatchObject({
        skipped: 1,
      });
      expect(logs).toContainEqual({
        id: seeded.attachmentId,
        sourceEvidenceId,
        gmailAttachmentId: seeded.gmailAttachmentId,
        action: "skipped",
        reason: "gmail_message_not_found",
      });
    } finally {
      await context.dispose();
    }
  });

  it("recomputes when the live Gmail attachment id changed but partIndexPath stayed stable", async () => {
    const context = await createTestWorkerContext();

    try {
      const sourceEvidenceId = buildSourceEvidenceId("gmail", "message", "msg-ephemeral");
      const seeded = await seedGmailMessageContext({
        context,
        sourceEvidenceId,
        messageId: "msg-ephemeral",
        createdAt: "2026-05-20T10:00:00.000Z",
        gmailAttachmentId: "OLD_ID",
      });

      const result = await recomputeAttachmentInline({
        db: context.db,
        repositories: context.repositories,
        apiClient: {
          listMessageIds: () => Promise.resolve([]),
          getMessage: () =>
            Promise.resolve(
              buildMessageMetadata({
                messageId: "msg-ephemeral",
                gmailAttachmentId: "NEW_ID",
                contentDisposition: "inline",
                contentId: "<inline-image-ephemeral>",
              }),
            ),
        },
        mailbox: "volunteers@adventurescientists.org",
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: true,
        limit: 1000,
      });

      expect(result).toMatchObject({
        recomputed: 1,
        skipped: 0,
      });
      await expect(
        context.repositories.messageAttachments.findById(seeded.attachmentId),
      ).resolves.toMatchObject({
        gmailAttachmentId: "OLD_ID",
        isInline: true,
      });
    } finally {
      await context.dispose();
    }
  });

  it("skips rows when the partIndexPath is no longer present in the live Gmail message", async () => {
    const context = await createTestWorkerContext();
    const logs: RecomputeAttachmentInlineLogEntry[] = [];

    try {
      const sourceEvidenceId = buildSourceEvidenceId("gmail", "message", "msg-missing-part");
      const seeded = await seedGmailMessageContext({
        context,
        sourceEvidenceId,
        messageId: "msg-missing-part",
        createdAt: "2026-05-20T10:00:00.000Z",
      });

      const result = await recomputeAttachmentInline({
        db: context.db,
        repositories: context.repositories,
        apiClient: {
          listMessageIds: () => Promise.resolve([]),
          getMessage: () =>
            Promise.resolve(
              buildMessageMetadata({
                messageId: "msg-missing-part",
                gmailAttachmentId: "other-live-id",
                contentDisposition: "inline",
                contentId: "<inline-image-missing-part>",
                attachmentAtRoot: true,
              }),
            ),
        },
        mailbox: "volunteers@adventurescientists.org",
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: false,
        limit: 1000,
        logger: createLogger(logs),
      });

      expect(result).toMatchObject({
        skipped: 1,
        recomputed: 0,
      });
      expect(logs).toContainEqual({
        id: seeded.attachmentId,
        sourceEvidenceId,
        gmailAttachmentId: seeded.gmailAttachmentId,
        action: "skipped",
        reason: "attachment_not_in_message",
      });
    } finally {
      await context.dispose();
    }
  });

  it("respects the since/until window", async () => {
    const context = await createTestWorkerContext();

    try {
      const inside = await seedGmailMessageContext({
        context,
        sourceEvidenceId: buildSourceEvidenceId("gmail", "message", "msg-6"),
        messageId: "msg-6",
        createdAt: "2026-05-20T10:00:00.000Z",
      });
      await seedGmailMessageContext({
        context,
        sourceEvidenceId: buildSourceEvidenceId("gmail", "message", "msg-7"),
        messageId: "msg-7",
        createdAt: "2026-02-20T10:00:00.000Z",
      });

      const result = await recomputeAttachmentInline({
        db: context.db,
        repositories: context.repositories,
        apiClient: {
          listMessageIds: () => Promise.resolve([]),
          getMessage: ({ messageId }: { readonly messageId: string }) =>
            Promise.resolve(
              buildMessageMetadata({
                messageId,
                gmailAttachmentId: inside.gmailAttachmentId,
                contentDisposition: "inline",
                contentId: "<inline-image-6>",
              }),
            ),
        },
        mailbox: "volunteers@adventurescientists.org",
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: false,
        limit: 1000,
      });

      expect(result).toMatchObject({
        candidates: 1,
        recomputed: 1,
      });
    } finally {
      await context.dispose();
    }
  });
});
