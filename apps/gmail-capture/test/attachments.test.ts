import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTestStage1Context } from "@as-comms/db/test-helpers";
import {
  buildGmailMessageAttachmentId,
  buildGmailMessageAttachmentStorageKey,
  buildSourceEvidenceId,
  type GmailRecord,
} from "@as-comms/integrations";
import { afterEach, describe, expect, it, vi } from "vitest";

import { syncGmailMessageAttachments } from "../src/attachments.js";

function buildGmailRecord(input: {
  readonly direction: "inbound" | "outbound";
  readonly recordId: string;
  readonly attachmentSizeBytes: number;
}): GmailRecord {
  return {
    recordType: "message",
    recordId: input.recordId,
    direction: input.direction,
    occurredAt: "2026-04-28T16:00:00.000Z",
    receivedAt: "2026-04-28T16:00:00.000Z",
    payloadRef: `gmail://volunteers@example.org/messages/${input.recordId}`,
    checksum: `checksum:${input.recordId}`,
    snippet: "See attached",
    subject: "Attachment test",
    fromHeader:
      input.direction === "outbound"
        ? "Adventure Scientists <volunteers@example.org>"
        : "Volunteer <volunteer@example.org>",
    toHeader:
      input.direction === "outbound"
        ? "Volunteer <volunteer@example.org>"
        : "Adventure Scientists <volunteers@example.org>",
    ccHeader: null,
    labelIds: input.direction === "outbound" ? ["SENT"] : ["INBOX"],
    snippetClean: "See attached",
    bodyTextPreview: "See attached",
    bodyKind: "plaintext",
    dsnOriginalMessageId: null,
    threadId: "thread-1",
    rfc822MessageId: `<${input.recordId}@example.org>`,
    capturedMailbox: "volunteers@example.org",
    projectInboxAlias: "project-oceans@example.org",
    normalizedParticipantEmails: ["volunteer@example.org"],
    salesforceContactId: null,
    volunteerIdPlainValues: [],
    normalizedPhones: [],
    supportingRecords: [],
    crossProviderCollapseKey: null,
    attachmentMetadata: [
      {
        partIndexPath: "0/1",
        mimeType: "image/jpeg",
        filename: "field-photo.jpg",
        sizeBytes: input.attachmentSizeBytes,
        gmailAttachmentId: "gmail-attachment-1",
      },
    ],
  };
}

describe("gmail attachment sync", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes outbound attachment bytes, retries Gmail 5xx responses, and inserts a message_attachments row", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-attachments-"));
    let attachmentFetchAttempts = 0;

    try {
      const record = buildGmailRecord({
        direction: "outbound",
        recordId: "gmail-outbound-1",
        attachmentSizeBytes: 11,
      });
      const attachmentBytes = Buffer.from("hello-image", "utf8");
      const attachmentId = buildGmailMessageAttachmentId({
        messageId: "gmail-outbound-1",
        partIndexPath: "0/1",
      });
      const sourceEvidenceId = buildSourceEvidenceId(
        "gmail",
        "message",
        "gmail-outbound-1",
      );

      await syncGmailMessageAttachments({
        records: [record],
        repositories: context.repositories,
        serviceConfig: {
          liveAccount: "volunteers@example.org",
          oauthClientId: "gmail-oauth-client-id",
          oauthClientSecret: "gmail-oauth-client-secret",
          oauthRefreshToken: "gmail-oauth-refresh-token",
          tokenUri: "https://oauth2.googleapis.com/token",
          timeoutMs: 15_000,
        },
        runtimeConfig: {
          attachmentVolumePath: tempDir,
          maxAttachmentBytesPerAttachment: 52_428_800,
        },
        fetchImplementation: vi.fn((url: string | URL | Request) => {
          const resolvedUrl =
            typeof url === "string"
              ? url
              : url instanceof URL
                ? url.toString()
                : url.url;

          if (resolvedUrl === "https://oauth2.googleapis.com/token") {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  access_token: "access-token",
                  expires_in: 3600,
                }),
                { status: 200 },
              ),
            );
          }

          attachmentFetchAttempts += 1;

          if (attachmentFetchAttempts < 3) {
            return Promise.resolve(new Response("server error", { status: 503 }));
          }

          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: attachmentBytes.toString("base64url"),
                size: attachmentBytes.length,
              }),
              { status: 200 },
            ),
          );
        }) as unknown as typeof fetch,
      });

      expect(attachmentFetchAttempts).toBe(3);
      await expect(
        context.repositories.sourceEvidence.findById(sourceEvidenceId),
      ).resolves.not.toBeNull();
      await expect(
        context.repositories.messageAttachments.findByMessageIds([sourceEvidenceId]),
      ).resolves.toMatchObject([
        {
          id: attachmentId,
          sourceEvidenceId,
          provider: "gmail",
          gmailAttachmentId: "gmail-attachment-1",
          mimeType: "image/jpeg",
          filename: "field-photo.jpg",
          sizeBytes: attachmentBytes.length,
          storageKey: buildGmailMessageAttachmentStorageKey(attachmentId),
        },
      ]);
      await expect(
        readFile(
          path.join(
            tempDir,
            buildGmailMessageAttachmentStorageKey(attachmentId),
          ),
        ),
      ).resolves.toEqual(attachmentBytes);
    } finally {
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("skips attachments that exceed the configured size limit", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-attachments-"));
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "access-token",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      ),
    ) as unknown as typeof fetch;

    try {
      await syncGmailMessageAttachments({
        records: [
          buildGmailRecord({
            direction: "inbound",
            recordId: "gmail-inbound-oversize",
            attachmentSizeBytes: 2_000_000,
          }),
        ],
        repositories: context.repositories,
        serviceConfig: {
          liveAccount: "volunteers@example.org",
          oauthClientId: "gmail-oauth-client-id",
          oauthClientSecret: "gmail-oauth-client-secret",
          oauthRefreshToken: "gmail-oauth-refresh-token",
          tokenUri: "https://oauth2.googleapis.com/token",
          timeoutMs: 15_000,
        },
        runtimeConfig: {
          attachmentVolumePath: tempDir,
          maxAttachmentBytesPerAttachment: 1_000_000,
        },
        fetchImplementation,
      });

      expect(fetchImplementation).not.toHaveBeenCalled();
      await expect(
        context.repositories.messageAttachments.findByMessageIds([
          buildSourceEvidenceId("gmail", "message", "gmail-inbound-oversize"),
        ]),
      ).resolves.toEqual([]);
    } finally {
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
