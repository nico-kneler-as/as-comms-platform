import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const requireApiSession = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/api", () => ({
  requireApiSession,
}));

import { GET } from "../../app/api/attachments/[id]/route";
import {
  createInboxTestRuntime,
  seedInboxEmailEvent,
  seedInboxContact,
  seedInboxMessageAttachment,
} from "./inbox-stage1-helpers";

describe("attachment proxy route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ATTACHMENT_VOLUME_PATH;
  });

  it("streams images inline for authenticated operators", async () => {
    const runtime = await createInboxTestRuntime();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "attachment-route-"));

    try {
      requireApiSession.mockResolvedValue({
        ok: true,
        user: { id: "user:operator", role: "operator" },
      });
      await seedInboxContact(runtime.context, {
        contactId: "contact:image",
        salesforceContactId: "003-image",
        displayName: "Image Contact",
        primaryEmail: "image@example.org",
        primaryPhone: null,
      });
      await seedInboxEmailEvent(runtime.context, {
        id: "attachment-image-1",
        contactId: "contact:image",
        occurredAt: "2026-04-20T12:00:00.000Z",
        direction: "inbound",
        subject: "Image",
        snippet: "See image",
      });
      await seedInboxMessageAttachment(runtime.context, {
        sourceEvidenceId: "source:attachment-image-1",
        id: "att:gmail:attachment-image-1:0/1",
        mimeType: "image/jpeg",
        filename: "field-photo.jpg",
        sizeBytes: 5,
        storageKey: "gmail/ab/att:gmail:attachment-image-1:0/1",
      });
      process.env.ATTACHMENT_VOLUME_PATH = tempDir;
      const imagePath = path.join(
        tempDir,
        "gmail/ab/att:gmail:attachment-image-1:0/1",
      );
      await mkdir(path.dirname(imagePath), { recursive: true });
      await writeFile(imagePath, Buffer.from("image", "utf8"));

      const response = await GET(new Request("http://localhost/api/attachments"), {
        params: Promise.resolve({
          id: "att:gmail:attachment-image-1:0/1",
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/jpeg");
      expect(response.headers.get("Content-Disposition")).toBe(
        'inline; filename="field-photo.jpg"',
      );
      expect(response.headers.get("Content-Length")).toBe("5");
      await expect(response.text()).resolves.toBe("image");
    } finally {
      await runtime.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("forces download disposition for non-image attachments", async () => {
    const runtime = await createInboxTestRuntime();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "attachment-route-"));

    try {
      requireApiSession.mockResolvedValue({
        ok: true,
        user: { id: "user:operator", role: "operator" },
      });
      await seedInboxContact(runtime.context, {
        contactId: "contact:pdf",
        salesforceContactId: "003-pdf",
        displayName: "PDF Contact",
        primaryEmail: "pdf@example.org",
        primaryPhone: null,
      });
      await seedInboxEmailEvent(runtime.context, {
        id: "attachment-pdf-1",
        contactId: "contact:pdf",
        occurredAt: "2026-04-20T12:00:00.000Z",
        direction: "outbound",
        subject: "PDF",
        snippet: "See PDF",
      });
      await seedInboxMessageAttachment(runtime.context, {
        sourceEvidenceId: "source:attachment-pdf-1",
        id: "att:gmail:attachment-pdf-1:0/1",
        mimeType: "application/pdf",
        filename: "packet.pdf",
        sizeBytes: 3,
        storageKey: "gmail/cd/att:gmail:attachment-pdf-1:0/1",
      });
      process.env.ATTACHMENT_VOLUME_PATH = tempDir;
      const pdfPath = path.join(
        tempDir,
        "gmail/cd/att:gmail:attachment-pdf-1:0/1",
      );
      await mkdir(path.dirname(pdfPath), { recursive: true });
      await writeFile(pdfPath, Buffer.from("pdf", "utf8"));

      const response = await GET(new Request("http://localhost/api/attachments"), {
        params: Promise.resolve({
          id: "att:gmail:attachment-pdf-1:0/1",
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="packet.pdf"',
      );
    } finally {
      await runtime.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 401 without a session", async () => {
    requireApiSession.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 }),
    });

    const response = await GET(new Request("http://localhost/api/attachments"), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "unauthorized",
    });
  });

  it("returns 404 when the attachment id is unknown", async () => {
    const runtime = await createInboxTestRuntime();

    try {
      requireApiSession.mockResolvedValue({
        ok: true,
        user: { id: "user:operator", role: "operator" },
      });

      const response = await GET(new Request("http://localhost/api/attachments"), {
        params: Promise.resolve({ id: "missing" }),
      });

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Not found");
    } finally {
      await runtime.dispose();
    }
  });

  it("returns 503 when the attachment row exists but the file is missing", async () => {
    const runtime = await createInboxTestRuntime();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "attachment-route-"));

    try {
      requireApiSession.mockResolvedValue({
        ok: true,
        user: { id: "user:operator", role: "operator" },
      });
      await seedInboxContact(runtime.context, {
        contactId: "contact:missing",
        salesforceContactId: "003-missing",
        displayName: "Missing Contact",
        primaryEmail: "missing@example.org",
        primaryPhone: null,
      });
      await seedInboxEmailEvent(runtime.context, {
        id: "attachment-missing-1",
        contactId: "contact:missing",
        occurredAt: "2026-04-20T12:00:00.000Z",
        direction: "inbound",
        subject: "Missing file",
        snippet: "Missing file",
      });
      await seedInboxMessageAttachment(runtime.context, {
        sourceEvidenceId: "source:attachment-missing-1",
        id: "att:gmail:attachment-missing-1:0/1",
        mimeType: "image/jpeg",
        filename: "field-photo.jpg",
        sizeBytes: 5,
        storageKey: "gmail/ef/att:gmail:attachment-missing-1:0/1",
      });
      process.env.ATTACHMENT_VOLUME_PATH = tempDir;

      const response = await GET(new Request("http://localhost/api/attachments"), {
        params: Promise.resolve({
          id: "att:gmail:attachment-missing-1:0/1",
        }),
      });

      expect(response.status).toBe(503);
      await expect(response.text()).resolves.toBe("Attachment not yet cached");
    } finally {
      await runtime.dispose();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
