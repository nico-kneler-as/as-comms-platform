import { describe, expect, it, vi } from "vitest";

const metadata = vi.hoisted(() => vi.fn());

vi.mock("sharp", () => ({
  default: vi.fn(() => ({ metadata })),
}));

import { classifyBroadcastUpload } from "@/src/server/broadcasts/classify-broadcast-upload";

describe("classifyBroadcastUpload", () => {
  it.each([
    [Buffer.from("%PDF-1.4"), "application/pdf", "guide.pdf", "document", "application/pdf", 25],
    [Buffer.from("ID3test"), "audio/mp3", "recording.mp3", "audio", "audio/mpeg", 25],
    [Buffer.from([0xff, 0xfb, 0x00]), "audio/mpeg", "recording.mp3", "audio", "audio/mpeg", 25],
    [Buffer.from("RIFF0000WAVE"), "audio/x-wav", "recording.wav", "audio", "audio/wav", 25],
    [Buffer.from("0000ftypM4A "), "", "recording.m4a", "audio", "audio/mp4", 25],
  ] as const)("accepts valid signatures", async (bytes, declaredType, filename, kind, contentType, maxMb) => {
    await expect(classifyBroadcastUpload({ bytes, declaredType, filename })).resolves.toEqual({ ok: true, kind, contentType, maxBytes: maxMb * 1024 * 1024 });
  });

  it("rejects mismatched and spoofed payloads", async () => {
    await expect(classifyBroadcastUpload({ bytes: Buffer.from("%PDF-1.4"), declaredType: "audio/mpeg", filename: "recording.mp3" })).resolves.toMatchObject({ ok: false });
    await expect(classifyBroadcastUpload({ bytes: Buffer.from("%PDF-1.4"), declaredType: "", filename: "recording.mp3" })).resolves.toEqual({ ok: false, message: "This file doesn't look like an MP3." });
  });

  it("validates image bytes against the declared image type", async () => {
    metadata.mockResolvedValueOnce({ format: "jpeg" });
    await expect(classifyBroadcastUpload({ bytes: Buffer.from("not-gif"), declaredType: "image/gif", filename: "image.gif" })).resolves.toMatchObject({ ok: false });

    metadata.mockResolvedValueOnce({ format: "png" });
    await expect(classifyBroadcastUpload({ bytes: Buffer.from("png"), declaredType: "image/png", filename: "image.png" })).resolves.toEqual({ ok: true, kind: "image", contentType: "image/png", maxBytes: 10 * 1024 * 1024 });
  });
});
