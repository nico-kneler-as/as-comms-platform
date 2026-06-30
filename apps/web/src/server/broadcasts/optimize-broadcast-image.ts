import sharp from "sharp";

const MAX_IMAGE_WIDTH = 1200;

export async function optimizeBroadcastImage(
  input: Buffer,
  contentType: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  if (contentType === "image/gif") {
    return {
      bytes: input,
      contentType,
    };
  }

  const image = sharp(input, { failOn: "none" }).rotate();
  const metadata = await image.metadata();

  if (metadata.width > MAX_IMAGE_WIDTH) {
    image.resize({
      width: MAX_IMAGE_WIDTH,
      withoutEnlargement: true,
    });
  }

  switch (contentType) {
    case "image/jpeg":
      image.jpeg({ quality: 80, mozjpeg: true });
      break;
    case "image/png":
      image.png({ compressionLevel: 9 });
      break;
    case "image/webp":
      image.webp({ quality: 82 });
      break;
    default:
      return {
        bytes: input,
        contentType,
      };
  }

  const optimized = await image.toBuffer();

  return {
    bytes: optimized.byteLength < input.byteLength ? optimized : input,
    contentType,
  };
}
