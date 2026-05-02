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

async function seedAttachmentFixture() {
  const runtime = await createInboxTestRuntime();

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
    isInline: false,
  });

  return runtime;
}

describe("attachment proxy route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.GMAIL_CAPTURE_BASE_URL;
    delete process.env.GMAIL_CAPTURE_TOKEN;
  });

  it("streams attachment bytes from gmail-capture for authenticated operators", async () => {
    const runtime = await seedAttachmentFixture();
    const fetchImplementation = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        expect(url).toBe(
          "https://gmail-capture.internal/internal/attachments/att%3Agmail%3Aattachment-image-1%3A0%2F1",
        );
        expect(init?.headers).toMatchObject({
          authorization: "Bearer gmail-capture-token",
        });

        return Promise.resolve(
          new Response("image", {
            status: 200,
            headers: {
              "Content-Type": "text/plain",
            },
          }),
        );
      },
    ) as typeof fetch;

    try {
      requireApiSession.mockResolvedValue({
        ok: true,
        user: { id: "user:operator", role: "operator" },
      });
      process.env.GMAIL_CAPTURE_BASE_URL = "https://gmail-capture.internal";
      process.env.GMAIL_CAPTURE_TOKEN = "gmail-capture-token";
      vi.stubGlobal("fetch", fetchImplementation);

      const response = await GET(new Request("http://localhost/api/attachments"), {
        params: Promise.resolve({
          id: "att:gmail:attachment-image-1:0/1",
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
      expect(response.headers.get("Content-Type")).toBe("image/jpeg");
      expect(response.headers.get("Content-Length")).toBe("5");
      expect(response.headers.get("Content-Disposition")).toBe(
        "inline; filename=\"field-photo.jpg\"; filename*=UTF-8''field-photo.jpg",
      );
      await expect(response.text()).resolves.toBe("image");
    } finally {
      await runtime.dispose();
    }
  });

  it("returns 401 without a session", async () => {
    requireApiSession.mockResolvedValue({
      ok: false,
      response: Response.json({ ok: false, code: "unauthorized" }, { status: 401 }),
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

  it("returns 404 when the attachment id is unknown without calling upstream", async () => {
    const runtime = await createInboxTestRuntime();
    const fetchImplementation = vi.fn() as typeof fetch;

    try {
      requireApiSession.mockResolvedValue({
        ok: true,
        user: { id: "user:operator", role: "operator" },
      });
      process.env.GMAIL_CAPTURE_BASE_URL = "https://gmail-capture.internal";
      process.env.GMAIL_CAPTURE_TOKEN = "gmail-capture-token";
      vi.stubGlobal("fetch", fetchImplementation);

      const response = await GET(new Request("http://localhost/api/attachments"), {
        params: Promise.resolve({ id: "missing" }),
      });

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Attachment not found");
      expect(fetchImplementation).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });

  it("returns 404 when gmail-capture reports the attachment missing", async () => {
    const runtime = await seedAttachmentFixture();

    try {
      requireApiSession.mockResolvedValue({
        ok: true,
        user: { id: "user:operator", role: "operator" },
      });
      process.env.GMAIL_CAPTURE_BASE_URL = "https://gmail-capture.internal";
      process.env.GMAIL_CAPTURE_TOKEN = "gmail-capture-token";
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(new Response("missing", { status: 404 }))) as typeof fetch,
      );

      const response = await GET(new Request("http://localhost/api/attachments"), {
        params: Promise.resolve({
          id: "att:gmail:attachment-image-1:0/1",
        }),
      });

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Attachment not found");
    } finally {
      await runtime.dispose();
    }
  });

  it.each([401, 403])(
    "returns 502 when gmail-capture auth fails with %s",
    async (status) => {
      const runtime = await seedAttachmentFixture();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      try {
        requireApiSession.mockResolvedValue({
          ok: true,
          user: { id: "user:operator", role: "operator" },
        });
        process.env.GMAIL_CAPTURE_BASE_URL = "https://gmail-capture.internal";
        process.env.GMAIL_CAPTURE_TOKEN = "gmail-capture-token";
        vi.stubGlobal(
          "fetch",
          vi.fn(() => Promise.resolve(new Response("forbidden", { status }))) as typeof fetch,
        );

        const response = await GET(new Request("http://localhost/api/attachments"), {
          params: Promise.resolve({
            id: "att:gmail:attachment-image-1:0/1",
          }),
        });

        expect(response.status).toBe(502);
        await expect(response.text()).resolves.toBe("Attachment proxy auth failed.");
        expect(warnSpy).toHaveBeenCalledWith("Attachment proxy auth failed.", {
          attachmentId: "att:gmail:attachment-image-1:0/1",
          status,
        });
      } finally {
        await runtime.dispose();
      }
    },
  );

  it("returns 502 when gmail-capture is unavailable", async () => {
    const runtime = await seedAttachmentFixture();

    try {
      requireApiSession.mockResolvedValue({
        ok: true,
        user: { id: "user:operator", role: "operator" },
      });
      process.env.GMAIL_CAPTURE_BASE_URL = "https://gmail-capture.internal";
      process.env.GMAIL_CAPTURE_TOKEN = "gmail-capture-token";
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(new Response("unavailable", { status: 503 })),
        ) as typeof fetch,
      );

      const response = await GET(new Request("http://localhost/api/attachments"), {
        params: Promise.resolve({
          id: "att:gmail:attachment-image-1:0/1",
        }),
      });

      expect(response.status).toBe(502);
      await expect(response.text()).resolves.toBe("Attachment upstream unavailable.");
    } finally {
      await runtime.dispose();
    }
  });

  it("returns 502 when gmail-capture times out", async () => {
    const runtime = await seedAttachmentFixture();

    try {
      requireApiSession.mockResolvedValue({
        ok: true,
        user: { id: "user:operator", role: "operator" },
      });
      process.env.GMAIL_CAPTURE_BASE_URL = "https://gmail-capture.internal";
      process.env.GMAIL_CAPTURE_TOKEN = "gmail-capture-token";
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          const error = new Error("timed out");
          error.name = "TimeoutError";
          return Promise.reject(error);
        }) as typeof fetch,
      );

      const response = await GET(new Request("http://localhost/api/attachments"), {
        params: Promise.resolve({
          id: "att:gmail:attachment-image-1:0/1",
        }),
      });

      expect(response.status).toBe(502);
      await expect(response.text()).resolves.toBe("Attachment upstream unavailable.");
    } finally {
      await runtime.dispose();
    }
  });

  it("returns 500 when the attachments upstream is not configured", async () => {
    const runtime = await seedAttachmentFixture();
    const fetchImplementation = vi.fn() as typeof fetch;

    try {
      requireApiSession.mockResolvedValue({
        ok: true,
        user: { id: "user:operator", role: "operator" },
      });
      vi.stubGlobal("fetch", fetchImplementation);

      const response = await GET(new Request("http://localhost/api/attachments"), {
        params: Promise.resolve({
          id: "att:gmail:attachment-image-1:0/1",
        }),
      });

      expect(response.status).toBe(500);
      await expect(response.text()).resolves.toBe("Attachments upstream not configured.");
      expect(fetchImplementation).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });
});
