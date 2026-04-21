import { createHash } from "node:crypto";

import type {
  CanonicalEventRecord,
  GmailMessageDetailRecord,
  NormalizedCanonicalEventIntake,
  Provider,
  ProvenanceWinnerReason,
  SalesforceCommunicationDetailRecord
} from "@as-comms/contracts";

export const outboundEmailFingerprintWindowMs = 15 * 60 * 1000;
export const contentFingerprintWindowMs = 5 * 60 * 1000;
export const salesforceSnippetClusterWindowMs = 10 * 60 * 1000;

const trackedQueryParamPattern =
  /^(utm_[a-z0-9_]+|fbclid|gclid|msclkid|mc_cid|mc_eid|vero_[a-z0-9_]+)$/iu;
const emailPrefixPattern = /^\s*→\s*email:\s*/iu;
const replyForwardPrefixPattern = /^(?:(?:re|fwd?|aw):\s*)+/iu;
const subjectArrowPrefixPattern = /^[←→⇐⇒]\s*(?:email:\s*)?/iu;
const externalEmailPrefixPattern = /^\[external email\]\s*/iu;
const conservativeSignatureBoundaryPatterns = [
  /^\s*--\s*$/u,
  /^\s*sent from my (iphone|ipad|android|mobile device)\s*$/iu,
  /^\s*get outlook for (ios|android)\s*$/iu
] as const;
const quotedReplyBoundaryPatterns = [
  /(?:\n|^)\s*On .+ wrote:\s*$/imu,
  /(?:\bOn .+? wrote:)\s*>/isu,
  /(?:\n|^)\s*From:\s.+?(?:Date:|Sent:)\s.+/isu,
  /(?:\n|^)\s*-{2,}\s*Original Message\s*-{2,}/imu,
  /(?:\n|^)\s*Begin forwarded message:/imu,
  /(?:\n|^)\s*Forwarded message:/imu,
  /(?:\n|^)\s*>/mu
] as const;

export interface OutboundEmailFingerprintSource {
  readonly provider: Provider;
  readonly subject: string | null;
  readonly body: string;
}

export interface OutboundEmailDuplicateWinnerSelection {
  readonly winner: "incoming" | "existing";
  readonly winnerReason:
    | "gmail_wins_duplicate_collapse"
    | "earliest_gmail_wins_duplicate_collapse";
  readonly notes: string;
}

export interface OutboundEmailWinnerDecision {
  readonly winnerReason: ProvenanceWinnerReason;
  readonly notes: string | null;
}

export interface ContentFingerprintInput {
  readonly subject: string | null;
  readonly occurredAt: string;
  readonly contactId: string | null;
  readonly channel: CanonicalEventRecord["channel"];
  readonly direction: "inbound" | "outbound" | null;
  readonly previewText?: string | null;
}

function resolveContentFingerprintChannel(
  eventType: NormalizedCanonicalEventIntake["canonicalEvent"]["eventType"]
): CanonicalEventRecord["channel"] | null {
  if (eventType.startsWith("communication.email.")) {
    return "email";
  }

  if (eventType.startsWith("communication.sms.")) {
    return "sms";
  }

  return null;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stripCampaignQueryParamsFromUrls(value: string): string {
  return value.replace(
    /https?:\/\/[^\s<>()]+/giu,
    (candidateUrl) => {
      const trailingPunctuationMatch =
        /[),.;:!?]+$/u.exec(candidateUrl)?.[0] ?? "";
      const urlWithoutTrailing =
        trailingPunctuationMatch.length > 0
          ? candidateUrl.slice(0, -trailingPunctuationMatch.length)
          : candidateUrl;

      try {
        const parsed = new URL(urlWithoutTrailing);
        const entries = Array.from(parsed.searchParams.entries());

        for (const [name] of entries) {
          if (trackedQueryParamPattern.test(name)) {
            parsed.searchParams.delete(name);
          }
        }

        const normalizedSearch = parsed.searchParams.toString();
        parsed.search = normalizedSearch.length === 0 ? "" : `?${normalizedSearch}`;

        return `${parsed.toString()}${trailingPunctuationMatch}`;
      } catch {
        return candidateUrl;
      }
    }
  );
}

function stripTrackingPixelMarkup(value: string): string {
  return value
    .replace(
      /<img\b[^>]*(?:width\s*=\s*["']?1\b|height\s*=\s*["']?1\b|display\s*:\s*none|visibility\s*:\s*hidden|tracking|pixel)[^>]*>/giu,
      " "
    )
    .replace(
      /\[\s*image:\s*tracking pixel\s*\]/giu,
      " "
    );
}

function findForwardedHeaderBlockStart(value: string): number {
  const lines = value.split("\n");
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!/^(From|To|Recipients|Cc|Bcc|Reply-To|Sent|Date|Subject):/iu.test(trimmed)) {
      offset += line.length + 1;
      continue;
    }

    let headerCount = 0;
    let candidateIndex = index;

    while (candidateIndex < lines.length) {
      const candidate = lines[candidateIndex] ?? "";
      const candidateTrimmed = candidate.trim();

      if (candidateTrimmed.length === 0) {
        break;
      }

      if (/^(From|To|Recipients|Cc|Bcc|Reply-To|Sent|Date|Subject):/iu.test(candidateTrimmed)) {
        headerCount += 1;
        candidateIndex += 1;
        continue;
      }

      if (/^[\t ]/u.test(candidate)) {
        candidateIndex += 1;
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

function stripQuotedReplyBlocks(value: string): string {
  let earliestBoundary = -1;

  for (const pattern of quotedReplyBoundaryPatterns) {
    const match = pattern.exec(value);

    if (match === null) {
      continue;
    }

    if (earliestBoundary === -1 || match.index < earliestBoundary) {
      earliestBoundary = match.index;
    }
  }

  const forwardedHeaderBoundary = findForwardedHeaderBlockStart(value);

  if (
    forwardedHeaderBoundary !== -1 &&
    (earliestBoundary === -1 || forwardedHeaderBoundary < earliestBoundary)
  ) {
    earliestBoundary = forwardedHeaderBoundary;
  }

  return (
    earliestBoundary === -1 ? value : value.slice(0, earliestBoundary)
  ).trim();
}

function stripConservativeSignatureBlock(value: string): string {
  const lines = value.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";

    if (
      conservativeSignatureBoundaryPatterns.some((pattern) =>
        pattern.test(line)
      )
    ) {
      return lines.slice(0, index).join("\n").trim();
    }
  }

  return value.trim();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function firstNonEmptyString(
  ...values: readonly (string | null | undefined)[]
): string {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return "";
}

function normalizeSubject(value: string | null): string {
  if (value === null) {
    return "";
  }

  return collapseWhitespace(
    value.replace(emailPrefixPattern, "").toLowerCase()
  );
}

export function normalizeContentFingerprintSubject(
  value: string | null
): string | null {
  if (value === null) {
    return null;
  }

  const normalized = collapseWhitespace(
    value
      .trim()
      .toLowerCase()
      .replace(externalEmailPrefixPattern, "")
      .replace(subjectArrowPrefixPattern, "")
      .replace(replyForwardPrefixPattern, "")
  );

  return normalized.length === 0 ? null : normalized;
}

function normalizeContentFingerprintPreview(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = collapseWhitespace(
    stripConservativeSignatureBlock(
      stripQuotedReplyBlocks(
        stripCampaignQueryParamsFromUrls(
          stripTrackingPixelMarkup(
            normalizeLineEndings(value).toLowerCase()
          )
        )
      )
    )
  );

  return normalized.length === 0 ? null : normalized;
}

function buildMinuteBucket(occurredAt: string): string | null {
  const occurredAtMs = Date.parse(occurredAt);

  if (Number.isNaN(occurredAtMs)) {
    return null;
  }

  return new Date(occurredAtMs).toISOString().slice(0, 16);
}

export function computeContentFingerprint(
  input: ContentFingerprintInput
): string | null {
  if (
    input.contactId === null ||
    input.direction === null ||
    input.channel !== "email"
  ) {
    return null;
  }

  const normalizedSubject = normalizeContentFingerprintSubject(input.subject);
  const normalizedPreview = normalizeContentFingerprintPreview(
    input.previewText
  );
  const minuteBucket = buildMinuteBucket(input.occurredAt);

  if (
    normalizedSubject === null ||
    normalizedPreview === null ||
    minuteBucket === null
  ) {
    return null;
  }

  const key = [
    input.contactId,
    input.channel,
    input.direction,
    minuteBucket,
    normalizedSubject,
    sha256Text(normalizedPreview)
  ].join("|");

  return `fp:${sha256Text(key)}`;
}

export function computePendingComposerOutboundFingerprint(input: {
  readonly contactId: string;
  readonly subject: string;
  readonly bodyPlaintext: string;
  readonly sentAt: string;
}): string | null {
  return computeContentFingerprint({
    subject: input.subject,
    occurredAt: input.sentAt,
    contactId: input.contactId,
    channel: "email",
    direction: "outbound",
    previewText: input.bodyPlaintext,
  });
}

export function computeSalesforceSnippetClusterFingerprint(input: {
  readonly subject: string | null;
  readonly snippet: string;
  readonly contactId: string | null;
  readonly channel: CanonicalEventRecord["channel"];
  readonly direction: "inbound" | "outbound" | null;
}): string | null {
  if (
    input.contactId === null ||
    input.direction === null ||
    input.channel !== "email"
  ) {
    return null;
  }

  const normalizedSubject = normalizeContentFingerprintSubject(input.subject);
  const normalizedSnippet = normalizeContentFingerprintPreview(input.snippet);

  if (normalizedSubject === null || normalizedSnippet === null) {
    return null;
  }

  const key = [
    input.contactId,
    input.channel,
    input.direction,
    normalizedSubject,
    sha256Text(normalizedSnippet)
  ].join("|");

  return `sf:${sha256Text(key)}`;
}

/**
 * Normalizes an outbound email fingerprint conservatively so we collapse only
 * very high-confidence duplicates. The normalizer:
 * - lowercases text
 * - collapses repeated whitespace
 * - strips the Salesforce "→ Email:" subject prefix
 * - trims quoted-reply / forwarded-message blocks
 * - strips only conservative signature markers ("--" and common mobile footers)
 * - removes obvious tracking-pixel markup when literal <img ...> tags survive
 * - drops campaign-style URL query params such as utm_*, fbclid, gclid, mc_*
 *
 * We intentionally do not strip broader valedictions or arbitrary HTML because
 * false negatives are safer than collapsing two distinct operator emails.
 */
export function buildOutboundEmailDuplicateFingerprint(input: {
  readonly subject: string | null;
  readonly body: string;
}): string | null {
  const normalizedSubject = normalizeSubject(input.subject);
  const normalizedBody = collapseWhitespace(
    stripConservativeSignatureBlock(
      stripQuotedReplyBlocks(
        stripCampaignQueryParamsFromUrls(
          stripTrackingPixelMarkup(
            normalizeLineEndings(input.body).toLowerCase()
          )
        )
      )
    )
  );

  if (normalizedSubject.length === 0 && normalizedBody.length === 0) {
    return null;
  }

  return `${normalizedSubject}\n${normalizedBody}`;
}

export function buildIncomingOutboundEmailFingerprintSource(
  input: Pick<
    NormalizedCanonicalEventIntake,
    | "canonicalEvent"
    | "sourceEvidence"
    | "gmailMessageDetail"
    | "salesforceCommunicationDetail"
  >
): OutboundEmailFingerprintSource | null {
  switch (input.sourceEvidence.provider) {
    case "gmail":
      return {
        provider: "gmail",
        subject: input.gmailMessageDetail?.subject ?? null,
        body: firstNonEmptyString(
          input.gmailMessageDetail?.bodyTextPreview,
          input.gmailMessageDetail?.snippetClean,
          input.canonicalEvent.snippet
        )
      };
    case "salesforce":
      return {
        provider: "salesforce",
        subject: input.salesforceCommunicationDetail?.subject ?? null,
        body: firstNonEmptyString(
          input.salesforceCommunicationDetail?.snippet,
          input.canonicalEvent.snippet
        )
      };
    default:
      return null;
  }
}

export function buildPersistedOutboundEmailFingerprintSource(input: {
  readonly event: Pick<CanonicalEventRecord, "sourceEvidenceId" | "provenance">;
  readonly gmailMessageDetailBySourceEvidenceId: ReadonlyMap<
    string,
    GmailMessageDetailRecord
  >;
  readonly salesforceCommunicationDetailBySourceEvidenceId: ReadonlyMap<
    string,
    SalesforceCommunicationDetailRecord
  >;
}): OutboundEmailFingerprintSource | null {
  if (input.event.provenance.primaryProvider === "gmail") {
    const detail = input.gmailMessageDetailBySourceEvidenceId.get(
      input.event.sourceEvidenceId
    );

    if (detail === undefined) {
      return null;
    }

    return {
      provider: "gmail",
      subject: detail.subject,
      body: detail.bodyTextPreview || detail.snippetClean
    };
  }

  if (input.event.provenance.primaryProvider === "salesforce") {
    const detail = input.salesforceCommunicationDetailBySourceEvidenceId.get(
      input.event.sourceEvidenceId
    );

    if (detail === undefined) {
      return null;
    }

    return {
      provider: "salesforce",
      subject: detail.subject,
      body: detail.snippet
    };
  }

  return null;
}

export function buildIncomingContentFingerprintSource(
  input: Pick<
    NormalizedCanonicalEventIntake,
    | "canonicalEvent"
    | "communicationClassification"
    | "gmailMessageDetail"
    | "salesforceCommunicationDetail"
  >
): ContentFingerprintInput | null {
  const channel = resolveContentFingerprintChannel(
    input.canonicalEvent.eventType
  );

  if (channel === null) {
    return null;
  }

  const direction = input.communicationClassification?.direction ?? null;
  const previewText =
    input.gmailMessageDetail?.bodyTextPreview ??
    input.gmailMessageDetail?.snippetClean ??
    input.salesforceCommunicationDetail?.snippet ??
    input.canonicalEvent.snippet ??
    null;
  const subject =
    input.gmailMessageDetail?.subject ??
    input.salesforceCommunicationDetail?.subject ??
    null;

  return {
    subject,
    occurredAt: input.canonicalEvent.occurredAt,
    contactId: null,
    channel,
    direction,
    previewText
  };
}

export function buildPersistedContentFingerprintSource(input: {
  readonly event: Pick<
    CanonicalEventRecord,
    "channel" | "contactId" | "occurredAt" | "provenance"
  >;
  readonly gmailMessageDetailBySourceEvidenceId: ReadonlyMap<
    string,
    GmailMessageDetailRecord
  >;
  readonly salesforceCommunicationDetailBySourceEvidenceId: ReadonlyMap<
    string,
    SalesforceCommunicationDetailRecord
  >;
} & Pick<CanonicalEventRecord, "sourceEvidenceId">): ContentFingerprintInput | null {
  if (input.event.channel !== "email") {
    return null;
  }

  if (
    input.event.provenance.primaryProvider === "gmail"
  ) {
    const detail = input.gmailMessageDetailBySourceEvidenceId.get(
      input.sourceEvidenceId
    );

    if (detail === undefined) {
      return null;
    }

    return {
      subject: detail.subject,
      occurredAt: input.event.occurredAt,
      contactId: input.event.contactId,
      channel: input.event.channel,
      direction: detail.direction,
      previewText: detail.bodyTextPreview || detail.snippetClean
    };
  }

  if (
    input.event.provenance.primaryProvider === "salesforce"
  ) {
    const detail = input.salesforceCommunicationDetailBySourceEvidenceId.get(
      input.sourceEvidenceId
    );

    if (detail === undefined) {
      return null;
    }

    return {
      subject: detail.subject,
      occurredAt: input.event.occurredAt,
      contactId: input.event.contactId,
      channel: input.event.channel,
      direction: input.event.provenance.direction,
      previewText: detail.snippet
    };
  }

  return null;
}

export function isWithinContentFingerprintWindow(input: {
  readonly leftOccurredAt: string;
  readonly rightOccurredAt: string;
  readonly windowMs?: number;
}): boolean {
  const left = Date.parse(input.leftOccurredAt);
  const right = Date.parse(input.rightOccurredAt);

  if (Number.isNaN(left) || Number.isNaN(right)) {
    return false;
  }

  return Math.abs(left - right) <= (input.windowMs ?? contentFingerprintWindowMs);
}

export function selectSalesforceSelfDuplicateWinner(input: {
  readonly incomingOccurredAt: string;
  readonly existingOccurredAt: string;
}): "incoming" | "existing" {
  const incomingOccurredAt = Date.parse(input.incomingOccurredAt);
  const existingOccurredAt = Date.parse(input.existingOccurredAt);

  if (
    Number.isNaN(incomingOccurredAt) ||
    Number.isNaN(existingOccurredAt)
  ) {
    return "existing";
  }

  return incomingOccurredAt < existingOccurredAt ? "incoming" : "existing";
}

export function isWithinOutboundEmailFingerprintWindow(input: {
  readonly leftOccurredAt: string;
  readonly rightOccurredAt: string;
}): boolean {
  const left = Date.parse(input.leftOccurredAt);
  const right = Date.parse(input.rightOccurredAt);

  if (Number.isNaN(left) || Number.isNaN(right)) {
    return false;
  }

  return Math.abs(left - right) <= outboundEmailFingerprintWindowMs;
}

export function selectOutboundEmailDuplicateWinner(input: {
  readonly incoming: Pick<CanonicalEventRecord, "occurredAt"> & {
    readonly provider: Provider;
  };
  readonly existing: Pick<CanonicalEventRecord, "occurredAt"> & {
    readonly provider: Provider;
  };
}): OutboundEmailDuplicateWinnerSelection | null {
  const providers = new Set([input.incoming.provider, input.existing.provider]);

  if (!providers.has("gmail")) {
    return null;
  }

  if (providers.has("salesforce")) {
    return input.incoming.provider === "gmail"
      ? {
          winner: "incoming",
          winnerReason: "gmail_wins_duplicate_collapse",
          notes:
            "Gmail remained the canonical winner over Salesforce for the same outbound email fingerprint within the 15 minute dedup window."
        }
      : {
          winner: "existing",
          winnerReason: "gmail_wins_duplicate_collapse",
          notes:
            "Gmail remained the canonical winner over Salesforce for the same outbound email fingerprint within the 15 minute dedup window."
        };
  }

  if (input.incoming.provider === "gmail" && input.existing.provider === "gmail") {
    const incomingOccurredAt = Date.parse(input.incoming.occurredAt);
    const existingOccurredAt = Date.parse(input.existing.occurredAt);

    if (
      Number.isNaN(incomingOccurredAt) ||
      Number.isNaN(existingOccurredAt)
    ) {
      return {
        winner: "existing",
        winnerReason: "earliest_gmail_wins_duplicate_collapse",
        notes:
          "The earliest Gmail evidence remains canonical for the same outbound email fingerprint; exact timestamps could not be parsed, so the existing row was kept."
      };
    }

    if (incomingOccurredAt < existingOccurredAt) {
      return {
        winner: "incoming",
        winnerReason: "earliest_gmail_wins_duplicate_collapse",
        notes:
          "The earliest Gmail evidence remained canonical for the same outbound email fingerprint within the 15 minute dedup window."
      };
    }

    return {
      winner: "existing",
      winnerReason: "earliest_gmail_wins_duplicate_collapse",
      notes:
        "The earliest Gmail evidence remained canonical for the same outbound email fingerprint within the 15 minute dedup window."
    };
  }

  return null;
}

export function resolveOutboundEmailMergedWinnerDecision(input: {
  readonly primaryProvider: Provider;
  readonly supportingProviders: readonly Provider[];
  readonly fallback: OutboundEmailWinnerDecision;
}): OutboundEmailWinnerDecision {
  const supportingProviders = new Set(input.supportingProviders);

  if (
    input.primaryProvider === "gmail" &&
    supportingProviders.has("salesforce")
  ) {
    return {
      winnerReason: "gmail_wins_duplicate_collapse",
      notes: supportingProviders.has("gmail")
        ? "Gmail remained canonical over Salesforce for the same outbound email fingerprint within the 15 minute dedup window, and later Gmail duplicates were retained as supporting evidence."
        : "Gmail remained canonical over Salesforce for the same outbound email fingerprint within the 15 minute dedup window."
    };
  }

  if (
    input.primaryProvider === "gmail" &&
    supportingProviders.has("gmail")
  ) {
    return {
      winnerReason: "earliest_gmail_wins_duplicate_collapse",
      notes:
        "The earliest Gmail evidence remained canonical for the same outbound email fingerprint within the 15 minute dedup window."
    };
  }

  return input.fallback;
}
