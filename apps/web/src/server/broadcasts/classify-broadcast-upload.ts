import sharp from "sharp";

export type BroadcastUploadKind = "image" | "audio" | "document";

export type BroadcastUploadClassification =
  | {
      readonly ok: true;
      readonly kind: BroadcastUploadKind;
      readonly contentType: string;
      readonly maxBytes: number;
    }
  | { readonly ok: false; readonly message: string };

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TYPE_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
};
const TYPE_BY_DECLARATION: Record<string, string> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/mp4": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/wav": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "application/pdf": "application/pdf",
};

function extensionOf(filename: string): string {
  const dotIndex = filename.trim().lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
}

function kindFor(contentType: string): BroadcastUploadKind {
  return IMAGE_TYPES.has(contentType)
    ? "image"
    : contentType.startsWith("audio/")
      ? "audio"
      : "document";
}

function failureFor(contentType: string): BroadcastUploadClassification {
  switch (contentType) {
    case "application/pdf":
      return { ok: false, message: "This file doesn't look like a PDF." };
    case "audio/mpeg":
      return { ok: false, message: "This file doesn't look like an MP3." };
    case "audio/mp4":
      return { ok: false, message: "This file doesn't look like an M4A audio file." };
    case "audio/wav":
      return { ok: false, message: "This file doesn't look like a WAV audio file." };
    default:
      return { ok: false, message: "This file doesn't look like the selected image type." };
  }
}

function hasPrefix(bytes: Buffer, value: string): boolean {
  return bytes.subarray(0, value.length).toString("ascii") === value;
}

function sniffAudioOrPdf(bytes: Buffer, contentType: string): boolean {
  switch (contentType) {
    case "application/pdf":
      return hasPrefix(bytes, "%PDF-");
    case "audio/mpeg":
      return hasPrefix(bytes, "ID3") || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0);
    case "audio/wav":
      return hasPrefix(bytes, "RIFF") && bytes.subarray(8, 12).toString("ascii") === "WAVE";
    case "audio/mp4": {
      if (bytes.subarray(4, 8).toString("ascii") !== "ftyp") return false;
      const brand = bytes.subarray(8, 12).toString("ascii");
      return brand === "M4A " || brand === "mp42" || brand === "isom" || brand === "M4B ";
    }
    default:
      return false;
  }
}

/** Size cap for an accepted canonical content type (images vs. audio/PDF). */
export function maxBytesForBroadcastUpload(contentType: string): number {
  return IMAGE_TYPES.has(contentType) ? MAX_IMAGE_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
}

export function getBroadcastUploadCandidate(input: {
  readonly declaredType: string;
  readonly filename: string;
}): string | null {
  const declaredType = input.declaredType.toLowerCase().trim();
  const byDeclaration = declaredType ? TYPE_BY_DECLARATION[declaredType] : undefined;
  const byExtension = TYPE_BY_EXTENSION[extensionOf(input.filename)];

  if (declaredType && !byDeclaration) return null;
  return byDeclaration ?? byExtension ?? null;
}

export async function classifyBroadcastUpload(input: {
  readonly bytes: Buffer;
  readonly declaredType: string;
  readonly filename: string;
}): Promise<BroadcastUploadClassification> {
  const contentType = getBroadcastUploadCandidate(input);
  if (!contentType) {
    return {
      ok: false,
      message: "Unsupported file type. Allowed: PNG, JPEG, GIF, WEBP, MP3, M4A, WAV, PDF.",
    };
  }

  if (IMAGE_TYPES.has(contentType)) {
    try {
      const metadata = await sharp(input.bytes, { failOn: "none" }).metadata();
      const expectedFormat = contentType.slice("image/".length);
      if (metadata.format !== expectedFormat) return failureFor(contentType);
    } catch {
      return failureFor(contentType);
    }
  } else if (!sniffAudioOrPdf(input.bytes, contentType)) {
    return failureFor(contentType);
  }

  return {
    ok: true,
    kind: kindFor(contentType),
    contentType,
    maxBytes: maxBytesForBroadcastUpload(contentType),
  };
}
