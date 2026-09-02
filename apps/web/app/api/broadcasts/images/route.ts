import { randomUUID } from "node:crypto";

import { requireApiSession } from "@/src/server/auth/api";
import {
  classifyBroadcastUpload,
  getBroadcastUploadCandidate,
  maxBytesForBroadcastUpload,
} from "@/src/server/broadcasts/classify-broadcast-upload";
import { optimizeBroadcastImage } from "@/src/server/broadcasts/optimize-broadcast-image";
import { uploadBroadcastImageToObjectStore } from "@/src/server/broadcasts/object-store-runtime";
import {
  createBroadcastMediaAssetRecord,
  listBroadcastMediaAssets,
} from "@/src/server/stage1-runtime";

import { toMediaLibraryItem } from "../../../broadcasts/media/_lib/media-library-item";

export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return Response.json(
    {
      ok: false,
      message,
    },
    { status: 400 },
  );
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim();
  const normalized = trimmed.length > 0 ? trimmed : "file";

  const sanitized = normalized
    .replaceAll(/[/\\]/g, "-")
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^A-Za-z0-9._-]/g, "");

  return sanitized.length > 0 ? sanitized : "file";
}

function parseLimit(raw: string | null): number {
  if (raw === null) {
    return 50;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return Math.min(100, Math.max(1, parsed));
}

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) {
    return session.response;
  }

  const { searchParams } = new URL(request.url);
  const result = await listBroadcastMediaAssets({
    limit: parseLimit(searchParams.get("limit")),
    cursor: searchParams.get("cursor"),
  });

  return Response.json({
    items: result.items.map(toMediaLibraryItem),
    nextCursor: result.nextCursor,
  });
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) {
    return session.response;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return badRequest("Expected multipart/form-data with one file.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return badRequest("Invalid multipart/form-data payload.");
  }

  const files = Array.from(formData.values()).filter(
    (value): value is File => value instanceof File,
  );

  if (files.length !== 1) {
    return badRequest("Provide exactly one file.");
  }

  const [file] = files;
  if (file === undefined) {
    return badRequest("Provide exactly one file.");
  }

  const candidate = getBroadcastUploadCandidate({
    declaredType: file.type,
    filename: file.name,
  });
  if (!candidate) {
    return badRequest("Unsupported file type. Allowed: PNG, JPEG, GIF, WEBP, MP3, M4A, WAV, PDF.");
  }

  const isImage = candidate.startsWith("image/");
  const maxBytes = maxBytesForBroadcastUpload(candidate);
  if (file.size > maxBytes) {
    return badRequest(
      isImage
        ? "Images must be 10 MB or smaller."
        : "Audio and PDF files must be 25 MB or smaller.",
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const classification = await classifyBroadcastUpload({
    bytes,
    declaredType: file.type,
    filename: file.name,
  });
  if (!classification.ok) return badRequest(classification.message);

  const prefix = classification.kind === "image" ? "images" : classification.kind === "audio" ? "audio" : "files";
  const storageKey = `${prefix}/${randomUUID()}-${sanitizeFilename(file.name)}`;
  const upload = classification.kind === "image"
    ? await optimizeBroadcastImage(bytes, classification.contentType)
    : { bytes, contentType: classification.contentType };
  const uploaded = await uploadBroadcastImageToObjectStore({
    key: storageKey,
    bytes: upload.bytes,
    contentType: upload.contentType,
  });
  const record = await createBroadcastMediaAssetRecord({
    uploaderId: session.user.id,
    storageKey,
    publicUrl: uploaded.url,
    filename: file.name,
    contentType: upload.contentType,
    sizeBytes: upload.bytes.byteLength,
  });

  return Response.json({
    id: record.id,
    url: record.publicUrl,
  });
}
