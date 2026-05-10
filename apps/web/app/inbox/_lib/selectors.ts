import type {
  AuditEvidenceRecord,
  CanonicalEventType,
  CanonicalEventRecord,
  ContactMembershipRecord,
  ContactRecord,
  InboxProjectionRow,
  MessageAttachmentRecord,
  TimelineItem,
} from "@as-comms/contracts";

import { getCurrentUser } from "@/src/server/auth/session";
import { recordSensitiveReadForCurrentUserDetached } from "@/src/server/security/audit";
import { getStage1WebRuntime } from "../../../src/server/stage1-runtime";
import {
  occurredAtIsOnOrAfterPlatformFullCaptureCutover,
  occurredAtIsBeforePlatformFullCaptureCutover,
  filterItemsAtOrAfterPlatformFullCaptureCutover,
} from "@/app/_lib/cutover";

import { INBOX_FILTERS } from "./filters";
import { formatUtcRailEventDate } from "./format-date";
import {
  extractEmailAddresses,
  normalizeEmailAddress,
  normalizeInlineText,
  type ParsedPreview,
  parseCommunicationPreview,
  resolvePreferredMessagePreview,
  sanitizePreviewText,
  stripSignature,
  trimQuotedReplyContent,
} from "./message-formatting";
import type {
  InboxActiveProjectOption,
  InboxAvatarTone,
  InboxBucket,
  InboxChannel,
  InboxComposerReplyContext,
  InboxContactSummaryViewModel,
  InboxDetailFreshnessViewModel,
  InboxDetailSummaryViewModel,
  InboxDetailTimelinePageViewModel,
  InboxDetailTimelineViewModel,
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
  InboxTimelineEntryParticipantRowViewModel,
  InboxTimelineEntryViewModel,
  InboxUnifiedSearchRowViewModel,
  InboxUnifiedSearchViewModel,
  InboxVolunteerStage,
  InboxWelcomeWorkloadViewModel,
} from "./view-models";
export { groupInboxTimelineSystemMessages } from "./view-models";
export { stripSignature } from "./message-formatting";

type InboxDetailProjection = Omit<
  InboxProjectionRow,
  "lastCanonicalEventId" | "lastEventType"
> & {
  readonly lastCanonicalEventId: string | null;
  readonly lastEventType: CanonicalEventRecord["eventType"] | null;
};

/**
 * Per-project metadata used by the inbox row, conversation header, and
 * contact rail to label and route project chips. The connected-projects
 * fields (`connectedToProjectId`, `hostProjectName`) are populated only
 * when the project rolls up into a host (per PR #384). Standalone or host
 * projects leave both `null` so the chip renders as a single-line label.
 */
interface ProjectMetadataEntry {
  readonly projectName: string;
  readonly isActive: boolean;
  /**
   * `project_dimensions.connected_to_project_id` for connected sub-projects;
   * `null` for standalone or host rows.
   */
  readonly connectedToProjectId: string | null;
  /**
   * Display name to show as the primary chip label when the project is a
   * connected sub. Equals the host's resolved alias-or-name (so the chip
   * reads "Beech & Butternut" for a Beech-only volunteer). `null` for
   * standalone or host projects.
   */
  readonly hostProjectName: string | null;
}

type ProjectMetadataIndex = Readonly<Record<string, ProjectMetadataEntry>>;

function findNewestCanonicalEvent(
  events: readonly CanonicalEventRecord[],
): CanonicalEventRecord | null {
  let newestEvent: CanonicalEventRecord | null = null;

  for (const event of events) {
    if (
      newestEvent === null ||
      event.occurredAt > newestEvent.occurredAt ||
      (event.occurredAt === newestEvent.occurredAt && event.id > newestEvent.id)
    ) {
      newestEvent = event;
    }
  }

  return newestEvent;
}

interface InboxListCacheRow {
  readonly contact: ContactRecord;
  readonly inboxProjection: InboxProjectionRow;
  readonly memberships: readonly ContactMembershipRecord[];
  readonly latestMessagePreview: {
    readonly subject: string | null;
    readonly body: string;
  } | null;
  readonly lastInboundAlias: string | null;
  readonly lastNonAliasMessageAt: string | null;
  readonly isUnread: boolean;
  /**
   * Per-contact map of `projectId -> latest occurredAt` for that project's
   * Salesforce lifecycle events. Powers the same "primary project by last
   * activity" derivation the conversation header uses, so the inbox row's
   * project chip cannot diverge from the header's first chip.
   */
  readonly lastOccurredAtByProjectId: ReadonlyMap<string, string>;
  /**
   * Per-contact fallback used when no active membership exists. Mirrors the
   * conversation header's `conversationProject` (latest SF lifecycle event
   * with a known projectId, mapped through projectMetadataById).
   */
  readonly conversationProjectFallback: {
    readonly projectId: string;
    readonly projectName: string;
  } | null;
}

interface InboxListCacheData {
  readonly rows: readonly InboxListCacheRow[];
  readonly projectLabelById: Readonly<Record<string, string>>;
  readonly projectMetadataById: ProjectMetadataIndex;
  readonly aliasToProjectId: ReadonlyMap<string, string>;
  readonly counts: {
    readonly inbox: number;
    readonly unread: number;
    readonly followUp: number;
    readonly sent: number;
    readonly archived: number;
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
  readonly inboxProjection: InboxDetailProjection;
  readonly projectionAvailable: boolean;
  readonly isUnread: boolean;
  readonly memberships: readonly ContactMembershipRecord[];
  readonly latestNote: {
    readonly body: string;
    readonly authorDisplayName: string | null;
    readonly authorId: string | null;
    readonly createdAt: string;
  } | null;
  readonly activityTimelineItems: readonly TimelineItem[];
  readonly timelineItems: readonly TimelineItem[];
  readonly campaignActivitySummaryByCampaignId: Readonly<
    Record<string, CampaignActivitySummary>
  >;
  readonly canonicalEventById: ReadonlyMap<string, CanonicalEventRecord>;
  readonly projectMetadataById: ProjectMetadataIndex;
  readonly salesforceEventContextBySourceEvidenceId: ReadonlyMap<
    string,
    {
      readonly projectId: string | null;
    }
  >;
  readonly contactDisplayNameByEmail: ReadonlyMap<string, string>;
  readonly projectLabelByAlias: ReadonlyMap<string, string>;
  readonly attachmentsByCanonicalEventId: ReadonlyMap<
    string,
    readonly MessageAttachmentRecord[]
  >;
  readonly timelinePage: InboxDetailTimelinePageViewModel;
  readonly freshness: InboxDetailFreshnessViewModel;
}

interface InboxDetailSummaryCacheData {
  readonly contact: ContactRecord;
  readonly inboxProjection: InboxDetailProjection;
  readonly projectionAvailable: boolean;
  readonly isUnread: boolean;
  readonly memberships: readonly ContactMembershipRecord[];
  readonly latestNote: {
    readonly body: string;
    readonly authorDisplayName: string | null;
    readonly authorId: string | null;
    readonly createdAt: string;
  } | null;
  readonly activityTimelineItems: readonly TimelineItem[];
  readonly canonicalEventById: ReadonlyMap<string, CanonicalEventRecord>;
  readonly projectMetadataById: ProjectMetadataIndex;
  readonly salesforceEventContextBySourceEvidenceId: ReadonlyMap<
    string,
    {
      readonly projectId: string | null;
    }
  >;
  readonly freshness: InboxDetailFreshnessViewModel;
}

interface InboxWelcomeWorkloadCacheData {
  readonly projects: InboxWelcomeWorkloadViewModel["projects"];
  readonly totals: InboxWelcomeWorkloadViewModel["totals"];
  readonly followUpRail: InboxWelcomeWorkloadViewModel["followUpRail"];
}

const DEFAULT_INBOX_LIST_PAGE_SIZE = 50;
const DEFAULT_INBOX_TIMELINE_PAGE_SIZE = 20;
const INBOX_LIST_SCAN_LIMIT = 250;
const WELCOME_FOLLOW_UP_INLINE_LIMIT = 3;

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
  if (a.lastNonAliasMessageAt !== b.lastNonAliasMessageAt) {
    if (a.lastNonAliasMessageAt === null) {
      return 1;
    }

    if (b.lastNonAliasMessageAt === null) {
      return -1;
    }

    return a.lastNonAliasMessageAt < b.lastNonAliasMessageAt ? 1 : -1;
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

function uniqueInboxProjectionsByContactId(
  rows: readonly InboxProjectionRow[],
): InboxProjectionRow[] {
  const seen = new Set<string>();
  const uniqueRows: InboxProjectionRow[] = [];

  for (const row of rows) {
    if (seen.has(row.contactId)) {
      continue;
    }

    seen.add(row.contactId);
    uniqueRows.push(row);
  }

  return uniqueRows;
}

function isInboundInboxEvent(
  eventType: CanonicalEventRecord["eventType"],
): boolean {
  return (
    eventType === "communication.email.inbound" ||
    eventType === "communication.sms.inbound"
  );
}

function buildAliasSetForMemberships(input: {
  readonly memberships: readonly ContactMembershipRecord[];
  readonly aliasesByProjectId: ReadonlyMap<string, readonly string[]>;
}): ReadonlySet<string> {
  const aliases = new Set<string>();

  for (const membership of input.memberships) {
    if (membership.projectId === null) {
      continue;
    }

    for (const alias of input.aliasesByProjectId.get(membership.projectId) ??
      []) {
      aliases.add(alias);
    }
  }

  return aliases;
}

function findLastNonAliasMessageAt(input: {
  readonly events: readonly CanonicalEventRecord[];
  readonly aliasSet: ReadonlySet<string>;
  readonly gmailDetailBySourceEvidenceId: ReadonlyMap<
    string,
    {
      readonly fromHeader: string | null;
    }
  >;
  readonly fallbackLastInboundAt: string | null;
}): string | null {
  if (input.aliasSet.size === 0) {
    return input.fallbackLastInboundAt;
  }

  let lastNonAliasMessageAt: string | null = null;

  for (const event of input.events) {
    if (isInboundInboxEvent(event.eventType)) {
      lastNonAliasMessageAt = keepMostRecentTimestamp(
        lastNonAliasMessageAt,
        event.occurredAt,
      );
      continue;
    }

    if (event.eventType !== "communication.email.outbound") {
      continue;
    }

    const fromAddresses = extractEmailAddresses(
      input.gmailDetailBySourceEvidenceId.get(event.sourceEvidenceId)
        ?.fromHeader,
    );

    if (fromAddresses.length === 0) {
      continue;
    }

    const sentFromAlias = fromAddresses.some((address) =>
      input.aliasSet.has(address),
    );

    if (!sentFromAlias) {
      lastNonAliasMessageAt = keepMostRecentTimestamp(
        lastNonAliasMessageAt,
        event.occurredAt,
      );
    }
  }

  return lastNonAliasMessageAt;
}

function findLastNonAliasOutboundAt(input: {
  readonly events: readonly CanonicalEventRecord[];
  readonly aliasSet: ReadonlySet<string>;
  readonly gmailDetailBySourceEvidenceId: ReadonlyMap<
    string,
    {
      readonly fromHeader: string | null;
    }
  >;
}): string | null {
  if (input.aliasSet.size === 0) {
    return null;
  }

  let lastNonAliasOutboundAt: string | null = null;

  for (const event of input.events) {
    if (event.eventType !== "communication.email.outbound") {
      continue;
    }

    const fromAddresses = extractEmailAddresses(
      input.gmailDetailBySourceEvidenceId.get(event.sourceEvidenceId)
        ?.fromHeader,
    );

    if (fromAddresses.length === 0) {
      continue;
    }

    const sentFromAlias = fromAddresses.some((address) =>
      input.aliasSet.has(address),
    );

    if (!sentFromAlias) {
      lastNonAliasOutboundAt = keepMostRecentTimestamp(
        lastNonAliasOutboundAt,
        event.occurredAt,
      );
    }
  }

  return lastNonAliasOutboundAt;
}

function latestAttentionReadAt(
  audits: readonly {
    readonly action: string;
    readonly occurredAt: string;
  }[],
): string | null {
  let latest: string | null = null;

  for (const audit of audits) {
    if (audit.action !== "inbox.attention.read") {
      continue;
    }

    latest = keepMostRecentTimestamp(latest, audit.occurredAt);
  }

  return latest;
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
    default:
      return "sentAt";
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
      summaryByCampaignId[key] ??
      (summaryByCampaignId[key] = emptyCampaignActivitySummary());
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
  readonly lastNonAliasMessageAt: string | null;
  readonly lastOutboundAt: string | null;
  readonly lastActivityAt: string;
  readonly contactId: string;
}): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeInboxListCursor(cursor: string | null): {
  readonly lastInboundAt: string | null;
  readonly lastNonAliasMessageAt: string | null;
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
    const lastInboundAt = parsed.lastInboundAt ?? null;
    const lastNonAliasMessageAt =
      parsed.lastNonAliasMessageAt ?? parsed.lastInboundAt;
    const lastOutboundAt = parsed.lastOutboundAt ?? null;
    const lastActivityAt = parsed.lastActivityAt;
    const contactId = parsed.contactId;

    return (lastInboundAt === null || typeof lastInboundAt === "string") &&
      (lastNonAliasMessageAt === null ||
        typeof lastNonAliasMessageAt === "string") &&
      (lastOutboundAt === null || typeof lastOutboundAt === "string") &&
      typeof lastActivityAt === "string" &&
      typeof contactId === "string"
      ? {
          lastInboundAt,
          lastNonAliasMessageAt: lastNonAliasMessageAt ?? null,
          lastOutboundAt,
          lastActivityAt,
          contactId,
        }
      : null;
  } catch {
    return null;
  }
}

function toInboxRepositoryCursor(
  cursor: ReturnType<typeof decodeInboxListCursor>,
): {
  readonly lastInboundAt: string | null;
  readonly lastOutboundAt: string | null;
  readonly lastActivityAt: string;
  readonly contactId: string;
} | null {
  if (cursor === null) {
    return null;
  }

  return {
    lastInboundAt: cursor.lastInboundAt,
    lastOutboundAt: cursor.lastOutboundAt,
    lastActivityAt: cursor.lastActivityAt,
    contactId: cursor.contactId,
  };
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

function mapChannel(eventType: CanonicalEventType): InboxChannel {
  switch (eventType) {
    case "communication.sms.inbound":
    case "communication.sms.outbound":
    case "communication.sms.opt_in":
    case "communication.sms.opt_out":
      return "sms";
    default:
      return "email";
  }
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
    case "in-the-field":
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

function buildProjectActivityIndex(timelineItems: readonly TimelineItem[]): {
  readonly lastOccurredAtByProjectId: ReadonlyMap<string, string>;
} {
  const lastOccurredAtByProjectId = new Map<string, string>();

  for (const item of timelineItems) {
    if (item.family !== "salesforce_event" || item.projectId === null) {
      continue;
    }

    const lastOccurredAt =
      lastOccurredAtByProjectId.get(item.projectId) ?? null;

    if (lastOccurredAt === null || item.occurredAt > lastOccurredAt) {
      lastOccurredAtByProjectId.set(item.projectId, item.occurredAt);
    }
  }

  return {
    lastOccurredAtByProjectId,
  };
}

function sortMembershipsByLastActivity(
  memberships: readonly ContactMembershipRecord[],
  lastOccurredAtByProjectId: ReadonlyMap<string, string>,
): readonly ContactMembershipRecord[] {
  return [...memberships].sort((left, right) => {
    const leftLastActivityAt =
      (left.projectId === null
        ? null
        : lastOccurredAtByProjectId.get(left.projectId)) ?? left.createdAt;
    const rightLastActivityAt =
      (right.projectId === null
        ? null
        : lastOccurredAtByProjectId.get(right.projectId)) ?? right.createdAt;
    const activityDifference =
      rightLastActivityAt.localeCompare(leftLastActivityAt);

    if (activityDifference !== 0) {
      return activityDifference;
    }

    if (left.projectId !== right.projectId) {
      return (left.projectId ?? "").localeCompare(right.projectId ?? "");
    }

    return left.id.localeCompare(right.id);
  });
}

export function sortMembershipsByCreatedAt(
  memberships: readonly ContactMembershipRecord[],
): readonly ContactMembershipRecord[] {
  return [...memberships].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
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
    case "in-the-field":
    case "active":
      return "active";
    case "successful":
    case "completed":
      return "alumni";
    default:
      return "non-volunteer";
  }
}

/**
 * Result returned by {@link resolvePrimaryProjectForContact}. Mirrors the
 * shape of `InboxDetailViewModel["conversationProject"]` (without the
 * `source` discriminator) so callers can render either field with the same
 * code path.
 */
export interface ResolvedPrimaryProject {
  readonly projectId: string;
  /**
   * The chip's primary text. For a connected sub this is the host's display
   * name (so the chip reads "Beech & Butternut"); for standalone or host
   * projects it's the project's own name.
   */
  readonly projectName: string;
  /**
   * Sub-project's own name when the resolved project is a connected sub,
   * so the renderer can place "via {subProjectName}" beneath the primary
   * label. `null` for standalone / host projects.
   */
  readonly subProjectName: string | null;
  /** Mirrors {@link InboxProjectMembershipViewModel.isConnectedSub}. */
  readonly isConnectedSub: boolean;
  /**
   * "membership" — derived from an active membership (preferred path).
   * "conversation" — fell through to the latest SF lifecycle event's project
   * because the contact has no active memberships.
   */
  readonly source: "membership" | "conversation";
}

/**
 * Single source of truth for "which project does this contact's
 * conversation belong to?". Both the conversation header (multi-chip
 * region collapsed to its first chip) and the inbox row (single chip)
 * call through here so the two surfaces cannot drift.
 *
 * Order of preference, mirroring `buildContactSummary` + the existing
 * `conversationProject` derivation:
 *   1. The first active membership when sorted by last activity (then
 *      projectId asc, then membershipId asc — same comparator as
 *      `sortMembershipsByLastActivity`). The `lastOccurredAtByProjectId`
 *      index ties activity ordering to real Salesforce timeline events;
 *      pass an empty map to fall back to membership createdAt order.
 *   2. The provided `conversationProjectFallback`, normally the latest
 *      timeline-projection SF event with a known projectId.
 *   3. `null` when neither is available.
 *
 * This replaces the older `resolvePrimaryMembership` that keyed off
 * `lastInboundAlias` + most-recent membership createdAt — that path
 * produced rows whose chip disagreed with the header's chip whenever
 * the alias mapped to a different project than the contact's active
 * membership(s).
 */
export function resolvePrimaryProjectForContact(input: {
  readonly memberships: readonly ContactMembershipRecord[];
  readonly projectMetadataById: ProjectMetadataIndex;
  readonly lastOccurredAtByProjectId: ReadonlyMap<string, string>;
  readonly conversationProjectFallback: {
    readonly projectId: string;
    readonly projectName: string;
  } | null;
}): ResolvedPrimaryProject | null {
  // Match the header's `activeProjects` array exactly: drop past
  // (inactive) projects, and drop memberships whose `projectId` is null
  // because `buildProjectMembershipViewModel` returns null in that case
  // and the header skips them. The candidate set must be identical, or
  // the row's primary chip can race ahead of the header's first chip.
  const activeMemberships = input.memberships.filter(
    (membership) =>
      !isPastProject(membership, input.projectMetadataById) &&
      membership.projectId !== null,
  );
  const sortedActive = sortMembershipsByLastActivity(
    activeMemberships,
    input.lastOccurredAtByProjectId,
  );
  const primary = sortedActive[0] ?? null;

  if (primary !== null && primary.projectId !== null) {
    const metadata = input.projectMetadataById[primary.projectId];
    const ownName = metadata?.projectName ?? primary.projectId;
    const hostName =
      metadata?.connectedToProjectId == null
        ? null
        : metadata.hostProjectName;

    return {
      projectId: primary.projectId,
      projectName: hostName ?? ownName,
      subProjectName: hostName === null ? null : ownName,
      isConnectedSub: hostName !== null,
      source: "membership",
    };
  }

  if (input.conversationProjectFallback !== null) {
    const fallbackId = input.conversationProjectFallback.projectId;
    const metadata = input.projectMetadataById[fallbackId];
    // For the conversation-fallback path the caller already resolved the
    // sub's own name (via the metadata index → `projectName`). Reuse that
    // as the chip's secondary line when the project is a connected sub.
    const ownName = input.conversationProjectFallback.projectName;
    const hostName =
      metadata?.connectedToProjectId == null
        ? null
        : metadata.hostProjectName;

    return {
      projectId: fallbackId,
      projectName: hostName ?? ownName,
      subProjectName: hostName === null ? null : ownName,
      isConnectedSub: hostName !== null,
      source: "conversation",
    };
  }

  return null;
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
    case "in-the-field":
    case "active":
      return "in-field";
    case "successful":
    case "completed":
      return "successful";
    default:
      return "applied";
  }
}

function mapProjectStatusLabel(status: string | null): string {
  switch (normalizeMembershipStatus(status)) {
    case "lead":
      return "Lead";
    case "confirmed":
      return "Confirmed";
    case "applied":
    case "applicant":
      return "Applied";
    case "pending-acceptance":
      return "Pending Acceptance";
    case "accepted":
      return "Accepted";
    case "in-training":
    case "training":
      return "In Training";
    case "trip-planning":
      return "Trip Planning";
    case "in-field":
    case "in-the-field":
    case "active":
      return "In the Field";
    case "returning-gear":
      return "Returning Gear";
    case "successful":
      return "Successful";
    case "completed":
      return "Completed";
    case "denied":
      return "Denied";
    case "declined":
      return "Declined";
    case "aborted":
      return "Aborted";
    case "failed":
      return "Failed";
    case "waitlist":
      return "Waitlist";
    default:
      return "Applied";
  }
}

function buildProjectMembershipViewModel(
  membership: ContactMembershipRecord,
  projectMetadataById: ProjectMetadataIndex,
): InboxProjectMembershipViewModel | null {
  const metadata =
    membership.projectId === null
      ? undefined
      : projectMetadataById[membership.projectId];
  const ownName =
    membership.projectId === null
      ? null
      : (metadata?.projectName ?? membership.projectId);

  if (ownName === null || membership.projectId === null) {
    return null;
  }

  // Connected-sub display: PR #388 keeps the sub's own row (with its own
  // alias-or-name in `metadata.projectName`) and the host's display name in
  // `metadata.hostProjectName`. Only flip into the two-line layout when
  // the host's name actually resolved — otherwise fall back to the sub's
  // own name as a single-line label so we never render an empty primary.
  const hostName =
    metadata?.connectedToProjectId == null
      ? null
      : metadata.hostProjectName;

  return {
    membershipId: membership.id,
    projectId: membership.projectId,
    projectName: hostName ?? ownName,
    subDisplayName: hostName === null ? null : ownName,
    isConnectedSub: hostName !== null,
    projectIsActive: metadata?.isActive ?? false,
    status: mapProjectStatus(membership.status),
    statusLabel: mapProjectStatusLabel(membership.status),
    crmUrl: `https://adventurescientists.lightning.force.com/lightning/r/Project__c/${encodeURIComponent(
      membership.projectId,
    )}/view`,
    expeditionMemberUrl: membership.salesforceMembershipId
      ? `https://adventurescientists.lightning.force.com/lightning/r/Expedition_Members__c/${encodeURIComponent(
          membership.salesforceMembershipId,
        )}/view`
      : null,
  };
}

function isPastProject(
  membership: ContactMembershipRecord,
  projectMetadataById: ProjectMetadataIndex,
): boolean {
  if (membership.projectId === null) {
    return true;
  }

  return !(projectMetadataById[membership.projectId]?.isActive ?? false);
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

const BUBBLE_DAY_KEY_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();
const BUBBLE_TIME_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();
const BUBBLE_MONTH_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const BUBBLE_MONTH_DAY_YEAR_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function bubbleDayKey(timestamp: string, timeZone: string): string {
  let formatter = BUBBLE_DAY_KEY_FORMATTER_CACHE.get(timeZone);

  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    BUBBLE_DAY_KEY_FORMATTER_CACHE.set(timeZone, formatter);
  }

  return formatter.format(new Date(timestamp));
}

function bubbleTimeLabel(timestamp: string, timeZone: string): string {
  let formatter = BUBBLE_TIME_FORMATTER_CACHE.get(timeZone);

  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    });
    BUBBLE_TIME_FORMATTER_CACHE.set(timeZone, formatter);
  }

  return formatter.format(new Date(timestamp));
}

function bubbleYear(timestamp: string, timeZone: string): number {
  return Number.parseInt(bubbleDayKey(timestamp, timeZone).slice(0, 4), 10);
}

export function formatBubbleTimestamp(
  timestamp: string,
  referenceNowIso: string,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const targetDayKey = bubbleDayKey(timestamp, timeZone);
  const referenceDayKey = bubbleDayKey(referenceNowIso, timeZone);

  if (targetDayKey === referenceDayKey) {
    return bubbleTimeLabel(timestamp, timeZone);
  }

  const referenceDate = new Date(referenceNowIso);
  const yesterdayReference = new Date(referenceDate);
  yesterdayReference.setDate(referenceDate.getDate() - 1);

  if (
    targetDayKey === bubbleDayKey(yesterdayReference.toISOString(), timeZone)
  ) {
    return BUBBLE_MONTH_DAY_FORMATTER.format(new Date(timestamp));
  }

  if (
    bubbleYear(timestamp, timeZone) === bubbleYear(referenceNowIso, timeZone)
  ) {
    return BUBBLE_MONTH_DAY_FORMATTER.format(new Date(timestamp));
  }

  return BUBBLE_MONTH_DAY_YEAR_FORMATTER.format(new Date(timestamp));
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

// Mailchimp's plain-text campaign content embeds template artifacts that look
// like noise in the operator timeline:
//   - Merge tags: *|FNAME|*, *|EMAIL|*, *|UNSUB|*, *|ABOUT_LIST|*, etc. — any
//     *|TOKEN|* form, including with default values like *|FNAME:Volunteer|*
//   - Heading markers: lines starting with `** Foo` (Mailchimp's plain-text
//     rendering of strong text)
//   - Long divider lines: rows of 30+ dashes used as section separators
//   - List-management footer: the trailing "This email was sent to *|EMAIL|*"
//     block and "why did I get this?... unsubscribe from this list..." line
const MAILCHIMP_MERGE_TAG_PATTERN = /\*\|[^|*]+\|\*/gu;
const MAILCHIMP_DIVIDER_LINE_PATTERN = /^\s*-{30,}\s*$/u;
const MAILCHIMP_FOOTER_BOUNDARY_PATTERN =
  /^(this email was sent to\s|why did i get this\?|=+\s*$|unsubscribe from this list\b)/iu;

function stripMailchimpFooter(body: string): string {
  const lines = body.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (line.length > 0 && MAILCHIMP_FOOTER_BOUNDARY_PATTERN.test(line)) {
      return lines.slice(0, index).join("\n");
    }
  }
  return body;
}

function sanitizeMailchimpCampaignBody(body: string): string {
  if (body.length === 0) {
    return body;
  }

  return stripMailchimpFooter(body)
    .replace(MAILCHIMP_MERGE_TAG_PATTERN, "")
    .split("\n")
    .map((line) => {
      // Drop standalone `**` lines (Mailchimp wraps headings in `** ... **`
      // pairs that come out as a separate line of stars).
      if (/^\s*\*+\s*$/u.test(line)) {
        return "";
      }
      // Drop pure divider lines.
      if (MAILCHIMP_DIVIDER_LINE_PATTERN.test(line)) {
        return "";
      }
      // Strip leading `**` heading markers; keep the heading text.
      return line.replace(/^\s*\*\*\s+/u, "").replace(/\s*\*\*\s*$/u, "");
    })
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function campaignHeadlineAndBody(
  item: Extract<TimelineItem, { family: "campaign_email" | "campaign_sms" }>,
): {
  readonly headline: string | null;
  readonly body: string;
} {
  if (item.family === "campaign_email") {
    const parsedPreview = parseCommunicationPreview(item.snippet);
    const headline =
      normalizeInlineText(item.campaignName) ??
      resolveDisplayableOutboundSubject(parsedPreview.subject);

    if (parsedPreview.subject !== null) {
      return {
        headline,
        body:
          resolveDisplayableOutboundSubject(parsedPreview.subject) === null
            ? sanitizeMailchimpCampaignBody(parsedPreview.body)
            : sanitizeMailchimpCampaignBody(
                suppressDuplicateHeadlineBody(
                  parsedPreview.subject,
                  parsedPreview.body,
                ),
              ),
      };
    }

    const cleaned =
      parsedPreview.body.length > 0
        ? parsedPreview.body
        : (normalizeInlineText(item.summary) ?? "");

    return {
      headline,
      body: sanitizeMailchimpCampaignBody(cleaned),
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

  if (/^(outbound|inbound) email (sent|received)$/i.test(normalizedSummary)) {
    return item.primaryProvider === "gmail"
      ? "Email body not cached - open in Gmail"
      : "Email body not cached - open in Salesforce";
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
    default:
      return context === null
        ? "Project activity"
        : `Project activity for ${context}`;
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
    default:
      return projectContext === null
        ? "Project activity"
        : `Project activity - ${projectContext}`;
  }
}

function fallbackLatestSubject(eventType: CanonicalEventType): string {
  switch (eventType) {
    case "communication.email.inbound":
      return "Inbound email received";
    case "communication.email.outbound":
      return "Outbound email sent";
    case "communication.sms.inbound":
      return "Inbound SMS received";
    case "communication.sms.outbound":
      return "Outbound SMS sent";
    case "communication.sms.opt_in":
      return "SMS opt-in received";
    case "communication.sms.opt_out":
      return "SMS opt-out received";
    case "lifecycle.signed_up":
      return "Signed up";
    case "lifecycle.received_training":
      return "Received training";
    case "lifecycle.completed_training":
      return "Completed training";
    case "lifecycle.submitted_first_data":
      return "Submitted first data";
    case "campaign.email.sent":
      return "Campaign email sent";
    case "campaign.email.opened":
      return "Campaign email opened";
    case "campaign.email.clicked":
      return "Campaign email clicked";
    case "campaign.email.unsubscribed":
      return "Campaign email unsubscribed";
    case "note.internal.created":
      return "Internal note created";
    default:
      return "Activity recorded";
  }
}

function defaultLatestSubject(
  eventType: CanonicalEventType,
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
    default:
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

function participantHeaderEmails(
  headerValue: string | null,
): readonly string[] {
  if (headerValue === null) {
    return [];
  }

  return uniqueStrings(
    Array.from(headerValue.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu))
      .map((match) => normalizeEmailAddress(match[0]))
      .filter((value): value is string => value !== null),
  );
}

function inferHeaderDirection(input: {
  readonly item: Extract<TimelineItem, { family: "one_to_one_email" }>;
  readonly contactPrimaryEmail: string | null;
}): "inbound" | "outbound" | null {
  const contactEmail = normalizeEmailAddress(input.contactPrimaryEmail);

  if (contactEmail === null) {
    return null;
  }

  const fromEmails = participantHeaderEmails(input.item.fromHeader ?? null);
  const recipientEmails = uniqueStrings([
    ...participantHeaderEmails(input.item.toHeader ?? null),
    ...participantHeaderEmails(input.item.ccHeader ?? null),
  ]);
  const fromContact = fromEmails.includes(contactEmail);
  const recipientContact = recipientEmails.includes(contactEmail);

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
  const lifecycleItems = timelineItems.filter(
    (item): item is Extract<TimelineItem, { family: "salesforce_event" }> =>
      item.family === "salesforce_event",
  );

  const ascendingLifecycleItems = [...lifecycleItems].sort(
    compareLifecycleActivityAscending,
  );
  const mostRecentItemId = ascendingLifecycleItems.at(-1)?.id ?? null;

  // Reverse to newest-first for the rail display.
  return [...ascendingLifecycleItems].reverse().map((item) => ({
    id: item.id,
    label: lifecycleRailActivityLabel(item),
    occurredAtLabel: formatUtcRailEventDate(item.occurredAt, referenceNowIso),
    isMostRecent: item.id === mostRecentItemId,
  }));
}

function lifecycleMilestoneOrdinal(
  milestone: Extract<TimelineItem, { family: "salesforce_event" }>["milestone"],
): number {
  switch (milestone) {
    case "signed_up":
      return 1;
    case "received_training":
      return 2;
    case "completed_training":
      return 3;
    case "submitted_first_data":
      return 4;
  }
}

function utcCalendarDate(occurredAt: string): string {
  return occurredAt.slice(0, 10);
}

function compareLifecycleActivityAscending(
  left: Extract<TimelineItem, { family: "salesforce_event" }>,
  right: Extract<TimelineItem, { family: "salesforce_event" }>,
): number {
  const leftDate = utcCalendarDate(left.occurredAt);
  const rightDate = utcCalendarDate(right.occurredAt);

  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  const leftOrdinal = lifecycleMilestoneOrdinal(left.milestone);
  const rightOrdinal = lifecycleMilestoneOrdinal(right.milestone);

  if (leftOrdinal !== rightOrdinal) {
    return leftOrdinal - rightOrdinal;
  }

  return left.id.localeCompare(right.id);
}

function reorderLifecycleTimelineItems(
  timelineItems: readonly TimelineItem[],
): readonly TimelineItem[] {
  const lifecycleItems: Extract<
    TimelineItem,
    { family: "salesforce_event" }
  >[] = [];

  for (const item of timelineItems) {
    if (item.family !== "salesforce_event") {
      continue;
    }

    lifecycleItems.push(item);
  }

  const orderedLifecycleItems = lifecycleItems.sort(
    compareLifecycleActivityAscending,
  );

  return timelineItems.map((item) => {
    if (item.family !== "salesforce_event") {
      return item;
    }

    const next = orderedLifecycleItems.shift();
    return next ?? item;
  });
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
    default:
      return null;
  }
}

function timelineActorLabel(
  item: TimelineItem,
  contactDisplayName: string,
  kind: InboxTimelineEntryKind,
  operatorDisplayName: string,
  canonicalContactDisplayName: string | null = null,
): string {
  if (kind === "inbound-email") {
    const normalizedCanonicalContactName =
      canonicalContactDisplayName === null
        ? ""
        : normalizeDisplayName(canonicalContactDisplayName);

    // Skip the canonical lookup when the stored displayName is just the
    // email itself (placeholder for email-only contacts). The From
    // header on inbound usually carries the sender's real name —
    // prefer that over a degraded stored value.
    if (
      normalizedCanonicalContactName.length > 0 &&
      !isEmailLikeName(normalizedCanonicalContactName)
    ) {
      return normalizedCanonicalContactName;
    }

    if (item.family === "one_to_one_email") {
      const senderLabel = participantHeaderLabel(item.fromHeader ?? null);
      const normalizedSenderLabel =
        senderLabel === null ? "" : normalizeDisplayName(senderLabel);

      if (
        normalizedSenderLabel.length > 0 &&
        !isEmailLikeName(normalizedSenderLabel)
      ) {
        return normalizedSenderLabel;
      }
    }

    const fallback =
      normalizeDisplayName(contactDisplayName) || contactDisplayName;
    return fallback;
  }

  if (kind === "inbound-sms") {
    return normalizeDisplayName(contactDisplayName) || contactDisplayName;
  }

  if (kind === "outbound-email" && item.family === "one_to_one_email") {
    const normalizedCanonicalContactName =
      canonicalContactDisplayName === null
        ? ""
        : normalizeDisplayName(canonicalContactDisplayName);

    if (
      normalizedCanonicalContactName.length > 0 &&
      !isEmailLikeName(normalizedCanonicalContactName)
    ) {
      return normalizedCanonicalContactName;
    }

    const senderLabel = participantHeaderLabel(item.fromHeader ?? null);
    const normalizedSenderLabel =
      senderLabel === null ? "" : normalizeDisplayName(senderLabel);

    if (
      normalizedSenderLabel.length > 0 &&
      !isEmailLikeName(normalizedSenderLabel)
    ) {
      return normalizedSenderLabel;
    }
  }

  if (kind === "outbound-email" || kind === "outbound-sms") {
    return normalizeDisplayName(operatorDisplayName) || "Adventure Scientists";
  }

  if (kind === "email-activity") {
    return "Email activity";
  }

  switch (item.family) {
    case "one_to_one_email":
    case "one_to_one_sms":
      return (
        normalizeDisplayName(operatorDisplayName) || "Adventure Scientists"
      );
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

const PARTICIPANT_HEADER_NAME_PATTERN = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/u;
const PARTICIPANT_HEADER_EMAIL_PATTERN =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const PLACEHOLDER_BODY_PREVIEWS = new Set([
  "[Encrypted message — open in Gmail to read]",
  "[Message body could not be extracted — open in Gmail]",
]);

function hasUppercaseBeyondFirst(token: string): boolean {
  for (let index = 1; index < token.length; index += 1) {
    const character = token[index];

    if (character !== undefined && /[A-Z]/u.test(character)) {
      return true;
    }
  }

  return false;
}

function titleCaseSimpleToken(token: string): string {
  if (token.length === 0) {
    return token;
  }

  if (/[.'’-]/u.test(token) && hasUppercaseBeyondFirst(token)) {
    return token;
  }

  return `${token[0]?.toUpperCase() ?? ""}${token.slice(1).toLowerCase()}`;
}

/**
 * Treats `local@host.tld`-shaped strings as "we don't actually have a
 * real name for this person" — used so we never render `email <email>`
 * in the bubble header AND so a contact whose stored displayName
 * happens to be the email itself doesn't short-circuit the From-header
 * fallback chain. Conservative on whitespace: any space disqualifies.
 */
function isEmailLikeName(value: string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return false;
  }

  return /^\S+@\S+\.\S+$/u.test(trimmed);
}

function normalizeDisplayName(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return "";
  }

  if (/^[a-z0-9._-]+$/iu.test(trimmed)) {
    return trimmed;
  }

  const reversedNameMatch = /^([^,]+),\s*([^,]+)$/u.exec(trimmed);

  if (reversedNameMatch !== null) {
    return [reversedNameMatch[2], reversedNameMatch[1]]
      .flatMap((part) => (part ?? "").trim().split(/\s+/u))
      .filter((part) => part.length > 0)
      .map(titleCaseSimpleToken)
      .join(" ");
  }

  return trimmed.split(/\s+/u).map(titleCaseSimpleToken).join(" ");
}

function participantHeaderLabel(headerValue: string | null): string | null {
  if (headerValue === null) {
    return null;
  }

  const trimmed = headerValue.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const nameMatch = PARTICIPANT_HEADER_NAME_PATTERN.exec(trimmed);
  const name = nameMatch?.[1]?.trim();

  if (name !== undefined && name.length > 0) {
    return name;
  }

  const emailMatch =
    PARTICIPANT_HEADER_EMAIL_PATTERN.exec(trimmed)?.[0]?.trim();

  if (emailMatch !== undefined && emailMatch.length > 0) {
    return emailMatch;
  }

  return trimmed;
}

function participantHeaderEmail(headerValue: string | null): string | null {
  if (headerValue === null) {
    return null;
  }

  return normalizeEmailAddress(
    PARTICIPANT_HEADER_EMAIL_PATTERN.exec(headerValue)?.[0] ?? null,
  );
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
      return campaignHeadlineAndBody(item).headline;
    case "campaign_sms":
      return campaignHeadlineAndBody(item).headline;
    case "one_to_one_sms":
    case "internal_note":
    case "salesforce_event":
      return null;
    default:
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
      return item.messageTextPreview || item.summary;
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
    default:
      return "";
  }
}

function projectLabelForAlias(input: {
  readonly alias: string | null | undefined;
  readonly projectLabelByAlias: ReadonlyMap<string, string>;
}): string | null {
  const normalizedAlias = normalizeEmailAddress(input.alias);

  if (normalizedAlias === null) {
    return null;
  }

  return input.projectLabelByAlias.get(normalizedAlias) ?? null;
}

function hasDisplayNameHeader(value: string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  return PARTICIPANT_HEADER_NAME_PATTERN.test(value.trim());
}

function resolveRecipientLabel(input: {
  readonly item: TimelineItem;
  readonly contactPrimaryEmail: string | null;
  readonly contactDisplayName: string;
  readonly contactDisplayNameByEmail: ReadonlyMap<string, string>;
  readonly projectLabelByAlias: ReadonlyMap<string, string>;
  readonly visualDirection: "inbound" | "outbound" | null;
}): string | null {
  if (input.item.family !== "one_to_one_email") {
    return null;
  }

  const toHeader = normalizeInlineText(input.item.toHeader);
  const toEmail = normalizeEmailAddress(toHeader);

  // Outbound: prefer a Title-Cased contact name resolved via the To
  // email so the bubble header renders "Pam Hoult" instead of
  // "phoult@yahoo.com". Falls through to whatever name was on the wire
  // when the recipient email isn't a known contact, then the bare
  // email. Notably, we don't fall back to the conversation's canonical
  // contact name — that contact may not match the actual To address.
  if (input.visualDirection === "outbound") {
    const contactName =
      toEmail !== null ? input.contactDisplayNameByEmail.get(toEmail) : null;
    if (contactName !== null && contactName !== undefined) {
      return normalizeDisplayName(contactName) || contactName;
    }
    if (hasDisplayNameHeader(toHeader)) {
      return participantHeaderLabel(toHeader);
    }
    return toEmail ?? normalizeEmailAddress(input.contactPrimaryEmail);
  }

  // Inbound: prefer a known project alias label. Falls back to the
  // To-header's display name, then the email, then the mailbox alias.
  if (toEmail !== null) {
    const aliasLabel = input.projectLabelByAlias.get(toEmail);
    if (aliasLabel !== undefined) {
      return aliasLabel;
    }
  }
  if (hasDisplayNameHeader(toHeader)) {
    return participantHeaderLabel(toHeader);
  }
  if (toEmail !== null) {
    return toEmail;
  }
  return projectLabelForAlias({
    alias: input.item.mailbox,
    projectLabelByAlias: input.projectLabelByAlias,
  });
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
    default:
      return `Activity ${occurredAtLabel}`;
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
    default:
      return false;
  }
}

function buildTimelineEntry(input: {
  readonly contactDisplayName: string;
  readonly contactPrimaryEmail: string | null;
  readonly contactDisplayNameByEmail: ReadonlyMap<string, string>;
  readonly operatorDisplayName: string;
  readonly inboxProjection: InboxDetailProjection;
  readonly item: TimelineItem;
  readonly campaignActivitySummaryByCampaignId: Readonly<
    Record<string, CampaignActivitySummary>
  >;
  readonly memberships: readonly ContactMembershipRecord[];
  readonly projectMetadataById: InboxDetailCacheData["projectMetadataById"];
  readonly projectLabelByAlias: ReadonlyMap<string, string>;
  readonly referenceNowIso: string;
  readonly attachmentsByCanonicalEventId: ReadonlyMap<
    string,
    readonly MessageAttachmentRecord[]
  >;
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
  const headerDirection =
    input.item.family === "one_to_one_email"
      ? inferHeaderDirection({
          item: input.item,
          contactPrimaryEmail: input.contactPrimaryEmail,
        })
      : null;
  const visualEmailDirection =
    input.item.family === "one_to_one_email"
      ? (inferredDirection ?? headerDirection ?? input.item.direction)
      : null;
  const isLegacySalesforceEmail = isLegacySalesforceEmailWithoutMessageDetail(
    input.item,
  );
  const kind =
    input.item.family === "one_to_one_email" &&
    isLegacySalesforceEmail &&
    visualEmailDirection !== "inbound"
      ? "email-activity"
      : input.item.family === "one_to_one_email" &&
          visualEmailDirection !== null
        ? visualEmailDirection === "inbound"
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
    finalKind === "inbound-sms"
      ? input.inboxProjection.bucket === "New" &&
        input.inboxProjection.lastEventType === "communication.sms.inbound" &&
        input.inboxProjection.lastInboundAt === input.item.occurredAt
      : input.item.family === "one_to_one_email" &&
          (finalKind === "inbound-email" || finalKind === "outbound-email")
        ? input.inboxProjection.bucket === "New" &&
          input.item.direction === "inbound" &&
          input.item.canonicalEventId ===
            input.inboxProjection.lastCanonicalEventId
        : false;
  const attachments =
    input.item.family === "one_to_one_email"
      ? buildEmailAttachmentsForEntry({
          canonical:
            input.attachmentsByCanonicalEventId.get(
              input.item.canonicalEventId,
            ) ?? [],
          pending: input.item.pendingAttachmentMetadata ?? [],
        })
      : [];
  const headerProjectLabel =
    input.item.family === "one_to_one_email"
      ? resolveHeaderProjectLabel({
          item: input.item,
          memberships: input.memberships,
          projectMetadataById: input.projectMetadataById,
          projectLabelByAlias: input.projectLabelByAlias,
        })
      : null;
  const canonicalSenderDisplayName =
    input.item.family === "one_to_one_email"
      ? (input.contactDisplayNameByEmail.get(
          participantHeaderEmail(input.item.fromHeader ?? null) ?? "",
        ) ?? null)
      : null;

  return {
    id: input.item.id,
    kind: finalKind,
    occurredAt: input.item.occurredAt,
    occurredAtLabel:
      input.item.family === "one_to_one_email" ||
      input.item.family === "one_to_one_sms"
        ? formatBubbleTimestamp(input.item.occurredAt, input.referenceNowIso)
        : formatRelativeTimestamp(input.item.occurredAt, input.referenceNowIso),
    actorLabel: timelineActorLabel(
      input.item,
      input.contactDisplayName,
      finalKind,
      input.operatorDisplayName,
      canonicalSenderDisplayName,
    ),
    subject,
    body: resolvedBody,
    channel: timelineChannel(input.item),
    isUnread,
    isPreview: isPreviewTimelineItem(input.item),
    fromHeader:
      input.item.family === "one_to_one_email"
        ? (input.item.fromHeader ?? null)
        : null,
    toHeader:
      input.item.family === "one_to_one_email"
        ? (input.item.toHeader ?? null)
        : null,
    recipientLabel: resolveRecipientLabel({
      item: input.item,
      contactPrimaryEmail: input.contactPrimaryEmail,
      contactDisplayName: input.contactDisplayName,
      contactDisplayNameByEmail: input.contactDisplayNameByEmail,
      projectLabelByAlias: input.projectLabelByAlias,
      visualDirection: visualEmailDirection,
    }),
    ccHeader:
      input.item.family === "one_to_one_email"
        ? (input.item.ccHeader ?? null)
        : null,
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
      input.item.family === "one_to_one_email" ||
      input.item.family === "one_to_one_sms"
        ? (input.item.sendStatus ?? null)
        : null,
    failedReason:
      input.item.family === "one_to_one_email" ||
      input.item.family === "one_to_one_sms"
        ? (input.item.failedReason ?? null)
        : null,
    failedDetail:
      input.item.family === "one_to_one_email" ||
      input.item.family === "one_to_one_sms"
        ? (input.item.failedDetail ?? null)
        : null,
    // For canonical (captured) emails, attachmentCount comes from the
    // singly-batched attachments load — the domain layer intentionally
    // returns 0 there to avoid a duplicate findByMessageIds call. Pending
    // composer outbounds, however, set attachmentCount from the in-flight
    // attachmentMetadataJson before any capture happens, so we honor
    // whichever number is greater.
    attachmentCount:
      input.item.family === "one_to_one_email"
        ? Math.max(input.item.attachmentCount ?? 0, attachments.length)
        : 0,
    attachments,
    campaignActivity,
    headerProjectLabel,
    ...(input.item.family === "one_to_one_email"
      ? {
          participantRows: buildParticipantRows({
            item: input.item,
            contactDisplayName: input.contactDisplayName,
            contactPrimaryEmail: input.contactPrimaryEmail,
            contactDisplayNameByEmail: input.contactDisplayNameByEmail,
            projectLabelByAlias: input.projectLabelByAlias,
            operatorDisplayName: input.operatorDisplayName,
            headerProjectLabel,
            visualDirection: visualEmailDirection ?? input.item.direction,
          }),
        }
      : {}),
    noteId: input.item.family === "internal_note" ? input.item.noteId : null,
    authorId:
      input.item.family === "internal_note" ? input.item.authorId : null,
  };
}

/**
 * Filename patterns that email clients use as defaults when the sender
 * embeds an inline image without an explicit filename — typically the
 * sender's signature graphic. Used as a belt-and-suspenders alongside
 * `message_attachments.is_inline`: capture-side detection requires both
 * a Content-ID header AND a `cid:` reference in the live HTML body, but
 * reply chains often strip the reference even though the image is still
 * dragged along as a quoted-signature artifact. Those slip through the
 * primary filter and end up showing as map-sized thumbnails.
 *
 * Patterns covered (case-insensitive):
 *   - "noname"                   (Outlook default, no extension)
 *   - "image001.png"             (Outlook embedded-image convention)
 *   - "image.png" / "image.jpg"  (mobile mail clients, generic)
 *   - "ATT00001.png"             (legacy Lotus Notes / similar)
 *
 * Conservative: only image MIME types, only when the filename matches
 * one of these placeholder shapes. Real photos with descriptive names
 * are unaffected, and the API endpoint still serves the bytes — we
 * just don't surface them as visible thumbnails in the bubble.
 */
const INLINE_SIGNATURE_FILENAME_PATTERN =
  /^(noname|image\d*\.(?:png|jpe?g|gif|webp)|ATT\d+\.(?:png|jpe?g|gif|webp))$/iu;

function looksLikeInlineSignatureImage(attachment: {
  readonly mimeType: string;
  readonly filename: string | null;
}): boolean {
  if (!attachment.mimeType.toLowerCase().startsWith("image/")) {
    return false;
  }

  const trimmed = attachment.filename?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return true;
  }

  return INLINE_SIGNATURE_FILENAME_PATTERN.test(trimmed);
}

function buildEmailAttachmentsForEntry(input: {
  readonly canonical: readonly MessageAttachmentRecord[];
  readonly pending: readonly {
    readonly filename: string | null;
    readonly contentType: string;
    readonly sizeBytes: number;
  }[];
}): InboxTimelineEntryViewModel["attachments"] {
  const canonicalAttachments = input.canonical
    .filter(
      (attachment) =>
        !attachment.isInline && !looksLikeInlineSignatureImage(attachment),
    )
    .map((attachment) => ({
      id: attachment.id,
      mimeType: attachment.mimeType,
      filename: attachment.filename,
      sizeBytes: attachment.sizeBytes,
      proxyUrl: `/api/attachments/${encodeURIComponent(attachment.id)}`,
    }));

  if (canonicalAttachments.length > 0) {
    return canonicalAttachments;
  }

  if (input.pending.length > 0) {
    return input.pending.map((attachment) => ({
      id: null,
      mimeType: attachment.contentType,
      filename: attachment.filename,
      sizeBytes: attachment.sizeBytes,
      proxyUrl: null,
    }));
  }

  return [];
}

/**
 * Resolve a single bubble-header participant slot ("From"/"To"
 * volunteer side, never the project side) to a `name` (or null when
 * we have nothing better than the email itself). Order: known-contact
 * lookup by email, header display name, conversation-contact display
 * name. Each candidate is rejected when it looks like a bare email
 * (`isEmailLikeName`) so we never echo `email <email>` in the UI.
 */
function resolveVolunteerParticipantName(input: {
  readonly emailAddress: string | null;
  readonly headerDisplayName: string | null;
  readonly contactDisplayNameByEmail: ReadonlyMap<string, string>;
  readonly conversationContactDisplayName: string;
}): string | null {
  if (input.emailAddress !== null) {
    const lookup = input.contactDisplayNameByEmail.get(input.emailAddress);
    if (lookup !== undefined && lookup.length > 0 && !isEmailLikeName(lookup)) {
      const normalized = normalizeDisplayName(lookup);
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  if (input.headerDisplayName !== null) {
    const normalized = normalizeDisplayName(input.headerDisplayName);
    if (normalized.length > 0 && !isEmailLikeName(normalized)) {
      return normalized;
    }
  }

  if (
    input.conversationContactDisplayName.length > 0 &&
    !isEmailLikeName(input.conversationContactDisplayName)
  ) {
    const normalized = normalizeDisplayName(
      input.conversationContactDisplayName,
    );
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return null;
}

/**
 * Build the From / To / (optional Cc) rows that drive both the
 * compact bubble header and the expanded debug view. Direction is
 * baked in so the component can render
 * `participantRows[0].name → participantRows[1].name` without
 * branching: the From slot for outbound is the known sender behind
 * an alias when we have one, then the project alias; for inbound it
 * is the volunteer's resolved name (and vice versa for To). When
 * toHeader is missing on an inbound capture the To row
 * falls back to `item.mailbox` so we never render an empty right
 * side.
 */
function buildParticipantRows(input: {
  readonly item: Extract<TimelineItem, { family: "one_to_one_email" }>;
  readonly contactDisplayName: string;
  readonly contactPrimaryEmail: string | null;
  readonly contactDisplayNameByEmail: ReadonlyMap<string, string>;
  readonly projectLabelByAlias: ReadonlyMap<string, string>;
  readonly operatorDisplayName: string;
  readonly headerProjectLabel: string | null;
  readonly visualDirection: "inbound" | "outbound";
}): readonly InboxTimelineEntryParticipantRowViewModel[] {
  const fromEmail =
    participantHeaderEmail(input.item.fromHeader ?? null) ??
    (input.visualDirection === "inbound"
      ? normalizeEmailAddress(input.contactPrimaryEmail)
      : null);
  const toEmail = participantHeaderEmail(input.item.toHeader ?? null);
  const fromHeaderDisplayName = participantHeaderLabel(
    input.item.fromHeader ?? null,
  );
  const toHeaderDisplayName = participantHeaderLabel(
    input.item.toHeader ?? null,
  );
  const normalizedOperator = normalizeDisplayName(input.operatorDisplayName);
  const operatorLabel =
    normalizedOperator.length > 0 ? normalizedOperator : "Adventure Scientists";

  const rows: InboxTimelineEntryParticipantRowViewModel[] = [];

  if (input.visualDirection === "outbound") {
    // For outbound the From slot holds whatever the operator was
    // sending AS. Order: known sender identity behind the alias →
    // resolved project alias → whatever display name appears on the
    // wire (handles legacy / non-aliased sends like
    // "PNW Project <pnwbio@…>") → operator name → fallback.
    const fromContactName =
      fromEmail === null
        ? null
        : (input.contactDisplayNameByEmail.get(fromEmail) ?? null);
    const normalizedFromContactName =
      fromContactName === null ? "" : normalizeDisplayName(fromContactName);
    const senderContactName =
      normalizedFromContactName.length > 0 &&
      !isEmailLikeName(normalizedFromContactName)
        ? normalizedFromContactName
        : null;
    const fromHeaderName =
      fromHeaderDisplayName !== null && !isEmailLikeName(fromHeaderDisplayName)
        ? normalizeDisplayName(fromHeaderDisplayName) || fromHeaderDisplayName
        : null;
    const fromProjectAliasLabel =
      fromEmail === null
        ? null
        : (input.projectLabelByAlias.get(fromEmail) ?? null);
    rows.push({
      label: "From",
      name:
        senderContactName ??
        fromProjectAliasLabel ??
        fromHeaderName ??
        input.headerProjectLabel ??
        operatorLabel,
      email: fromEmail,
    });
    rows.push({
      label: "To",
      name: resolveVolunteerParticipantName({
        emailAddress: toEmail,
        headerDisplayName:
          toHeaderDisplayName !== null && !isEmailLikeName(toHeaderDisplayName)
            ? toHeaderDisplayName
            : null,
        contactDisplayNameByEmail: input.contactDisplayNameByEmail,
        conversationContactDisplayName: input.contactDisplayName,
      }),
      email: toEmail,
    });
  } else {
    rows.push({
      label: "From",
      name: resolveVolunteerParticipantName({
        emailAddress: fromEmail,
        headerDisplayName:
          fromHeaderDisplayName !== null &&
          !isEmailLikeName(fromHeaderDisplayName)
            ? fromHeaderDisplayName
            : null,
        contactDisplayNameByEmail: input.contactDisplayNameByEmail,
        conversationContactDisplayName: input.contactDisplayName,
      }),
      email: fromEmail,
    });
    // Inbound captures sometimes drop the To header (older
    // Salesforce-derived items, mbox imports). Fall back to the
    // captured `mailbox` so the compact header always has a right
    // side and the expanded view always shows a To row.
    const inboundToEmail = toEmail ?? input.item.mailbox ?? null;
    rows.push({
      label: "To",
      name: input.headerProjectLabel ?? "Adventure Scientists",
      email: inboundToEmail,
    });
  }

  if (input.item.ccHeader !== null && input.item.ccHeader.trim().length > 0) {
    rows.push({
      label: "Cc",
      name: input.item.ccHeader.trim(),
      email: null,
    });
  }

  return rows;
}

/**
 * Resolve the project alias label for a 1:1 email — used in the bubble
 * header in place of "Adventure Scientists" / verbose project names.
 *
 * Looks at whichever side of the email is one of our project aliases:
 * outbound → fromHeader (we sent FROM the alias),
 * inbound  → toHeader (the operator received TO the alias).
 * Falls back to the explicit `mailbox` field when headers are missing.
 */
function resolveHeaderProjectLabel(input: {
  readonly item: Extract<TimelineItem, { family: "one_to_one_email" }>;
  readonly memberships: readonly ContactMembershipRecord[];
  readonly projectMetadataById: InboxDetailCacheData["projectMetadataById"];
  readonly projectLabelByAlias: ReadonlyMap<string, string>;
}): string | null {
  const fromEmail = participantHeaderEmail(input.item.fromHeader ?? null);
  const toEmail = participantHeaderEmail(input.item.toHeader ?? null);

  const fromMatch =
    fromEmail !== null
      ? (input.projectLabelByAlias.get(fromEmail) ?? null)
      : null;
  if (fromMatch !== null) {
    return fromMatch;
  }

  const toMatch =
    toEmail !== null ? (input.projectLabelByAlias.get(toEmail) ?? null) : null;
  if (toMatch !== null) {
    return toMatch;
  }

  const mailboxMatch = projectLabelForAlias({
    alias: input.item.mailbox,
    projectLabelByAlias: input.projectLabelByAlias,
  });
  if (mailboxMatch !== null) {
    return mailboxMatch;
  }

  const membershipProjects = input.memberships.flatMap((membership) => {
    const metadata =
      membership.projectId === null
        ? undefined
        : input.projectMetadataById[membership.projectId];
    return metadata === undefined ? [] : [metadata];
  });

  return (
    membershipProjects.find((metadata) => metadata.isActive)?.projectName ??
    membershipProjects[0]?.projectName ??
    null
  );
}

function buildComposerReplyContext(input: {
  readonly contact: ContactRecord;
  readonly timelineItems: readonly TimelineItem[];
  readonly defaultAlias: string | null;
}): InboxComposerReplyContext | null {
  const hasPostCutoverActivity = input.timelineItems.some((item) =>
    occurredAtIsOnOrAfterPlatformFullCaptureCutover(item.occurredAt),
  );
  const visibleTimelineItems = hasPostCutoverActivity
    ? filterItemsAtOrAfterPlatformFullCaptureCutover(input.timelineItems)
    : input.timelineItems;
  const inboundEmails = [...visibleTimelineItems]
    .reverse()
    .filter(
      (item): item is Extract<TimelineItem, { family: "one_to_one_email" }> =>
        item.family === "one_to_one_email" && item.direction === "inbound",
    );
  const latestInboundEmail = inboundEmails[0];
  const latestQuotableInboundEmail = inboundEmails.find(
    (item) => !PLACEHOLDER_BODY_PREVIEWS.has((item.bodyPreview ?? "").trim()),
  );

  if (latestInboundEmail === undefined) {
    // Fresh-draft path: contacts whose timeline only contains lifecycle or
    // automated-outbound entries get a synthetic context with empty subject
    // and null threading fields. The composer modal renders this as a new
    // message rather than a reply (see `resolveReplyTitle`).
    return {
      contactId: input.contact.id,
      contactDisplayName: input.contact.displayName,
      contactPrimaryPhone: input.contact.primaryPhone,
      subject: "",
      threadCursor: null,
      threadId: null,
      inReplyToRfc822: null,
      defaultAlias: input.defaultAlias,
      cc: [],
    };
  }

  return {
    contactId: input.contact.id,
    contactDisplayName: input.contact.displayName,
    contactPrimaryPhone: input.contact.primaryPhone,
    subject: buildReplySubject(latestInboundEmail.subject),
    threadCursor: latestQuotableInboundEmail?.canonicalEventId ?? null,
    threadId: latestInboundEmail.threadId ?? null,
    inReplyToRfc822: latestInboundEmail.rfc822MessageId ?? null,
    defaultAlias: input.defaultAlias,
    cc: extractEmailAddresses(latestInboundEmail.ccHeader),
  };
}

function paginateTimelineItems(input: {
  readonly timelineItems: readonly TimelineItem[];
  readonly limit: number;
  readonly beforeSortKey: string | null;
}): {
  readonly items: readonly TimelineItem[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly total: number;
} {
  const total = input.timelineItems.length;
  const endIndex =
    input.beforeSortKey === null
      ? total
      : input.timelineItems.findIndex(
          (item) => item.sortKey === input.beforeSortKey,
        );

  if (endIndex <= 0) {
    return {
      items: [],
      hasMore: false,
      nextCursor: null,
      total,
    };
  }

  const sliceEnd = endIndex === -1 ? total : endIndex;
  const sliceStart = Math.max(0, sliceEnd - input.limit);
  const items = input.timelineItems.slice(sliceStart, sliceEnd);
  const hasMore = sliceStart > 0;

  return {
    items,
    hasMore,
    nextCursor: hasMore ? (items[0]?.sortKey ?? null) : null,
    total,
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

function groupCanonicalEventsByContactId(
  events: readonly CanonicalEventRecord[],
): ReadonlyMap<string, readonly CanonicalEventRecord[]> {
  const grouped = new Map<string, CanonicalEventRecord[]>();

  for (const event of events) {
    const existing = grouped.get(event.contactId);

    if (existing === undefined) {
      grouped.set(event.contactId, [event]);
      continue;
    }

    existing.push(event);
  }

  return grouped;
}

function groupAuditEntriesByEntityId(
  entries: readonly AuditEvidenceRecord[],
): ReadonlyMap<string, readonly AuditEvidenceRecord[]> {
  const grouped = new Map<string, AuditEvidenceRecord[]>();

  for (const entry of entries) {
    const existing = grouped.get(entry.entityId);

    if (existing === undefined) {
      grouped.set(entry.entityId, [entry]);
      continue;
    }

    existing.push(entry);
  }

  return grouped;
}

function pickPrimaryActiveProjectName(input: {
  readonly memberships: readonly ContactMembershipRecord[];
  readonly activeProjectIds: ReadonlySet<string>;
  readonly projectLabelById: ReadonlyMap<string, string>;
}): string | null {
  const membership =
    sortMembershipsByCreatedAt(input.memberships).find(
      (record) =>
        record.projectId !== null &&
        input.activeProjectIds.has(record.projectId) &&
        input.projectLabelById.has(record.projectId),
    ) ?? null;

  return membership?.projectId == null
    ? null
    : (input.projectLabelById.get(membership.projectId) ?? null);
}

async function loadProjectMetadataById(
  memberships: readonly ContactMembershipRecord[],
  /**
   * Additional project IDs to look up beyond what the contact's memberships
   * surface. The conversation-derived project pill needs the metadata for
   * any project_id that appears in salesforce_event_context for this
   * contact's events, even when no membership exists (external contacts
   * sent FROM a project alias).
   */
  extraProjectIds: readonly (string | null | undefined)[] = [],
): Promise<ProjectMetadataIndex> {
  const projectIds = uniqueStrings([
    ...memberships.map((membership) => membership.projectId),
    ...extraProjectIds,
  ]);

  if (projectIds.length === 0) {
    return {};
  }

  const runtime = await getStage1WebRuntime();
  const dimensions =
    await runtime.repositories.projectDimensions.listByIds(projectIds);

  // Connected-projects rollup (PR #384 + #388): if any of the requested
  // dimensions points at a host via `connected_to_project_id`, fetch that
  // host's row in a second batch query so the renderer can label the chip
  // with the host's display name. One extra IN(...) per page render is
  // cheap and preserves the existing batch-loading pattern.
  const hostIds = Array.from(
    new Set(
      dimensions
        .map((dimension) => dimension.connectedToProjectId ?? null)
        .filter((id): id is string => id !== null && !projectIds.includes(id)),
    ),
  );
  const hostDimensions =
    hostIds.length === 0
      ? []
      : await runtime.repositories.projectDimensions.listByIds(hostIds);
  const hostNameById = new Map<string, string>();
  for (const host of [...dimensions, ...hostDimensions]) {
    hostNameById.set(
      host.projectId,
      host.projectAlias?.trim().length ? host.projectAlias : host.projectName,
    );
  }

  return Object.fromEntries(
    dimensions.map((dimension) => {
      const connectedTo = dimension.connectedToProjectId ?? null;
      return [
        dimension.projectId,
        {
          projectName: dimension.projectAlias?.trim().length
            ? dimension.projectAlias
            : dimension.projectName,
          isActive: dimension.isActive ?? false,
          connectedToProjectId: connectedTo,
          hostProjectName:
            connectedTo === null
              ? null
              : (hostNameById.get(connectedTo) ?? null),
        } satisfies ProjectMetadataEntry,
      ];
    }),
  );
}

function buildProjectLabelById(
  projectMetadataById: ProjectMetadataIndex,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(projectMetadataById).map(([projectId, metadata]) => [
      projectId,
      metadata.projectName,
    ]),
  );
}

function countAdditionalActiveProjects(input: {
  readonly memberships: readonly ContactMembershipRecord[];
  readonly primaryProjectId: string | null;
  readonly projectMetadataById: ProjectMetadataIndex;
}): number {
  const primaryProjectId = input.primaryProjectId;
  const additionalActiveProjectIds = new Set<string>();

  for (const membership of input.memberships) {
    if (
      membership.projectId === null ||
      membership.projectId === primaryProjectId ||
      input.projectMetadataById[membership.projectId]?.isActive !== true
    ) {
      continue;
    }

    additionalActiveProjectIds.add(membership.projectId);
  }

  return additionalActiveProjectIds.size;
}

async function loadProjectLabelByAlias(
  aliases: readonly {
    readonly alias: string;
    readonly projectId: string | null;
  }[],
): Promise<ReadonlyMap<string, string>> {
  const projectIds = uniqueStrings(aliases.map((alias) => alias.projectId));

  if (projectIds.length === 0) {
    return new Map();
  }

  const runtime = await getStage1WebRuntime();
  const dimensions =
    await runtime.repositories.projectDimensions.listByIds(projectIds);
  const projectLabelById = new Map(
    dimensions.map((dimension) => [
      dimension.projectId,
      dimension.projectAlias?.trim().length
        ? dimension.projectAlias
        : dimension.projectName,
    ]),
  );
  const projectLabelByAlias = new Map<string, string>();

  for (const alias of aliases) {
    if (alias.projectId === null) {
      continue;
    }

    const projectLabel = projectLabelById.get(alias.projectId);

    if (projectLabel === undefined) {
      continue;
    }

    const normalizedAlias = normalizeEmailAddress(alias.alias);

    if (normalizedAlias !== null) {
      projectLabelByAlias.set(normalizedAlias, projectLabel);
    }
  }

  return projectLabelByAlias;
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
  const repositoryCursor = toInboxRepositoryCursor(decodedCursor);
  const normalizedQuery = normalizeInlineText(input.query) ?? null;
  const isSearchActive = normalizedQuery !== null;
  const order = orderForInboxFilter(isSearchActive ? "inbox" : input.filterId);
  const projectionScanLimit = Math.min(INBOX_LIST_SCAN_LIMIT, input.limit + 1);
  type RepoFilter =
    | "visible"
    | "inbox"
    | "unread"
    | "follow-up"
    | "sent"
    | "archived";
  const loadProjectionPage = async (
    filter: RepoFilter,
  ): Promise<{
    readonly rows: readonly InboxProjectionRow[];
    readonly total: number | null;
  }> => {
    const effectiveProjectId = isSearchActive ? null : input.projectId;

    if (normalizedQuery === null) {
      const rows =
        await runtime.repositories.inboxProjection.listPageOrderedByRecency({
          filter,
          order,
          limit: projectionScanLimit,
          cursor: repositoryCursor,
          projectId: effectiveProjectId,
        });

      return {
        rows,
        total: null,
      };
    }

    const result =
      await runtime.repositories.inboxProjection.searchPageOrderedByRecency({
        // Search-bypass: a typed query searches the full visible inbox,
        // ignoring the currently selected state/project facets.
        filter: "visible",
        order,
        limit: projectionScanLimit,
        cursor: repositoryCursor,
        query: normalizedQuery,
        projectId: effectiveProjectId,
      });

    return {
      rows: result.rows,
      total: result.total,
    };
  };
  // The primary loader pulls only the active filter slice. Counts come from
  // the aggregate repo method below, so opening a conversation does not hydrate
  // unrelated inbox or archived rows.
  const primaryFilterForLoader: RepoFilter = isSearchActive
    ? "visible"
    : input.filterId;
  const [
    primaryProjectionPage,
    attentionScanProjectionPage,
    projectionCounts,
    freshness,
    activeProjectRecords,
    projectAliasRecords,
  ] = await Promise.all([
    loadProjectionPage(primaryFilterForLoader),
    !isSearchActive && input.filterId === "unread"
      ? loadProjectionPage("inbox")
      : Promise.resolve({ rows: [], total: null }),
    runtime.repositories.inboxProjection.countByFilters({
      projectId: input.projectId,
    }),
    runtime.repositories.inboxProjection.getFreshness(),
    runtime.repositories.projectDimensions.listActive(),
    runtime.settings.aliases.listAll(),
  ]);
  const matchedProjections = uniqueInboxProjectionsByContactId([
    ...primaryProjectionPage.rows,
    ...attentionScanProjectionPage.rows,
  ]);
  // Connected sub-projects roll up into their host (see PR #384's
  // host-aware predicate). The host is the only entry point — exclude subs
  // so the dropdown doesn't list them as their own filter option.
  const activeProjects: readonly InboxActiveProjectOption[] =
    activeProjectRecords
      .filter(
        (record) =>
          record.connectedToProjectId === null ||
          record.connectedToProjectId === undefined,
      )
      .map((record) => ({
        id: record.projectId,
        name:
          record.projectAlias?.trim().length &&
          record.projectAlias.trim().length > 0
            ? record.projectAlias.trim()
            : record.projectName,
        alias:
          record.projectAlias?.trim().length &&
          record.projectAlias.trim().length > 0
            ? record.projectAlias.trim()
            : null,
      }));
  const candidateContactIds = uniqueStrings(
    matchedProjections.map((projection) => projection.contactId),
  );
  const [
    contacts,
    memberships,
    latestMessagePreviewByCanonicalEventId,
    lastInboundAliasByContactId,
    canonicalEvents,
    auditEntries,
  ] = await Promise.all([
    runtime.repositories.contacts.listByIds(candidateContactIds),
    runtime.repositories.contactMemberships.listByContactIds(
      candidateContactIds,
    ),
    loadLatestSubjectByCanonicalEventId(matchedProjections),
    runtime.repositories.gmailMessageDetails.listLastInboundAliasByContactIds(
      candidateContactIds,
    ),
    runtime.repositories.canonicalEvents.listByContactIds(candidateContactIds),
    runtime.repositories.auditEvidence.listByEntities({
      entityType: "contact",
      entityIds: candidateContactIds,
    }),
  ]);
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const membershipsByContactId = groupMembershipsByContactId(memberships);
  // Salesforce event context covers two row-level needs:
  //   1. The per-project last-activity index, scoped to lifecycle events
  //      (matches `buildProjectActivityIndex` on the detail side, which
  //      only counts `family === "salesforce_event"` items).
  //   2. The conversationProject fallback when no active membership
  //      exists (matches the detail loader, which checks ANY canonical
  //      event's source evidence — e.g. an outbound email sent FROM a
  //      project alias gets a salesforceEventContext entry too).
  // We load the broader set (all canonical source evidence ids, like the
  // detail loader does) so both paths resolve identically.
  const allCanonicalSourceEvidenceIds = uniqueStrings(
    canonicalEvents.map((event) => event.sourceEvidenceId),
  );
  const salesforceEventContexts =
    allCanonicalSourceEvidenceIds.length === 0
      ? []
      : await runtime.repositories.salesforceEventContext.listBySourceEvidenceIds(
          allCanonicalSourceEvidenceIds,
        );
  const salesforceContextProjectIdBySourceEvidenceId = new Map(
    salesforceEventContexts.map((context) => [
      context.sourceEvidenceId,
      context.projectId,
    ]),
  );
  // Project metadata must cover both membership projects AND any project
  // surfaced only by a Salesforce-context-linked event — otherwise the
  // conversationProject fallback can't resolve a project name and the row
  // chip silently disappears.
  const projectMetadataById = await loadProjectMetadataById(
    memberships,
    salesforceEventContexts.map((context) => context.projectId),
  );
  const projectLabelById = buildProjectLabelById(projectMetadataById);
  const aliasToProjectId = new Map<string, string>();

  for (const aliasRecord of projectAliasRecords) {
    if (aliasRecord.projectId !== null) {
      aliasToProjectId.set(aliasRecord.alias, aliasRecord.projectId);
    }
  }
  const aliasesByProjectId = new Map<string, string[]>();

  for (const aliasRecord of projectAliasRecords) {
    if (aliasRecord.projectId === null) {
      continue;
    }

    const normalizedAlias = normalizeEmailAddress(aliasRecord.alias);

    if (normalizedAlias === null) {
      continue;
    }

    const aliases = aliasesByProjectId.get(aliasRecord.projectId) ?? [];
    aliases.push(normalizedAlias);
    aliasesByProjectId.set(aliasRecord.projectId, aliases);
  }

  const canonicalEventsByContactId =
    groupCanonicalEventsByContactId(canonicalEvents);
  const auditEntriesByContactId = groupAuditEntriesByEntityId(auditEntries);
  const gmailSourceEvidenceIds = uniqueStrings(
    canonicalEvents
      .filter((event) => event.eventType === "communication.email.outbound")
      .map((event) => event.sourceEvidenceId),
  );
  const gmailDetails =
    gmailSourceEvidenceIds.length === 0
      ? []
      : await runtime.repositories.gmailMessageDetails.listBySourceEvidenceIds(
          gmailSourceEvidenceIds,
        );
  const gmailDetailBySourceEvidenceId = new Map(
    gmailDetails.map((detail) => [detail.sourceEvidenceId, detail]),
  );
  const allRows = matchedProjections.flatMap((inboxProjection) => {
    const contact = contactById.get(inboxProjection.contactId);

    if (contact === undefined) {
      return [];
    }

    const rowMemberships =
      membershipsByContactId.get(inboxProjection.contactId) ?? [];
    const aliasSet = buildAliasSetForMemberships({
      memberships: rowMemberships,
      aliasesByProjectId,
    });
    const rowCanonicalEvents =
      canonicalEventsByContactId.get(inboxProjection.contactId) ?? [];
    const lastNonAliasMessageAt = findLastNonAliasMessageAt({
      events: rowCanonicalEvents,
      aliasSet,
      gmailDetailBySourceEvidenceId,
      fallbackLastInboundAt: inboxProjection.lastInboundAt,
    });
    const lastNonAliasOutboundAt = findLastNonAliasOutboundAt({
      events: rowCanonicalEvents,
      aliasSet,
      gmailDetailBySourceEvidenceId,
    });
    const latestReadAt = latestAttentionReadAt(
      auditEntriesByContactId.get(inboxProjection.contactId) ?? [],
    );
    const isUnread =
      inboxProjection.bucket === "New" ||
      (lastNonAliasOutboundAt !== null &&
        (latestReadAt === null || lastNonAliasOutboundAt > latestReadAt));
    // Build the per-contact project-activity index, restricted to
    // lifecycle canonical events. Mirrors `buildProjectActivityIndex` in
    // the detail loader, which keys off TimelineItem.family ===
    // "salesforce_event" (lifecycle.* event types map to that family —
    // see packages/domain/src/timeline.ts).
    const lastOccurredAtByProjectId = new Map<string, string>();
    // The conversationProject fallback follows the detail loader's
    // broader rule: ANY canonical event whose source evidence has a
    // projectId in salesforce_event_context counts (e.g. outbound emails
    // sent from a project alias). We track the newest such event.
    let fallbackProjectId: string | null = null;
    let fallbackProjectOccurredAt: string | null = null;
    for (const event of rowCanonicalEvents) {
      const projectId =
        salesforceContextProjectIdBySourceEvidenceId.get(
          event.sourceEvidenceId,
        ) ?? null;

      if (projectId === null) {
        continue;
      }

      if (event.eventType.startsWith("lifecycle.")) {
        const previous = lastOccurredAtByProjectId.get(projectId) ?? null;
        if (previous === null || event.occurredAt > previous) {
          lastOccurredAtByProjectId.set(projectId, event.occurredAt);
        }
      }

      if (
        fallbackProjectOccurredAt === null ||
        event.occurredAt > fallbackProjectOccurredAt
      ) {
        fallbackProjectOccurredAt = event.occurredAt;
        fallbackProjectId = projectId;
      }
    }
    const fallbackProjectName =
      fallbackProjectId === null
        ? null
        : (projectMetadataById[fallbackProjectId]?.projectName ?? null);
    const conversationProjectFallback =
      fallbackProjectId !== null &&
      fallbackProjectName !== null &&
      fallbackProjectName.length > 0
        ? { projectId: fallbackProjectId, projectName: fallbackProjectName }
        : null;

    return [
      {
        contact,
        inboxProjection,
        memberships: rowMemberships,
        latestMessagePreview:
          latestMessagePreviewByCanonicalEventId[
            inboxProjection.lastCanonicalEventId
          ] ?? null,
        lastInboundAlias:
          lastInboundAliasByContactId.get(inboxProjection.contactId) ?? null,
        lastNonAliasMessageAt,
        isUnread,
        lastOccurredAtByProjectId,
        conversationProjectFallback,
      } satisfies InboxListCacheRow,
    ];
  });
  const referenceNowIso = new Date().toISOString();
  const allItems = allRows
    .map((row) =>
      toListItemViewModel(
        row,
        {
          projectLabelById,
          projectMetadataById,
          aliasToProjectId,
        },
        referenceNowIso,
      ),
    )
    .filter((item) =>
      matchesServerFilter(item, input.filterId, {
        bypassAllFilters: isSearchActive,
      }),
    )
    .sort(
      input.filterId === "sent"
        ? compareInboxOutboundRecency
        : compareInboxRecency,
    );
  const hasMore = allItems.length > input.limit;
  const pageItems = hasMore ? allItems.slice(0, input.limit) : allItems;
  const rowByContactId = new Map(allRows.map((row) => [row.contact.id, row]));
  const pageRows = pageItems.flatMap((item) => {
    const row = rowByContactId.get(item.contactId);
    return row === undefined ? [] : [row];
  });
  const counts = {
    inbox: projectionCounts.all,
    unread: projectionCounts.unread,
    followUp: projectionCounts.followUp,
    sent: projectionCounts.sent,
    archived: projectionCounts.archived,
  };

  return {
    rows: pageRows,
    projectLabelById,
    projectMetadataById,
    aliasToProjectId,
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
              lastNonAliasMessageAt:
                pageRows[pageRows.length - 1]?.lastNonAliasMessageAt ?? null,
              lastOutboundAt:
                pageRows[pageRows.length - 1]?.inboxProjection.lastOutboundAt ??
                null,
              lastActivityAt:
                pageRows[pageRows.length - 1]?.inboxProjection.lastActivityAt ??
                "",
              contactId: pageRows[pageRows.length - 1]?.contact.id ?? "",
            }),
      total: primaryProjectionPage.total ?? allItems.length,
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
    latestNote,
    activityTimelineItems,
    inboxFreshness,
    timelineFreshness,
    canonicalEvents,
    projectAliasRecords,
    attentionReadAudits,
  ] = await Promise.all([
    runtime.repositories.contacts.findById(contactId),
    runtime.repositories.inboxProjection.findByContactId(contactId),
    runtime.repositories.contactMemberships.listByContactId(contactId),
    runtime.repositories.internalNotes
      .findByContactId(contactId, 1)
      .then((rows) => {
        const latestNote = rows[0];
        return latestNote === undefined
          ? null
          : {
              body: latestNote.body,
              authorDisplayName: latestNote.authorDisplayName,
              authorId: latestNote.authorId,
              createdAt: latestNote.createdAt.toISOString(),
            };
      }),
    runtime.timelinePresentation.listTimelineItemsByContactId(contactId),
    runtime.repositories.inboxProjection.getFreshnessByContactId(contactId),
    runtime.repositories.timelineProjection.getFreshnessByContactId(contactId),
    runtime.repositories.canonicalEvents.listByContactId(contactId),
    runtime.settings.aliases.listAssigned(),
    runtime.repositories.auditEvidence.listByEntity({
      entityType: "contact",
      entityId: contactId,
    }),
  ]);

  if (contact === null) {
    return null;
  }

  const newestCanonicalEvent = findNewestCanonicalEvent(canonicalEvents);
  const projectionAvailable = inboxProjection !== null;
  const detailProjection: InboxDetailProjection = inboxProjection ?? {
    contactId,
    bucket: "Opened",
    needsFollowUp: false,
    hasUnresolved: false,
    archivedAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastActivityAt: newestCanonicalEvent?.occurredAt ?? contact.updatedAt,
    snippet: "",
    lastCanonicalEventId: newestCanonicalEvent?.id ?? null,
    lastEventType: newestCanonicalEvent?.eventType ?? null,
  };

  const aliasesByProjectId = new Map<string, string[]>();

  for (const aliasRecord of projectAliasRecords) {
    if (aliasRecord.projectId === null) {
      continue;
    }

    const normalizedAlias = normalizeEmailAddress(aliasRecord.alias);

    if (normalizedAlias === null) {
      continue;
    }

    const aliases = aliasesByProjectId.get(aliasRecord.projectId) ?? [];
    aliases.push(normalizedAlias);
    aliasesByProjectId.set(aliasRecord.projectId, aliases);
  }

  const hasPostCutoverActivity = canonicalEvents.some((event) =>
    occurredAtIsOnOrAfterPlatformFullCaptureCutover(event.occurredAt),
  );
  const visibleTimelineItems = hasPostCutoverActivity
    ? filterItemsAtOrAfterPlatformFullCaptureCutover(activityTimelineItems)
    : activityTimelineItems;
  const orderedTimelineItems = reorderLifecycleTimelineItems(
    visibleTimelineItems,
  );
  const timelinePage = paginateTimelineItems({
    timelineItems: orderedTimelineItems,
    limit: input.timelineLimit,
    beforeSortKey: input.timelineCursor,
  });
  const hasHiddenEarlierHistory =
    hasPostCutoverActivity &&
    canonicalEvents.some((event) =>
      occurredAtIsBeforePlatformFullCaptureCutover(event.occurredAt),
    );
  const gmailSourceEvidenceIds = uniqueStrings(
    canonicalEvents
      .filter((event) => event.eventType === "communication.email.outbound")
      .map((event) => event.sourceEvidenceId),
  );
  const canonicalSourceEvidenceIds = uniqueStrings(
    canonicalEvents.map((event) => event.sourceEvidenceId),
  );
  const gmailDetails =
    gmailSourceEvidenceIds.length === 0
      ? []
      : await runtime.repositories.gmailMessageDetails.listBySourceEvidenceIds(
          gmailSourceEvidenceIds,
        );
  const salesforceEventContexts =
    canonicalSourceEvidenceIds.length === 0
      ? []
      : await runtime.repositories.salesforceEventContext.listBySourceEvidenceIds(
          canonicalSourceEvidenceIds,
        );
  const gmailDetailBySourceEvidenceId = new Map(
    gmailDetails.map((detail) => [detail.sourceEvidenceId, detail]),
  );
  const lastNonAliasOutboundAt = findLastNonAliasOutboundAt({
    events: canonicalEvents,
    aliasSet: buildAliasSetForMemberships({
      memberships,
      aliasesByProjectId,
    }),
    gmailDetailBySourceEvidenceId,
  });
  const latestReadAt = latestAttentionReadAt(attentionReadAudits);
  const sourceEvidenceIdByCanonicalEventId = new Map(
    canonicalEvents.map((event) => [event.id, event.sourceEvidenceId]),
  );
  const timelineSourceEvidenceIds = uniqueStrings(
    timelinePage.items
      .map((item) =>
        sourceEvidenceIdByCanonicalEventId.get(item.canonicalEventId),
      )
      .filter((value): value is string => typeof value === "string"),
  );
  const senderEmails = uniqueStrings(
    timelinePage.items
      .flatMap((item) =>
        item.family === "one_to_one_email"
          ? [participantHeaderEmail(item.fromHeader ?? null)]
          : [],
      )
      .filter((value): value is string => value !== null),
  );
  const attachments =
    timelineSourceEvidenceIds.length === 0
      ? []
      : await runtime.repositories.messageAttachments.findByMessageIds(
          timelineSourceEvidenceIds,
        );
  const contactIdentityMatches = await Promise.all(
    senderEmails.map(async (email) => ({
      email,
      identities:
        await runtime.repositories.contactIdentities.listByNormalizedValue({
          kind: "email",
          normalizedValue: email,
        }),
    })),
  );
  const matchedContactIds = uniqueStrings(
    contactIdentityMatches.flatMap(({ identities }) =>
      identities.map((identity) => identity.contactId),
    ),
  );
  const matchedContacts =
    matchedContactIds.length === 0
      ? []
      : await runtime.repositories.contacts.listByIds(matchedContactIds);
  const contactById = new Map(matchedContacts.map((row) => [row.id, row]));
  const contactDisplayNameByEmail = new Map<string, string>();

  if (
    contact.primaryEmail !== null &&
    normalizeEmailAddress(contact.primaryEmail) !== null
  ) {
    contactDisplayNameByEmail.set(
      normalizeEmailAddress(contact.primaryEmail) ?? "",
      contact.displayName,
    );
  }

  for (const match of contactIdentityMatches) {
    const contactId = match.identities[0]?.contactId;
    const matchedContact =
      contactId === undefined ? null : (contactById.get(contactId) ?? null);

    if (matchedContact !== null) {
      contactDisplayNameByEmail.set(match.email, matchedContact.displayName);
    }
  }
  const attachmentsBySourceEvidenceId = new Map<
    string,
    MessageAttachmentRecord[]
  >();

  for (const attachment of attachments) {
    const existing =
      attachmentsBySourceEvidenceId.get(attachment.sourceEvidenceId) ?? [];
    existing.push(attachment);
    attachmentsBySourceEvidenceId.set(attachment.sourceEvidenceId, existing);
  }

  const isUnread =
    detailProjection.bucket === "New" ||
    (lastNonAliasOutboundAt !== null &&
      (latestReadAt === null || lastNonAliasOutboundAt > latestReadAt));

  return {
    contact,
    inboxProjection: detailProjection,
    projectionAvailable,
    isUnread,
    memberships,
    latestNote,
    activityTimelineItems,
    timelineItems: timelinePage.items,
    campaignActivitySummaryByCampaignId:
      await loadCampaignActivitySummaryByCampaignId({
        runtime,
        canonicalEvents,
      }),
    canonicalEventById: new Map(
      canonicalEvents.map((event) => [event.id, event]),
    ),
    projectMetadataById: await loadProjectMetadataById(
      memberships,
      salesforceEventContexts.map((context) => context.projectId),
    ),
    salesforceEventContextBySourceEvidenceId: new Map(
      salesforceEventContexts.map((context) => [
        context.sourceEvidenceId,
        {
          projectId: context.projectId,
        },
      ]),
    ),
    contactDisplayNameByEmail,
    projectLabelByAlias: await loadProjectLabelByAlias(projectAliasRecords),
    attachmentsByCanonicalEventId: new Map(
      timelinePage.items.map((item) => [
        item.canonicalEventId,
        attachmentsBySourceEvidenceId.get(
          sourceEvidenceIdByCanonicalEventId.get(item.canonicalEventId) ?? "",
        ) ?? [],
      ]),
    ),
    timelinePage: {
      hasMore: timelinePage.hasMore,
      hasHiddenEarlierHistory,
      nextCursor: timelinePage.nextCursor,
      total: timelinePage.total,
    },
    freshness: {
      inboxUpdatedAt: inboxFreshness?.updatedAt ?? null,
      timelineUpdatedAt:
        timelineFreshness.latestUpdatedAt ??
        timelinePage.items[timelinePage.items.length - 1]?.occurredAt ??
        null,
      timelineCount: timelineFreshness.total,
    },
  };
}

async function readInboxDetailSummaryCacheData(
  contactId: string,
): Promise<InboxDetailSummaryCacheData | null> {
  const runtime = await getStage1WebRuntime();
  const [
    contact,
    inboxProjection,
    memberships,
    latestNote,
    activityTimelineItems,
    inboxFreshness,
    timelineFreshness,
    canonicalEvents,
    projectAliasRecords,
    attentionReadAudits,
  ] = await Promise.all([
    runtime.repositories.contacts.findById(contactId),
    runtime.repositories.inboxProjection.findByContactId(contactId),
    runtime.repositories.contactMemberships.listByContactId(contactId),
    runtime.repositories.internalNotes
      .findByContactId(contactId, 1)
      .then((rows) => {
        const newestNote = rows[0];
        return newestNote === undefined
          ? null
          : {
              body: newestNote.body,
              authorDisplayName: newestNote.authorDisplayName,
              authorId: newestNote.authorId,
              createdAt: newestNote.createdAt.toISOString(),
            };
      }),
    runtime.timelinePresentation.listTimelineItemsByContactId(contactId),
    runtime.repositories.inboxProjection.getFreshnessByContactId(contactId),
    runtime.repositories.timelineProjection.getFreshnessByContactId(contactId),
    runtime.repositories.canonicalEvents.listByContactId(contactId),
    runtime.settings.aliases.listAssigned(),
    runtime.repositories.auditEvidence.listByEntity({
      entityType: "contact",
      entityId: contactId,
    }),
  ]);

  if (contact === null) {
    return null;
  }

  const newestCanonicalEvent = findNewestCanonicalEvent(canonicalEvents);
  const projectionAvailable = inboxProjection !== null;
  const detailProjection: InboxDetailProjection = inboxProjection ?? {
    contactId,
    bucket: "Opened",
    needsFollowUp: false,
    hasUnresolved: false,
    archivedAt: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastActivityAt: newestCanonicalEvent?.occurredAt ?? contact.updatedAt,
    snippet: "",
    lastCanonicalEventId: newestCanonicalEvent?.id ?? null,
    lastEventType: newestCanonicalEvent?.eventType ?? null,
  };

  const aliasesByProjectId = new Map<string, string[]>();

  for (const aliasRecord of projectAliasRecords) {
    if (aliasRecord.projectId === null) {
      continue;
    }

    const normalizedAlias = normalizeEmailAddress(aliasRecord.alias);

    if (normalizedAlias === null) {
      continue;
    }

    const aliases = aliasesByProjectId.get(aliasRecord.projectId) ?? [];
    aliases.push(normalizedAlias);
    aliasesByProjectId.set(aliasRecord.projectId, aliases);
  }

  const gmailSourceEvidenceIds = uniqueStrings(
    canonicalEvents
      .filter((event) => event.eventType === "communication.email.outbound")
      .map((event) => event.sourceEvidenceId),
  );
  const canonicalSourceEvidenceIds = uniqueStrings(
    canonicalEvents.map((event) => event.sourceEvidenceId),
  );
  const [gmailDetails, salesforceEventContexts] = await Promise.all([
    gmailSourceEvidenceIds.length === 0
      ? Promise.resolve([])
      : runtime.repositories.gmailMessageDetails.listBySourceEvidenceIds(
          gmailSourceEvidenceIds,
        ),
    canonicalSourceEvidenceIds.length === 0
      ? Promise.resolve([])
      : runtime.repositories.salesforceEventContext.listBySourceEvidenceIds(
          canonicalSourceEvidenceIds,
        ),
  ]);
  const gmailDetailBySourceEvidenceId = new Map(
    gmailDetails.map((detail) => [detail.sourceEvidenceId, detail]),
  );
  const lastNonAliasOutboundAt = findLastNonAliasOutboundAt({
    events: canonicalEvents,
    aliasSet: buildAliasSetForMemberships({
      memberships,
      aliasesByProjectId,
    }),
    gmailDetailBySourceEvidenceId,
  });
  const latestReadAt = latestAttentionReadAt(attentionReadAudits);
  const isUnread =
    detailProjection.bucket === "New" ||
    (lastNonAliasOutboundAt !== null &&
      (latestReadAt === null || lastNonAliasOutboundAt > latestReadAt));
  const projectMetadataById = await loadProjectMetadataById(
    memberships,
    salesforceEventContexts.map((context) => context.projectId),
  );

  return {
    contact,
    inboxProjection: detailProjection,
    projectionAvailable,
    isUnread,
    memberships,
    latestNote,
    activityTimelineItems,
    canonicalEventById: new Map(
      canonicalEvents.map((event) => [event.id, event]),
    ),
    projectMetadataById,
    salesforceEventContextBySourceEvidenceId: new Map(
      salesforceEventContexts.map((context) => [
        context.sourceEvidenceId,
        {
          projectId: context.projectId,
        },
      ]),
    ),
    freshness: {
      inboxUpdatedAt: inboxFreshness?.updatedAt ?? null,
      timelineUpdatedAt: timelineFreshness.latestUpdatedAt ?? null,
      timelineCount: timelineFreshness.total,
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
  return readInboxListCacheData(input);
}

function loadInboxDetailCacheData(
  contactId: string,
  input: {
    readonly timelineLimit: number;
    readonly timelineCursor: string | null;
  },
) {
  return readInboxDetailCacheData(contactId, input);
}

function loadInboxDetailSummaryCacheData(contactId: string) {
  return readInboxDetailSummaryCacheData(contactId);
}

async function readInboxWelcomeWorkloadCacheData(): Promise<InboxWelcomeWorkloadCacheData> {
  const runtime = await getStage1WebRuntime();
  const activeProjects =
    await runtime.repositories.projectDimensions.listActive();
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
  const followUpRows = activeWorkloadRows.filter((row) => row.needsFollowUp);
  const orderedFollowUpRows = [...followUpRows].sort((left, right) => {
    const timestampDifference = left.lastActivityAt.localeCompare(
      right.lastActivityAt,
    );

    return timestampDifference !== 0
      ? timestampDifference
      : left.contactId.localeCompare(right.contactId);
  });
  const inlineRows = orderedFollowUpRows.slice(
    0,
    WELCOME_FOLLOW_UP_INLINE_LIMIT,
  );
  const inlineContactIds = inlineRows.map((row) => row.contactId);
  const inlineContacts =
    inlineContactIds.length === 0
      ? []
      : await runtime.repositories.contacts.listByIds(inlineContactIds);
  const contactById = new Map(
    inlineContacts.map((contact) => [contact.id, contact]),
  );
  // Operator-facing label: prefer the alias (e.g. "PNW Biodiversity")
  // over the verbose Salesforce projectName. Falls back to projectName
  // when alias is null/empty so we never show a blank label.
  const projectDisplayName = (project: {
    readonly projectAlias?: string | null | undefined;
    readonly projectName: string;
  }): string => {
    const trimmedAlias = project.projectAlias?.trim() ?? "";
    return trimmedAlias.length > 0 ? trimmedAlias : project.projectName;
  };
  const projectLabelById = new Map(
    activeProjects.map((project) => [
      project.projectId,
      projectDisplayName(project),
    ]),
  );
  const referenceNowIso = new Date().toISOString();

  return {
    projects: activeProjects.map((project, index) => {
      const counts = projectCounts[index] ?? {
        all: 0,
        unread: 0,
        followUp: 0,
        unresolved: 0,
        sent: 0,
        archived: 0,
      };

      return {
        projectId: project.projectId,
        projectName: projectDisplayName(project),
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
    followUpRail: {
      totalCount: orderedFollowUpRows.length,
      entries: inlineRows.map((row) => {
        const contact = contactById.get(row.contactId);
        const displayName = contact?.displayName ?? "Unknown contact";
        const membershipsForContact =
          membershipsByContactId.get(row.contactId) ?? [];

        return {
          contactId: row.contactId,
          displayName,
          initials: toInitials(displayName),
          avatarTone: avatarToneForContact(row.contactId),
          projectLabel: pickPrimaryActiveProjectName({
            memberships: membershipsForContact,
            activeProjectIds,
            projectLabelById,
          }),
          latestSubject: fallbackLatestSubject(row.lastEventType),
          lastActivityLabel: formatRelativeTimestamp(
            row.lastActivityAt,
            referenceNowIso,
          ),
        };
      }),
    },
  };
}

function loadInboxWelcomeWorkloadCacheData() {
  return readInboxWelcomeWorkloadCacheData();
}

function toListItemViewModel(
  row: InboxListCacheRow,
  cacheData: Pick<
    InboxListCacheData,
    "projectLabelById" | "projectMetadataById" | "aliasToProjectId"
  >,
  referenceNowIso: string,
): InboxListItemViewModel {
  const sortedMemberships = sortMemberships(row.memberships);
  // Share derivation with the conversation header so the row chip and the
  // header chip cannot disagree for the same contact. See
  // {@link resolvePrimaryProjectForContact}.
  const primaryProject = resolvePrimaryProjectForContact({
    memberships: row.memberships,
    projectMetadataById: cacheData.projectMetadataById,
    lastOccurredAtByProjectId: row.lastOccurredAtByProjectId,
    conversationProjectFallback: row.conversationProjectFallback,
  });
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
    primaryEmail: row.contact.primaryEmail,
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
    projectLabel: primaryProject?.projectName ?? null,
    projectSubLabel: primaryProject?.subProjectName ?? null,
    additionalActiveProjectsCount: countAdditionalActiveProjects({
      memberships: row.memberships,
      primaryProjectId: primaryProject?.projectId ?? null,
      projectMetadataById: cacheData.projectMetadataById,
    }),
    volunteerStage: mapVolunteerStage(sortedMemberships),
    bucket: mapBucket(row.inboxProjection.bucket),
    needsFollowUp: row.inboxProjection.needsFollowUp,
    hasUnresolved: row.inboxProjection.hasUnresolved,
    isArchived: row.inboxProjection.archivedAt !== null,
    isUnread: row.isUnread,
    unreadCount: row.isUnread ? 1 : 0,
    isUnanswered:
      row.inboxProjection.lastInboundAt !== null &&
      (row.inboxProjection.lastOutboundAt === null ||
        row.inboxProjection.lastInboundAt > row.inboxProjection.lastOutboundAt),
    lastInboundAt: row.inboxProjection.lastInboundAt,
    lastNonAliasMessageAt: row.lastNonAliasMessageAt,
    lastOutboundAt: row.inboxProjection.lastOutboundAt,
    lastActivityAt: row.inboxProjection.lastActivityAt,
    lastEventType: row.inboxProjection.lastEventType,
    lastActivityLabel: formatRelativeTimestamp(
      row.lastNonAliasMessageAt ?? row.inboxProjection.lastActivityAt,
      referenceNowIso,
    ),
  };
}

function buildContactSummary(input: {
  readonly contact: ContactRecord;
  readonly inboxProjection: InboxDetailProjection;
  readonly memberships: readonly ContactMembershipRecord[];
  readonly latestNote: {
    readonly body: string;
    readonly authorDisplayName: string | null;
    readonly authorId: string | null;
    readonly createdAt: string;
  } | null;
  readonly activityTimelineItems: readonly TimelineItem[];
  readonly projectMetadataById: ProjectMetadataIndex;
  readonly referenceNowIso: string;
}): InboxContactSummaryViewModel {
  const projectActivityIndex = buildProjectActivityIndex(
    input.activityTimelineItems,
  );
  const activeProjects = sortMembershipsByLastActivity(
    input.memberships,
    projectActivityIndex.lastOccurredAtByProjectId,
  )
    .filter(
      (membership) => !isPastProject(membership, input.projectMetadataById),
    )
    .map((membership) =>
      buildProjectMembershipViewModel(membership, input.projectMetadataById),
    )
    .filter(
      (membership): membership is InboxProjectMembershipViewModel =>
        membership !== null,
    );
  const pastProjects = sortMembershipsByCreatedAt(input.memberships)
    .filter((membership) =>
      isPastProject(membership, input.projectMetadataById),
    )
    .map((membership) =>
      buildProjectMembershipViewModel(membership, input.projectMetadataById),
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
    pinnedNote:
      input.latestNote === null
        ? null
        : {
            body: input.latestNote.body,
            authorLabel: input.latestNote.authorDisplayName ?? "Internal note",
            createdAtLabel: formatRelativeTimestamp(
              input.latestNote.createdAt,
              input.referenceNowIso,
            ),
          },
    activeProjects,
    pastProjects,
    recentActivity: buildRecentActivity(
      input.activityTimelineItems,
      input.referenceNowIso,
    ),
  };
}

/**
 * Walks the contact's timeline items (newest first) and returns the most
 * recent SF lifecycle event with a known projectId + project name. This is
 * the "conversation project" fallback used when the contact has no active
 * memberships — the same logic the inbox row uses (see
 * `readInboxListCacheData`), just driven off a `TimelineItem[]` instead of
 * raw canonical events.
 */
function deriveConversationProjectFallbackFromTimeline(input: {
  readonly timelineItems: readonly TimelineItem[];
  readonly canonicalEventById: ReadonlyMap<string, CanonicalEventRecord>;
  readonly salesforceEventContextBySourceEvidenceId: ReadonlyMap<
    string,
    {
      readonly projectId: string | null;
    }
  >;
  readonly projectMetadataById: ProjectMetadataIndex;
}): { readonly projectId: string; readonly projectName: string } | null {
  for (const item of [...input.timelineItems].sort((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt),
  )) {
    const sourceEvidenceId = input.canonicalEventById.get(
      item.canonicalEventId,
    )?.sourceEvidenceId;

    if (sourceEvidenceId === undefined) {
      continue;
    }

    const projectId =
      input.salesforceEventContextBySourceEvidenceId.get(sourceEvidenceId)
        ?.projectId ?? null;

    if (projectId === null) {
      continue;
    }

    const projectName = input.projectMetadataById[projectId]?.projectName;

    if (typeof projectName !== "string" || projectName.length === 0) {
      continue;
    }

    return { projectId, projectName };
  }

  return null;
}

function buildConversationProject(input: {
  readonly memberships: readonly ContactMembershipRecord[];
  readonly timelineItems: readonly TimelineItem[];
  readonly canonicalEventById: ReadonlyMap<string, CanonicalEventRecord>;
  readonly salesforceEventContextBySourceEvidenceId: ReadonlyMap<
    string,
    {
      readonly projectId: string | null;
    }
  >;
  readonly projectMetadataById: ProjectMetadataIndex;
}): InboxDetailViewModel["conversationProject"] {
  // Routes through the shared helper so the header's primary project chip
  // cannot diverge from the inbox row's chip for the same contact.
  const resolved = resolvePrimaryProjectForContact({
    memberships: input.memberships,
    projectMetadataById: input.projectMetadataById,
    lastOccurredAtByProjectId: buildProjectActivityIndex(input.timelineItems)
      .lastOccurredAtByProjectId,
    conversationProjectFallback: deriveConversationProjectFallbackFromTimeline({
      timelineItems: input.timelineItems,
      canonicalEventById: input.canonicalEventById,
      salesforceEventContextBySourceEvidenceId:
        input.salesforceEventContextBySourceEvidenceId,
      projectMetadataById: input.projectMetadataById,
    }),
  });

  if (resolved === null) {
    return null;
  }

  // Project the wider `ResolvedPrimaryProject` shape to the narrower
  // `conversationProject` view-model so toEqual() callers don't see the
  // helper's `isConnectedSub` flag (which the header doesn't consume —
  // it gates rendering on `subProjectName !== null` instead).
  return {
    projectId: resolved.projectId,
    projectName: resolved.projectName,
    subProjectName: resolved.subProjectName,
    source: resolved.source,
  };
}

function buildInboxDetailSummaryViewModel(input: {
  readonly cachedData: InboxDetailSummaryCacheData | InboxDetailCacheData;
  readonly defaultAlias: string | null;
  readonly referenceNowIso: string;
}): InboxDetailSummaryViewModel {
  const contactSummary = buildContactSummary({
    contact: input.cachedData.contact,
    inboxProjection: input.cachedData.inboxProjection,
    memberships: input.cachedData.memberships,
    latestNote: input.cachedData.latestNote,
    activityTimelineItems: input.cachedData.activityTimelineItems,
    projectMetadataById: input.cachedData.projectMetadataById,
    referenceNowIso: input.referenceNowIso,
  });

  return {
    contact: contactSummary,
    projectionAvailable: input.cachedData.projectionAvailable,
    conversationProject: buildConversationProject({
      memberships: input.cachedData.memberships,
      timelineItems: input.cachedData.activityTimelineItems,
      canonicalEventById: input.cachedData.canonicalEventById,
      salesforceEventContextBySourceEvidenceId:
        input.cachedData.salesforceEventContextBySourceEvidenceId,
      projectMetadataById: input.cachedData.projectMetadataById,
    }),
    initials: toInitials(input.cachedData.contact.displayName),
    avatarTone: avatarToneForContact(input.cachedData.contact.id),
    bucket: mapBucket(input.cachedData.inboxProjection.bucket),
    needsFollowUp: input.cachedData.inboxProjection.needsFollowUp,
    isArchived: input.cachedData.inboxProjection.archivedAt !== null,
    isUnread: input.cachedData.isUnread,
    smsEligible: input.cachedData.contact.primaryPhone !== null,
    composerReplyContext: buildComposerReplyContext({
      contact: input.cachedData.contact,
      timelineItems: input.cachedData.activityTimelineItems,
      defaultAlias: input.defaultAlias,
    }),
    freshness: input.cachedData.freshness,
  };
}

function buildInboxDetailTimelineViewModel(input: {
  readonly cachedData: InboxDetailCacheData;
  readonly operatorDisplayName: string;
  readonly referenceNowIso: string;
}): InboxDetailTimelineViewModel {
  const timeline = input.cachedData.timelineItems.map((item) =>
    buildTimelineEntry({
      contactDisplayName: input.cachedData.contact.displayName,
      contactPrimaryEmail: input.cachedData.contact.primaryEmail,
      contactDisplayNameByEmail: input.cachedData.contactDisplayNameByEmail,
      operatorDisplayName: input.operatorDisplayName,
      inboxProjection: input.cachedData.inboxProjection,
      item,
      campaignActivitySummaryByCampaignId:
        input.cachedData.campaignActivitySummaryByCampaignId,
      memberships: input.cachedData.memberships,
      projectMetadataById: input.cachedData.projectMetadataById,
      projectLabelByAlias: input.cachedData.projectLabelByAlias,
      referenceNowIso: input.referenceNowIso,
      attachmentsByCanonicalEventId:
        input.cachedData.attachmentsByCanonicalEventId,
    }),
  );

  return {
    timeline: reorderLifecycleTimelineEntries(timeline),
    timelinePage: input.cachedData.timelinePage,
  };
}

function timelineLifecycleEntryOrdinal(
  entry: InboxTimelineEntryViewModel,
): number | null {
  if (entry.kind !== "system-event") {
    return null;
  }

  const normalized = entry.body.toLowerCase();

  if (normalized.startsWith("signed up")) {
    return 1;
  }

  if (normalized.startsWith("received training")) {
    return 2;
  }

  if (normalized.startsWith("completed training")) {
    return 3;
  }

  if (normalized.startsWith("submitted first data")) {
    return 4;
  }

  return null;
}

function compareLifecycleTimelineEntries(
  left: InboxTimelineEntryViewModel,
  right: InboxTimelineEntryViewModel,
): number {
  const leftDate = utcCalendarDate(left.occurredAt);
  const rightDate = utcCalendarDate(right.occurredAt);

  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  const leftOrdinal = timelineLifecycleEntryOrdinal(left) ?? 0;
  const rightOrdinal = timelineLifecycleEntryOrdinal(right) ?? 0;

  if (leftOrdinal !== rightOrdinal) {
    return leftOrdinal - rightOrdinal;
  }

  return left.id.localeCompare(right.id);
}

function reorderLifecycleTimelineEntries(
  entries: readonly InboxTimelineEntryViewModel[],
): readonly InboxTimelineEntryViewModel[] {
  const lifecycleEntries = entries.filter(
    (entry) => timelineLifecycleEntryOrdinal(entry) !== null,
  );
  const orderedLifecycleEntries = lifecycleEntries.sort(
    compareLifecycleTimelineEntries,
  );

  return entries.map((entry) => {
    if (timelineLifecycleEntryOrdinal(entry) === null) {
      return entry;
    }

    const next = orderedLifecycleEntries.shift();
    return next ?? entry;
  });
}

function matchesServerFilter(
  item: InboxListItemViewModel,
  filterId: InboxFilterId,
  input?: {
    readonly bypassAllFilters?: boolean;
    readonly bypassInboxScope?: boolean;
  },
): boolean {
  if (input?.bypassAllFilters === true) {
    return !item.isArchived;
  }

  if (item.isArchived) {
    return filterId === "archived";
  }

  switch (filterId) {
    case "inbox":
      return input?.bypassInboxScope === true || item.lastInboundAt !== null;
    case "unread":
      return item.isUnread;
    case "follow-up":
      return item.needsFollowUp;
    case "sent":
      return item.lastOutboundAt !== null;
    case "archived":
      return item.isArchived;
  }
}

export async function getInboxList(
  filterId: InboxFilterId = "inbox",
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
    toListItemViewModel(
      row,
      {
        projectLabelById: cachedData.projectLabelById,
        projectMetadataById: cachedData.projectMetadataById,
        aliasToProjectId: cachedData.aliasToProjectId,
      },
      referenceNowIso,
    ),
  );
  const totals = cachedData.counts;
  const filters: InboxFilterViewModel[] = INBOX_FILTERS.map((filter) => ({
    id: filter.id,
    label: filter.label,
    hint: filter.hint,
    count:
      filter.id === "follow-up"
        ? totals.followUp
        : filter.id === "unread"
          ? totals.unread
          : null,
  }));

  return {
    items: items.filter((item) =>
      matchesServerFilter(item, filterId, {
        bypassAllFilters: (input.query?.trim().length ?? 0) > 0,
      }),
    ),
    filters,
    totals,
    activeProjects: cachedData.activeProjects,
    selectedProjectId: projectId,
    page: cachedData.page,
    freshness: cachedData.freshness,
  };
}

/** Minimum query length enforced for the unified inbox search. */
export const INBOX_UNIFIED_SEARCH_MIN_QUERY_LENGTH = 3;

/** Per-section cap. Total counts (pre-truncation) come back in `totals`. */
export const INBOX_UNIFIED_SEARCH_SECTION_LIMIT = 25;

/**
 * Server selector for the unified inbox search bar. Replaces the dedicated
 * `/inbox/all-contacts` surface and the projection-only inbox-list search:
 * the input now searches the broad set of contacts (Section A — contact
 * attribute matches) plus projection snippet/subject matches (Section B),
 * with each section sorted by last activity desc and capped per section.
 *
 * Below the min-query length the selector short-circuits without hitting
 * the DB, so the API route can rely on this for cheap empty responses.
 */
export async function getInboxUnifiedSearch(input: {
  readonly query: string;
}): Promise<InboxUnifiedSearchViewModel> {
  const trimmedQuery = input.query.trim();

  if (trimmedQuery.length < INBOX_UNIFIED_SEARCH_MIN_QUERY_LENGTH) {
    return {
      query: trimmedQuery,
      contactMatches: [],
      bodyMatches: [],
      totals: { contactMatches: 0, bodyMatches: 0 },
    };
  }

  const runtime = await getStage1WebRuntime();
  const { contactMatches, bodyMatches, totals } =
    await runtime.repositories.contacts.searchInboxUnified({
      query: trimmedQuery,
      limit: INBOX_UNIFIED_SEARCH_SECTION_LIMIT,
    });

  const referenceNowIso = new Date().toISOString();

  const toRow = (
    row: Awaited<
      ReturnType<typeof runtime.repositories.contacts.searchInboxUnified>
    >["contactMatches"][number],
  ): InboxUnifiedSearchRowViewModel => {
    const projectLabel =
      row.memberships.length === 0
        ? null
        : (row.memberships[0]?.projectAlias ??
          row.memberships[0]?.projectName ??
          null);
    const lastActivityLabel =
      row.lastActivityAt === null
        ? ""
        : formatRelativeTimestamp(row.lastActivityAt, referenceNowIso);
    const channel: InboxChannel | null =
      row.lastEventType === null ? null : mapChannel(row.lastEventType);
    const sanitizedSnippet =
      row.snippet === null
        ? null
        : sanitizePreviewText(row.snippet) || row.snippet;

    return {
      contactId: row.contact.id,
      displayName: row.contact.displayName,
      initials: toInitials(row.contact.displayName),
      avatarTone: avatarToneForContact(row.contact.id),
      primaryEmail: row.contact.primaryEmail,
      primaryPhone: row.contact.primaryPhone,
      projectLabel,
      hasProjection: row.hasProjection,
      lastActivityAt: row.lastActivityAt,
      lastActivityLabel,
      latestSubject: row.latestMessageSubject,
      snippet: sanitizedSnippet,
      latestChannel: channel,
      lastEventType: row.lastEventType,
    };
  };

  return {
    query: trimmedQuery,
    contactMatches: contactMatches.map(toRow),
    bodyMatches: bodyMatches.map(toRow),
    totals,
  };
}

export async function getInboxWelcomeWorkload(): Promise<InboxWelcomeWorkloadViewModel> {
  const cachedData = await loadInboxWelcomeWorkloadCacheData();

  return {
    projects: cachedData.projects,
    totals: cachedData.totals,
    followUpRail: cachedData.followUpRail,
  };
}

export async function getInboxDetailSummary(
  contactId: string,
): Promise<InboxDetailSummaryViewModel | null> {
  const [cachedData, runtime] = await Promise.all([
    loadInboxDetailSummaryCacheData(contactId),
    getStage1WebRuntime(),
  ]);

  if (cachedData === null) {
    return null;
  }

  const [referenceNowIso, defaultAlias] = await Promise.all([
    Promise.resolve(new Date().toISOString()),
    runtime.timelinePresentation.findLastInboundAliasForContact(contactId),
  ]);

  return buildInboxDetailSummaryViewModel({
    cachedData,
    defaultAlias,
    referenceNowIso,
  });
}

export async function getInboxDetailTimeline(
  contactId: string,
  input: {
    readonly limit?: number;
    readonly recordReadAudit?: boolean;
  } = {},
): Promise<InboxDetailTimelineViewModel | null> {
  const cachedData = await loadInboxDetailCacheData(contactId, {
    timelineLimit: input.limit ?? DEFAULT_INBOX_TIMELINE_PAGE_SIZE,
    timelineCursor: null,
  });

  if (cachedData === null) {
    return null;
  }

  if (input.recordReadAudit === true) {
    recordSensitiveReadForCurrentUserDetached({
      action: "contact.timeline.read",
      entityType: "contact",
      entityId: contactId,
      metadataJson: {
        timelineCount: cachedData.timelinePage.total,
      },
    });
  }

  const currentUser = await getCurrentUser();

  return buildInboxDetailTimelineViewModel({
    cachedData,
    operatorDisplayName:
      normalizeDisplayName(currentUser?.name ?? "") || "Adventure Scientists",
    referenceNowIso: new Date().toISOString(),
  });
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
  const operatorDisplayName = "Adventure Scientists";

  return {
    entries: buildInboxDetailTimelineViewModel({
      cachedData,
      operatorDisplayName,
      referenceNowIso,
    }).timeline,
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
  const [currentUser, defaultAlias] = await Promise.all([
    getCurrentUser(),
    runtime.timelinePresentation.findLastInboundAliasForContact(contactId),
  ]);

  return {
    ...buildInboxDetailSummaryViewModel({
      cachedData,
      defaultAlias,
      referenceNowIso,
    }),
    ...buildInboxDetailTimelineViewModel({
      cachedData,
      operatorDisplayName:
        normalizeDisplayName(currentUser?.name ?? "") || "Adventure Scientists",
      referenceNowIso,
    }),
  };
}
