import type {
  CanonicalEventRecord,
  ContactMembershipRecord,
  ContactRecord,
  InboxDrivingEventType,
  InboxProjectionRow,
  MessageAttachmentRecord,
  TimelineItem,
} from "@as-comms/contracts";

import { getCurrentUser } from "@/src/server/auth/session";
import { recordSensitiveReadForCurrentUserDetached } from "@/src/server/security/audit";
import { getStage1WebRuntime } from "../../../src/server/stage1-runtime";
import {
  occurredAtIsBeforePlatformFullCaptureCutover,
  filterItemsAtOrAfterPlatformFullCaptureCutover,
} from "@/app/_lib/cutover";

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
  InboxTimelineEntryParticipantRowViewModel,
  InboxTimelineEntryViewModel,
  InboxVolunteerStage,
  InboxWelcomeWorkloadViewModel,
} from "./view-models";
export { groupInboxTimelineSystemMessages } from "./view-models";

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
}

interface InboxListCacheData {
  readonly rows: readonly InboxListCacheRow[];
  readonly projectLabelById: Readonly<Record<string, string>>;
  readonly projectMetadataById: Readonly<
    Record<
      string,
      {
        readonly projectName: string;
        readonly isActive: boolean;
      }
    >
  >;
  readonly aliasToProjectId: ReadonlyMap<string, string>;
  readonly counts: {
    readonly all: number;
    readonly unread: number;
    readonly followUp: number;
    readonly unresolved: number;
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
  readonly inboxProjection: InboxProjectionRow;
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
  readonly projectMetadataById: Readonly<
    Record<
      string,
      {
        readonly projectName: string;
        readonly isActive: boolean;
      }
    >
  >;
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
  readonly timelinePage: {
    readonly hasMore: boolean;
    readonly hasHiddenEarlierHistory: boolean;
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
  readonly followUpRail: InboxWelcomeWorkloadViewModel["followUpRail"];
}

const DEFAULT_INBOX_LIST_PAGE_SIZE = 50;
const DEFAULT_INBOX_TIMELINE_PAGE_SIZE = 40;
const INBOX_LIST_SCAN_LIMIT = 5_000;
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

    for (const alias of input.aliasesByProjectId.get(membership.projectId) ?? []) {
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
      input.gmailDetailBySourceEvidenceId.get(event.sourceEvidenceId)?.fromHeader,
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
      input.gmailDetailBySourceEvidenceId.get(event.sourceEvidenceId)?.fromHeader,
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
  readonly lastNonAliasMessageAt: string | null;
  readonly lastOutboundAt: string | null;
  readonly lastActivityAt: string;
  readonly contactId: string;
}): string {
  return Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
}

function decodeInboxListCursor(cursor: string | null): {
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
    const lastNonAliasMessageAt =
      parsed.lastNonAliasMessageAt ?? parsed.lastInboundAt;
    const lastOutboundAt = parsed.lastOutboundAt ?? null;
    const lastActivityAt = parsed.lastActivityAt;
    const contactId = parsed.contactId;

    return (
      lastNonAliasMessageAt === null ||
      typeof lastNonAliasMessageAt === "string"
    ) &&
      (lastOutboundAt === null || typeof lastOutboundAt === "string") &&
      typeof lastActivityAt === "string" &&
      typeof contactId === "string"
      ? {
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

function buildProjectActivityIndex(
  timelineItems: readonly TimelineItem[],
): {
  readonly firstOccurredAtByProjectId: ReadonlyMap<string, string>;
  readonly lastOccurredAtByProjectId: ReadonlyMap<string, string>;
} {
  const firstOccurredAtByProjectId = new Map<string, string>();
  const lastOccurredAtByProjectId = new Map<string, string>();

  for (const item of timelineItems) {
    if (item.family !== "salesforce_event" || item.projectId === null) {
      continue;
    }

    const firstOccurredAt =
      firstOccurredAtByProjectId.get(item.projectId) ?? null;

    if (firstOccurredAt === null || item.occurredAt < firstOccurredAt) {
      firstOccurredAtByProjectId.set(item.projectId, item.occurredAt);
    }

    const lastOccurredAt = lastOccurredAtByProjectId.get(item.projectId) ?? null;

    if (lastOccurredAt === null || item.occurredAt > lastOccurredAt) {
      lastOccurredAtByProjectId.set(item.projectId, item.occurredAt);
    }
  }

  return {
    firstOccurredAtByProjectId,
    lastOccurredAtByProjectId,
  };
}

function sortMembershipsByLastActivity(
  memberships: readonly ContactMembershipRecord[],
  lastOccurredAtByProjectId: ReadonlyMap<string, string>,
): readonly ContactMembershipRecord[] {
  return [...memberships].sort((left, right) => {
    const leftLastActivityAt =
      (left.projectId === null ? null : lastOccurredAtByProjectId.get(left.projectId)) ??
      left.createdAt;
    const rightLastActivityAt =
      (right.projectId === null
        ? null
        : lastOccurredAtByProjectId.get(right.projectId)) ?? right.createdAt;
    const activityDifference = rightLastActivityAt.localeCompare(leftLastActivityAt);

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

export function resolvePrimaryMembership(input: {
  readonly memberships: readonly ContactMembershipRecord[];
  readonly lastInboundAlias: string | null;
  readonly aliasToProjectId: ReadonlyMap<string, string>;
}): ContactMembershipRecord | null {
  if (input.lastInboundAlias !== null) {
    const projectId = input.aliasToProjectId.get(input.lastInboundAlias);

    if (projectId !== undefined) {
      const match =
        sortMembershipsByCreatedAt(input.memberships).find(
          (membership) => membership.projectId === projectId,
        ) ?? null;

      if (match !== null) {
        return match;
      }
    }
  }

  return sortMembershipsByCreatedAt(input.memberships)[0] ?? null;
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
  projectMetadataById: Readonly<
    Record<
      string,
      {
        readonly projectName: string;
        readonly isActive: boolean;
      }
    >
  >,
  firstOccurredAtByProjectId: ReadonlyMap<string, string>,
): InboxProjectMembershipViewModel | null {
  const projectName =
    membership.projectId === null
      ? null
      : (projectMetadataById[membership.projectId]?.projectName ??
        membership.projectId);

  if (projectName === null || membership.projectId === null) {
    return null;
  }

  return {
    membershipId: membership.id,
    projectId: membership.projectId,
    projectName,
    signupYear: new Date(
      firstOccurredAtByProjectId.get(membership.projectId) ?? membership.createdAt,
    ).getUTCFullYear(),
    projectIsActive:
      projectMetadataById[membership.projectId]?.isActive ?? false,
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
  projectMetadataById: Readonly<
    Record<
      string,
      {
        readonly projectName: string;
        readonly isActive: boolean;
      }
    >
  >,
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

  if (targetDayKey === bubbleDayKey(yesterdayReference.toISOString(), timeZone)) {
    return BUBBLE_MONTH_DAY_FORMATTER.format(new Date(timestamp));
  }

  if (bubbleYear(timestamp, timeZone) === bubbleYear(referenceNowIso, timeZone)) {
    return BUBBLE_MONTH_DAY_FORMATTER.format(new Date(timestamp));
  }

  return BUBBLE_MONTH_DAY_YEAR_FORMATTER.format(new Date(timestamp));
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

const PREVIEW_NOISE_THRESHOLD = 0.3;
const PREVIEW_NOISE_MIN_LENGTH = 32;
const SHORT_PREVIEW_NOISE_MIN_SUSPICIOUS = 3;
const REPLACEMENT_CHARACTER = "�";

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

    if (
      code < 0x20 &&
      code !== 0x09 &&
      code !== 0x0a &&
      code !== 0x0d
    ) {
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

function normalizeEmailAddress(
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

function trimQuotedReplyContent(value: string): string {
  const normalized = sanitizePreviewText(value);

  if (normalized.length === 0) {
    return "";
  }

  const boundaries = [
    // Keep quoted-reply cropping consistent for common email-client markers.
    // This intentionally keys off the marker line itself, not provider classes
    // that are frequently missing from plaintext fallbacks.
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
    const headline =
      normalizeInlineText(item.campaignName) ??
      resolveDisplayableOutboundSubject(parsedPreview.subject);

    if (parsedPreview.subject !== null) {
      return {
        headline,
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

    return {
      headline,
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

  if (kind === "outbound-email" || kind === "outbound-sms") {
    return normalizeDisplayName(operatorDisplayName) || "Adventure Scientists";
  }

  if (kind === "email-activity") {
    return "Email activity";
  }

  switch (item.family) {
    case "one_to_one_email":
    case "one_to_one_sms":
      return normalizeDisplayName(operatorDisplayName) || "Adventure Scientists";
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

  return trimmed
    .split(/\s+/u)
    .map(titleCaseSimpleToken)
    .join(" ");
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

  const emailMatch = PARTICIPANT_HEADER_EMAIL_PATTERN.exec(trimmed)?.[0]?.trim();

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
  if (input.item.direction === "outbound") {
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
  readonly contactDisplayNameByEmail: ReadonlyMap<string, string>;
  readonly operatorDisplayName: string;
  readonly inboxProjection: InboxProjectionRow;
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
      ? input.contactDisplayNameByEmail.get(
          participantHeaderEmail(input.item.fromHeader ?? null) ?? "",
        ) ?? null
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
      input.item.family === "one_to_one_email"
        ? (input.item.sendStatus ?? null)
        : null,
    failedReason:
      input.item.family === "one_to_one_email"
        ? (input.item.failedReason ?? null)
        : null,
    failedDetail:
      input.item.family === "one_to_one_email"
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
          }),
        }
      : {}),
    noteId: input.item.family === "internal_note" ? input.item.noteId : null,
    authorId:
      input.item.family === "internal_note" ? input.item.authorId : null,
  };
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
    .filter((attachment) => !attachment.isInline)
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
    if (
      lookup !== undefined &&
      lookup.length > 0 &&
      !isEmailLikeName(lookup)
    ) {
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
 * branching: the From slot for outbound is the project alias, for
 * inbound it is the volunteer's resolved name (and vice versa for
 * To). When toHeader is missing on an inbound capture the To row
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
}): readonly InboxTimelineEntryParticipantRowViewModel[] {
  const fromEmail =
    participantHeaderEmail(input.item.fromHeader ?? null) ??
    (input.item.direction === "inbound"
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

  if (input.item.direction === "outbound") {
    // For outbound the From slot holds whatever the operator was
    // sending AS. Order: resolved project alias → whatever display
    // name appears on the wire (handles legacy / non-aliased sends
    // like "PNW Project <pnwbio@…>") → operator name → fallback.
    const fromHeaderName =
      fromHeaderDisplayName !== null &&
      !isEmailLikeName(fromHeaderDisplayName)
        ? normalizeDisplayName(fromHeaderDisplayName) || fromHeaderDisplayName
        : null;
    rows.push({
      label: "From",
      name: input.headerProjectLabel ?? fromHeaderName ?? operatorLabel,
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

  if (
    input.item.ccHeader !== null &&
    input.item.ccHeader.trim().length > 0
  ) {
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
    toEmail !== null
      ? (input.projectLabelByAlias.get(toEmail) ?? null)
      : null;
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
  const inboundEmails = [...filterItemsAtOrAfterPlatformFullCaptureCutover(input.timelineItems)]
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
    return null;
  }

  return {
    contactId: input.contact.id,
    contactDisplayName: input.contact.displayName,
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
    nextCursor: hasMore ? items[0]?.sortKey ?? null : null,
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
    : input.projectLabelById.get(membership.projectId) ?? null;
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
): Promise<
  Readonly<
    Record<
      string,
      {
        readonly projectName: string;
        readonly isActive: boolean;
      }
    >
  >
> {
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

  return Object.fromEntries(
    dimensions.map((dimension) => [
      dimension.projectId,
      {
        projectName:
          dimension.projectAlias?.trim().length
            ? dimension.projectAlias
            : dimension.projectName,
        isActive: dimension.isActive ?? false,
      },
    ]),
  );
}

function buildProjectLabelById(
  projectMetadataById: Readonly<
    Record<
      string,
      {
        readonly projectName: string;
        readonly isActive: boolean;
      }
    >
  >,
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
  readonly primaryMembership: ContactMembershipRecord | null;
  readonly projectMetadataById: Readonly<
    Record<
      string,
      {
        readonly projectName: string;
        readonly isActive: boolean;
      }
    >
  >;
}): number {
  const primaryProjectId = input.primaryMembership?.projectId ?? null;
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
  const normalizedQuery = normalizeInlineText(input.query) ?? null;
  const order = orderForInboxFilter(input.filterId);
  const loadProjectionRows = (filter: InboxFilterId) =>
    normalizedQuery === null
      ? runtime.repositories.inboxProjection.listPageOrderedByRecency({
          filter,
          order,
          limit: INBOX_LIST_SCAN_LIMIT,
          cursor: null,
          projectId: input.projectId,
        })
      : runtime.repositories.inboxProjection
          .searchPageOrderedByRecency({
            filter,
            order,
            limit: INBOX_LIST_SCAN_LIMIT,
            cursor: null,
            query: normalizedQuery,
            projectId: input.projectId,
          })
          .then((result) => result.rows);
  const [
    visibleProjections,
    archivedProjections,
    freshness,
    activeProjectRecords,
    projectAliasRecords,
  ] = await Promise.all([
    loadProjectionRows("all"),
    loadProjectionRows("archived"),
    runtime.repositories.inboxProjection.getFreshness(),
    runtime.repositories.projectDimensions.listActive(),
    runtime.settings.aliases.listAll(),
  ]);
  const matchedProjections = [...visibleProjections, ...archivedProjections];
  const activeProjects: readonly InboxActiveProjectOption[] =
    activeProjectRecords.map((record) => ({
      id: record.projectId,
      name: record.projectName,
      alias:
        record.projectAlias?.trim().length && record.projectAlias.trim().length > 0
          ? record.projectAlias.trim()
          : null,
    }));
  const candidateContactIds = matchedProjections.map(
    (projection) => projection.contactId,
  );
  const [
    contacts,
    memberships,
    latestMessagePreviewByCanonicalEventId,
    lastInboundAliasByContactId,
    canonicalEventsByContactIdEntries,
    auditEntriesByContactIdEntries,
  ] = await Promise.all([
    runtime.repositories.contacts.listByIds(candidateContactIds),
    runtime.repositories.contactMemberships.listByContactIds(
      candidateContactIds,
    ),
    loadLatestSubjectByCanonicalEventId(matchedProjections),
    runtime.repositories.gmailMessageDetails.listLastInboundAliasByContactIds(
      candidateContactIds,
    ),
    Promise.all(
      candidateContactIds.map(async (contactId) => [
        contactId,
        await runtime.repositories.canonicalEvents.listByContactId(contactId),
      ] as const),
    ),
    Promise.all(
      candidateContactIds.map(async (contactId) => [
        contactId,
        await runtime.repositories.auditEvidence.listByEntity({
          entityType: "contact",
          entityId: contactId,
        }),
      ] as const),
    ),
  ]);
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const membershipsByContactId = groupMembershipsByContactId(memberships);
  const projectMetadataById = await loadProjectMetadataById(memberships);
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

  const canonicalEventsByContactId = new Map(canonicalEventsByContactIdEntries);
  const auditEntriesByContactId = new Map(auditEntriesByContactIdEntries);
  const gmailSourceEvidenceIds = uniqueStrings(
    canonicalEventsByContactIdEntries.flatMap(([, events]) =>
      events
        .filter((event) => event.eventType === "communication.email.outbound")
        .map((event) => event.sourceEvidenceId),
    ),
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
    const lastNonAliasMessageAt = findLastNonAliasMessageAt({
      events: canonicalEventsByContactId.get(inboxProjection.contactId) ?? [],
      aliasSet,
      gmailDetailBySourceEvidenceId,
      fallbackLastInboundAt: inboxProjection.lastInboundAt,
    });
    const lastNonAliasOutboundAt = findLastNonAliasOutboundAt({
      events: canonicalEventsByContactId.get(inboxProjection.contactId) ?? [],
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
    .filter((item) => matchesServerFilter(item, input.filterId))
    .sort(
      input.filterId === "sent"
        ? compareInboxOutboundRecency
        : compareInboxRecency,
    );
  const cursorIndex =
    decodedCursor === null
      ? -1
      : allItems.findIndex(
          (item) =>
            item.contactId === decodedCursor.contactId &&
            item.lastNonAliasMessageAt === decodedCursor.lastNonAliasMessageAt &&
            item.lastOutboundAt === decodedCursor.lastOutboundAt &&
            item.lastActivityAt === decodedCursor.lastActivityAt,
        );
  const itemsAfterCursor =
    cursorIndex < 0 ? allItems : allItems.slice(cursorIndex + 1);
  const hasMore = itemsAfterCursor.length > input.limit;
  const pageItems = hasMore
    ? itemsAfterCursor.slice(0, input.limit)
    : itemsAfterCursor;
  const rowByContactId = new Map(allRows.map((row) => [row.contact.id, row]));
  const pageRows = pageItems.flatMap((item) => {
    const row = rowByContactId.get(item.contactId);
    return row === undefined ? [] : [row];
  });
  const counts = {
    all: allRows.filter((row) => row.inboxProjection.archivedAt === null).length,
    unread: allRows.filter(
      (row) => row.inboxProjection.archivedAt === null && row.isUnread,
    ).length,
    followUp: allRows.filter(
      (row) =>
        row.inboxProjection.archivedAt === null &&
        row.inboxProjection.needsFollowUp,
    ).length,
    unresolved: allRows.filter(
      (row) =>
        row.inboxProjection.archivedAt === null &&
        row.inboxProjection.hasUnresolved,
    ).length,
    sent: allRows.filter(
      (row) =>
        row.inboxProjection.archivedAt === null &&
        row.inboxProjection.lastOutboundAt !== null,
    ).length,
    archived: allRows.filter((row) => row.inboxProjection.archivedAt !== null)
      .length,
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
              lastNonAliasMessageAt:
                pageRows[pageRows.length - 1]?.lastNonAliasMessageAt ?? null,
              lastOutboundAt:
                pageRows[pageRows.length - 1]?.inboxProjection
                  .lastOutboundAt ?? null,
              lastActivityAt:
                pageRows[pageRows.length - 1]?.inboxProjection.lastActivityAt ??
                "",
              contactId: pageRows[pageRows.length - 1]?.contact.id ?? "",
            }),
      total: allItems.length,
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

  if (contact === null || inboxProjection === null) {
    return null;
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

  const visibleTimelineItems = filterItemsAtOrAfterPlatformFullCaptureCutover(
    activityTimelineItems,
  );
  const timelinePage = paginateTimelineItems({
    timelineItems: visibleTimelineItems,
    limit: input.timelineLimit,
    beforeSortKey: input.timelineCursor,
  });
  const hasHiddenEarlierHistory = canonicalEvents.some((event) =>
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
      .map((item) => sourceEvidenceIdByCanonicalEventId.get(item.canonicalEventId))
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
    inboxProjection.bucket === "New" ||
    (lastNonAliasOutboundAt !== null &&
      (latestReadAt === null || lastNonAliasOutboundAt > latestReadAt));

  return {
    contact,
    inboxProjection,
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
    canonicalEventById: new Map(canonicalEvents.map((event) => [event.id, event])),
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
  const contactById = new Map(inlineContacts.map((contact) => [contact.id, contact]));
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
    activeProjects.map((project) => [project.projectId, projectDisplayName(project)]),
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
  const primaryMembership = resolvePrimaryMembership({
    memberships: row.memberships,
    lastInboundAlias: row.lastInboundAlias,
    aliasToProjectId: cacheData.aliasToProjectId,
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
        : resolveProjectName(primaryMembership, cacheData.projectLabelById),
    additionalActiveProjectsCount: countAdditionalActiveProjects({
      memberships: row.memberships,
      primaryMembership,
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
        row.inboxProjection.lastInboundAt >
          row.inboxProjection.lastOutboundAt),
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
  readonly inboxProjection: InboxProjectionRow;
  readonly memberships: readonly ContactMembershipRecord[];
  readonly latestNote: {
    readonly body: string;
    readonly authorDisplayName: string | null;
    readonly authorId: string | null;
    readonly createdAt: string;
  } | null;
  readonly activityTimelineItems: readonly TimelineItem[];
  readonly projectMetadataById: Readonly<
    Record<
      string,
      {
        readonly projectName: string;
        readonly isActive: boolean;
      }
    >
  >;
  readonly referenceNowIso: string;
}): InboxContactSummaryViewModel {
  const projectActivityIndex = buildProjectActivityIndex(
    input.activityTimelineItems,
  );
  const activeProjects = sortMembershipsByLastActivity(
    input.memberships,
    projectActivityIndex.lastOccurredAtByProjectId,
  )
    .filter((membership) => !isPastProject(membership, input.projectMetadataById))
    .map((membership) =>
      buildProjectMembershipViewModel(
        membership,
        input.projectMetadataById,
        projectActivityIndex.firstOccurredAtByProjectId,
      ),
    )
    .filter(
      (membership): membership is InboxProjectMembershipViewModel =>
        membership !== null,
    );
  const pastProjects = sortMembershipsByCreatedAt(input.memberships)
    .filter((membership) => isPastProject(membership, input.projectMetadataById))
    .map((membership) =>
      buildProjectMembershipViewModel(
        membership,
        input.projectMetadataById,
        projectActivityIndex.firstOccurredAtByProjectId,
      ),
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

function buildConversationProject(input: {
  readonly contact: InboxContactSummaryViewModel;
  readonly timelineItems: readonly TimelineItem[];
  readonly canonicalEventById: ReadonlyMap<string, CanonicalEventRecord>;
  readonly salesforceEventContextBySourceEvidenceId: ReadonlyMap<
    string,
    {
      readonly projectId: string | null;
    }
  >;
  readonly projectMetadataById: Readonly<
    Record<
      string,
      {
        readonly projectName: string;
        readonly isActive: boolean;
      }
    >
  >;
}): InboxDetailViewModel["conversationProject"] {
  const membershipProject = input.contact.activeProjects[0];

  if (membershipProject !== undefined) {
    return {
      projectId: membershipProject.projectId,
      projectName: membershipProject.projectName,
      source: "membership",
    };
  }

  for (const item of [...input.timelineItems].sort((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt),
  )) {
    const sourceEvidenceId =
      input.canonicalEventById.get(item.canonicalEventId)?.sourceEvidenceId;

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

    return {
      projectId,
      projectName,
      source: "conversation",
    };
  }

  return null;
}

function matchesServerFilter(
  item: InboxListItemViewModel,
  filterId: InboxFilterId,
): boolean {
  if (item.isArchived) {
    return filterId === "archived";
  }

  switch (filterId) {
    case "all":
      return true;
    case "unread":
      return item.isUnread;
    case "follow-up":
      return item.needsFollowUp;
    case "unresolved":
      return item.hasUnresolved;
    case "sent":
      return item.lastOutboundAt !== null;
    case "archived":
      return item.isArchived;
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
        : filter.id === "unresolved"
          ? totals.unresolved
          : filter.id === "sent"
            ? totals.sent
            : filter.id === "archived"
              ? totals.archived
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
    followUpRail: cachedData.followUpRail,
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
  const operatorDisplayName = "Adventure Scientists";

  return {
    entries: cachedData.timelineItems.map((item) =>
      buildTimelineEntry({
        contactDisplayName: cachedData.contact.displayName,
        contactPrimaryEmail: cachedData.contact.primaryEmail,
        contactDisplayNameByEmail: cachedData.contactDisplayNameByEmail,
        operatorDisplayName,
        inboxProjection: cachedData.inboxProjection,
        item,
        campaignActivitySummaryByCampaignId:
          cachedData.campaignActivitySummaryByCampaignId,
        memberships: cachedData.memberships,
        projectMetadataById: cachedData.projectMetadataById,
        projectLabelByAlias: cachedData.projectLabelByAlias,
        referenceNowIso,
        attachmentsByCanonicalEventId: cachedData.attachmentsByCanonicalEventId,
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
  const currentUser = await getCurrentUser();
  const operatorDisplayName =
    normalizeDisplayName(currentUser?.name ?? "") || "Adventure Scientists";
  const contactSummary = buildContactSummary({
    contact: cachedData.contact,
    inboxProjection: cachedData.inboxProjection,
    memberships: cachedData.memberships,
    latestNote: cachedData.latestNote,
    activityTimelineItems: cachedData.activityTimelineItems,
    projectMetadataById: cachedData.projectMetadataById,
    referenceNowIso,
  });
  const composerReplyContext = buildComposerReplyContext({
    contact: cachedData.contact,
    timelineItems: cachedData.timelineItems,
    defaultAlias:
      await runtime.timelinePresentation.findLastInboundAliasForContact(
        contactId,
      ),
  });

  return {
    contact: contactSummary,
    conversationProject: buildConversationProject({
      contact: contactSummary,
      timelineItems: cachedData.activityTimelineItems,
      canonicalEventById: cachedData.canonicalEventById,
      salesforceEventContextBySourceEvidenceId:
        cachedData.salesforceEventContextBySourceEvidenceId,
      projectMetadataById: cachedData.projectMetadataById,
    }),
    initials: toInitials(cachedData.contact.displayName),
    avatarTone: avatarToneForContact(cachedData.contact.id),
    timeline: cachedData.timelineItems.map((item) =>
      buildTimelineEntry({
        contactDisplayName: cachedData.contact.displayName,
        contactPrimaryEmail: cachedData.contact.primaryEmail,
        contactDisplayNameByEmail: cachedData.contactDisplayNameByEmail,
        operatorDisplayName,
        inboxProjection: cachedData.inboxProjection,
        item,
        campaignActivitySummaryByCampaignId:
          cachedData.campaignActivitySummaryByCampaignId,
        memberships: cachedData.memberships,
        projectMetadataById: cachedData.projectMetadataById,
        projectLabelByAlias: cachedData.projectLabelByAlias,
        referenceNowIso,
        attachmentsByCanonicalEventId: cachedData.attachmentsByCanonicalEventId,
      }),
    ),
    bucket: mapBucket(cachedData.inboxProjection.bucket),
    needsFollowUp: cachedData.inboxProjection.needsFollowUp,
    isArchived: cachedData.inboxProjection.archivedAt !== null,
    isUnread: cachedData.isUnread,
    smsEligible: cachedData.contact.primaryPhone !== null,
    composerReplyContext,
    timelinePage: cachedData.timelinePage,
    freshness: cachedData.freshness,
  };
}
