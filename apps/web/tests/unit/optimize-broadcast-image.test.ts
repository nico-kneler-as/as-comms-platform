import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { optimizeBroadcastImage } from "@/src/server/broadcasts/optimize-broadcast-image";

const TRANSPARENT_GIF_BASE64 =
  "R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=";

describe("optimizeBroadcastImage", () => {
  it("resizes large images down to 1200px wide and reduces byte size", async () => {
    const input = await sharp({
      create: {
        width: 2400,
        height: 1200,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    const result = await optimizeBroadcastImage(input, "image/jpeg");
    const metadata = await sharp(result.bytes).metadata();

    expect(result.contentType).toBe("image/jpeg");
    expect(metadata.width).toBeLessThanOrEqual(1200);
    expect(result.bytes.byteLength).toBeLessThan(input.byteLength);
  });

  it("passes gif uploads through unchanged", async () => {
    const input = Buffer.from(TRANSPARENT_GIF_BASE64, "base64");

    const result = await optimizeBroadcastImage(input, "image/gif");

    expect(result.contentType).toBe("image/gif");
    expect(result.bytes.equals(input)).toBe(true);
  });

  it("does not enlarge already-small images", async () => {
    const input = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 4,
        background: { r: 10, g: 40, b: 90, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const result = await optimizeBroadcastImage(input, "image/png");
    const metadata = await sharp(result.bytes).metadata();

    expect(result.contentType).toBe("image/png");
    expect(metadata.width).toBe(800);
  });
});
