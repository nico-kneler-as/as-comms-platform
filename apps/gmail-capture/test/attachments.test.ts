import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTestStage1Context } from "@as-comms/db/test-helpers";
import {
  buildGmailMessageAttachmentId,
  buildGmailMessageDriveAttachmentId,
  buildGmailMessageAttachmentStorageKey,
  buildSourceEvidenceId,
  classifyAttachment,
  type GmailRecord,
} from "@as-comms/integrations";
import { afterEach, describe, expect, it, vi } from "vitest";

import { syncGmailMessageAttachments } from "../src/attachments.js";

type GmailMessageRecord = Extract<GmailRecord, { recordType: "message" }>;

function buildGmailRecord(input: {
  readonly direction: "inbound" | "outbound";
  readonly recordId: string;
  readonly attachmentSizeBytes?: number;
  readonly mimeType?: string;
  readonly filename?: string | null;
  readonly attachmentMetadata?: GmailMessageRecord["attachmentMetadata"];
  readonly driveAttachmentMetadata?: GmailMessageRecord["driveAttachmentMetadata"];
}): GmailMessageRecord {
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
    fromEmails:
      input.direction === "outbound"
        ? ["volunteers@example.org"]
        : ["volunteer@example.org"],
    toEmails:
      input.direction === "outbound"
        ? ["volunteer@example.org"]
        : ["volunteers@example.org"],
    ccEmails: [],
    bccEmails: [],
    salesforceContactId: null,
    volunteerIdPlainValues: [],
    normalizedPhones: [],
    supportingRecords: [],
    crossProviderCollapseKey: null,
    attachmentMetadata: input.attachmentMetadata ?? [
      {
        partIndexPath: "0/1",
        mimeType: input.mimeType ?? "image/jpeg",
        filename: input.filename ?? "field-photo.jpg",
        sizeBytes: input.attachmentSizeBytes ?? 0,
        gmailAttachmentId: "gmail-attachment-1",
        contentDisposition: null,
        contentId: null,
      },
    ],
    driveAttachmentMetadata: input.driveAttachmentMetadata ?? [],
    htmlBodyCidReferences: [],
  };
}

function buildSuccessfulFetchImplementation(
  attachmentBytes: Buffer,
): typeof fetch {
  return vi.fn((url: string | URL | Request) => {
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

    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: attachmentBytes.toString("base64url"),
          size: attachmentBytes.length,
        }),
        { status: 200 },
      ),
    );
  }) as unknown as typeof fetch;
}

describe("classifyAttachment", () => {
  it.each([
    {
      input: { filename: "trail distance.png", mimeType: "image/png" },
      expected: { isDecoration: false },
    },
    {
      input: {
        filename: "Screenshot 2026-05-27 at 11.26.38 AM.png",
        mimeType: "image/png",
      },
      expected: { isDecoration: false },
    },
    {
      input: { filename: "image001.png", mimeType: "image/png" },
      expected: { isDecoration: true },
    },
    {
      input: { filename: "image.jpg", mimeType: "image/jpeg" },
      expected: { isDecoration: true },
    },
    {
      input: { filename: "ATT00001.png", mimeType: "image/png" },
      expected: { isDecoration: true },
    },
    {
      input: { filename: "noname", mimeType: "image/png" },
      expected: { isDecoration: true },
    },
    {
      input: { filename: null, mimeType: "image/png" },
      expected: { isDecoration: true },
    },
    {
      input: { filename: "  ", mimeType: "image/png" },
      expected: { isDecoration: true },
    },
    {
      input: { filename: "report.pdf", mimeType: "application/pdf" },
      expected: { isDecoration: false },
    },
    {
      input: { filename: "image001.png", mimeType: "application/pdf" },
      expected: { isDecoration: false },
    },
    {
      input: { filename: "IMAGE001.PNG", mimeType: "IMAGE/PNG" },
      expected: { isDecoration: true },
    },
  ])("classifies $input.filename / $input.mimeType", ({ input, expected }) => {
    expect(classifyAttachment(input)).toEqual(expected);
  });
});

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
          externalUrl: null,
          isDecoration: false,
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

  it("writes isDecoration for decoration placeholders", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-attachments-"));
    const attachmentBytes = Buffer.from("inline-image", "utf8");
    const sourceEvidenceId = buildSourceEvidenceId(
      "gmail",
      "message",
      "gmail-decoration-1",
    );

    try {
      await syncGmailMessageAttachments({
        records: [
          buildGmailRecord({
            direction: "inbound",
            recordId: "gmail-decoration-1",
            attachmentSizeBytes: attachmentBytes.length,
            mimeType: "image/png",
            filename: "image001.png",
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
          maxAttachmentBytesPerAttachment: 52_428_800,
        },
        fetchImplementation: buildSuccessfulFetchImplementation(attachmentBytes),
      });

      await expect(
        context.repositories.messageAttachments.findByMessageIds([sourceEvidenceId]),
      ).resolves.toMatchObject([
        {
          sourceEvidenceId,
          filename: "image001.png",
          externalUrl: null,
          isDecoration: true,
        },
      ]);
    } finally {
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("captures a Drive attachment as a drive provider row without fetching Gmail bytes", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-attachments-"));
    const fetchImplementation = vi.fn();
    const sourceEvidenceId = buildSourceEvidenceId(
      "gmail",
      "message",
      "gmail-drive-only-1",
    );
    const driveAttachmentId = buildGmailMessageDriveAttachmentId({
      messageId: "gmail-drive-only-1",
      driveFileId: "drive-file-1",
    });

    try {
      await syncGmailMessageAttachments({
        records: [
          buildGmailRecord({
            direction: "inbound",
            recordId: "gmail-drive-only-1",
            attachmentMetadata: [],
            driveAttachmentMetadata: [
              {
                driveFileId: "drive-file-1",
                driveUrl: "https://drive.google.com/file/d/drive-file-1/view",
                filename: "shared-photo.jpg",
              },
            ],
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
          maxAttachmentBytesPerAttachment: 52_428_800,
        },
        fetchImplementation: fetchImplementation as unknown as typeof fetch,
      });

      expect(fetchImplementation).not.toHaveBeenCalled();
      await expect(
        context.repositories.messageAttachments.findByMessageIds([sourceEvidenceId]),
      ).resolves.toMatchObject([
        {
          id: driveAttachmentId,
          sourceEvidenceId,
          provider: "drive",
          gmailAttachmentId: null,
          mimeType: "application/octet-stream",
          filename: "shared-photo.jpg",
          sizeBytes: 0,
          storageKey: null,
          externalUrl: "https://drive.google.com/file/d/drive-file-1/view",
          isDecoration: false,
        },
      ]);
    } finally {
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("captures Gmail and Drive attachments in one batch", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-attachments-"));
    const attachmentBytes = Buffer.from("hello-image", "utf8");
    const sourceEvidenceId = buildSourceEvidenceId(
      "gmail",
      "message",
      "gmail-mixed-1",
    );
    const gmailAttachmentId = buildGmailMessageAttachmentId({
      messageId: "gmail-mixed-1",
      partIndexPath: "0/1",
    });
    const driveAttachmentId = buildGmailMessageDriveAttachmentId({
      messageId: "gmail-mixed-1",
      driveFileId: "drive-file-2",
    });

    try {
      await syncGmailMessageAttachments({
        records: [
          buildGmailRecord({
            direction: "inbound",
            recordId: "gmail-mixed-1",
            attachmentSizeBytes: attachmentBytes.length,
            driveAttachmentMetadata: [
              {
                driveFileId: "drive-file-2",
                driveUrl: "https://drive.google.com/file/d/drive-file-2/view",
                filename: "field-notes.pdf",
              },
            ],
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
          maxAttachmentBytesPerAttachment: 52_428_800,
        },
        fetchImplementation: buildSuccessfulFetchImplementation(attachmentBytes),
      });

      await expect(
        context.repositories.messageAttachments.findByMessageIds([sourceEvidenceId]),
      ).resolves.toMatchObject([
        {
          id: driveAttachmentId,
          provider: "drive",
          externalUrl: "https://drive.google.com/file/d/drive-file-2/view",
        },
        {
          id: gmailAttachmentId,
          provider: "gmail",
          externalUrl: null,
        },
      ]);
    } finally {
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not create Drive rows when driveAttachmentMetadata is empty", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-attachments-"));
    const attachmentBytes = Buffer.from("hello-image", "utf8");
    const sourceEvidenceId = buildSourceEvidenceId(
      "gmail",
      "message",
      "gmail-no-drive-1",
    );

    try {
      await syncGmailMessageAttachments({
        records: [
          buildGmailRecord({
            direction: "inbound",
            recordId: "gmail-no-drive-1",
            attachmentSizeBytes: attachmentBytes.length,
            driveAttachmentMetadata: [],
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
          maxAttachmentBytesPerAttachment: 52_428_800,
        },
        fetchImplementation: buildSuccessfulFetchImplementation(attachmentBytes),
      });

      await expect(
        context.repositories.messageAttachments.findByMessageIds([sourceEvidenceId]),
      ).resolves.toMatchObject([
        {
          provider: "gmail",
          externalUrl: null,
        },
      ]);
      await expect(
        context.repositories.messageAttachments.findByMessageIds([sourceEvidenceId]),
      ).resolves.toHaveLength(1);
    } finally {
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
