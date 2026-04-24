const ALLOWED_CONTAINER_TAGS = new Set([
  "p",
  "strong",
  "em",
  "b",
  "i",
  "ul",
  "ol",
  "li",
]);
const VOID_TAGS = new Set(["br"]);
const STRIP_WITH_CONTENT_TAGS = new Set(["script", "style"]);
const TAG_PATTERN = /<\/?[^>]+>/gu;
const TAG_NAME_PATTERN = /^<\/?\s*([a-zA-Z0-9:-]+)/u;
const HREF_PATTERN = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/iu;

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function isAllowedHref(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return false;
  }

  return /^(https?:\/\/|mailto:)/iu.test(trimmed);
}

function sanitizeHref(value: string): string | null {
  const trimmed = value.trim();
  return isAllowedHref(trimmed) ? escapeHtml(trimmed) : null;
}

function readTagName(rawTag: string): string | null {
  const match = TAG_NAME_PATTERN.exec(rawTag);
  return match?.[1]?.toLowerCase() ?? null;
}

function readHref(rawTag: string): string | null {
  const match = HREF_PATTERN.exec(rawTag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
  return value === null ? null : sanitizeHref(value);
}

export function sanitizeComposerHtml(input: string): string {
  let output = "";
  let cursor = 0;
  let strippedContentTag: string | null = null;
  let skippedAnchorDepth = 0;

  for (const match of input.matchAll(TAG_PATTERN)) {
    const rawTag = match[0];
    const tagStart = match.index;
    const tagName = readTagName(rawTag);

    if (strippedContentTag !== null) {
      if (tagName === strippedContentTag && rawTag.startsWith("</")) {
        strippedContentTag = null;
      }
      cursor = tagStart + rawTag.length;
      continue;
    }

    output += escapeHtml(input.slice(cursor, tagStart));
    cursor = tagStart + rawTag.length;

    if (tagName === null) {
      continue;
    }

    if (STRIP_WITH_CONTENT_TAGS.has(tagName) && !rawTag.startsWith("</")) {
      strippedContentTag = tagName;
      continue;
    }

    if (rawTag.startsWith("</")) {
      if (tagName === "a" && skippedAnchorDepth > 0) {
        skippedAnchorDepth -= 1;
        continue;
      }

      if (ALLOWED_CONTAINER_TAGS.has(tagName) || tagName === "a") {
        output += `</${tagName}>`;
      }
      continue;
    }

    if (VOID_TAGS.has(tagName)) {
      output += "<br>";
      continue;
    }

    if (ALLOWED_CONTAINER_TAGS.has(tagName)) {
      output += `<${tagName}>`;
      continue;
    }

    if (tagName === "a") {
      const href = readHref(rawTag);
      if (href === null) {
        skippedAnchorDepth += 1;
      } else {
        output += `<a href="${href}">`;
      }
    }
  }

  if (strippedContentTag === null) {
    output += escapeHtml(input.slice(cursor));
  }

  return output.trim();
}

function linkifyEscapedLine(line: string): string {
  return line.replace(/https?:\/\/[^\s<]+/gu, (url) => {
    const escapedUrl = escapeHtml(url);
    return `<a href="${escapedUrl}">${escapedUrl}</a>`;
  });
}

export function plaintextToComposerHtml(input: string): string {
  return input
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split(/\n{2,}/u)
    .map((paragraph) => {
      const html = paragraph
        .split("\n")
        .map((line) => linkifyEscapedLine(escapeHtml(line)))
        .join("<br>");
      return html.length > 0 ? `<p>${html}</p>` : "";
    })
    .filter((paragraph) => paragraph.length > 0)
    .join("");
}

export function appendComposerHtmlSignature(input: {
  readonly bodyHtml: string;
  readonly bodyPlaintext: string;
  readonly signaturePlaintext: string;
}): string {
  const sanitizedBody = sanitizeComposerHtml(input.bodyHtml);
  const bodyHtml =
    sanitizedBody.length > 0
      ? sanitizedBody
      : sanitizeComposerHtml(plaintextToComposerHtml(input.bodyPlaintext));
  const signatureHtml = sanitizeComposerHtml(
    plaintextToComposerHtml(input.signaturePlaintext),
  );

  return signatureHtml.length > 0
    ? `${bodyHtml}${signatureHtml}`
    : bodyHtml;
}
