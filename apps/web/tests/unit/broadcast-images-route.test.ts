import { afterEach, describe, expect, it, vi } from "vitest";

const requireApiSession = vi.hoisted(() => vi.fn());
const optimizeBroadcastImage = vi.hoisted(() => vi.fn());
const uploadBroadcastImageToObjectStore = vi.hoisted(() => vi.fn());
const createBroadcastMediaAssetRecord = vi.hoisted(() => vi.fn());
const listBroadcastMediaAssets = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/auth/api", () => ({
  requireApiSession,
}));

vi.mock("@/src/server/broadcasts/optimize-broadcast-image", () => ({
  optimizeBroadcastImage,
}));

vi.mock("@/src/server/broadcasts/object-store-runtime", () => ({
  uploadBroadcastImageToObjectStore,
}));

vi.mock("@/src/server/stage1-runtime", () => ({
  createBroadcastMediaAssetRecord,
  listBroadcastMediaAssets,
}));

import { GET, POST } from "../../app/api/broadcasts/images/route";

function buildMultipartRequest(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return new Request("http://localhost/api/broadcasts/images", {
    method: "POST",
    body: formData,
  });
}

describe("broadcast images upload route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns 401 without a session", async () => {
    requireApiSession.mockResolvedValue({
      ok: false,
      response: Response.json({ ok: false, code: "unauthorized" }, { status: 401 }),
    });

    const response = await POST(
      buildMultipartRequest(
        new File(["image"], "hero.png", {
          type: "image/png",
        }),
      ),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "unauthorized",
    });
  });

  it("returns 400 for a non-image upload", async () => {
    requireApiSession.mockResolvedValue({
      ok: true,
      user: { id: "user:operator", role: "operator" },
    });

    const response = await POST(
      buildMultipartRequest(
        new File(["not an image"], "notes.txt", {
          type: "text/plain",
        }),
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "Unsupported image type. Allowed: PNG, JPEG, GIF, WEBP.",
    });
    expect(uploadBroadcastImageToObjectStore).not.toHaveBeenCalled();
    expect(createBroadcastMediaAssetRecord).not.toHaveBeenCalled();
  });

  it("returns 400 for an oversized image upload", async () => {
    requireApiSession.mockResolvedValue({
      ok: true,
      user: { id: "user:operator", role: "operator" },
    });

    const response = await POST(
      buildMultipartRequest(
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "hero.webp", {
          type: "image/webp",
        }),
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      message: "Image must be 10 MB or smaller.",
    });
    expect(uploadBroadcastImageToObjectStore).not.toHaveBeenCalled();
    expect(createBroadcastMediaAssetRecord).not.toHaveBeenCalled();
  });

  it("uploads a valid image and persists the media-asset record", async () => {
    requireApiSession.mockResolvedValue({
      ok: true,
      user: { id: "user:operator", role: "operator" },
    });
    optimizeBroadcastImage.mockResolvedValue({
      bytes: Buffer.from("tiny"),
      contentType: "image/png",
    });
    uploadBroadcastImageToObjectStore.mockResolvedValue({
      url: "https://cdn.example.org/images/uploaded-hero.png",
    });
    createBroadcastMediaAssetRecord.mockResolvedValue({
      id: "asset-123",
      publicUrl: "https://cdn.example.org/images/uploaded-hero.png",
    });

    const response = await POST(
      buildMultipartRequest(
        new File(["image-bytes"], "Hero Banner.png", {
          type: "image/png",
        }),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "asset-123",
      url: "https://cdn.example.org/images/uploaded-hero.png",
    });
    expect(optimizeBroadcastImage).toHaveBeenCalledTimes(1);
    expect(uploadBroadcastImageToObjectStore).toHaveBeenCalledTimes(1);
    const uploadCall = uploadBroadcastImageToObjectStore.mock.calls.at(0)?.[0] as
      | {
          readonly key: string;
          readonly bytes: Uint8Array;
          readonly contentType: string;
        }
      | undefined;
    expect(uploadCall?.key).toMatch(/^images\/[0-9a-f-]+-Hero-Banner\.png$/i);
    expect(Buffer.from(uploadCall?.bytes ?? []).toString("utf8")).toBe("tiny");
    expect(uploadCall?.contentType).toBe("image/png");
    expect(createBroadcastMediaAssetRecord).toHaveBeenCalledTimes(1);
    const createCall = createBroadcastMediaAssetRecord.mock.calls.at(0)?.[0] as
      | {
          readonly uploaderId: string;
          readonly storageKey: string;
          readonly publicUrl: string;
          readonly filename: string;
          readonly contentType: string;
          readonly sizeBytes: number;
        }
      | undefined;
    expect(createCall).toMatchObject({
      uploaderId: "user:operator",
      publicUrl: "https://cdn.example.org/images/uploaded-hero.png",
      filename: "Hero Banner.png",
      contentType: "image/png",
      sizeBytes: 4,
    });
    expect(createCall?.storageKey).toMatch(
      /^images\/[0-9a-f-]+-Hero-Banner\.png$/i,
    );
  });

  it("returns 401 from the list endpoint without a session", async () => {
    requireApiSession.mockResolvedValue({
      ok: false,
      response: Response.json({ ok: false, code: "unauthorized" }, { status: 401 }),
    });

    const response = await GET(
      new Request("http://localhost/api/broadcasts/images"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "unauthorized",
    });
  });

  it("returns listed media assets newest first", async () => {
    requireApiSession.mockResolvedValue({
      ok: true,
      user: { id: "user:operator", role: "operator" },
    });
    listBroadcastMediaAssets.mockResolvedValue({
      items: [
        {
          id: "0d34633d-aee7-4f17-8c3f-6e5551f58a11",
          publicUrl: "https://cdn.example.org/images/newer.png",
          filename: "newer.png",
          contentType: "image/png",
          sizeBytes: 24576,
          createdAt: "2026-06-27T18:00:00.000Z",
        },
        {
          id: "2b8beef8-c630-4f2b-97eb-770dc4e5aa89",
          publicUrl: "https://cdn.example.org/images/older.png",
          filename: "older.png",
          contentType: "image/png",
          sizeBytes: 1024,
          createdAt: "2026-06-26T10:30:00.000Z",
        },
      ],
      nextCursor: "cursor:next",
    });

    const response = await GET(
      new Request(
        "http://localhost/api/broadcasts/images?limit=25&cursor=cursor%3Astart",
      ),
    );

    expect(response.status).toBe(200);
    expect(listBroadcastMediaAssets).toHaveBeenCalledWith({
      limit: 25,
      cursor: "cursor:start",
    });
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: "0d34633d-aee7-4f17-8c3f-6e5551f58a11",
          url: "https://cdn.example.org/images/newer.png",
          filename: "newer.png",
          contentType: "image/png",
          sizeBytes: 24576,
          createdAt: "2026-06-27T18:00:00.000Z",
        },
        {
          id: "2b8beef8-c630-4f2b-97eb-770dc4e5aa89",
          url: "https://cdn.example.org/images/older.png",
          filename: "older.png",
          contentType: "image/png",
          sizeBytes: 1024,
          createdAt: "2026-06-26T10:30:00.000Z",
        },
      ],
      nextCursor: "cursor:next",
    });
  });
});
