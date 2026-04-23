import { unstable_cache } from "next/cache";

import type {
  CanonicalEventRecord,
  ContactMembershipRecord,
  ContactRecord,
  InboxDrivingEventType,
  InboxProjectionRow,
  TimelineItem,
} from "@as-comms/contracts";

import { recordSensitiveReadForCurrentUserDetached } from "@/src/server/security/audit";
import { getStage1WebRuntime } from "../../../src/server/stage1-runtime";

import { INBOX_FILTERS } from "./filters";
import type {
  InboxActiveProjectOption,
  InboxAvatarTone,
  InboxBucket,
  InboxChannel,
  InboxComposerReplyContext,
  InboxContactSummaryViewModel,
  InboxDetailViewModel,
  InboxFilterId,
  InboxFilterViewModel,
  InboxListItemViewModel,
  InboxListViewModel,
  InboxProjectMembershipViewModel,
  InboxProjectStatus,
  InboxRecentActivityViewModel,
  InboxTimelineCampaignActivityViewModel,
  InboxTimelineEntryKind,
  InboxTimelineEntryViewModel,
  InboxVolunteerStage,
  InboxWelcomeWorkloadViewModel,
} from "./view-models";

interface InboxListCacheRow {
  readonly contact: ContactRecord;
  readonly inboxProjection: InboxProjectionRow;
  readonly memberships: readonly ContactMembershipRecord[];
  readonly latestMessagePreview: {
    readonly subject: string | null;
    readonly body: string;
  } | null;
}

interface InboxListCacheData {
  readonly rows: readonly InboxListCacheRow[];
  readonly projectNameById: Readonly<Record<string, string>>;
  readonly counts: {
    readonly all: number;
    readonly unread: number;
    readonly followUp: number;
    readonly unresolved: number;
    readonly sent: number;
  };
  readonly activeProjects: readonly InboxActiveProjectOption[];
  readonly page: {
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
    readonly total: number;
  };
  readonly freshness: {
    readonly latestUpdatedAt: string | null;
    readonly total: number;
  };
}

interface InboxDetailCacheData {
  readonly contact: ContactRecord;
  readonly inboxProjection: InboxProjectionRow;
  readonly memberships: readonly ContactMembershipRecord[];
  readonly activityTimelineItems: readonly TimelineItem[];
  readonly timelineItems: readonly TimelineItem[];
  readonly campaignActivitySummaryByCampaignId: Readonly<
    Record<string, CampaignActivitySummary>
  >;
  readonly projectNameById: Readonly<Record<string, string>>;
  readonly timelinePage: {
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
    readonly total: number;
  };
  readonly freshness: {
    readonly inboxUpdatedAt: string | null;
    readonly timelineUpdatedAt: string | null;
    readonly timelineCount: number;
  };
}

interface InboxWelcomeWorkloadCacheData {
  readonly projects: InboxWelcomeWorkloadViewModel["projects"];
  readonly totals: InboxWelcomeWorkloadViewModel["totals"];
}

const DEFAULT_INBOX_LIST_PAGE_SIZE = 50;
const DEFAULT_INBOX_TIMELINE_PAGE_SIZE = 40;

type CampaignActivityType = Extract<
  TimelineItem,
  { family: "campaign_email" }
>["activityType"];

interface CampaignActivitySummary {
  sentAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  unsubscribedAt: string | null;
}

const AVATAR_TONES: readonly InboxAvatarTone[] = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "sky",
  "violet",
  "teal",
  "slate",
];

/**
 * Default list sort: last inbound message first.
 * Toggling follow-up does NOT change row ordering.
 */
export const compareInboxRecency = (
  a: InboxListItemViewModel,
  b: InboxListItemViewModel,
): number => {
  if (a.lastInboundAt !== b.lastInboundAt) {
    if (a.lastInboundAt === null) {
      return 1;
    }

    if (b.lastInboundAt === null) {
      return -1;
    }

    return a.lastInboundAt < b.lastInboundAt ? 1 : -1;
  }

  if (a.lastActivityAt !== b.lastActivityAt) {
    return a.lastActivityAt < b.lastActivityAt ? 1 : -1;
  }

  return a.contactId.localeCompare(b.contactId);
};

export const compareInboxOutboundRecency = (
  a: InboxListItemViewModel,
  b: InboxListItemViewModel,
): number => {
  if (a.lastOutboundAt !== b.lastOutboundAt) {
    if (a.lastOutboundAt === null) {
      return 1;
    }

    if (b.lastOutboundAt === null) {
      return -1;
    }

    return a.lastOutboundAt < b.lastOutboundAt ? 1 : -1;
  }

  if (a.lastActivityAt !== b.lastActivityAt) {
    return a.lastActivityAt < b.lastActivityAt ? 1 : -1;
  }

  return a.contactId.localeCompare(b.contactId);
};

function uniqueStrings(
  values: readonly (string | null | undefined)[],
): string[] {
  return Array.from(
    new Set(
      values.filter((value): value is string => typeof value === "string"),
    ),
  );
}

function emptyCampaignActivitySummary(): CampaignActivitySummary {
  return {
    sentAt: null,
    openedAt: null,
    clickedAt: null,
    unsubscribedAt: null,
  };
}

function campaignActivitySummaryKey(
  activityType: CampaignActivityType,
): keyof CampaignActivitySummary {
  switch (activityType) {
    case "sent":
      return "sentAt";
    case "opened":
      return "openedAt";
    case "clicked":
      return "clickedAt";
    case "unsubscribed":
      return "unsubscribedAt";
  }
}

function keepMostRecentTimestamp(
  current: string | null,
  candidate: string,
): string {
  if (current === null) {
    return candidate;
  }

  return current >= candidate ? current : candidate;
}

async function loadCampaignActivitySummaryByCampaignId(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly canonicalEvents: readonly CanonicalEventRecord[];
}): Promise<Readonly<Record<string, CampaignActivitySummary>>> {
  const campaignSourceEvidenceIds = uniqueStrings(
    input.canonicalEvents
      .filter((event) => event.channel === "campaign_email")
      .map((event) => event.sourceEvidenceId),
  );

  if (campaignSourceEvidenceIds.length === 0) {
    return {};
  }

  const details =
    await input.runtime.repositories.mailchimpCampaignActivityDetails.listBySourceEvidenceIds(
      campaignSourceEvidenceIds,
    );
  const detailBySourceEvidenceId = new Map(
    details.map((detail) => [detail.sourceEvidenceId, detail]),
  );
  const summaryByCampaignId: Record<string, CampaignActivitySummary> = {};

  for (const event of input.canonicalEvents) {
    if (event.channel !== "campaign_email") {
      continue;
    }

    const detail = detailBySourceEvidenceId.get(event.sourceEvidenceId);

    if (detail === undefined) {
      continue;
    }

    const campaignId = detail.campaignId;

    if (typeof campaignId !== "string" || campaignId.trim().length === 0) {
      continue;
    }

    const key = campaignId.trim();
    const summary =
      summaryByCampaignId[key] ?? (summaryByCampaignId[key] = emptyCampaignActivitySummary());
    const summaryKey = campaignActivitySummaryKey(detail.activityType);

    summary[summaryKey] = keepMostRecentTimestamp(
      summary[summaryKey],
      event.occurredAt,
    );
  }

  return summaryByCampaignId;
}

function encodeInboxListCursor(input: {
  readonly lastInboundAt: string | null;
  readonly lastOutboundAt: string | null;
  readonly lastActivityAt: string;
  readonly contactId: string;
}): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeInboxListCursor(cursor: string | null): {
  readonly lastInboundAt: string | null;
  readonly lastOutboundAt: string | null;
  readonly lastActivityAt: string;
  readonly contactId: string;
} | null {
  if (cursor === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const lastInboundAt = parsed.lastInboundAt;
    const lastOutboundAt = parsed.lastOutboundAt ?? null;
    const lastActivityAt = parsed.lastActivityAt;
    const contactId = parsed.contactId;

    return (lastInboundAt === null || typeof lastInboundAt === "string") &&
      (lastOutboundAt === null || typeof lastOutboundAt === "string") &&
      typeof lastActivityAt === "string" &&
      typeof contactId === "string"
      ? {
          lastInboundAt: lastInboundAt ?? null,
          lastOutboundAt,
          lastActivityAt,
          contactId,
        }
      : null;
  } catch {
    return null;
  }
}

function toInitials(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2);

  if (parts.length === 0) {
    return "??";
  }

  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function hashString(value: string): number {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function avatarToneForContact(contactId: string): InboxAvatarTone {
  return AVATAR_TONES[hashString(contactId) % AVATAR_TONES.length] ?? "slate";
}

function mapBucket(bucket: InboxProjectionRow["bucket"]): InboxBucket {
  return bucket === "New" ? "new" : "opened";
}

function mapChannel(eventType: InboxDrivingEventType): InboxChannel {
  return eventType.includes(".sms.") ? "sms" : "email";
}

function normalizeMembershipStatus(status: string | null): string | null {
  if (status === null) {
    return null;
  }

  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  return normalized.length > 0 ? normalized : null;
}

function membershipSortRank(membership: ContactMembershipRecord): number {
  switch (normalizeMembershipStatus(membership.status)) {
    case "lead":
      return 0;
    case "applied":
    case "applicant":
      return 1;
    case "in-training":
    case "training":
      return 2;
    case "trip-planning":
      return 3;
    case "in-field":
    case "active":
      return 4;
    case "successful":
    case "completed":
      return 5;
    default:
      return 6;
  }
}

function sortMemberships(
  memberships: readonly ContactMembershipRecord[],
): readonly ContactMembershipRecord[] {
  return [...memberships].sort((left, right) => {
    const rankDifference = membershipSortRank(left) - membershipSortRank(right);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    if (left.projectId !== right.projectId) {
      return (left.projectId ?? "").localeCompare(right.projectId ?? "");
    }

    return left.id.localeCompare(right.id);
  });
}

function mapVolunteerStage(
  memberships: readonly ContactMembershipRecord[],
): InboxVolunteerStage {
  const primaryMembership = sortMemberships(memberships)[0] ?? null;
  const normalizedStatus = normalizeMembershipStatus(
    primaryMembership?.status ?? null,
  );

  switch (normalizedStatus) {
    case "lead":
      return "lead";
    case "applied":
    case "applicant":
      return "applicant";
    case "in-training":
    case "training":
    case "trip-planning":
    case "in-field":
    case "active":
      return "active";
    case "successful":
    case "completed":
      return "alumni";
    default:
      return "non-volunteer";
  }
}

function mapProjectStatus(status: string | null): InboxProjectStatus {
  switch (normalizeMembershipStatus(status)) {
    case "lead":
      return "lead";
    case "applied":
    case "applicant":
      return "applied";
    case "in-training":
    case "training":
      return "in-training";
    case "trip-planning":
      return "trip-planning";
    case "in-field":
    case "active":
      return "in-field";
    case "successful":
    case "completed":
      return "successful";
    default:
      return "applied";
  }
}

function resolveProjectName(
  membership: ContactMembershipRecord,
  projectNameById: Readonly<Record<string, string>>,
): string | null {
  if (membership.projectId === null) {
    return null;
  }

  return projectNameById[membership.projectId] ?? membership.projectId;
}

function buildProjectMembershipViewModel(
  membership: ContactMembershipRecord,
  projectNameById: Readonly<Record<string, string>>,
): InboxProjectMembershipViewModel | null {
  const projectName = resolveProjectName(membership, projectNameById);

  if (projectName === null || membership.projectId === null) {
    return null;
  }

  return {
    membershipId: membership.id,
    projectId: membership.projectId,
    projectName,
    // Gap: the canonical membership season/year is not persisted yet, so the
    // shell keeps its existing contract with a selector-derived current year.
    year: new Date().getUTCFullYear(),
    status: mapProjectStatus(membership.status),
    // Right-rail links must target the volunteer's Salesforce membership
    // record for that specific project context.
    crmUrl: `https://adventurescientists.lightning.force.com/lightning/r/Expedition_Members__c/${encodeURIComponent(
      membership.id,
    )}/view`,
  };
}

function isPastProject(status: InboxProjectStatus): boolean {
  return status === "successful";
}

function formatJoinedAtLabel(createdAt: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  return `Joined ${formatter.format(new Date(createdAt))}`;
}

function formatRelativeTimestamp(
  timestamp: string,
  referenceNowIso: string,
): string {
  const target = new Date(timestamp).getTime();
  const now = new Date(referenceNowIso).getTime();
  const deltaMs = Math.max(0, now - target);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (deltaMs < hour) {
    const minutes = Math.max(1, Math.floor(deltaMs / minute));
    return `${minutes.toString()}m ago`;
  }

  if (deltaMs < day) {
    const hours = Math.floor(deltaMs / hour);
    return `${hours.toString()}h ago`;
  }

  const days = Math.floor(deltaMs / day);

  if (days === 1) {
    return "yesterday";
  }

  if (days < 7) {
    return `${days.toString()}d ago`;
  }

  if (days < 30) {
    return `${Math.floor(days / 7).toString()}w ago`;
  }

  if (days < 365) {
    return `${Math.floor(days / 30).toString()}mo ago`;
  }

  return `${Math.floor(days / 365).toString()}y ago`;
}

function normalizeInlineText(value: string | null | undefined): string | null {
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

function decodeQuotedPrintable(value: string): string {
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

function stripMimeScaffolding(value: string): string {
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

function sanitizePreviewText(value: string): string {
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

function restoreStructuredEmailParagraphs(value: string): string {
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

interface ParsedPreview {
  readonly structuredEmail: boolean;
  readonly fromAddresses: readonly string[];
  readonly recipientAddresses: readonly string[];
  readonly subject: string | null;
  readonly body: string;
}

interface ResolvedMessagePreview {
  readonly subject: string | null;
  readonly body: string;
  readonly directionPreview: ParsedPreview | null;
}

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

function extractEmailAddresses(value: string | null | undefined): string[] {
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

function trimQuotedReplyContent(value: string): string {
  const normalized = sanitizePreviewText(value);

  if (normalized.length === 0) {
    return "";
  }

  const boundaries = [
    /(?:\n|^)\s*On .+ wrote:\s*$/im,
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

function parseCommunicationPreview(raw: string): ParsedPreview {
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

function resolvePreferredMessagePreview(input: {
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

    if (body.length === 0 && parsed.body.length > 0) {
      body = parsed.body;
      continue;
    }

    if (sanitizedFallback.length === 0) {
      const sanitized = sanitizePreviewText(rawCandidate);

      if (sanitized.length > 0) {
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

function splitHeadlineAndBody(value: string): {
  readonly headline: string | null;
  readonly body: string;
} {
  const lines = value
    .split("\n")
    .map((line) => normalizeInlineText(line))
    .filter((line): line is string => line !== null);
  const headline = lines[0] ?? null;
  const body = lines.slice(1).join("\n").trim();

  return {
    headline,
    body,
  };
}

function suppressDuplicateHeadlineBody(
  headline: string | null,
  body: string,
): string {
  const normalizedHeadline = normalizeInlineText(headline);
  const normalizedBody = normalizeInlineText(body);

  if (
    normalizedHeadline !== null &&
    normalizedBody !== null &&
    normalizedHeadline.toLowerCase() === normalizedBody.toLowerCase()
  ) {
    return "";
  }

  return body;
}

function campaignHeadlineAndBody(
  item: Extract<TimelineItem, { family: "campaign_email" | "campaign_sms" }>,
): {
  readonly headline: string | null;
  readonly body: string;
} {
  if (item.family === "campaign_email") {
    const parsedPreview = parseCommunicationPreview(item.snippet);

    if (parsedPreview.subject !== null) {
      return {
        headline: parsedPreview.subject,
        body:
          resolveDisplayableOutboundSubject(parsedPreview.subject) === null
            ? parsedPreview.body
            : suppressDuplicateHeadlineBody(
                parsedPreview.subject,
                parsedPreview.body,
              ),
      };
    }

    const cleaned =
      parsedPreview.body.length > 0
        ? parsedPreview.body
        : (normalizeInlineText(item.summary) ?? "");

    const split = splitHeadlineAndBody(cleaned);

    return {
      headline:
        split.headline ??
        normalizeInlineText(item.campaignName) ??
        normalizeInlineText(item.summary),
      body: cleaned,
    };
  }

  const resolvedPreview = resolvePreferredMessagePreview({
    rawCandidates: [item.messageTextPreview],
  });
  const cleaned =
    resolvedPreview.body.length > 0
      ? resolvedPreview.body
      : (normalizeInlineText(item.summary) ?? "");
  const split = splitHeadlineAndBody(cleaned);

  return {
    headline:
      split.headline ??
      normalizeInlineText(item.campaignName) ??
      normalizeInlineText(item.summary),
    body: split.body.length > 0 ? split.body : cleaned,
  };
}

function fallbackOneToOneEmailBody(
  item: Extract<TimelineItem, { family: "one_to_one_email" }>,
): string {
  const normalizedSummary = normalizeInlineText(item.summary) ?? "";

  if (
    item.primaryProvider === "salesforce" &&
    /^(outbound|inbound) email (sent|received)$/i.test(normalizedSummary)
  ) {
    return "Email body not cached - open in Salesforce";
  }

  return normalizedSummary;
}

function timelineLifecycleBodyLabel(
  item: Extract<TimelineItem, { family: "salesforce_event" }>,
): string {
  const context =
    normalizeInlineText(item.projectName) ??
    normalizeInlineText(item.expeditionName);

  switch (item.milestone) {
    case "signed_up":
      return context === null ? "Signed up" : `Signed up for ${context}`;
    case "received_training":
      return context === null
        ? "Received training"
        : `Received training for ${context}`;
    case "completed_training":
      return context === null
        ? "Completed training"
        : `Completed training for ${context}`;
    case "submitted_first_data":
      return context === null
        ? "Submitted first data"
        : `Submitted first data for ${context}`;
  }
}

function lifecycleRailActivityLabel(
  item: Extract<TimelineItem, { family: "salesforce_event" }>,
): string {
  const projectContext =
    normalizeInlineText(item.projectName) ??
    normalizeInlineText(item.expeditionName);

  switch (item.milestone) {
    case "signed_up":
      return projectContext === null
        ? "Signed up"
        : `Signed up - ${projectContext}`;
    case "received_training":
      return projectContext === null
        ? "Received training"
        : `Received training - ${projectContext}`;
    case "completed_training":
      return projectContext === null
        ? "Completed training"
        : `Completed training - ${projectContext}`;
    case "submitted_first_data":
      return projectContext === null
        ? "Submitted first data"
        : `Submitted first data - ${projectContext}`;
  }
}

function fallbackLatestSubject(eventType: InboxDrivingEventType): string {
  switch (eventType) {
    case "communication.email.inbound":
      return "Inbound email received";
    case "communication.email.outbound":
      return "Outbound email sent";
    case "communication.sms.inbound":
      return "Inbound SMS received";
    case "communication.sms.outbound":
      return "Outbound SMS sent";
  }
}

function defaultLatestSubject(
  eventType: InboxDrivingEventType,
  fallback: string | null,
  previewSubject: string | null,
): string {
  const normalizedFallback = normalizeInlineText(fallback);

  if (normalizedFallback !== null) {
    return normalizedFallback;
  }

  if (previewSubject !== null) {
    return previewSubject;
  }

  return fallbackLatestSubject(eventType);
}

function mapTimelineKind(item: TimelineItem): InboxTimelineEntryKind {
  switch (item.family) {
    case "one_to_one_email":
      return item.direction === "inbound" ? "inbound-email" : "outbound-email";
    case "one_to_one_sms":
      return item.direction === "inbound" ? "inbound-sms" : "outbound-sms";
    case "auto_email":
      return "outbound-auto-email";
    case "auto_sms":
      return "outbound-auto-sms";
    case "campaign_email":
      return "outbound-campaign-email";
    case "campaign_sms":
      return "outbound-campaign-sms";
    case "internal_note":
      return "internal-note";
    case "salesforce_event":
      return "system-event";
  }
}

function inferPreviewDirection(
  preview: ParsedPreview | null,
  contactPrimaryEmail: string | null,
): "inbound" | "outbound" | null {
  const normalizedContactEmail = normalizeInlineText(contactPrimaryEmail);
  const contactEmail =
    normalizedContactEmail === null
      ? null
      : normalizedContactEmail.toLowerCase();

  if (preview === null || !preview.structuredEmail || contactEmail === null) {
    return null;
  }

  const fromContact = preview.fromAddresses.includes(contactEmail);
  const recipientContact = preview.recipientAddresses.includes(contactEmail);

  if (fromContact && !recipientContact) {
    return "inbound";
  }

  if (recipientContact && !fromContact) {
    return "outbound";
  }

  return null;
}

function isLegacySalesforceEmailWithoutMessageDetail(
  item: TimelineItem,
): boolean {
  return (
    item.family === "one_to_one_email" &&
    item.primaryProvider === "salesforce" &&
    normalizeInlineText(item.subject) === null &&
    sanitizePreviewText(item.bodyPreview ?? "") === "" &&
    parseCommunicationPreview(item.snippet).body === ""
  );
}

function buildRecentActivity(
  timelineItems: readonly TimelineItem[],
  referenceNowIso: string,
): readonly InboxRecentActivityViewModel[] {
  return [...timelineItems]
    .filter(
      (item): item is Extract<TimelineItem, { family: "salesforce_event" }> =>
        item.family === "salesforce_event",
    )
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      label: lifecycleRailActivityLabel(item),
      occurredAtLabel: formatRelativeTimestamp(
        item.occurredAt,
        referenceNowIso,
      ),
    }));
}

function timelineChannel(item: TimelineItem): InboxChannel | null {
  switch (item.family) {
    case "one_to_one_email":
    case "auto_email":
    case "campaign_email":
      return "email";
    case "auto_sms":
    case "one_to_one_sms":
    case "campaign_sms":
      return "sms";
    case "internal_note":
    case "salesforce_event":
      return null;
  }
}

function timelineActorLabel(
  item: TimelineItem,
  contactDisplayName: string,
  kind: InboxTimelineEntryKind,
): string {
  if (kind === "inbound-email" || kind === "inbound-sms") {
    return contactDisplayName;
  }

  if (kind === "outbound-email" || kind === "outbound-sms") {
    return "You";
  }

  if (kind === "email-activity") {
    return "Email activity";
  }

  switch (item.family) {
    case "one_to_one_email":
    case "one_to_one_sms":
      return "You";
    case "auto_email":
    case "auto_sms":
      return item.sourceLabel;
    case "campaign_email":
    case "campaign_sms":
      return "Campaigns";
    case "internal_note":
      return item.authorDisplayName ?? "Internal note";
    case "salesforce_event":
      return "System";
  }
}

const OUTBOUND_SUBJECT_PREFIX_PATTERN =
  /^\s*(?:(?:→|->|&rarr;|\u2192)\s*)?Email:\s*/i;

function stripOutboundSubjectPrefix(subject: string | null): string | null {
  const normalized = normalizeInlineText(subject);

  if (normalized === null) {
    return null;
  }

  return normalizeInlineText(
    normalized.replace(OUTBOUND_SUBJECT_PREFIX_PATTERN, ""),
  );
}

function looksLikeUrl(subject: string): boolean {
  return /^https?:\/\//i.test(subject.trim());
}

function resolveDisplayableOutboundSubject(
  subject: string | null,
): string | null {
  const stripped = stripOutboundSubjectPrefix(subject);

  if (stripped === null || looksLikeUrl(stripped)) {
    return null;
  }

  return stripped;
}

function timelineSubject(item: TimelineItem): string | null {
  switch (item.family) {
    case "one_to_one_email":
      return (
        normalizeInlineText(item.subject) ??
        parseCommunicationPreview(item.snippet).subject
      );
    case "auto_email":
      return resolveDisplayableOutboundSubject(
        normalizeInlineText(item.subject) ??
          parseCommunicationPreview(item.snippet).subject,
      );
    case "auto_sms":
      return null;
    case "campaign_email":
      return resolveDisplayableOutboundSubject(
        parseCommunicationPreview(item.snippet).subject,
      );
    case "campaign_sms":
      return campaignHeadlineAndBody(item).headline;
    case "one_to_one_sms":
    case "internal_note":
    case "salesforce_event":
      return null;
  }
}

const REPLY_SUBJECT_PREFIX_PATTERN = /^\s*(?:(?:re|fwd?)\s*:\s*)+/i;

function buildReplySubject(subject: string | null): string {
  const normalizedSubject = normalizeInlineText(subject);

  if (normalizedSubject === null) {
    return "";
  }

  const trimmedSubject = normalizeInlineText(
    normalizedSubject.replace(REPLY_SUBJECT_PREFIX_PATTERN, ""),
  );

  return trimmedSubject === null ? "" : `Re: ${trimmedSubject}`;
}

function timelineBody(item: TimelineItem): string {
  switch (item.family) {
    case "one_to_one_email":
      return stripSignature(
        trimQuotedReplyContent(item.bodyPreview ?? "") ||
          parseCommunicationPreview(item.snippet).body ||
          fallbackOneToOneEmailBody(item),
      );
    case "one_to_one_sms":
      return item.messageTextPreview;
    case "auto_email":
      return stripSignature(
        parseCommunicationPreview(item.snippet).body || item.summary,
      );
    case "auto_sms":
      return item.messageTextPreview;
    case "campaign_email":
      return stripSignature(campaignHeadlineAndBody(item).body);
    case "campaign_sms":
      return campaignHeadlineAndBody(item).body;
    case "internal_note":
      return item.body;
    case "salesforce_event":
      return timelineLifecycleBodyLabel(item);
  }
}

function formatCampaignActivityLabel(
  activityType: Exclude<CampaignActivityType, "sent">,
  occurredAtLabel: string,
): string {
  switch (activityType) {
    case "opened":
      return `Opened ${occurredAtLabel}`;
    case "clicked":
      return `Clicked ${occurredAtLabel}`;
    case "unsubscribed":
      return `Unsubscribed ${occurredAtLabel}`;
  }
}

function buildCampaignActivityViewModels(input: {
  readonly item: Extract<TimelineItem, { family: "campaign_email" }>;
  readonly campaignActivitySummaryByCampaignId: Readonly<
    Record<string, CampaignActivitySummary>
  >;
  readonly referenceNowIso: string;
}): readonly InboxTimelineCampaignActivityViewModel[] {
  const campaignId = input.item.campaignId;

  if (campaignId === null) {
    return [];
  }

  const summary = input.campaignActivitySummaryByCampaignId[campaignId];

  if (summary === undefined) {
    return [];
  }

  const activities: readonly Exclude<CampaignActivityType, "sent">[] = [
    "opened",
    "clicked",
    "unsubscribed",
  ];

  return activities.flatMap((activityType) => {
    const occurredAt =
      activityType === "opened"
        ? summary.openedAt
        : activityType === "clicked"
          ? summary.clickedAt
          : summary.unsubscribedAt;

    if (occurredAt === null || activityType === input.item.activityType) {
      return [];
    }

    const occurredAtLabel = formatRelativeTimestamp(
      occurredAt,
      input.referenceNowIso,
    );

    return [
      {
        activityType,
        occurredAt,
        occurredAtLabel,
        label: formatCampaignActivityLabel(activityType, occurredAtLabel),
      } satisfies InboxTimelineCampaignActivityViewModel,
    ];
  });
}

function isPreviewTimelineItem(item: TimelineItem): boolean {
  switch (item.family) {
    case "salesforce_event":
    case "internal_note":
      return false;
    case "auto_email":
    case "auto_sms":
    case "campaign_email":
    case "campaign_sms":
    case "one_to_one_email":
    case "one_to_one_sms":
      return true;
  }
}

function buildTimelineEntry(input: {
  readonly contactDisplayName: string;
  readonly contactPrimaryEmail: string | null;
  readonly inboxProjection: InboxProjectionRow;
  readonly item: TimelineItem;
  readonly campaignActivitySummaryByCampaignId: Readonly<
    Record<string, CampaignActivitySummary>
  >;
  readonly referenceNowIso: string;
}): InboxTimelineEntryViewModel {
  const latestProjectionSnippet =
    input.item.family === "one_to_one_email" &&
    input.item.canonicalEventId === input.inboxProjection.lastCanonicalEventId
      ? input.inboxProjection.snippet
      : null;
  const latestProjectionDirectionPreview =
    latestProjectionSnippet === null
      ? null
      : parseCommunicationPreview(latestProjectionSnippet);
  const itemPreview =
    input.item.family === "one_to_one_email"
      ? resolvePreferredMessagePreview({
          explicitSubjects: [input.item.subject],
          rawCandidates: [
            input.item.bodyPreview,
            input.item.snippet,
            latestProjectionSnippet,
          ],
        })
      : null;
  const body = timelineBody(input.item);
  const inferredDirection =
    input.item.family === "one_to_one_email"
      ? inferPreviewDirection(
          itemPreview?.directionPreview ?? latestProjectionDirectionPreview,
          input.contactPrimaryEmail,
        )
      : null;
  const isLegacySalesforceEmail = isLegacySalesforceEmailWithoutMessageDetail(
    input.item,
  );
  const kind =
    input.item.family === "one_to_one_email" &&
    isLegacySalesforceEmail &&
    inferredDirection === null
      ? "email-activity"
      : input.item.family === "one_to_one_email" && inferredDirection !== null
        ? inferredDirection === "inbound"
          ? "inbound-email"
          : "outbound-email"
        : mapTimelineKind(input.item);
  const subject =
    input.item.family === "one_to_one_email"
      ? (itemPreview?.subject ?? null)
      : (timelineSubject(input.item) ?? null);
  const resolvedBody =
    input.item.family === "one_to_one_email"
      ? itemPreview?.body !== undefined && itemPreview.body.length > 0
        ? itemPreview.body
        : body
      : body;
  const hasRenderableEmailContent =
    kind === "inbound-email" || kind === "outbound-email"
      ? subject !== null || resolvedBody.trim().length > 0
      : true;
  const finalKind =
    !hasRenderableEmailContent && input.item.family === "one_to_one_email"
      ? "email-activity"
      : kind;
  const campaignActivity =
    input.item.family === "campaign_email"
      ? buildCampaignActivityViewModels({
          item: input.item,
          campaignActivitySummaryByCampaignId:
            input.campaignActivitySummaryByCampaignId,
          referenceNowIso: input.referenceNowIso,
        })
      : [];
  const isUnread =
    input.inboxProjection.bucket === "New" &&
    input.item.canonicalEventId ===
      input.inboxProjection.lastCanonicalEventId &&
    (finalKind === "inbound-email" || finalKind === "inbound-sms");

  return {
    id: input.item.id,
    kind: finalKind,
    occurredAt: input.item.occurredAt,
    occurredAtLabel: formatRelativeTimestamp(
      input.item.occurredAt,
      input.referenceNowIso,
    ),
    actorLabel: timelineActorLabel(
      input.item,
      input.contactDisplayName,
      finalKind,
    ),
    subject,
    body: resolvedBody,
    channel: timelineChannel(input.item),
    isUnread,
    isPreview: isPreviewTimelineItem(input.item),
    mailbox:
      input.item.family === "one_to_one_email"
        ? (input.item.mailbox ?? null)
        : null,
    threadId:
      input.item.family === "one_to_one_email"
        ? (input.item.threadId ?? null)
        : null,
    rfc822MessageId:
      input.item.family === "one_to_one_email"
        ? (input.item.rfc822MessageId ?? null)
        : null,
    inReplyToRfc822:
      input.item.family === "one_to_one_email"
        ? (input.item.inReplyToRfc822 ?? null)
        : null,
    sendStatus:
      input.item.family === "one_to_one_email"
        ? (input.item.sendStatus ?? null)
        : null,
    attachmentCount:
      input.item.family === "one_to_one_email"
        ? (input.item.attachmentCount ?? 0)
        : 0,
    campaignActivity,
    noteId: input.item.family === "internal_note" ? input.item.noteId : null,
    authorId:
      input.item.family === "internal_note" ? input.item.authorId : null,
  };
}

function buildComposerReplyContext(input: {
  readonly contact: ContactRecord;
  readonly timelineItems: readonly TimelineItem[];
  readonly defaultAlias: string | null;
}): InboxComposerReplyContext | null {
  const latestInboundEmail = [...input.timelineItems]
    .reverse()
    .find(
      (item): item is Extract<TimelineItem, { family: "one_to_one_email" }> =>
        item.family === "one_to_one_email" && item.direction === "inbound",
    );

  if (latestInboundEmail === undefined) {
    return null;
  }

  return {
    contactId: input.contact.id,
    contactDisplayName: input.contact.displayName,
    subject: buildReplySubject(latestInboundEmail.subject),
    threadId: latestInboundEmail.threadId ?? null,
    inReplyToRfc822: latestInboundEmail.rfc822MessageId ?? null,
    defaultAlias: input.defaultAlias,
  };
}

function groupMembershipsByContactId(
  memberships: readonly ContactMembershipRecord[],
): ReadonlyMap<string, readonly ContactMembershipRecord[]> {
  const grouped = new Map<string, ContactMembershipRecord[]>();

  for (const membership of memberships) {
    const existing = grouped.get(membership.contactId);

    if (existing === undefined) {
      grouped.set(membership.contactId, [membership]);
      continue;
    }

    existing.push(membership);
  }

  return grouped;
}

async function loadProjectNameById(
  memberships: readonly ContactMembershipRecord[],
): Promise<Readonly<Record<string, string>>> {
  const projectIds = uniqueStrings(
    memberships.map((membership) => membership.projectId),
  );

  if (projectIds.length === 0) {
    return {};
  }

  const runtime = await getStage1WebRuntime();
  const dimensions =
    await runtime.repositories.projectDimensions.listByIds(projectIds);

  return Object.fromEntries(
    dimensions.map((dimension) => [dimension.projectId, dimension.projectName]),
  );
}

async function loadLatestSubjectByCanonicalEventId(
  projections: readonly InboxProjectionRow[],
): Promise<
  Readonly<
    Record<
      string,
      {
        readonly subject: string | null;
        readonly body: string;
      }
    >
  >
> {
  const eventIds = uniqueStrings(
    projections.map((projection) => projection.lastCanonicalEventId),
  );

  if (eventIds.length === 0) {
    return {};
  }

  const runtime = await getStage1WebRuntime();
  const canonicalEvents =
    await runtime.repositories.canonicalEvents.listByIds(eventIds);
  const sourceEvidenceIds = uniqueStrings(
    canonicalEvents.map((event) => event.sourceEvidenceId),
  );
  const [
    gmailDetails,
    salesforceCommunicationDetails,
    simpleTextingMessageDetails,
  ] = await Promise.all([
    runtime.repositories.gmailMessageDetails.listBySourceEvidenceIds(
      sourceEvidenceIds,
    ),
    runtime.repositories.salesforceCommunicationDetails.listBySourceEvidenceIds(
      sourceEvidenceIds,
    ),
    runtime.repositories.simpleTextingMessageDetails.listBySourceEvidenceIds(
      sourceEvidenceIds,
    ),
  ]);
  const canonicalEventById = new Map(
    canonicalEvents.map((event) => [event.id, event]),
  );
  const gmailDetailBySourceEvidenceId = new Map(
    gmailDetails.map((detail) => [detail.sourceEvidenceId, detail]),
  );
  const salesforceCommunicationBySourceEvidenceId = new Map(
    salesforceCommunicationDetails.map((detail) => [
      detail.sourceEvidenceId,
      detail,
    ]),
  );
  const simpleTextingBySourceEvidenceId = new Map(
    simpleTextingMessageDetails.map((detail) => [
      detail.sourceEvidenceId,
      detail,
    ]),
  );

  return Object.fromEntries(
    eventIds.map((eventId) => {
      const event = canonicalEventById.get(eventId);

      if (event === undefined) {
        return [
          eventId,
          {
            subject: null,
            body: "",
          },
        ] as const;
      }

      const gmailDetail =
        gmailDetailBySourceEvidenceId.get(event.sourceEvidenceId) ?? null;
      const salesforceDetail =
        salesforceCommunicationBySourceEvidenceId.get(event.sourceEvidenceId) ??
        null;
      const simpleTextingDetail =
        simpleTextingBySourceEvidenceId.get(event.sourceEvidenceId) ?? null;
      const resolvedPreview = resolvePreferredMessagePreview({
        explicitSubjects: [gmailDetail?.subject, salesforceDetail?.subject],
        rawCandidates:
          event.channel === "email"
            ? [
                gmailDetail?.bodyTextPreview,
                gmailDetail?.snippetClean,
                salesforceDetail?.snippet,
              ]
            : [
                simpleTextingDetail?.messageTextPreview,
                salesforceDetail?.snippet,
              ],
      });

      return [
        eventId,
        {
          subject: resolvedPreview.subject,
          body: resolvedPreview.body,
        },
      ] as const;
    }),
  );
}

function totalForFilter(
  counts: {
    readonly all: number;
    readonly unread: number;
    readonly followUp: number;
    readonly unresolved: number;
    readonly sent: number;
  },
  filterId: InboxFilterId,
): number {
  switch (filterId) {
    case "all":
      return counts.all;
    case "unread":
      return counts.unread;
    case "follow-up":
      return counts.followUp;
    case "unresolved":
      return counts.unresolved;
    case "sent":
      return counts.sent;
  }
}

function orderForInboxFilter(
  filterId: InboxFilterId,
): "last-inbound" | "last-outbound" {
  return filterId === "sent" ? "last-outbound" : "last-inbound";
}

async function readInboxListCacheData(input: {
  readonly filterId: InboxFilterId;
  readonly cursor: string | null;
  readonly limit: number;
  readonly query: string | null;
  readonly projectId: string | null;
}): Promise<InboxListCacheData> {
  const runtime = await getStage1WebRuntime();
  const decodedCursor = decodeInboxListCursor(input.cursor);
  const normalizedQuery = normalizeInlineText(input.query) ?? null;
  const order = orderForInboxFilter(input.filterId);
  const [projectionPage, counts, freshness, activeProjectRecords] =
    await Promise.all([
      normalizedQuery === null
        ? runtime.repositories.inboxProjection
            .listPageOrderedByRecency({
              filter: input.filterId,
              order,
              limit: input.limit + 1,
              cursor: decodedCursor,
              projectId: input.projectId,
            })
            .then((rows) => ({
              rows,
              total: 0,
            }))
        : runtime.repositories.inboxProjection.searchPageOrderedByRecency({
            filter: input.filterId,
            order,
            limit: input.limit + 1,
            cursor: decodedCursor,
            query: normalizedQuery,
            projectId: input.projectId,
          }),
      runtime.repositories.inboxProjection.countByFilters({
        projectId: input.projectId,
      }),
      runtime.repositories.inboxProjection.getFreshness(),
      runtime.repositories.projectDimensions.listActive(),
    ]);
  const activeProjects: readonly InboxActiveProjectOption[] =
    activeProjectRecords.map((record) => ({
      id: record.projectId,
      name: record.projectName,
    }));
  const hasMore = projectionPage.rows.length > input.limit;
  const pageProjections = hasMore
    ? projectionPage.rows.slice(0, input.limit)
    : projectionPage.rows;
  const candidateContactIds = pageProjections.map(
    (projection) => projection.contactId,
  );
  const [contacts, memberships, latestMessagePreviewByCanonicalEventId] =
    await Promise.all([
      runtime.repositories.contacts.listByIds(candidateContactIds),
      runtime.repositories.contactMemberships.listByContactIds(
        candidateContactIds,
      ),
      loadLatestSubjectByCanonicalEventId(pageProjections),
    ]);
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const membershipsByContactId = groupMembershipsByContactId(memberships);
  const projectNameById = await loadProjectNameById(memberships);
  const pageRows = pageProjections.flatMap((inboxProjection) => {
    const contact = contactById.get(inboxProjection.contactId);

    if (contact === undefined) {
      return [];
    }

    return [
      {
        contact,
        inboxProjection,
        memberships:
          membershipsByContactId.get(inboxProjection.contactId) ?? [],
        latestMessagePreview:
          latestMessagePreviewByCanonicalEventId[
            inboxProjection.lastCanonicalEventId
          ] ?? null,
      } satisfies InboxListCacheRow,
    ];
  });

  return {
    rows: pageRows,
    projectNameById,
    counts,
    activeProjects,
    page: {
      hasMore,
      nextCursor:
        !hasMore || pageRows.length === 0
          ? null
          : encodeInboxListCursor({
              lastInboundAt:
                pageRows[pageRows.length - 1]?.inboxProjection.lastInboundAt ??
                null,
              lastOutboundAt:
                pageRows[pageRows.length - 1]?.inboxProjection
                  .lastOutboundAt ?? null,
              lastActivityAt:
                pageRows[pageRows.length - 1]?.inboxProjection.lastActivityAt ??
                "",
              contactId: pageRows[pageRows.length - 1]?.contact.id ?? "",
            }),
      total:
        normalizedQuery === null
          ? totalForFilter(counts, input.filterId)
          : projectionPage.total,
    },
    freshness,
  };
}

async function readInboxDetailCacheData(
  contactId: string,
  input: {
    readonly timelineLimit: number;
    readonly timelineCursor: string | null;
  },
): Promise<InboxDetailCacheData | null> {
  const runtime = await getStage1WebRuntime();
  const [
    contact,
    inboxProjection,
    memberships,
    activityTimelineItems,
    timelinePage,
    inboxFreshness,
    timelineFreshness,
    canonicalEvents,
  ] = await Promise.all([
    runtime.repositories.contacts.findById(contactId),
    runtime.repositories.inboxProjection.findByContactId(contactId),
    runtime.repositories.contactMemberships.listByContactId(contactId),
    runtime.timelinePresentation.listTimelineItemsByContactId(contactId),
    runtime.timelinePresentation.listTimelineItemsPageByContactId(contactId, {
      limit: input.timelineLimit,
      beforeSortKey: input.timelineCursor,
    }),
    runtime.repositories.inboxProjection.getFreshnessByContactId(contactId),
    runtime.repositories.timelineProjection.getFreshnessByContactId(contactId),
    runtime.repositories.canonicalEvents.listByContactId(contactId),
  ]);

  if (contact === null || inboxProjection === null) {
    return null;
  }

  return {
    contact,
    inboxProjection,
    memberships,
    activityTimelineItems,
    timelineItems: timelinePage.items,
    campaignActivitySummaryByCampaignId:
      await loadCampaignActivitySummaryByCampaignId({
        runtime,
        canonicalEvents,
      }),
    projectNameById: await loadProjectNameById(memberships),
    timelinePage: {
      hasMore: timelinePage.hasMore,
      nextCursor: timelinePage.hasMore ? timelinePage.nextBeforeSortKey : null,
      total: timelinePage.total,
    },
    freshness: {
      inboxUpdatedAt: inboxFreshness?.updatedAt ?? null,
      timelineUpdatedAt:
        timelineFreshness.latestUpdatedAt ??
        timelinePage.items[timelinePage.items.length - 1]?.occurredAt ??
        null,
      timelineCount: timelinePage.total,
    },
  };
}

function loadInboxListCacheData(input: {
  readonly filterId: InboxFilterId;
  readonly cursor: string | null;
  readonly limit: number;
  readonly query: string | null;
  readonly projectId: string | null;
}) {
  if (process.env.NODE_ENV !== "production") {
    return readInboxListCacheData(input);
  }

  return unstable_cache(
    () => readInboxListCacheData(input),
    [
      `inbox:list:data:${input.filterId}:${input.cursor ?? "first"}:${input.limit.toString()}:${input.query ?? "none"}:${input.projectId ?? "none"}`,
    ],
    {
      tags: ["inbox"],
    },
  )();
}

function loadInboxDetailCacheData(
  contactId: string,
  input: {
    readonly timelineLimit: number;
    readonly timelineCursor: string | null;
  },
) {
  if (process.env.NODE_ENV !== "production") {
    return readInboxDetailCacheData(contactId, input);
  }

  return unstable_cache(
    () => readInboxDetailCacheData(contactId, input),
    [
      `inbox:detail:data:${contactId}:${input.timelineCursor ?? "latest"}:${input.timelineLimit.toString()}`,
    ],
    {
      tags: [
        "inbox",
        `inbox:contact:${contactId}`,
        `timeline:contact:${contactId}`,
      ],
    },
  )();
}

async function readInboxWelcomeWorkloadCacheData(): Promise<InboxWelcomeWorkloadCacheData> {
  const runtime = await getStage1WebRuntime();
  const activeProjects = await runtime.repositories.projectDimensions.listActive();
  const activeProjectIds = new Set(
    activeProjects.map((project) => project.projectId),
  );
  const projectCounts = await Promise.all(
    activeProjects.map((project) =>
      runtime.repositories.inboxProjection.countByFilters({
        projectId: project.projectId,
      }),
    ),
  );
  const allInboxRows =
    activeProjectIds.size === 0
      ? []
      : await runtime.repositories.inboxProjection.listAllOrderedByRecency();
  const memberships =
    allInboxRows.length === 0
      ? []
      : await runtime.repositories.contactMemberships.listByContactIds(
          allInboxRows.map((row) => row.contactId),
        );
  const membershipsByContactId = groupMembershipsByContactId(memberships);
  const activeWorkloadRows = allInboxRows.filter((row) =>
    (membershipsByContactId.get(row.contactId) ?? []).some(
      (membership) =>
        membership.projectId !== null &&
        activeProjectIds.has(membership.projectId),
    ),
  );

  return {
    projects: activeProjects.map((project, index) => {
      const counts = projectCounts[index] ?? {
        all: 0,
        unread: 0,
        followUp: 0,
        unresolved: 0,
      };

      return {
        projectId: project.projectId,
        projectName: project.projectName,
        unreadCount: counts.unread,
        needsFollowUpCount: counts.followUp,
      };
    }),
    totals: {
      activeProjects: activeProjects.length,
      unread: activeWorkloadRows.filter((row) => row.bucket === "New").length,
      needsFollowUp: activeWorkloadRows.filter((row) => row.needsFollowUp)
        .length,
    },
  };
}

function loadInboxWelcomeWorkloadCacheData() {
  if (process.env.NODE_ENV !== "production") {
    return readInboxWelcomeWorkloadCacheData();
  }

  return unstable_cache(
    () => readInboxWelcomeWorkloadCacheData(),
    ["inbox:welcome-workload"],
    {
      tags: ["inbox", "settings:projects"],
    },
  )();
}

function toListItemViewModel(
  row: InboxListCacheRow,
  projectNameById: Readonly<Record<string, string>>,
  referenceNowIso: string,
): InboxListItemViewModel {
  const sortedMemberships = sortMemberships(row.memberships);
  const primaryMembership = sortedMemberships[0] ?? null;
  const preview = resolvePreferredMessagePreview({
    explicitSubjects: [row.latestMessagePreview?.subject],
    rawCandidates: [
      row.latestMessagePreview?.body,
      row.inboxProjection.snippet,
    ],
  });

  return {
    contactId: row.contact.id,
    displayName: row.contact.displayName,
    initials: toInitials(row.contact.displayName),
    avatarTone: avatarToneForContact(row.contact.id),
    latestSubject: defaultLatestSubject(
      row.inboxProjection.lastEventType,
      row.latestMessagePreview?.subject ?? null,
      preview.subject,
    ),
    snippet:
      preview.body ||
      sanitizePreviewText(row.inboxProjection.snippet) ||
      fallbackLatestSubject(row.inboxProjection.lastEventType),
    latestChannel: mapChannel(row.inboxProjection.lastEventType),
    projectLabel:
      primaryMembership === null
        ? null
        : resolveProjectName(primaryMembership, projectNameById),
    volunteerStage: mapVolunteerStage(sortedMemberships),
    bucket: mapBucket(row.inboxProjection.bucket),
    needsFollowUp: row.inboxProjection.needsFollowUp,
    hasUnresolved: row.inboxProjection.hasUnresolved,
    unreadCount: row.inboxProjection.bucket === "New" ? 1 : 0,
    lastInboundAt: row.inboxProjection.lastInboundAt,
    lastOutboundAt: row.inboxProjection.lastOutboundAt,
    lastActivityAt: row.inboxProjection.lastActivityAt,
    lastEventType: row.inboxProjection.lastEventType,
    lastActivityLabel: formatRelativeTimestamp(
      row.inboxProjection.lastActivityAt,
      referenceNowIso,
    ),
  };
}

function buildContactSummary(input: {
  readonly contact: ContactRecord;
  readonly inboxProjection: InboxProjectionRow;
  readonly memberships: readonly ContactMembershipRecord[];
  readonly activityTimelineItems: readonly TimelineItem[];
  readonly projectNameById: Readonly<Record<string, string>>;
  readonly referenceNowIso: string;
}): InboxContactSummaryViewModel {
  const memberships = sortMemberships(input.memberships);
  const projectMemberships = memberships
    .map((membership) =>
      buildProjectMembershipViewModel(membership, input.projectNameById),
    )
    .filter(
      (membership): membership is InboxProjectMembershipViewModel =>
        membership !== null,
    );

  return {
    contactId: input.contact.id,
    displayName: input.contact.displayName,
    volunteerId: input.contact.salesforceContactId ?? input.contact.id,
    primaryEmail: input.contact.primaryEmail,
    primaryPhone: input.contact.primaryPhone,
    joinedAtLabel: formatJoinedAtLabel(input.contact.createdAt),
    hasUnresolved: input.inboxProjection.hasUnresolved,
    activeProjects: projectMemberships.filter(
      (membership) => !isPastProject(membership.status),
    ),
    pastProjects: projectMemberships.filter((membership) =>
      isPastProject(membership.status),
    ),
    recentActivity: buildRecentActivity(
      input.activityTimelineItems,
      input.referenceNowIso,
    ),
  };
}

function matchesServerFilter(
  item: InboxListItemViewModel,
  filterId: InboxFilterId,
): boolean {
  switch (filterId) {
    case "all":
      return true;
    case "unread":
      return item.bucket === "new";
    case "follow-up":
      return item.needsFollowUp;
    case "unresolved":
      return item.hasUnresolved;
    case "sent":
      return item.lastOutboundAt !== null;
  }
}

export async function getInboxList(
  filterId: InboxFilterId = "all",
  input: {
    readonly cursor?: string | null;
    readonly limit?: number;
    readonly query?: string | null;
    readonly projectId?: string | null;
  } = {},
): Promise<InboxListViewModel> {
  const projectId = input.projectId ?? null;
  const cachedData = await loadInboxListCacheData({
    filterId,
    cursor: input.cursor ?? null,
    limit: input.limit ?? DEFAULT_INBOX_LIST_PAGE_SIZE,
    query: input.query ?? null,
    projectId,
  });
  const referenceNowIso = new Date().toISOString();
  const items = cachedData.rows.map((row) =>
    toListItemViewModel(row, cachedData.projectNameById, referenceNowIso),
  );
  const totals = cachedData.counts;
  const filters: InboxFilterViewModel[] = INBOX_FILTERS.map((filter) => ({
    id: filter.id,
    label: filter.label,
    hint: filter.hint,
    count:
      filter.id === "follow-up"
        ? totals.followUp
        : filter.id === "unresolved"
          ? totals.unresolved
          : filter.id === "sent"
            ? totals.sent
            : totals[filter.id],
  }));

  return {
    items: items.filter((item) => matchesServerFilter(item, filterId)),
    filters,
    totals,
    activeProjects: cachedData.activeProjects,
    selectedProjectId: projectId,
    page: cachedData.page,
    freshness: cachedData.freshness,
  };
}

export async function getInboxWelcomeWorkload(): Promise<InboxWelcomeWorkloadViewModel> {
  const cachedData = await loadInboxWelcomeWorkloadCacheData();

  return {
    projects: cachedData.projects,
    totals: cachedData.totals,
  };
}

export async function getInboxTimelinePage(
  contactId: string,
  input: {
    readonly cursor?: string | null;
    readonly limit?: number;
  } = {},
): Promise<{
  readonly entries: readonly InboxTimelineEntryViewModel[];
  readonly page: {
    readonly hasMore: boolean;
    readonly nextCursor: string | null;
    readonly total: number;
  };
} | null> {
  const cachedData = await loadInboxDetailCacheData(contactId, {
    timelineLimit: input.limit ?? DEFAULT_INBOX_TIMELINE_PAGE_SIZE,
    timelineCursor: input.cursor ?? null,
  });

  if (cachedData === null) {
    return null;
  }

  const referenceNowIso = new Date().toISOString();

  return {
    entries: cachedData.timelineItems.map((item) =>
      buildTimelineEntry({
        contactDisplayName: cachedData.contact.displayName,
        contactPrimaryEmail: cachedData.contact.primaryEmail,
        inboxProjection: cachedData.inboxProjection,
        item,
        campaignActivitySummaryByCampaignId:
          cachedData.campaignActivitySummaryByCampaignId,
        referenceNowIso,
      }),
    ),
    page: cachedData.timelinePage,
  };
}

export async function getInboxFreshness(contactId?: string): Promise<{
  readonly list: {
    readonly latestUpdatedAt: string | null;
    readonly total: number;
  };
  readonly detail: {
    readonly inboxUpdatedAt: string | null;
    readonly timelineUpdatedAt: string | null;
    readonly timelineCount: number;
  } | null;
}> {
  const runtime = await getStage1WebRuntime();
  const list = await runtime.repositories.inboxProjection.getFreshness();

  if (contactId === undefined) {
    return {
      list,
      detail: null,
    };
  }

  const [inboxFreshness, timelineFreshness] = await Promise.all([
    runtime.repositories.inboxProjection.getFreshnessByContactId(contactId),
    runtime.repositories.timelineProjection.getFreshnessByContactId(contactId),
  ]);

  return {
    list,
    detail: {
      inboxUpdatedAt: inboxFreshness?.updatedAt ?? null,
      timelineUpdatedAt: timelineFreshness.latestUpdatedAt,
      timelineCount: timelineFreshness.total,
    },
  };
}

export async function getInboxDetail(
  contactId: string,
  input: {
    readonly timelineCursor?: string | null;
    readonly timelineLimit?: number;
  } = {},
): Promise<InboxDetailViewModel | null> {
  const cachedData = await loadInboxDetailCacheData(contactId, {
    timelineLimit: input.timelineLimit ?? DEFAULT_INBOX_TIMELINE_PAGE_SIZE,
    timelineCursor: input.timelineCursor ?? null,
  });

  if (cachedData === null) {
    return null;
  }

  recordSensitiveReadForCurrentUserDetached({
    action: "contact.timeline.read",
    entityType: "contact",
    entityId: contactId,
    metadataJson: {
      timelineCount: cachedData.timelinePage.total,
    },
  });

  const runtime = await getStage1WebRuntime();
  const referenceNowIso = new Date().toISOString();
  const composerReplyContext = buildComposerReplyContext({
    contact: cachedData.contact,
    timelineItems: cachedData.timelineItems,
    defaultAlias:
      await runtime.timelinePresentation.findLastInboundAliasForContact(
        contactId,
      ),
  });

  return {
    contact: buildContactSummary({
      contact: cachedData.contact,
      inboxProjection: cachedData.inboxProjection,
      memberships: cachedData.memberships,
      activityTimelineItems: cachedData.activityTimelineItems,
      projectNameById: cachedData.projectNameById,
      referenceNowIso,
    }),
    timeline: cachedData.timelineItems.map((item) =>
      buildTimelineEntry({
        contactDisplayName: cachedData.contact.displayName,
        contactPrimaryEmail: cachedData.contact.primaryEmail,
        inboxProjection: cachedData.inboxProjection,
        item,
        campaignActivitySummaryByCampaignId:
          cachedData.campaignActivitySummaryByCampaignId,
        referenceNowIso,
      }),
    ),
    bucket: mapBucket(cachedData.inboxProjection.bucket),
    needsFollowUp: cachedData.inboxProjection.needsFollowUp,
    smsEligible: cachedData.contact.primaryPhone !== null,
    composerReplyContext,
    timelinePage: cachedData.timelinePage,
    freshness: cachedData.freshness,
  };
}
