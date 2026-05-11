import { getStage1WebRuntime } from "@/src/server/stage1-runtime";
import { requireApiSession } from "@/src/server/auth/api";
import { fetchAttachmentUpstream } from "@/src/server/attachments/upstream";
import { appendSecurityAudit } from "@/src/server/security/audit";

export const dynamic = "force-dynamic";

/**
 * RFC 5987 / 6266-compliant Content-Disposition builder.
 *
 * The legacy `filename=` parameter is a quoted-string per RFC 7230, which
 * only permits printable ASCII — non-ASCII bytes throw on Node's strict
 * header validator. We provide both an ASCII-sanitized fallback and a
 * UTF-8 percent-encoded `filename*=` for full Unicode support per RFC
 * 5987. Browsers prefer `filename*` when both are present.
 *
 * Mirrored in `apps/gmail-capture/src/index.ts`. If you change this,
 * change that one too — they format the same wire bytes.
 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDisposition(input: {
  readonly mimeType: string;
  readonly filename: string | null;
}): string {
  const trimmed = input.filename?.trim();
  const rawName = trimmed && trimmed.length > 0 ? trimmed : "Attachment";
  const asciiFallback = rawName
    .replace(/[^\x20-\x7e]/g, "_")
    .replaceAll('"', "")
    .replaceAll("\\", "");
  const safeFallback = asciiFallback.length > 0 ? asciiFallback : "Attachment";
  const utf8Encoded = encodeRfc5987(rawName);
  const disposition = input.mimeType.startsWith("image/")
    ? "inline"
    : "attachment";

  return `${disposition}; filename="${safeFallback}"; filename*=UTF-8''${utf8Encoded}`;
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
    // Defense-in-depth observability: log every cross-attachment access
    // attempt so a future cross-project IDOR pattern is detectable in the
    // audit log without requiring a structural project-scope filter.
    // See `.STATE-2026-05-02-security-review.md` H2.
    await appendSecurityAudit({
      actorType: "user",
      actorId: session.user.id,
      action: "attachment.fetch",
      entityType: "message_attachment",
      entityId: id,
      result: "denied",
      policyCode: "attachment.fetch.not_found",
      metadataJson: {},
    }).catch((error: unknown) => {
      console.error("Failed to append attachment audit.", error);
    });

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

  // Successful fetch — log who fetched what for the cross-attachment access
  // audit trail (see `.STATE-2026-05-02-security-review.md` H2).
  await appendSecurityAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "attachment.fetch",
    entityType: "message_attachment",
    entityId: id,
    result: "allowed",
    policyCode: "attachment.fetch",
    metadataJson: {
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    },
  }).catch((error: unknown) => {
    console.error("Failed to append attachment audit.", error);
  });

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
