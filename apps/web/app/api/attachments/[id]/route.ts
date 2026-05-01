import { getStage1WebRuntime } from "@/src/server/stage1-runtime";
import { requireApiSession } from "@/src/server/auth/api";
import { fetchAttachmentUpstream } from "@/src/server/attachments/upstream";

export const dynamic = "force-dynamic";

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
    return new Response("Attachment not found", { status: 404 });
  }

  let upstreamResponse: Response | null;

  try {
    upstreamResponse = await fetchAttachmentUpstream({
      id,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return new Response("Attachment upstream unavailable.", { status: 502 });
  }

  if (upstreamResponse === null) {
    return new Response("Attachments upstream not configured.", { status: 500 });
  }

  if (upstreamResponse.status === 404) {
    return new Response("Attachment not found", { status: 404 });
  }

  if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
    console.warn("Attachment proxy auth failed.", {
      attachmentId: id,
      status: upstreamResponse.status,
    });
    return new Response("Attachment proxy auth failed.", { status: 502 });
  }

  if (!upstreamResponse.ok) {
    return new Response("Attachment upstream unavailable.", { status: 502 });
  }

  return new Response(upstreamResponse.body, {
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
