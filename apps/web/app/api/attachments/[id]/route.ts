import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { getStage1WebRuntime } from "@/src/server/stage1-runtime";
import { requireApiSession } from "@/src/server/auth/api";
import { readAttachmentServerConfig } from "@/src/server/attachments/config";

export const dynamic = "force-dynamic";

function resolveAttachmentPath(input: {
  readonly attachmentVolumePath: string;
  readonly storageKey: string;
}): string {
  const volumeRoot = input.attachmentVolumePath;
  const absolutePath = path.resolve(volumeRoot, input.storageKey);

  if (
    absolutePath !== volumeRoot &&
    !absolutePath.startsWith(`${volumeRoot}${path.sep}`)
  ) {
    throw new Error("Attachment path escapes the configured volume.");
  }

  return absolutePath;
}

function contentDisposition(input: {
  readonly mimeType: string;
  readonly filename: string | null;
}): string {
  const trimmed = input.filename?.trim();
  const filename = (trimmed && trimmed.length > 0 ? trimmed : "Attachment").replaceAll(
    '"',
    ""
  );
  const disposition = input.mimeType.startsWith("image/")
    ? "inline"
    : "attachment";

  return `${disposition}; filename="${filename}"`;
}

export async function GET(
  _request: Request,
  context: {
    readonly params: Promise<{
      readonly id: string;
    }>;
  },
) {
  const session = await requireApiSession();
  if (!session.ok) {
    return session.response;
  }

  const { id } = await context.params;
  const runtime = await getStage1WebRuntime();
  const attachment = await runtime.repositories.messageAttachments.findById(id);

  if (attachment === null) {
    return new Response("Not found", { status: 404 });
  }

  const { attachmentVolumePath } = readAttachmentServerConfig(process.env);
  const absolutePath = resolveAttachmentPath({
    attachmentVolumePath,
    storageKey: attachment.storageKey,
  });

  try {
    await access(absolutePath);
  } catch {
    return new Response("Attachment not yet cached", { status: 503 });
  }

  return new Response(Readable.toWeb(createReadStream(absolutePath)) as ReadableStream, {
    status: 200,
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": contentDisposition({
        mimeType: attachment.mimeType,
        filename: attachment.filename,
      }),
      "Content-Length": String(attachment.sizeBytes),
      "Content-Type": attachment.mimeType,
    },
  });
}
