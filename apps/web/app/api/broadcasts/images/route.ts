import { randomUUID } from "node:crypto";

import { requireApiSession } from "@/src/server/auth/api";
import { uploadBroadcastImageToObjectStore } from "@/src/server/broadcasts/object-store-runtime";
import { createBroadcastMediaAssetRecord } from "@/src/server/stage1-runtime";

export const dynamic = "force-dynamic";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

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
  const normalized = trimmed.length > 0 ? trimmed : "image";

  const sanitized = normalized
    .replaceAll(/[/\\]/g, "-")
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^A-Za-z0-9._-]/g, "");

  return sanitized.length > 0 ? sanitized : "image";
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (!session.ok) {
    return session.response;
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return badRequest("Expected multipart/form-data with one image file.");
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
    return badRequest("Provide exactly one image file.");
  }

  const [file] = files;
  if (file === undefined) {
    return badRequest("Provide exactly one image file.");
  }

  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    return badRequest("Unsupported image type. Allowed: PNG, JPEG, GIF, WEBP.");
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return badRequest("Image must be 10 MB or smaller.");
  }

  const storageKey = `images/${randomUUID()}-${sanitizeFilename(file.name)}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploaded = await uploadBroadcastImageToObjectStore({
    key: storageKey,
    bytes,
    contentType: file.type,
  });
  const record = await createBroadcastMediaAssetRecord({
    uploaderId: session.user.id,
    storageKey,
    publicUrl: uploaded.url,
    filename: file.name,
    contentType: file.type,
    sizeBytes: file.size,
  });

  return Response.json({
    id: record.id,
    url: record.publicUrl,
  });
}
