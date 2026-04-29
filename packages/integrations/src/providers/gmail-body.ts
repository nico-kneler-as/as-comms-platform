import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";

export interface GmailApiMessagePartHeader {
  readonly name: string;
  readonly value: string;
}

export interface GmailApiMessagePartBody {
  readonly attachmentId?: string | null | undefined;
  readonly data?: string | null | undefined;
  readonly size?: number | null | undefined;
}

export interface GmailApiMessagePart {
  readonly mimeType?: string | null | undefined;
  readonly filename?: string | null | undefined;
  readonly headers?: readonly GmailApiMessagePartHeader[] | null | undefined;
  readonly body?: GmailApiMessagePartBody | null | undefined;
  readonly parts?: readonly GmailApiMessagePart[] | null | undefined;
}

const MIME_HEADER_LINE_PATTERN =
  /^(Content-Type|Content-Transfer-Encoding|Content-Disposition|MIME-Version|charset|boundary|name|filename):/i;

const SIMPLE_PARSER_OPTIONS = {
  skipImageLinks: true,
  skipTextToHtml: true
} as const;

interface CandidateBodyPart {
  readonly kind: "plain" | "html";
  readonly part: GmailApiMessagePart;
}

interface GmailMimeBoundsConfig {
  readonly maxDepth: number;
  readonly maxParts: number;
  readonly maxDecodedBytes: number;
  readonly parseTimeoutMs: number;
}

type GmailMimeBudgetName =
  | "depth"
  | "parts"
  | "decoded_bytes"
  | "parse_timeout_ms";

interface GmailMimeBudgetContext {
  readonly bounds: GmailMimeBoundsConfig;
  readonly messageIdentifier: string;
  readonly warnedBudgets: Set<GmailMimeBudgetName>;
}

interface GmailMimeTraversalState {
  visitedParts: number;
  budgetExceeded: boolean;
}

interface GmailMimeDecodeState {
  decodedBytes: number;
  budgetExceeded: boolean;
}

interface SerializedMimePart {
  readonly decodedBody: Buffer;
  readonly serializedPart: Buffer;
}

export type GmailBodyKind =
  | "plaintext"
  | "encrypted_placeholder"
  | "binary_fallback";

export interface GmailBodyPreviewResult {
  readonly bodyTextPreview: string;
  readonly bodyKind: GmailBodyKind;
}

export interface GmailAttachmentMetadata {
  readonly partIndexPath: string;
  readonly mimeType: string;
  readonly filename: string | null;
  readonly sizeBytes: number;
  readonly gmailAttachmentId: string;
}

const ENCRYPTED_MESSAGE_PLACEHOLDER =
  "[Encrypted message — open in Gmail to read]";
const BINARY_FALLBACK_PLACEHOLDER =
  "[Message body could not be extracted — open in Gmail]";
const ENCRYPTED_MIME_TYPES = new Set([
  "application/pkcs7-mime",
  "application/x-pkcs7-mime",
  "multipart/encrypted",
  "application/pgp-encrypted"
]);
const DENYLISTED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pkcs7-signature",
  "application/pgp-signature",
]);

const REPLACEMENT_CHARACTER = "�";

// Threshold: 30% replacement-or-control chars means the byte stream couldn't
// be decoded as UTF-8 and is almost certainly an encrypted/binary payload that
// our MIME-type allowlist (ENCRYPTED_MIME_TYPES) didn't recognize — for
// example, an `application/pkcs7-mime` body misdeclared as `text/plain`, or a
// signed-but-not-listed envelope. Legitimate emails with the occasional
// private-use Unicode char come in well under 10%; encrypted bodies measured
// in production sit at ~50%.
const BINARY_NOISE_THRESHOLD = 0.3;
const BINARY_NOISE_MIN_LENGTH = 32;
const DEFAULT_GMAIL_MIME_MAX_DEPTH = 64;
const DEFAULT_GMAIL_MIME_MAX_PARTS = 512;
const DEFAULT_GMAIL_MIME_MAX_DECODED_BYTES = 20 * 1024 * 1024;
const DEFAULT_GMAIL_MIME_PARSE_TIMEOUT_MS = 10_000;

class GmailMimeParseTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Gmail MIME parsing exceeded timeout of ${String(timeoutMs)}ms.`);
    this.name = "GmailMimeParseTimeoutError";
  }
}

function parsePositiveIntEnv(
  envName: string,
  defaultValue: number
): number {
  const parsedValue = Number.parseInt(process.env[envName] ?? "", 10);

  if (!Number.isFinite(parsedValue)) {
    return defaultValue;
  }

  return Math.max(1, parsedValue);
}

function readGmailMimeBoundsConfig(): GmailMimeBoundsConfig {
  return {
    maxDepth: parsePositiveIntEnv(
      "GMAIL_MIME_MAX_DEPTH",
      DEFAULT_GMAIL_MIME_MAX_DEPTH
    ),
    maxParts: parsePositiveIntEnv(
      "GMAIL_MIME_MAX_PARTS",
      DEFAULT_GMAIL_MIME_MAX_PARTS
    ),
    maxDecodedBytes: parsePositiveIntEnv(
      "GMAIL_MIME_MAX_DECODED_BYTES",
      DEFAULT_GMAIL_MIME_MAX_DECODED_BYTES
    ),
    parseTimeoutMs: parsePositiveIntEnv(
      "GMAIL_MIME_PARSE_TIMEOUT_MS",
      DEFAULT_GMAIL_MIME_PARSE_TIMEOUT_MS
    )
  };
}

function createGmailMimeBudgetContext(
  messageIdentifier?: string | null
): GmailMimeBudgetContext {
  return {
    bounds: readGmailMimeBoundsConfig(),
    messageIdentifier: messageIdentifier?.trim().length
      ? messageIdentifier
      : "unknown",
    warnedBudgets: new Set<GmailMimeBudgetName>()
  };
}

function warnGmailMimeBudgetExceeded(
  context: GmailMimeBudgetContext,
  budgetName: GmailMimeBudgetName,
  limit: number
): void {
  if (context.warnedBudgets.has(budgetName)) {
    return;
  }

  context.warnedBudgets.add(budgetName);
  console.warn("Gmail MIME parsing budget exceeded.", {
    budgetName,
    limit,
    messageIdentifier: context.messageIdentifier
  });
}

function markTraversalBudgetExceeded(
  context: GmailMimeBudgetContext,
  traversalState: GmailMimeTraversalState,
  budgetName: "depth" | "parts",
  limit: number
): void {
  traversalState.budgetExceeded = true;
  warnGmailMimeBudgetExceeded(context, budgetName, limit);
}

function markDecodedBytesBudgetExceeded(
  context: GmailMimeBudgetContext,
  decodeState: GmailMimeDecodeState
): void {
  decodeState.budgetExceeded = true;
  warnGmailMimeBudgetExceeded(
    context,
    "decoded_bytes",
    context.bounds.maxDecodedBytes
  );
}

function visitChildPart(
  context: GmailMimeBudgetContext,
  traversalState: GmailMimeTraversalState
): boolean {
  traversalState.visitedParts += 1;

  if (traversalState.visitedParts > context.bounds.maxParts) {
    markTraversalBudgetExceeded(
      context,
      traversalState,
      "parts",
      context.bounds.maxParts
    );
    return true;
  }

  return false;
}

export function isLikelyBinaryNoise(text: string): boolean {
  if (text.length < BINARY_NOISE_MIN_LENGTH) {
    return false;
  }

  let suspicious = 0;
  let total = 0;

  for (const ch of text) {
    total += 1;

    if (ch === REPLACEMENT_CHARACTER) {
      suspicious += 1;
      continue;
    }

    const code = ch.codePointAt(0) ?? 0;

    // C0 controls except TAB, LF, CR. These never appear in cleanly-decoded
    // human text and are a strong signal of mis-decoded binary content.
    if (
      code < 0x20 &&
      code !== 0x09 &&
      code !== 0x0a &&
      code !== 0x0d
    ) {
      suspicious += 1;
    }
  }

  return total > 0 && suspicious / total >= BINARY_NOISE_THRESHOLD;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&#x27;/giu, "'");
}

function decodeQuotedPrintable(value: string): string {
  const unfolded = value.replace(/=(?:\r\n|\r|\n)/gu, "");

  return unfolded.replace(/(?:=[0-9A-F]{2})+/giu, (match) => {
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

function stripMimeScaffolding(value: string): string {
  const normalized = value
    .replace(
      /(?<!\n)(Content-Type:|Content-Transfer-Encoding:|Content-Disposition:|MIME-Version:)/giu,
      "\n$1"
    )
    .replace(
      /(Content-Transfer-Encoding:\s*(?:quoted-printable|base64|7bit|8bit|binary))\s+(?=\S)/giu,
      "$1\n"
    );
  const keptLines: string[] = [];
  let skippingMimeContinuation = false;

  for (const line of normalized.split(/\r\n?|\n/gu)) {
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
      (/^[\t ]/u.test(line) ||
        /^[;=]/u.test(trimmed) ||
        /^(charset|boundary|name|filename)=/iu.test(trimmed))
    ) {
      continue;
    }

    skippingMimeContinuation = false;

    if (
      /^-{2,}(?:Apple-Mail|_mimepart|=_|[0-9A-Za-z][0-9A-Za-z._:-]{8,})/iu.test(
        trimmed
      )
    ) {
      continue;
    }

    keptLines.push(line);
  }

  return keptLines.join("\n");
}

function sanitizePreviewText(value: string): string {
  const mimeAware = stripMimeScaffolding(decodeQuotedPrintable(value));
  const htmlAware = /<[^>]+>/u.test(mimeAware)
    ? mimeAware
        .replace(/<\s*br\s*\/?>/giu, "\n")
        .replace(
          /<\/(p|div|section|article|tr|table|blockquote|ul|ol)\s*>/giu,
          "\n"
        )
        .replace(/<li[^>]*>/giu, "- ")
        .replace(/<\/li\s*>/giu, "\n")
        .replace(/<[^>]+>/gu, " ")
    : mimeAware;

  return decodeHtmlEntities(htmlAware)
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

export function trimQuotedReplyContent(value: string): string {
  const normalized = sanitizePreviewText(value);

  if (normalized.length === 0) {
    return "";
  }

  const boundaries = [
    /(?:\n|^)\s*On .+ wrote:\s*$/imu,
    /(?:\n|^)\s*On .+? wrote:\s*>/su,
    /(?:\n|^)\s*-{2,}\s*Original Message\s*-{2,}/imu,
    /(?:\n|^)\s*Begin forwarded message:/imu,
    /(?:\n|^)\s*Forwarded message:/imu,
    /(?:\n|^)\s*>/mu
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

  return (
    earliestBoundary === -1 ? normalized : normalized.slice(0, earliestBoundary)
  ).trim();
}

export function cleanGmailBodyPreviewText(value: string): string {
  const trimmedQuotedReply = trimQuotedReplyContent(value);
  const normalized =
    trimmedQuotedReply.length > 0
      ? trimmedQuotedReply
      : sanitizePreviewText(value);

  return normalized;
}

function decodeBase64Url(value: string): Buffer {
  const paddedValue =
    value.replace(/-/gu, "+").replace(/_/gu, "/") +
    "=".repeat((4 - (value.length % 4 || 4)) % 4);

  return Buffer.from(paddedValue, "base64");
}

function decodePartBody(
  part: GmailApiMessagePart,
  context: GmailMimeBudgetContext,
  decodeState: GmailMimeDecodeState
): Buffer | null {
  const bodyData = part.body?.data;

  if (typeof bodyData !== "string" || bodyData.length === 0) {
    return null;
  }

  const declaredSize = Math.max(0, part.body?.size ?? 0);

  if (
    declaredSize > 0 &&
    decodeState.decodedBytes + declaredSize > context.bounds.maxDecodedBytes
  ) {
    markDecodedBytesBudgetExceeded(context, decodeState);
    return null;
  }

  try {
    const decodedBody = decodeBase64Url(bodyData);

    if (
      decodeState.decodedBytes + decodedBody.length >
      context.bounds.maxDecodedBytes
    ) {
      markDecodedBytesBudgetExceeded(context, decodeState);
      return null;
    }

    decodeState.decodedBytes += decodedBody.length;
    return decodedBody;
  } catch {
    return null;
  }
}

function decodePartBodyToString(
  part: GmailApiMessagePart,
  context: GmailMimeBudgetContext,
  decodeState: GmailMimeDecodeState
): string | null {
  const decodedBody = decodePartBody(part, context, decodeState);
  return decodedBody?.toString("utf8") ?? null;
}

function getPartHeader(
  part: GmailApiMessagePart,
  headerName: string
): string | null {
  const header = part.headers?.find(
    (candidate) => candidate.name.toLowerCase() === headerName.toLowerCase()
  );

  return header?.value ?? null;
}

function normalizeMimeType(value: string | null | undefined): string {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function extractHeaderValue(
  value: string,
  patterns: readonly RegExp[]
): string | null {
  for (const pattern of patterns) {
    const match = value.match(pattern);

    if (match?.[1] !== undefined) {
      const extracted = match[1].trim();

      if (extracted.length > 0) {
        return extracted;
      }
    }
  }

  return null;
}

export function extractDsnOriginalMessageId(
  payload: GmailApiMessagePart,
  options?: {
    readonly messageIdentifier?: string | null;
  }
): string | null | undefined {
  const context = createGmailMimeBudgetContext(options?.messageIdentifier);
  const traversalState: GmailMimeTraversalState = {
    visitedParts: 0,
    budgetExceeded: false
  };
  const decodeState: GmailMimeDecodeState = {
    decodedBytes: 0,
    budgetExceeded: false
  };

  return extractDsnOriginalMessageIdInternal(
    payload,
    context,
    traversalState,
    decodeState
  );
}

function extractDsnOriginalMessageIdInternal(
  payload: GmailApiMessagePart,
  context: GmailMimeBudgetContext,
  traversalState: GmailMimeTraversalState,
  decodeState: GmailMimeDecodeState,
  depth = 0
): string | null | undefined {
  if (depth > context.bounds.maxDepth) {
    markTraversalBudgetExceeded(
      context,
      traversalState,
      "depth",
      context.bounds.maxDepth
    );
    return undefined;
  }

  const mimeType = normalizeMimeType(payload.mimeType);

  if (mimeType === "message/delivery-status") {
    const decoded = decodePartBodyToString(payload, context, decodeState);

    if (decodeState.budgetExceeded) {
      return undefined;
    }

    if (decoded !== null) {
      const originalMessageId = extractHeaderValue(decoded, [
        /^Original-Message-ID:\s*(.+)$/imu,
        /^Message-ID:\s*(.+)$/imu
      ]);

      if (originalMessageId !== null) {
        return originalMessageId;
      }

      const finalRecipient = extractHeaderValue(decoded, [
        /^Final-Recipient:\s*(.+)$/imu
      ]);

      if (finalRecipient !== null) {
        return finalRecipient;
      }
    }
  }

  if (mimeType === "message/rfc822") {
    const decoded = decodePartBodyToString(payload, context, decodeState);

    if (decodeState.budgetExceeded) {
      return undefined;
    }

    if (decoded !== null) {
      const embeddedMessageId = extractHeaderValue(decoded, [
        /^Message-ID:\s*(.+)$/imu
      ]);

      if (embeddedMessageId !== null) {
        return embeddedMessageId;
      }
    }
  }

  for (const childPart of payload.parts ?? []) {
    if (visitChildPart(context, traversalState)) {
      return undefined;
    }

    const nestedMatch = extractDsnOriginalMessageIdInternal(
      childPart,
      context,
      traversalState,
      decodeState,
      depth + 1
    );

    if (nestedMatch === undefined) {
      return undefined;
    }

    if (nestedMatch !== null) {
      return nestedMatch;
    }
  }

  return null;
}

function buildBodyPreviewResult(
  bodyTextPreview: string,
  bodyKind: GmailBodyKind
): GmailBodyPreviewResult {
  return {
    bodyTextPreview,
    bodyKind
  };
}

export function extractBodyKind(part: GmailApiMessagePart): GmailBodyKind {
  const contentType = normalizeMimeType(
    getPartHeader(part, "Content-Type") ?? part.mimeType ?? null
  );

  return ENCRYPTED_MIME_TYPES.has(contentType)
    ? "encrypted_placeholder"
    : "plaintext";
}

function containsEncryptedBodyPartInternal(
  part: GmailApiMessagePart,
  context: GmailMimeBudgetContext,
  traversalState: GmailMimeTraversalState,
  depth = 0
): boolean {
  if (depth > context.bounds.maxDepth) {
    markTraversalBudgetExceeded(
      context,
      traversalState,
      "depth",
      context.bounds.maxDepth
    );
    return true;
  }

  if (extractBodyKind(part) === "encrypted_placeholder") {
    return true;
  }

  return (part.parts ?? []).some((childPart) => {
    if (visitChildPart(context, traversalState)) {
      return true;
    }

    return containsEncryptedBodyPartInternal(
      childPart,
      context,
      traversalState,
      depth + 1
    );
  });
}

function isAttachmentPart(part: GmailApiMessagePart): boolean {
  if ((part.filename?.trim().length ?? 0) > 0) {
    return true;
  }

  const contentDisposition = getPartHeader(part, "Content-Disposition");
  return contentDisposition?.toLowerCase().includes("attachment") ?? false;
}

export function buildGmailMessageAttachmentId(input: {
  readonly messageId: string;
  readonly partIndexPath: string;
}): string {
  return `att:gmail:${input.messageId}:${input.partIndexPath}`;
}

export function buildGmailMessageAttachmentStorageKey(
  attachmentId: string,
): string {
  const shard = createHash("sha256").update(attachmentId, "utf8").digest("hex");

  return `gmail/${shard.slice(0, 2)}/${attachmentId}`;
}

export function collectGmailAttachmentMetadata(
  payload: GmailApiMessagePart,
): readonly GmailAttachmentMetadata[] {
  const attachments: GmailAttachmentMetadata[] = [];

  function walk(part: GmailApiMessagePart, path: readonly number[]): void {
    const mimeType = normalizeMimeType(part.mimeType);

    if (
      isAttachmentPart(part) &&
      !DENYLISTED_ATTACHMENT_MIME_TYPES.has(mimeType)
    ) {
      const gmailAttachmentId = part.body?.attachmentId?.trim() ?? "";

      if (gmailAttachmentId.length > 0) {
        attachments.push({
          partIndexPath: path.join("/"),
          mimeType: mimeType || "application/octet-stream",
          filename:
            part.filename?.trim().length ? part.filename.trim() : null,
          sizeBytes: Math.max(0, part.body?.size ?? 0),
          gmailAttachmentId,
        });
      }
    }

    for (const [index, childPart] of (part.parts ?? []).entries()) {
      walk(childPart, [...path, index]);
    }
  }

  for (const [index, childPart] of (payload.parts ?? []).entries()) {
    walk(childPart, [index]);
  }

  return attachments;
}

function collectCandidateBodyPartsInternal(
  part: GmailApiMessagePart,
  context: GmailMimeBudgetContext,
  traversalState: GmailMimeTraversalState,
  candidates: CandidateBodyPart[] = [],
  depth = 0
): CandidateBodyPart[] {
  if (depth > context.bounds.maxDepth) {
    markTraversalBudgetExceeded(
      context,
      traversalState,
      "depth",
      context.bounds.maxDepth
    );
    return candidates;
  }

  for (const childPart of part.parts ?? []) {
    if (visitChildPart(context, traversalState)) {
      return candidates;
    }

    collectCandidateBodyPartsInternal(
      childPart,
      context,
      traversalState,
      candidates,
      depth + 1
    );

    if (traversalState.budgetExceeded) {
      return candidates;
    }
  }

  const mimeType = part.mimeType?.toLowerCase() ?? "";

  if (isAttachmentPart(part)) {
    return candidates;
  }

  if (
    typeof part.body?.data === "string" &&
    (mimeType === "text/plain" || mimeType === "text/html")
  ) {
    candidates.push({
      kind: mimeType === "text/plain" ? "plain" : "html",
      part
    });
  }

  return candidates;
}

function serializeMimePart(
  part: GmailApiMessagePart,
  context: GmailMimeBudgetContext,
  decodeState: GmailMimeDecodeState
): SerializedMimePart | null {
  const bodyData = part.body?.data;

  if (typeof bodyData !== "string" || bodyData.length === 0) {
    return null;
  }

  const headerLines = [...(part.headers ?? [])];

  if (!headerLines.some((header) => header.name.toLowerCase() === "content-type")) {
    headerLines.unshift({
      name: "Content-Type",
      value: part.mimeType ?? "text/plain; charset=UTF-8"
    });
  }

  const serializedHeaders = headerLines
    .map((header) => `${header.name}: ${header.value}`)
    .join("\r\n");
  const decodedBody = decodePartBody(part, context, decodeState);

  if (decodedBody === null) {
    return null;
  }

  return {
    decodedBody,
    serializedPart: Buffer.concat([
      Buffer.from(`${serializedHeaders}\r\n\r\n`, "utf8"),
      decodedBody
    ])
  };
}

async function extractTextFromMimeDocument(
  document: string | Buffer,
  context: GmailMimeBudgetContext
): Promise<string> {
  const parsePromise = simpleParser(document, SIMPLE_PARSER_OPTIONS);

  // This timeout only stops awaiting `simpleParser`; mailparser does not
  // expose cancellation, so the abandoned parse may still finish in the
  // background.
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new GmailMimeParseTimeoutError(context.bounds.parseTimeoutMs));
    }, context.bounds.parseTimeoutMs);

    void parsePromise.finally(() => {
      clearTimeout(timeoutHandle);
    });
  });
  const parsed = await Promise.race([parsePromise, timeoutPromise]);

  if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
    return parsed.text;
  }

  if (typeof parsed.html === "string" && parsed.html.trim().length > 0) {
    return parsed.html;
  }

  return "";
}

async function extractTextFromMimePart(
  part: GmailApiMessagePart,
  context: GmailMimeBudgetContext,
  decodeState: GmailMimeDecodeState
): Promise<string> {
  const serializedPart = serializeMimePart(part, context, decodeState);

  if (serializedPart === null) {
    return "";
  }

  try {
    const extractedText = await extractTextFromMimeDocument(
      serializedPart.serializedPart,
      context
    );
    return cleanGmailBodyPreviewText(extractedText);
  } catch (error) {
    if (error instanceof GmailMimeParseTimeoutError) {
      warnGmailMimeBudgetExceeded(
        context,
        "parse_timeout_ms",
        context.bounds.parseTimeoutMs
      );
      return "";
    }

    return cleanGmailBodyPreviewText(serializedPart.decodedBody.toString("utf8"));
  }
}

export async function extractGmailBodyPreviewFromPayloadResult(
  payload: GmailApiMessagePart,
  options?: {
    readonly messageIdentifier?: string | null;
  }
): Promise<GmailBodyPreviewResult> {
  const context = createGmailMimeBudgetContext(options?.messageIdentifier);
  const encryptedTraversalState: GmailMimeTraversalState = {
    visitedParts: 0,
    budgetExceeded: false
  };

  if (
    containsEncryptedBodyPartInternal(
      payload,
      context,
      encryptedTraversalState
    )
  ) {
    return buildBodyPreviewResult(
      ENCRYPTED_MESSAGE_PLACEHOLDER,
      "encrypted_placeholder"
    );
  }

  const candidateTraversalState: GmailMimeTraversalState = {
    visitedParts: 0,
    budgetExceeded: false
  };
  const decodeState: GmailMimeDecodeState = {
    decodedBytes: 0,
    budgetExceeded: false
  };
  const candidates = collectCandidateBodyPartsInternal(
    payload,
    context,
    candidateTraversalState
  );
  let sawGarbledCandidate = false;

  if (candidateTraversalState.budgetExceeded) {
    return buildBodyPreviewResult(
      BINARY_FALLBACK_PLACEHOLDER,
      "binary_fallback"
    );
  }

  for (const kind of ["plain", "html"] as const) {
    for (const candidate of candidates.filter((entry) => entry.kind === kind)) {
      const bodyPreview = await extractTextFromMimePart(
        candidate.part,
        context,
        decodeState
      );

      if (decodeState.budgetExceeded) {
        return buildBodyPreviewResult(
          BINARY_FALLBACK_PLACEHOLDER,
          "binary_fallback"
        );
      }

      if (bodyPreview.length === 0) {
        continue;
      }

      if (isLikelyBinaryNoise(bodyPreview)) {
        // The candidate part decoded to garbled bytes — most likely an
        // encrypted body with a misdeclared MIME type that
        // ENCRYPTED_MIME_TYPES did not catch. Skip it and prefer the binary
        // fallback rather than storing replacement-character soup.
        sawGarbledCandidate = true;
        continue;
      }

      return buildBodyPreviewResult(bodyPreview, "plaintext");
    }
  }

  if (sawGarbledCandidate || (payload.parts?.length ?? 0) > 0) {
    return buildBodyPreviewResult(
      BINARY_FALLBACK_PLACEHOLDER,
      "binary_fallback"
    );
  }

  const fallbackBodyPreview = await extractTextFromMimePart(
    payload,
    context,
    decodeState
  );

  if (decodeState.budgetExceeded) {
    return buildBodyPreviewResult(
      BINARY_FALLBACK_PLACEHOLDER,
      "binary_fallback"
    );
  }

  if (fallbackBodyPreview.length === 0) {
    return buildBodyPreviewResult(cleanGmailBodyPreviewText(""), "plaintext");
  }

  return isLikelyBinaryNoise(fallbackBodyPreview)
    ? buildBodyPreviewResult(BINARY_FALLBACK_PLACEHOLDER, "binary_fallback")
    : buildBodyPreviewResult(fallbackBodyPreview, "plaintext");
}

export async function extractGmailBodyPreviewFromPayload(
  payload: GmailApiMessagePart,
  options?: {
    readonly messageIdentifier?: string | null;
  }
): Promise<string> {
  const result = await extractGmailBodyPreviewFromPayloadResult(
    payload,
    options
  );
  return result.bodyTextPreview;
}

function extractTopLevelContentType(rawMessage: string): string {
  const normalized = rawMessage.replace(/\r\n/gu, "\n");
  const headerBlock = normalized.split(/\n\n/u, 1)[0] ?? "";
  const match = /(?:^|\n)Content-Type:\s*([^\n]+)/iu.exec(headerBlock);

  return normalizeMimeType(match?.[1] ?? null);
}

export async function extractGmailBodyPreviewFromMimeMessageResult(input: {
  readonly rawMessage: string;
  readonly fallbackBodyText?: string | null;
  readonly messageIdentifier?: string | null;
}): Promise<GmailBodyPreviewResult> {
  const context = createGmailMimeBudgetContext(input.messageIdentifier);

  if (ENCRYPTED_MIME_TYPES.has(extractTopLevelContentType(input.rawMessage))) {
    return buildBodyPreviewResult(
      ENCRYPTED_MESSAGE_PLACEHOLDER,
      "encrypted_placeholder"
    );
  }

  try {
    const extractedText = await extractTextFromMimeDocument(
      input.rawMessage,
      context
    );
    const cleaned = cleanGmailBodyPreviewText(extractedText);

    if (cleaned.length > 0) {
      if (isLikelyBinaryNoise(cleaned)) {
        return buildBodyPreviewResult(
          BINARY_FALLBACK_PLACEHOLDER,
          "binary_fallback"
        );
      }
      return buildBodyPreviewResult(cleaned, "plaintext");
    }
  } catch (error) {
    if (error instanceof GmailMimeParseTimeoutError) {
      warnGmailMimeBudgetExceeded(
        context,
        "parse_timeout_ms",
        context.bounds.parseTimeoutMs
      );
    }

    // Fall back to a conservative text clean-up below.
  }

  const fallbackBodyPreview = cleanGmailBodyPreviewText(
    normalizeLineEndings(input.fallbackBodyText ?? "")
  );

  // Raw-message extraction can legitimately return empty (e.g. mbox messages
  // with subject + headers but no body). Treat that as empty plaintext, not
  // a binary-extraction failure — the binary_fallback placeholder is reserved
  // for the parts-based path where we can actually detect binary-only content.
  return buildBodyPreviewResult(fallbackBodyPreview, "plaintext");
}

export async function extractGmailBodyPreviewFromMimeMessage(input: {
  readonly rawMessage: string;
  readonly fallbackBodyText?: string | null;
  readonly messageIdentifier?: string | null;
}): Promise<string> {
  const result = await extractGmailBodyPreviewFromMimeMessageResult(input);
  return result.bodyTextPreview;
}
