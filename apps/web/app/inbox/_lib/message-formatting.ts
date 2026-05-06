export interface ParsedPreview {
  readonly structuredEmail: boolean;
  readonly fromAddresses: readonly string[];
  readonly recipientAddresses: readonly string[];
  readonly subject: string | null;
  readonly body: string;
}

export interface ResolvedMessagePreview {
  readonly subject: string | null;
  readonly body: string;
  readonly directionPreview: ParsedPreview | null;
}

const PREVIEW_NOISE_THRESHOLD = 0.3;
const PREVIEW_NOISE_MIN_LENGTH = 32;
const SHORT_PREVIEW_NOISE_MIN_SUSPICIOUS = 3;
const REPLACEMENT_CHARACTER = "�";

const STRUCTURED_EMAIL_TRANSLATION_MARKER_PATTERN =
  /\b(?:en|es|fr|de|pt):(?=[A-ZÀ-Ý])/g;
const STRUCTURED_EMAIL_PARAGRAPH_STARTERS = [
  "Thank you",
  "Thanks",
  "We are",
  "We're",
  "This",
  "These",
  "That",
  "The project coordinator",
  "The",
  "Gracias",
  "El coordinador",
  "Esta",
  "Este",
  "Estas",
  "Estos",
  "Saludos,",
] as const;

const SIGNATURE_SEPARATOR_PATTERN = /^(?:---|--\s)$/;
const SENT_WITH_SIGNATURE_PATTERN = /^Sent with\b/i;
const SIGN_OFF_PREFIX_PATTERN =
  /^(?:Best|Thanks|Warmly|Cheers|Sincerely|Saludos),/i;

const MIME_HEADER_LINE_PATTERN =
  /^(Content-Type|Content-Transfer-Encoding|Content-Disposition|MIME-Version|charset|boundary|name|filename):/i;
const FORWARDED_HEADER_LINE_PATTERN =
  /^(From|To|Recipients|Cc|Bcc|Reply-To|Sent|Date|Subject):/i;
const STRUCTURED_EMAIL_HEADER_PATTERN =
  /(?:^|\n)(From|To|Recipients|Cc|Bcc|Reply-To|Sent|Date|Subject|Body):/i;
const FROM_HEADER_PATTERN = /(?:^|\n)From:\s*(.+?)(?:\n|$)/i;
const RECIPIENTS_HEADER_PATTERN = /(?:^|\n)(?:Recipients|To):\s*(.+?)(?:\n|$)/i;
const CC_HEADER_PATTERN = /(?:^|\n)Cc:\s*(.+?)(?:\n|$)/i;
const BCC_HEADER_PATTERN = /(?:^|\n)Bcc:\s*(.+?)(?:\n|$)/i;
const REPLY_TO_HEADER_PATTERN = /(?:^|\n)Reply-To:\s*(.+?)(?:\n|$)/i;
const SUBJECT_HEADER_PATTERN = /(?:^|\n)Subject:\s*(.+?)(?:\n|$)/i;
const BODY_HEADER_PATTERN = /(?:^|\n)Body:\s*([\s\S]*)$/i;

function uniqueStrings(
  values: readonly (string | null | undefined)[],
): string[] {
  return Array.from(
    new Set(
      values.filter((value): value is string => typeof value === "string"),
    ),
  );
}

export function normalizeInlineText(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

export function decodeQuotedPrintable(value: string): string {
  const unfolded = value.replace(/=(?:\r\n|\r|\n)/g, "");

  return unfolded.replace(/(?:=[0-9A-F]{2})+/gi, (match) => {
    try {
      const bytes = match
        .split("=")
        .filter((segment) => segment.length > 0)
        .map((segment) => Number.parseInt(segment, 16));
      return Buffer.from(bytes).toString("utf8");
    } catch {
      return match;
    }
  });
}

export function stripMimeScaffolding(value: string): string {
  const normalized = value.replace(
    /(?<!\n)(Content-Type:|Content-Transfer-Encoding:|Content-Disposition:|MIME-Version:)/gi,
    "\n$1",
  );
  const keptLines: string[] = [];
  let skippingMimeContinuation = false;

  for (const line of normalized.split(/\r\n?|\n/)) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      skippingMimeContinuation = false;
      keptLines.push("");
      continue;
    }

    if (MIME_HEADER_LINE_PATTERN.test(trimmed)) {
      skippingMimeContinuation = true;
      continue;
    }

    if (
      skippingMimeContinuation &&
      (/^[\t ]/.test(line) ||
        /^[;=]/.test(trimmed) ||
        /^(charset|boundary|name|filename)=/i.test(trimmed))
    ) {
      continue;
    }

    skippingMimeContinuation = false;

    if (
      /^-{2,}(?:Apple-Mail|_mimepart|=_|[0-9A-Za-z][0-9A-Za-z._:-]{8,})/i.test(
        trimmed,
      )
    ) {
      continue;
    }

    keptLines.push(line);
  }

  return keptLines.join("\n");
}

export function sanitizePreviewText(value: string): string {
  const mimeAware = stripMimeScaffolding(decodeQuotedPrintable(value));
  const htmlAware = /<[^>]+>/.test(mimeAware)
    ? mimeAware
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(
          /<\/(p|div|section|article|tr|table|blockquote|ul|ol)\s*>/gi,
          "\n",
        )
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<\/li\s*>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    : mimeAware;

  return decodeHtmlEntities(htmlAware)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isLikelyPreviewNoise(value: string): boolean {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return false;
  }

  let suspicious = 0;
  let total = 0;

  for (const character of normalized) {
    total += 1;

    if (character === REPLACEMENT_CHARACTER) {
      suspicious += 1;
      continue;
    }

    const code = character.codePointAt(0) ?? 0;

    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      suspicious += 1;
    }
  }

  if (total === 0) {
    return false;
  }

  const ratio = suspicious / total;

  if (total < PREVIEW_NOISE_MIN_LENGTH) {
    return (
      suspicious >= SHORT_PREVIEW_NOISE_MIN_SUSPICIOUS &&
      ratio >= PREVIEW_NOISE_THRESHOLD
    );
  }

  return ratio >= PREVIEW_NOISE_THRESHOLD;
}

function isStandaloneSignOffLine(value: string): boolean {
  const trimmed = value.trim();

  if (!SIGN_OFF_PREFIX_PATTERN.test(trimmed)) {
    return false;
  }

  const remainder = trimmed.replace(SIGN_OFF_PREFIX_PATTERN, "").trim();

  if (remainder.length === 0) {
    return true;
  }

  if (/[.!?]/.test(remainder)) {
    return false;
  }

  return /^[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.&-]*(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.&-]*){0,4}$/u.test(
    remainder,
  );
}

export function restoreStructuredEmailParagraphs(value: string): string {
  const normalized = value.trim();

  if (normalized.length === 0 || normalized.includes("\n")) {
    return normalized;
  }

  const hasGreeting = /^(?:Hi|Hello|Hey|Hola|Dear)\b[^,\n]{0,80},(?=\S)/i.test(
    normalized,
  );
  const hasTranslationMarker =
    STRUCTURED_EMAIL_TRANSLATION_MARKER_PATTERN.test(normalized);
  const sentenceBreaks = normalized.match(/[.!?](?=\S)/g)?.length ?? 0;

  if (!hasGreeting && !hasTranslationMarker && sentenceBreaks < 3) {
    return normalized;
  }

  const paragraphStarterPattern = new RegExp(
    `([.!?])\\s*(?=(?:¡|¿|${STRUCTURED_EMAIL_PARAGRAPH_STARTERS.map((starter) =>
      starter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ).join("|")}))`,
    "g",
  );

  return normalized
    .replace(/^((?:Hi|Hello|Hey|Hola|Dear)\b[^,\n]{0,80},)(?=\S)/i, "$1\n\n")
    .replace(paragraphStarterPattern, "$1\n\n")
    .replace(/([.!?])\s*(?=(?:en|es|fr|de|pt):(?=[A-ZÀ-Ý]))/g, "$1\n\n")
    .replace(STRUCTURED_EMAIL_TRANSLATION_MARKER_PATTERN, "\n\n$&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractEmailAddresses(
  value: string | null | undefined,
): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  return Array.from(
    new Set(
      Array.from(value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)).map(
        (match) => match[0].toLowerCase(),
      ),
    ),
  );
}

export function normalizeEmailAddress(
  value: string | null | undefined,
): string | null {
  const email = extractEmailAddresses(value)[0];
  return email ?? null;
}

function firstNonEmptyNormalized(
  values: readonly (string | null | undefined)[],
): string | null {
  for (const value of values) {
    const normalized = normalizeInlineText(value);

    if (normalized !== null) {
      return normalized;
    }
  }

  return null;
}

function findForwardedHeaderBlockStart(value: string): number {
  const lines = value.split("\n");
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!FORWARDED_HEADER_LINE_PATTERN.test(trimmed)) {
      offset += line.length + 1;
      continue;
    }

    let headerCount = 0;
    let lineIndex = index;

    while (lineIndex < lines.length) {
      const candidate = lines[lineIndex] ?? "";
      const candidateTrimmed = candidate.trim();

      if (candidateTrimmed.length === 0) {
        break;
      }

      if (FORWARDED_HEADER_LINE_PATTERN.test(candidateTrimmed)) {
        headerCount += 1;
        lineIndex += 1;
        continue;
      }

      if (/^[\t ]/.test(candidate)) {
        lineIndex += 1;
        continue;
      }

      break;
    }

    if (headerCount >= 3) {
      return offset;
    }

    offset += line.length + 1;
  }

  return -1;
}

export function trimQuotedReplyContent(value: string): string {
  const normalized = sanitizePreviewText(value);

  if (normalized.length === 0) {
    return "";
  }

  const boundaries = [
    /(?:\n|^)\s*On .+ wrote:\s*$/im,
    /(?:\n|^)\s*On .+? wrote:\s*(?=\n|>)/is,
    /(?:\n|^)\s*El .+ escribi[oó]:\s*(?=\n|>)/is,
    /(?:\n|^)\s*From:\s.+?(?:Date:|Sent:)\s.+/is,
    /(?:\n|^)\s*-{2,}\s*Original Message\s*-{2,}/im,
    /(?:\n|^)\s*Begin forwarded message:/im,
    /(?:\n|^)\s*Forwarded message:/im,
    /(?:\n|^)\s*>/m,
  ];
  let earliestBoundary = -1;

  for (const boundary of boundaries) {
    const match = boundary.exec(normalized);

    if (match === null) {
      continue;
    }

    if (earliestBoundary === -1 || match.index < earliestBoundary) {
      earliestBoundary = match.index;
    }
  }

  const forwardedHeaderBoundary = findForwardedHeaderBlockStart(normalized);

  if (
    forwardedHeaderBoundary !== -1 &&
    (earliestBoundary === -1 || forwardedHeaderBoundary < earliestBoundary)
  ) {
    earliestBoundary = forwardedHeaderBoundary;
  }

  return (
    earliestBoundary === -1 ? normalized : normalized.slice(0, earliestBoundary)
  ).trim();
}

function signatureLooksLikeClosing(
  lines: readonly string[],
  index: number,
): boolean {
  const trailingLines = lines.slice(index);
  const trailingNonEmpty = trailingLines.filter(
    (line) => line.trim().length > 0,
  );

  if (trailingNonEmpty.length === 0 || trailingNonEmpty.length > 6) {
    return false;
  }

  if (index === lines.length - 1) {
    return true;
  }

  return trailingLines.slice(1).some((line) => {
    const trimmed = line.trim();

    return (
      trimmed.length === 0 ||
      /^[A-Z][A-Za-zÀ-ÿ'’.-]+(?:\s+[A-Z][A-Za-zÀ-ÿ'’.-]+){0,3}$/.test(
        trimmed,
      ) ||
      /@|https?:\/\/|\b(?:adventure scientists|docuseal|sent from my)\b/i.test(
        trimmed,
      )
    );
  });
}

export function stripSignature(body: string): string {
  const normalized = body.replace(/\r\n?/g, "\n").trim();

  if (normalized.length === 0) {
    return "";
  }

  const lines = normalized.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? "").trim();

    if (
      SIGNATURE_SEPARATOR_PATTERN.test(trimmed) ||
      SENT_WITH_SIGNATURE_PATTERN.test(trimmed) ||
      /^(?:[-—]\s*)?The Adventure Scientists Team$/i.test(trimmed) ||
      /^Adventure Scientists$/i.test(trimmed)
    ) {
      return lines.slice(0, index).join("\n").trim();
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? "").trim();

    if (
      isStandaloneSignOffLine(trimmed) &&
      signatureLooksLikeClosing(lines, index)
    ) {
      return lines.slice(0, index).join("\n").trim();
    }
  }

  const inlineClosingMatch =
    /([.!?])\s*(?:Best|Thanks|Warmly|Cheers|Sincerely|Saludos),\s*(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.&-]*(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.&-]*){0,4})?\s*$/iu.exec(
      normalized,
    );

  if (
    inlineClosingMatch !== null &&
    inlineClosingMatch.index >= normalized.length - 200
  ) {
    return normalized.slice(0, inlineClosingMatch.index + 1).trim();
  }

  const trailingSignatureMatch =
    /\n+\s*(?:Best|Thanks|Warmly|Cheers|Sincerely|Saludos),\s*(?:[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.&-]*(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'’.&-]*){0,4})?\s*$/iu.exec(
      normalized,
    );

  if (
    trailingSignatureMatch !== null &&
    trailingSignatureMatch.index >= normalized.length - 200
  ) {
    return normalized.slice(0, trailingSignatureMatch.index).trim();
  }

  return normalized;
}

export function parseCommunicationPreview(raw: string): ParsedPreview {
  const sanitized = sanitizePreviewText(raw);

  if (sanitized.length === 0) {
    return {
      structuredEmail: false,
      fromAddresses: [],
      recipientAddresses: [],
      subject: null,
      body: "",
    };
  }

  const structuredEmail = STRUCTURED_EMAIL_HEADER_PATTERN.test(sanitized);
  const fromMatch = FROM_HEADER_PATTERN.exec(sanitized);
  const recipientsMatch = RECIPIENTS_HEADER_PATTERN.exec(sanitized);
  const ccMatch = CC_HEADER_PATTERN.exec(sanitized);
  const bccMatch = BCC_HEADER_PATTERN.exec(sanitized);
  const replyToMatch = REPLY_TO_HEADER_PATTERN.exec(sanitized);
  const subjectMatch = SUBJECT_HEADER_PATTERN.exec(sanitized);
  const subject = normalizeInlineText(subjectMatch?.[1] ?? null);
  const fromAddresses = extractEmailAddresses(fromMatch?.[1]);
  const recipientAddresses = uniqueStrings([
    ...extractEmailAddresses(recipientsMatch?.[1]),
    ...extractEmailAddresses(ccMatch?.[1]),
    ...extractEmailAddresses(bccMatch?.[1]),
    ...extractEmailAddresses(replyToMatch?.[1]),
  ]);

  if (!structuredEmail) {
    return {
      structuredEmail: false,
      fromAddresses,
      recipientAddresses,
      subject: null,
      body: trimQuotedReplyContent(sanitized),
    };
  }

  const bodyMatch = BODY_HEADER_PATTERN.exec(sanitized);

  if (bodyMatch !== null) {
    return {
      structuredEmail: true,
      fromAddresses,
      recipientAddresses,
      subject,
      body: restoreStructuredEmailParagraphs(
        trimQuotedReplyContent(bodyMatch[1] ?? ""),
      ),
    };
  }

  const body = sanitized
    .split("\n")
    .filter(
      (line) =>
        !/^(From|To|Recipients|Cc|Bcc|Reply-To|Sent|Date|Subject|Body):/i.test(
          line.trim(),
        ),
    )
    .join("\n");

  return {
    structuredEmail: true,
    fromAddresses,
    recipientAddresses,
    subject,
    body: restoreStructuredEmailParagraphs(trimQuotedReplyContent(body)),
  };
}

export function resolvePreferredMessagePreview(input: {
  readonly explicitSubjects?: readonly (string | null | undefined)[];
  readonly rawCandidates: readonly (string | null | undefined)[];
}): ResolvedMessagePreview {
  const subjectFromExplicit = firstNonEmptyNormalized(
    input.explicitSubjects ?? [],
  );
  let subjectFromPreview: string | null = null;
  let body = "";
  let sanitizedFallback = "";
  let directionPreview: ParsedPreview | null = null;

  for (const rawCandidate of input.rawCandidates) {
    if (typeof rawCandidate !== "string" || rawCandidate.trim().length === 0) {
      continue;
    }

    const parsed = parseCommunicationPreview(rawCandidate);

    if (
      directionPreview === null &&
      parsed.structuredEmail &&
      (parsed.fromAddresses.length > 0 || parsed.recipientAddresses.length > 0)
    ) {
      directionPreview = parsed;
    }

    if (subjectFromPreview === null && parsed.subject !== null) {
      subjectFromPreview = parsed.subject;
    }

    if (
      body.length === 0 &&
      parsed.body.length > 0 &&
      !isLikelyPreviewNoise(parsed.body)
    ) {
      body = parsed.body;
      continue;
    }

    if (sanitizedFallback.length === 0) {
      const sanitized = sanitizePreviewText(rawCandidate);

      if (sanitized.length > 0 && !isLikelyPreviewNoise(sanitized)) {
        sanitizedFallback = sanitized;
      }
    }
  }

  return {
    subject: subjectFromExplicit ?? subjectFromPreview,
    body: stripSignature(body.length > 0 ? body : sanitizedFallback),
    directionPreview,
  };
}
