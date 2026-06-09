import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import {
  buildGmailMessageAttachmentId,
  buildSourceEvidenceId,
} from "@as-comms/integrations";
import { messageAttachments } from "@as-comms/db";

import {
  recomputeAttachmentDecoration,
  type RecomputeAttachmentDecorationLogEntry,
} from "../src/ops/recompute-attachment-decoration.js";
import { createTestWorkerContext } from "./helpers.js";

async function seedAttachmentRow(input: {
  readonly context: Awaited<ReturnType<typeof createTestWorkerContext>>;
  readonly messageId: string;
  readonly createdAt: string;
  readonly filename: string | null;
  readonly mimeType: string;
  readonly isDecoration: boolean;
}): Promise<{
  readonly attachmentId: string;
  readonly sourceEvidenceId: string;
}> {
  const sourceEvidenceId = buildSourceEvidenceId(
    "gmail",
    "message",
    input.messageId,
  );
  const attachmentId = buildGmailMessageAttachmentId({
    messageId: input.messageId,
    partIndexPath: "0/1",
  });

  await input.context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.messageId,
    receivedAt: input.createdAt,
    occurredAt: input.createdAt,
    payloadRef: `gmail://volunteers/messages/${input.messageId}`,
    idempotencyKey: `gmail:message:${input.messageId}`,
    checksum: `checksum:${input.messageId}`,
  });

  await input.context.db.insert(messageAttachments).values({
    id: attachmentId,
    sourceEvidenceId,
    provider: "gmail",
    gmailAttachmentId: `gmail-attachment:${input.messageId}`,
    mimeType: input.mimeType,
    filename: input.filename,
    sizeBytes: 128,
    storageKey: `attachments/${attachmentId}`,
    isDecoration: input.isDecoration,
    createdAt: new Date(input.createdAt),
  });

  return {
    attachmentId,
    sourceEvidenceId,
  };
}

async function readAttachmentDecoration(
  context: Awaited<ReturnType<typeof createTestWorkerContext>>,
  attachmentId: string,
): Promise<boolean | undefined> {
  const [row] = await context.db
    .select({
      isDecoration: messageAttachments.isDecoration,
    })
    .from(messageAttachments)
    .where(eq(messageAttachments.id, attachmentId))
    .limit(1);

  return row?.isDecoration;
}

function createLogger(logs: RecomputeAttachmentDecorationLogEntry[]) {
  return {
    log(value: unknown) {
      if (typeof value === "string" && value.startsWith("{")) {
        logs.push(JSON.parse(value) as RecomputeAttachmentDecorationLogEntry);
      }
    },
    error() {
      return undefined;
    },
  };
}

describe("recompute-attachment-decoration", () => {
  it("reports recompute in dry-run mode without writing the row", async () => {
    const context = await createTestWorkerContext();
    const logs: RecomputeAttachmentDecorationLogEntry[] = [];

    try {
      const seeded = await seedAttachmentRow({
        context,
        messageId: "msg-1",
        createdAt: "2026-05-20T10:00:00.000Z",
        filename: "image001.png",
        mimeType: "image/png",
        isDecoration: false,
      });

      const result = await recomputeAttachmentDecoration({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: false,
        limit: 10_000,
        logger: createLogger(logs),
      });

      expect(result).toMatchObject({
        dryRun: true,
        candidates: 1,
        recomputed: 1,
        unchanged: 0,
      });
      await expect(
        readAttachmentDecoration(context, seeded.attachmentId),
      ).resolves.toBe(false);
      expect(logs).toContainEqual({
        id: seeded.attachmentId,
        action: "recomputed",
        before: false,
        after: true,
        dryRun: true,
      });
    } finally {
      await context.dispose();
    }
  });

  it("writes the updated decoration flag when execute is enabled", async () => {
    const context = await createTestWorkerContext();

    try {
      const seeded = await seedAttachmentRow({
        context,
        messageId: "msg-2",
        createdAt: "2026-05-20T10:00:00.000Z",
        filename: "image001.png",
        mimeType: "image/png",
        isDecoration: false,
      });

      const result = await recomputeAttachmentDecoration({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: true,
        limit: 10_000,
      });

      expect(result).toMatchObject({
        dryRun: false,
        recomputed: 1,
        unchanged: 0,
      });
      await expect(
        readAttachmentDecoration(context, seeded.attachmentId),
      ).resolves.toBe(true);
    } finally {
      await context.dispose();
    }
  });

  it("keeps Karen-shaped image rows as non-decoration", async () => {
    const context = await createTestWorkerContext();

    try {
      const seeded = await seedAttachmentRow({
        context,
        messageId: "msg-3",
        createdAt: "2026-05-20T10:00:00.000Z",
        filename: "trail distance.png",
        mimeType: "image/png",
        isDecoration: false,
      });

      const result = await recomputeAttachmentDecoration({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: true,
        limit: 10_000,
      });

      expect(result).toMatchObject({
        recomputed: 0,
        unchanged: 1,
      });
      await expect(
        readAttachmentDecoration(context, seeded.attachmentId),
      ).resolves.toBe(false);
    } finally {
      await context.dispose();
    }
  });

  it("leaves already-correct decoration rows unchanged", async () => {
    const context = await createTestWorkerContext();

    try {
      const seeded = await seedAttachmentRow({
        context,
        messageId: "msg-4",
        createdAt: "2026-05-20T10:00:00.000Z",
        filename: "image001.png",
        mimeType: "image/png",
        isDecoration: true,
      });

      const result = await recomputeAttachmentDecoration({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: true,
        limit: 10_000,
      });

      expect(result).toMatchObject({
        recomputed: 0,
        unchanged: 1,
      });
      await expect(
        readAttachmentDecoration(context, seeded.attachmentId),
      ).resolves.toBe(true);
    } finally {
      await context.dispose();
    }
  });

  it("leaves non-image attachments unchanged", async () => {
    const context = await createTestWorkerContext();

    try {
      const seeded = await seedAttachmentRow({
        context,
        messageId: "msg-5",
        createdAt: "2026-05-20T10:00:00.000Z",
        filename: "image001.pdf",
        mimeType: "application/pdf",
        isDecoration: false,
      });

      const result = await recomputeAttachmentDecoration({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: true,
        limit: 10_000,
      });

      expect(result).toMatchObject({
        recomputed: 0,
        unchanged: 1,
      });
      await expect(
        readAttachmentDecoration(context, seeded.attachmentId),
      ).resolves.toBe(false);
    } finally {
      await context.dispose();
    }
  });

  it("respects the since/until window", async () => {
    const context = await createTestWorkerContext();
    const logs: RecomputeAttachmentDecorationLogEntry[] = [];

    try {
      const inside = await seedAttachmentRow({
        context,
        messageId: "msg-6",
        createdAt: "2026-05-20T10:00:00.000Z",
        filename: "image001.png",
        mimeType: "image/png",
        isDecoration: false,
      });
      const outside = await seedAttachmentRow({
        context,
        messageId: "msg-7",
        createdAt: "2026-02-20T10:00:00.000Z",
        filename: "image001.png",
        mimeType: "image/png",
        isDecoration: false,
      });

      const result = await recomputeAttachmentDecoration({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: true,
        limit: 10_000,
        logger: createLogger(logs),
      });

      expect(result).toMatchObject({
        candidates: 1,
        recomputed: 1,
        unchanged: 0,
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        id: inside.attachmentId,
        action: "recomputed",
      });
      await expect(
        readAttachmentDecoration(context, inside.attachmentId),
      ).resolves.toBe(true);
      await expect(
        readAttachmentDecoration(context, outside.attachmentId),
      ).resolves.toBe(false);
    } finally {
      await context.dispose();
    }
  });

  it("sets truncated when the candidate set exceeds the limit", async () => {
    const context = await createTestWorkerContext();
    const logs: RecomputeAttachmentDecorationLogEntry[] = [];

    try {
      for (const messageId of ["msg-8", "msg-9", "msg-10"]) {
        await seedAttachmentRow({
          context,
          messageId,
          createdAt: "2026-05-20T10:00:00.000Z",
          filename: "image001.png",
          mimeType: "image/png",
          isDecoration: false,
        });
      }

      const result = await recomputeAttachmentDecoration({
        db: context.db,
        since: "2026-05-01T00:00:00.000Z",
        until: "2026-05-29T23:59:59.999Z",
        execute: false,
        limit: 2,
        logger: createLogger(logs),
      });

      expect(result).toMatchObject({
        candidates: 2,
        recomputed: 2,
        truncated: true,
      });
      expect(logs).toHaveLength(2);
    } finally {
      await context.dispose();
    }
  });
});
