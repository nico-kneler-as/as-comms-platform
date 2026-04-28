import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { createStage1RepositoryBundleFromConnection } from "@as-comms/db";
import {
  buildGmailMessageAttachmentId,
  buildGmailMessageAttachmentStorageKey,
  exchangeGmailAccessToken,
  gmailMessageRecordSchema,
  mapGmailRecord,
  type GmailAccessTokenCacheEntry,
  type GmailRecord,
} from "@as-comms/integrations";
import { z } from "zod";

const gmailAttachmentResponseSchema = z.object({
  data: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
});

export const gmailAttachmentRuntimeConfigSchema = z.object({
  attachmentVolumePath: z.string().min(1),
  maxAttachmentBytesPerAttachment: z.number().int().positive(),
});
export type GmailAttachmentRuntimeConfig = z.infer<
  typeof gmailAttachmentRuntimeConfigSchema
>;

interface GmailServiceOAuthConfig {
  readonly liveAccount: string;
  readonly oauthClientId: string;
  readonly oauthClientSecret: string;
  readonly oauthRefreshToken: string;
  readonly tokenUri: string;
  readonly timeoutMs: number;
}

type AttachmentRepositories = Pick<
  ReturnType<typeof createStage1RepositoryBundleFromConnection>,
  "messageAttachments" | "sourceEvidence"
>;

interface AttachmentLogger {
  warn(message: string, metadata?: Record<string, unknown>): void;
}

interface CachedAttachmentBytes {
  readonly bytes: Buffer;
  readonly sizeBytes: number;
}

const attachmentLogger: AttachmentLogger = {
  warn(message, metadata) {
    console.warn(message, metadata);
  },
};

function decodeBase64Url(value: string): Buffer {
  const paddedValue =
    value.replace(/-/gu, "+").replace(/_/gu, "/") +
    "=".repeat((4 - (value.length % 4 || 4)) % 4);

  return Buffer.from(paddedValue, "base64");
}

function resolveAbsoluteAttachmentPath(input: {
  readonly attachmentVolumePath: string;
  readonly storageKey: string;
}): string {
  const volumeRoot = path.resolve(input.attachmentVolumePath);
  const absolutePath = path.resolve(volumeRoot, input.storageKey);

  if (
    absolutePath !== volumeRoot &&
    !absolutePath.startsWith(`${volumeRoot}${path.sep}`)
  ) {
    throw new Error("Resolved attachment path escapes the configured volume.");
  }

  return absolutePath;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildAttachmentFetchUrl(input: {
  readonly mailbox: string;
  readonly messageId: string;
  readonly gmailAttachmentId: string;
}): string {
  return `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(input.mailbox)}/messages/${encodeURIComponent(input.messageId)}/attachments/${encodeURIComponent(input.gmailAttachmentId)}`;
}

async function fetchGmailAttachmentBytes(input: {
  readonly mailbox: string;
  readonly messageId: string;
  readonly gmailAttachmentId: string;
  readonly oauth: GmailServiceOAuthConfig;
  readonly fetchImplementation: typeof fetch;
  readonly now: () => Date;
  readonly accessTokenCache: Map<string, GmailAccessTokenCacheEntry>;
  readonly logger: AttachmentLogger;
}): Promise<CachedAttachmentBytes | null> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const token = await exchangeGmailAccessToken({
      config: {
        oauthClient: {
          clientId: input.oauth.oauthClientId,
          clientSecret: input.oauth.oauthClientSecret,
          tokenUri: input.oauth.tokenUri,
        },
        oauthRefreshToken: input.oauth.oauthRefreshToken,
        timeoutMs: input.oauth.timeoutMs,
      },
      cacheKey: input.mailbox,
      fetchImplementation: input.fetchImplementation,
      now: input.now,
      accessTokenCache: input.accessTokenCache,
    });

    let response: Response;
    try {
      response = await input.fetchImplementation(
        buildAttachmentFetchUrl({
          mailbox: input.mailbox,
          messageId: input.messageId,
          gmailAttachmentId: input.gmailAttachmentId,
        }),
        {
          headers: {
            authorization: `Bearer ${token.accessToken}`,
            accept: "application/json",
          },
          signal: AbortSignal.timeout(input.oauth.timeoutMs),
        },
      );
    } catch (error) {
      if (attempt < maxAttempts) {
        await sleep(150 * attempt);
        continue;
      }

      input.logger.warn("Skipping Gmail attachment after network failure.", {
        mailbox: input.mailbox,
        messageId: input.messageId,
        gmailAttachmentId: input.gmailAttachmentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (response.status >= 500) {
      if (attempt < maxAttempts) {
        await sleep(150 * attempt);
        continue;
      }

      input.logger.warn("Skipping Gmail attachment after repeated 5xx errors.", {
        mailbox: input.mailbox,
        messageId: input.messageId,
        gmailAttachmentId: input.gmailAttachmentId,
        status: response.status,
      });
      return null;
    }

    if (!response.ok) {
      input.logger.warn("Skipping Gmail attachment after non-retryable fetch failure.", {
        mailbox: input.mailbox,
        messageId: input.messageId,
        gmailAttachmentId: input.gmailAttachmentId,
        status: response.status,
      });
      return null;
    }

    const parsed = gmailAttachmentResponseSchema.parse(
      JSON.parse(await response.text()),
    );
    const bytes = decodeBase64Url(parsed.data);

    return {
      bytes,
      sizeBytes: parsed.size ?? bytes.length,
    };
  }

  return null;
}

export async function syncGmailMessageAttachments(input: {
  readonly records: readonly GmailRecord[];
  readonly repositories: AttachmentRepositories;
  readonly serviceConfig: GmailServiceOAuthConfig;
  readonly runtimeConfig: GmailAttachmentRuntimeConfig;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => Date;
  readonly logger?: AttachmentLogger;
}): Promise<void> {
  const parsedRuntimeConfig = gmailAttachmentRuntimeConfigSchema.parse(
    input.runtimeConfig,
  );
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;
  const now = input.now ?? (() => new Date());
  const logger = input.logger ?? attachmentLogger;
  const accessTokenCache = new Map<string, GmailAccessTokenCacheEntry>();

  if (typeof fetchImplementation !== "function") {
    throw new Error("Global fetch is unavailable for Gmail attachment capture.");
  }

  for (const record of input.records) {
    const parsedRecord = gmailMessageRecordSchema.safeParse(record);

    if (!parsedRecord.success || parsedRecord.data.attachmentMetadata.length === 0) {
      continue;
    }

    const mapped = mapGmailRecord(parsedRecord.data);
    if (mapped.outcome !== "command" || mapped.command.kind !== "canonical_event") {
      continue;
    }

    const sourceEvidence = mapped.command.input.sourceEvidence;

    try {
      await input.repositories.sourceEvidence.append(sourceEvidence);
    } catch {
      const existing = await input.repositories.sourceEvidence.findById(
        sourceEvidence.id,
      );

      if (existing === null) {
        throw new Error(
          `Unable to establish source evidence for Gmail attachment capture: ${sourceEvidence.id}`,
        );
      }
    }

    const existingAttachments =
      await input.repositories.messageAttachments.findByMessageIds([
        sourceEvidence.id,
      ]);
    const existingAttachmentIds = new Set(
      existingAttachments.map((attachment) => attachment.id),
    );
    const rowsToInsert: {
      readonly id: string;
      readonly provider: "gmail";
      readonly gmailAttachmentId: string;
      readonly mimeType: string;
      readonly filename: string | null;
      readonly sizeBytes: number;
      readonly storageKey: string;
    }[] = [];

    for (const attachment of parsedRecord.data.attachmentMetadata) {
      const attachmentId = buildGmailMessageAttachmentId({
        messageId: parsedRecord.data.recordId,
        partIndexPath: attachment.partIndexPath,
      });

      if (existingAttachmentIds.has(attachmentId)) {
        continue;
      }

      if (
        attachment.sizeBytes > parsedRuntimeConfig.maxAttachmentBytesPerAttachment
      ) {
        logger.warn("Skipping Gmail attachment over size limit.", {
          attachmentId,
          messageId: parsedRecord.data.recordId,
          sizeBytes: attachment.sizeBytes,
        });
        continue;
      }

      const cachedAttachment = await fetchGmailAttachmentBytes({
        mailbox: parsedRecord.data.capturedMailbox ?? input.serviceConfig.liveAccount,
        messageId: parsedRecord.data.recordId,
        gmailAttachmentId: attachment.gmailAttachmentId,
        oauth: input.serviceConfig,
        fetchImplementation,
        now,
        accessTokenCache,
        logger,
      });

      if (cachedAttachment === null) {
        continue;
      }

      if (
        cachedAttachment.sizeBytes >
        parsedRuntimeConfig.maxAttachmentBytesPerAttachment
      ) {
        logger.warn("Skipping Gmail attachment after fetch due to size limit.", {
          attachmentId,
          messageId: parsedRecord.data.recordId,
          sizeBytes: cachedAttachment.sizeBytes,
        });
        continue;
      }

      const storageKey = buildGmailMessageAttachmentStorageKey(attachmentId);
      const absolutePath = resolveAbsoluteAttachmentPath({
        attachmentVolumePath: parsedRuntimeConfig.attachmentVolumePath,
        storageKey,
      });

      try {
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, cachedAttachment.bytes);
      } catch (error) {
        logger.warn("Skipping Gmail attachment after disk write failure.", {
          attachmentId,
          messageId: parsedRecord.data.recordId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      rowsToInsert.push({
        id: attachmentId,
        provider: "gmail",
        gmailAttachmentId: attachment.gmailAttachmentId,
        mimeType: attachment.mimeType,
        filename: attachment.filename,
        sizeBytes: cachedAttachment.sizeBytes,
        storageKey,
      });
    }

    await input.repositories.messageAttachments.upsertManyForMessage(
      sourceEvidence.id,
      rowsToInsert,
    );
  }
}
