import { sanitizeComposerHtml } from "@/src/lib/html-sanitizer";

import { extractEmailAddresses } from "./message-formatting";
import type {
  InboxComposerAliasOption,
  InboxComposerForwardContext,
  InboxTimelineEntryViewModel,
} from "./view-models";

const FORWARD_SUBJECT_PREFIX_PATTERN = /^\s*fwd:\s*/iu;
const HTML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/u;
const HTML_BREAK_PATTERN = /<(?:br|\/p|\/div|\/li)\b[^>]*>/giu;
const HTML_BLOCK_CLOSE_PATTERN = /<\/(?:p|div|li|blockquote|ul|ol|table|tr|h[1-6])>/giu;
const HTML_TAG_STRIP_PATTERN = /<[^>]+>/gu;
const HTML_ENTITY_REPLACEMENTS = new Map<string, string>([
  ["&nbsp;", " "],
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
]);

function bodyContainsHtml(body: string): boolean {
  return HTML_TAG_PATTERN.test(body);
}

function formatForwardedDate(occurredAtIso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    dateStyle: "long",
    timeStyle: "short",
  })
    .format(new Date(occurredAtIso))
    .replace(/, (?=\d{1,2}:\d{2}\s)/u, " at ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlToPlaintext(bodyHtml: string): string {
  const withLineBreaks = bodyHtml
    .replace(HTML_BREAK_PATTERN, "\n")
    .replace(HTML_BLOCK_CLOSE_PATTERN, "\n");
  const withoutTags = withLineBreaks.replace(HTML_TAG_STRIP_PATTERN, "");

  let decoded = withoutTags;
  for (const [entity, replacement] of HTML_ENTITY_REPLACEMENTS) {
    decoded = decoded.replaceAll(entity, replacement);
  }

  return decoded.replace(/\n{3,}/gu, "\n\n").trim();
}

function findMatchingAlias(
  header: string | null,
  composerAliases: readonly InboxComposerAliasOption[],
): string | null {
  for (const emailAddress of extractEmailAddresses(header)) {
    const match = composerAliases.find(
      (option) => option.alias.toLowerCase() === emailAddress,
    );

    if (match !== undefined) {
      return match.alias;
    }
  }

  return null;
}

export function buildForwardSubject(originalSubject: string): string {
  return FORWARD_SUBJECT_PREFIX_PATTERN.test(originalSubject)
    ? originalSubject
    : `Fwd: ${originalSubject}`;
}

export function buildForwardBodyPlaintext(
  context: InboxComposerForwardContext,
): string {
  const headerLines = [
    "---------- Forwarded message ----------",
    `From: ${context.originalFromLabel}`,
    `Date: ${formatForwardedDate(context.originalOccurredAtIso)}`,
    `Subject: ${context.originalSubject}`,
    `To: ${context.originalToLabel}`,
    ...(context.originalCcLabel === null
      ? []
      : [`Cc: ${context.originalCcLabel}`]),
    "",
    context.originalBodyPlaintext,
  ];

  return `\n\n${headerLines.join("\n")}`;
}

export function buildForwardBodyHtml(
  context: InboxComposerForwardContext,
): string {
  const ccLine =
    context.originalCcLabel === null
      ? ""
      : `<div>Cc: ${escapeHtml(context.originalCcLabel)}</div>`;

  return [
    "<p><br/></p>",
    "<p><br/></p>",
    "<div>---------- Forwarded message ----------</div>",
    `<div>From: ${escapeHtml(context.originalFromLabel)}</div>`,
    `<div>Date: ${escapeHtml(formatForwardedDate(context.originalOccurredAtIso))}</div>`,
    `<div>Subject: ${escapeHtml(context.originalSubject)}</div>`,
    `<div>To: ${escapeHtml(context.originalToLabel)}</div>`,
    ccLine,
    '<blockquote style="border-left:2px solid #cbd5e1; margin:0; padding-left:12px; color:#475569;">',
    context.originalBodyHtml ?? "",
    "</blockquote>",
  ]
    .filter((line) => line.length > 0)
    .join("");
}

export function buildForwardContextFromEntry(input: {
  readonly entry: InboxTimelineEntryViewModel;
  readonly composerAliases: readonly InboxComposerAliasOption[];
  readonly defaultAlias: string | null;
}): InboxComposerForwardContext | null {
  if (input.entry.channel !== "email") {
    return null;
  }

  const originalBody = input.entry.body.trim();
  const originalBodyHtml =
    originalBody.length > 0 && bodyContainsHtml(originalBody)
      ? sanitizeComposerHtml(originalBody)
      : null;
  const originalFromLabel = input.entry.fromHeader?.trim();
  const originalToLabel = input.entry.toHeader?.trim();
  const defaultAlias =
    findMatchingAlias(input.entry.toHeader, input.composerAliases) ??
    findMatchingAlias(input.entry.ccHeader, input.composerAliases) ??
    input.defaultAlias ??
    null;

  return {
    originalEntryId: input.entry.id,
    originalSubject: input.entry.subject ?? "",
    originalFromLabel:
      originalFromLabel && originalFromLabel.length > 0
        ? originalFromLabel
        : "Unknown sender",
    originalToLabel:
      originalToLabel && originalToLabel.length > 0
        ? originalToLabel
        : "Unknown recipient",
    originalCcLabel:
      input.entry.ccHeader?.trim().length ? input.entry.ccHeader.trim() : null,
    originalOccurredAtIso: input.entry.occurredAt,
    originalBodyPlaintext:
      originalBodyHtml === null ? originalBody : htmlToPlaintext(originalBodyHtml),
    originalBodyHtml,
    defaultAlias,
  };
}
