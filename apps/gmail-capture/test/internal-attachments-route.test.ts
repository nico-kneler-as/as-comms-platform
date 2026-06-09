import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import type { DatabaseConnection } from "@as-comms/db";
import { createTestStage1Context } from "@as-comms/db/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readGmailCaptureRuntimeConfig,
  startGmailCaptureServer,
} from "../src/index.js";

function createConfig(attachmentVolumePath: string) {
  const config = readGmailCaptureRuntimeConfig({
    GMAIL_CAPTURE_TOKEN: "gmail-token",
    GMAIL_LIVE_ACCOUNT: "volunteers@adventurescientists.org",
    GMAIL_PROJECT_INBOX_ALIASES:
      "project-antarctica@example.org,project-oceans@example.org",
    GMAIL_GOOGLE_OAUTH_CLIENT_ID: "gmail-oauth-client-id",
    GMAIL_GOOGLE_OAUTH_CLIENT_SECRET: "gmail-oauth-client-secret",
    GMAIL_GOOGLE_OAUTH_REFRESH_TOKEN: "gmail-oauth-refresh-token",
  });

  return {
    ...config,
    port: 0,
    attachments: {
      ...config.attachments,
      attachmentVolumePath,
    },
  };
}

function createTestConnection(
  context: Awaited<ReturnType<typeof createTestStage1Context>>,
): DatabaseConnection {
  return {
    db: context.db,
    sql: {
      end: () => Promise.resolve(0),
    },
  } as unknown as DatabaseConnection;
}

async function closeServer(server: Awaited<ReturnType<typeof startGmailCaptureServer>>) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function seedAttachment(input: {
  readonly context: Awaited<ReturnType<typeof createTestStage1Context>>;
  readonly id: string;
  readonly storageKey: string;
  readonly mimeType?: string;
  readonly filename?: string | null;
  readonly sizeBytes: number;
}) {
  const sourceEvidenceId = `source:${input.id}`;

  await input.context.repositories.sourceEvidence.append({
    id: sourceEvidenceId,
    provider: "gmail",
    providerRecordType: "message",
    providerRecordId: input.id,
    receivedAt: "2026-04-28T16:00:00.000Z",
    occurredAt: "2026-04-28T16:00:00.000Z",
    payloadRef: `payloads/gmail/${input.id}.json`,
    idempotencyKey: `gmail:${input.id}`,
    checksum: `checksum:${input.id}`,
  });

  await input.context.repositories.messageAttachments.upsertManyForMessage(
    sourceEvidenceId,
    [
      {
        id: input.id,
        provider: "gmail",
        gmailAttachmentId: `gmail:${input.id}`,
        mimeType: input.mimeType ?? "image/jpeg",
        filename: input.filename ?? "field-photo.jpg",
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
        externalUrl: null,
        isDecoration: false,
      },
    ],
  );
}

describe("gmail-capture internal attachments route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires a bearer token", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-internal-attachments-"));
    const server = await startGmailCaptureServer(createConfig(tempDir), {
      connection: createTestConnection(context),
    });

    try {
      const address = server.address() as AddressInfo;
      const url = new URL("/internal/attachments/att:gmail:test:0/1", `http://127.0.0.1:${String(address.port)}`);

      const missingAuthResponse = await fetch(url);
      expect(missingAuthResponse.status).toBe(401);

      const wrongAuthResponse = await fetch(url, {
        headers: {
          authorization: "Bearer wrong-token",
        },
      });
      expect(wrongAuthResponse.status).toBe(401);
    } finally {
      await closeServer(server);
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 404 when the attachment row is missing", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-internal-attachments-"));
    const server = await startGmailCaptureServer(createConfig(tempDir), {
      connection: createTestConnection(context),
    });

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(
        new URL("/internal/attachments/missing", `http://127.0.0.1:${String(address.port)}`),
        {
          headers: {
            authorization: "Bearer gmail-token",
          },
        },
      );

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Attachment not found");
    } finally {
      await closeServer(server);
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 404 when the storage key attempts path traversal", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-internal-attachments-"));
    const server = await startGmailCaptureServer(createConfig(tempDir), {
      connection: createTestConnection(context),
    });

    try {
      await seedAttachment({
        context,
        id: "att:gmail:traversal:0/1",
        storageKey: "../../../etc/passwd",
        sizeBytes: 4,
      });

      const address = server.address() as AddressInfo;
      const response = await fetch(
        new URL(
          `/internal/attachments/${encodeURIComponent("att:gmail:traversal:0/1")}`,
          `http://127.0.0.1:${String(address.port)}`,
        ),
        {
          headers: {
            authorization: "Bearer gmail-token",
          },
        },
      );

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Attachment not found");
    } finally {
      await closeServer(server);
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 404 when the attachment file is missing on disk", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-internal-attachments-"));
    const server = await startGmailCaptureServer(createConfig(tempDir), {
      connection: createTestConnection(context),
    });

    try {
      await seedAttachment({
        context,
        id: "att:gmail:missing-file:0/1",
        storageKey: "gmail/ab/att:gmail:missing-file:0/1",
        sizeBytes: 4,
      });

      const address = server.address() as AddressInfo;
      const response = await fetch(
        new URL(
          `/internal/attachments/${encodeURIComponent("att:gmail:missing-file:0/1")}`,
          `http://127.0.0.1:${String(address.port)}`,
        ),
        {
          headers: {
            authorization: "Bearer gmail-token",
          },
        },
      );

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Attachment not found");
    } finally {
      await closeServer(server);
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("streams attachment bytes with the stored content headers", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-internal-attachments-"));
    const server = await startGmailCaptureServer(createConfig(tempDir), {
      connection: createTestConnection(context),
    });

    try {
      const attachmentId = "att:gmail:found:0/1";
      const storageKey = "gmail/ab/att:gmail:found:0/1";
      const attachmentPath = path.join(tempDir, storageKey);
      const bytes = Buffer.from("image", "utf8");

      await seedAttachment({
        context,
        id: attachmentId,
        storageKey,
        sizeBytes: bytes.length,
      });
      await mkdir(path.dirname(attachmentPath), { recursive: true });
      await writeFile(attachmentPath, bytes);

      const address = server.address() as AddressInfo;
      const response = await fetch(
        new URL(
          `/internal/attachments/${encodeURIComponent(attachmentId)}`,
          `http://127.0.0.1:${String(address.port)}`,
        ),
        {
          headers: {
            authorization: "Bearer gmail-token",
          },
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/jpeg");
      expect(response.headers.get("Content-Length")).toBe(String(bytes.length));
      expect(response.headers.get("Content-Disposition")).toBe(
        "inline; filename=\"field-photo.jpg\"; filename*=UTF-8''field-photo.jpg",
      );
      await expect(response.text()).resolves.toBe("image");
    } finally {
      await closeServer(server);
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("RFC 5987-encodes Content-Disposition for non-ASCII filenames", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-internal-attachments-"));
    const server = await startGmailCaptureServer(createConfig(tempDir), {
      connection: createTestConnection(context),
    });

    try {
      const attachmentId = "att:gmail:non-ascii:0/1";
      const storageKey = "gmail/aa/att:gmail:non-ascii:0/1";
      const attachmentPath = path.join(tempDir, storageKey);
      const bytes = Buffer.from("image", "utf8");

      await seedAttachment({
        context,
        id: attachmentId,
        storageKey,
        sizeBytes: bytes.length,
        mimeType: "image/png",
        filename: "café — déjà vu.png",
      });
      await mkdir(path.dirname(attachmentPath), { recursive: true });
      await writeFile(attachmentPath, bytes);

      const address = server.address() as AddressInfo;
      const response = await fetch(
        new URL(
          `/internal/attachments/${encodeURIComponent(attachmentId)}`,
          `http://127.0.0.1:${String(address.port)}`,
        ),
        {
          headers: {
            authorization: "Bearer gmail-token",
          },
        },
      );

      expect(response.status).toBe(200);
      const header = response.headers.get("Content-Disposition") ?? "";
      // ASCII fallback replaces non-ASCII with `_` and preserves the
      // extension; the UTF-8 form percent-encodes the original.
      expect(header).toMatch(/^inline; filename="caf_ _ d_j_ vu\.png"; /);
      expect(header).toContain(
        "filename*=UTF-8''caf%C3%A9%20%E2%80%94%20d%C3%A9j%C3%A0%20vu.png",
      );
    } finally {
      await closeServer(server);
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("strips quotes and CR/LF from the ASCII fallback", async () => {
    const context = await createTestStage1Context();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "gmail-internal-attachments-"));
    const server = await startGmailCaptureServer(createConfig(tempDir), {
      connection: createTestConnection(context),
    });

    try {
      const attachmentId = "att:gmail:dangerous-name:0/1";
      const storageKey = "gmail/dd/att:gmail:dangerous-name:0/1";
      const attachmentPath = path.join(tempDir, storageKey);
      const bytes = Buffer.from("image", "utf8");

      await seedAttachment({
        context,
        id: attachmentId,
        storageKey,
        sizeBytes: bytes.length,
        mimeType: "image/png",
        // Embedded quote, backslash, CR, LF — would otherwise either
        // inject a header or break the quoted-string format.
        filename: 'a"b\\c\r\nd.png',
      });
      await mkdir(path.dirname(attachmentPath), { recursive: true });
      await writeFile(attachmentPath, bytes);

      const address = server.address() as AddressInfo;
      const response = await fetch(
        new URL(
          `/internal/attachments/${encodeURIComponent(attachmentId)}`,
          `http://127.0.0.1:${String(address.port)}`,
        ),
        {
          headers: {
            authorization: "Bearer gmail-token",
          },
        },
      );

      expect(response.status).toBe(200);
      const header = response.headers.get("Content-Disposition") ?? "";
      expect(header).toMatch(/^inline; filename="abc__d\.png"; /);
      expect(header).not.toContain('"b');
      expect(header).not.toContain("\r");
      expect(header).not.toContain("\n");
    } finally {
      await closeServer(server);
      await context.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
