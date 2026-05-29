export function normalizeContentId(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(/^<|>$/gu, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function resolveContentDispositionType(
  contentDisposition: string | null | undefined,
): string | null {
  if (typeof contentDisposition !== "string") {
    return null;
  }

  const dispositionType = contentDisposition.split(";")[0]?.trim().toLowerCase();
  return dispositionType && dispositionType.length > 0
    ? dispositionType
    : null;
}

export function isInlineAttachment(input: {
  readonly attachment: {
    readonly contentDisposition?: string | null;
    readonly contentId?: string | null;
  };
  readonly htmlBodyCidReferences: ReadonlySet<string>;
}): boolean {
  const dispositionType = resolveContentDispositionType(
    input.attachment.contentDisposition,
  );

  if (dispositionType === "attachment") {
    return false;
  }

  if (dispositionType === "inline") {
    return true;
  }

  const normalizedContentId = normalizeContentId(input.attachment.contentId);
  if (
    normalizedContentId === null ||
    !input.htmlBodyCidReferences.has(normalizedContentId)
  ) {
    return false;
  }

  return true;
}
