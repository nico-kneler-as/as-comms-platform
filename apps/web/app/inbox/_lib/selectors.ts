import { unstable_cache } from "next/cache";

import type {
  CanonicalEventRecord,
  ContactMembershipRecord,
  ContactRecord,
  GmailMessageDetailRecord,
  InboxDrivingEventType,
  InboxProjectionRow,
  TimelineItem,
  TimelineProjectionRow
} from "@as-comms/contracts";

import { getStage1WebRuntime } from "../../../src/server/stage1-runtime";

import { INBOX_FILTERS } from "./filters";
import type {
  InboxAvatarTone,
  InboxBucket,
  InboxChannel,
  InboxContactSummaryViewModel,
  InboxDetailViewModel,
  InboxFilterId,
  InboxFilterViewModel,
  InboxListItemViewModel,
  InboxListViewModel,
  InboxProjectMembershipViewModel,
  InboxProjectStatus,
  InboxRecentActivityViewModel,
  InboxTimelineEntryKind,
  InboxTimelineEntryViewModel,
  InboxVolunteerStage
} from "./view-models";

interface InboxListCacheRow {
  readonly contact: ContactRecord;
  readonly inboxProjection: InboxProjectionRow;
  readonly memberships: readonly ContactMembershipRecord[];
  readonly latestSubject: string | null;
}

interface InboxListCacheData {
  readonly rows: readonly InboxListCacheRow[];
  readonly projectNameById: Readonly<Record<string, string>>;
}

interface InboxDetailCacheData {
  readonly contact: ContactRecord;
  readonly inboxProjection: InboxProjectionRow;
  readonly memberships: readonly ContactMembershipRecord[];
  readonly timelineItems: readonly TimelineItem[];
  readonly projectNameById: Readonly<Record<string, string>>;
}

const AVATAR_TONES: readonly InboxAvatarTone[] = [
  "indigo",
  "emerald",
  "amber",
  "rose",
  "sky",
  "violet",
  "teal",
  "slate"
];

/**
 * Default list sort: last inbound message first.
 * Toggling follow-up does NOT change row ordering.
 */
export const compareInboxRecency = (
  a: InboxListItemViewModel,
  b: InboxListItemViewModel
): number => {
  const aSortAt = a.lastInboundAt ?? a.lastActivityAt;
  const bSortAt = b.lastInboundAt ?? b.lastActivityAt;

  if (aSortAt !== bSortAt) {
    return aSortAt < bSortAt ? 1 : -1;
  }

  if (a.lastActivityAt !== b.lastActivityAt) {
    return a.lastActivityAt < b.lastActivityAt ? 1 : -1;
  }

  return a.contactId.localeCompare(b.contactId);
};

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return Array.from(
    new Set(
      values.filter((value): value is string => typeof value === "string")
    )
  );
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

  return parts
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
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

  const normalized = status.trim().toLowerCase().replace(/[_\s]+/g, "-");
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
  memberships: readonly ContactMembershipRecord[]
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
  memberships: readonly ContactMembershipRecord[]
): InboxVolunteerStage {
  const primaryMembership = sortMemberships(memberships)[0] ?? null;
  const normalizedStatus = normalizeMembershipStatus(primaryMembership?.status ?? null);

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
  projectNameById: Readonly<Record<string, string>>
): string | null {
  if (membership.projectId === null) {
    return null;
  }

  return projectNameById[membership.projectId] ?? membership.projectId;
}

function buildProjectMembershipViewModel(
  membership: ContactMembershipRecord,
  projectNameById: Readonly<Record<string, string>>
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
    // Gap: the canonical project URL is not stored yet, so the shell uses a
    // stable best-effort CRM path derived from the project identifier.
    crmUrl: `https://adventurescientists.lightning.force.com/lightning/r/Project__c/${encodeURIComponent(
      membership.projectId
    )}/view`
  };
}

function isPastProject(status: InboxProjectStatus): boolean {
  return status === "successful";
}

function formatJoinedAtLabel(createdAt: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });

  return `Joined ${formatter.format(new Date(createdAt))}`;
}

function formatRelativeTimestamp(timestamp: string, referenceNowIso: string): string {
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

function defaultLatestSubject(
  eventType: InboxDrivingEventType,
  fallback: string | null
): string {
  if (fallback !== null && fallback.trim().length > 0) {
    return fallback;
  }

  return mapChannel(eventType) === "sms" ? "SMS conversation" : "Email conversation";
}

function mapTimelineKind(
  item: TimelineItem
): InboxTimelineEntryKind {
  switch (item.family) {
    case "one_to_one_email":
      return item.direction === "inbound" ? "inbound-email" : "outbound-email";
    case "one_to_one_sms":
      return item.direction === "inbound" ? "inbound-sms" : "outbound-sms";
    case "auto_email":
      return "outbound-auto-email";
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

function recentActivityLabel(item: TimelineItem): string {
  switch (item.family) {
    case "one_to_one_email":
    case "auto_email":
      return item.subject ?? item.summary;
    case "one_to_one_sms":
    case "campaign_sms":
      return item.messageTextPreview || item.summary;
    case "campaign_email":
      return item.campaignName ?? item.summary;
    case "internal_note":
      return item.body;
    case "salesforce_event":
      return item.summary;
  }
}

function buildRecentActivity(
  timelineItems: readonly TimelineItem[],
  referenceNowIso: string
): readonly InboxRecentActivityViewModel[] {
  return [...timelineItems]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      label: recentActivityLabel(item),
      occurredAtLabel: formatRelativeTimestamp(item.occurredAt, referenceNowIso)
    }));
}

function timelineChannel(item: TimelineItem): InboxChannel | null {
  switch (item.family) {
    case "one_to_one_email":
    case "auto_email":
    case "campaign_email":
      return "email";
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
  contactDisplayName: string
): string {
  switch (item.family) {
    case "one_to_one_email":
    case "one_to_one_sms":
      return item.direction === "inbound" ? contactDisplayName : "You";
    case "auto_email":
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

function timelineSubject(item: TimelineItem): string | null {
  switch (item.family) {
    case "one_to_one_email":
    case "auto_email":
      return item.subject;
    case "campaign_email":
    case "campaign_sms":
      return item.campaignName ?? item.summary;
    case "one_to_one_sms":
    case "internal_note":
    case "salesforce_event":
      return null;
  }
}

function timelineBody(item: TimelineItem): string {
  switch (item.family) {
    case "one_to_one_email":
      return item.bodyPreview ?? item.snippet;
    case "one_to_one_sms":
      return item.messageTextPreview;
    case "auto_email":
      return item.snippet;
    case "campaign_email":
      return item.snippet;
    case "campaign_sms":
      return item.messageTextPreview;
    case "internal_note":
      return item.body;
    case "salesforce_event":
      return item.summary;
  }
}

function isUnreadTimelineItem(
  item: TimelineItem,
  inboxProjection: InboxProjectionRow
): boolean {
  if (inboxProjection.bucket !== "New") {
    return false;
  }

  switch (item.family) {
    case "one_to_one_email":
    case "one_to_one_sms":
      return (
        item.direction === "inbound" &&
        item.canonicalEventId === inboxProjection.lastCanonicalEventId
      );
    case "auto_email":
    case "campaign_email":
    case "campaign_sms":
    case "internal_note":
    case "salesforce_event":
      return false;
  }
}

function buildTimelineEntry(
  input: {
    readonly contactDisplayName: string;
    readonly inboxProjection: InboxProjectionRow;
    readonly item: TimelineItem;
    readonly referenceNowIso: string;
  }
): InboxTimelineEntryViewModel {
  return {
    id: input.item.id,
    kind: mapTimelineKind(input.item),
    occurredAt: input.item.occurredAt,
    occurredAtLabel: formatRelativeTimestamp(
      input.item.occurredAt,
      input.referenceNowIso
    ),
    actorLabel: timelineActorLabel(input.item, input.contactDisplayName),
    subject: timelineSubject(input.item),
    body: timelineBody(input.item),
    channel: timelineChannel(input.item),
    isUnread: isUnreadTimelineItem(input.item, input.inboxProjection)
  };
}

function groupMembershipsByContactId(
  memberships: readonly ContactMembershipRecord[]
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
  memberships: readonly ContactMembershipRecord[]
): Promise<Readonly<Record<string, string>>> {
  const projectIds = uniqueStrings(
    memberships.map((membership) => membership.projectId)
  );

  if (projectIds.length === 0) {
    return {};
  }

  const runtime = await getStage1WebRuntime();
  const dimensions = await runtime.repositories.projectDimensions.listByIds(projectIds);

  return Object.fromEntries(
    dimensions.map((dimension) => [dimension.projectId, dimension.projectName])
  );
}

async function loadLatestSubjectByCanonicalEventId(
  projections: readonly InboxProjectionRow[]
): Promise<Readonly<Record<string, string | null>>> {
  const eventIds = uniqueStrings(
    projections.map((projection) => projection.lastCanonicalEventId)
  );

  if (eventIds.length === 0) {
    return {};
  }

  const runtime = await getStage1WebRuntime();
  const [canonicalEvents, timelineRows] = await Promise.all([
    runtime.repositories.canonicalEvents.listByIds(eventIds),
    Promise.all(
      eventIds.map((eventId) =>
        runtime.repositories.timelineProjection.findByCanonicalEventId(eventId)
      )
    )
  ]);
  const sourceEvidenceIds = uniqueStrings(
    canonicalEvents.map((event) => event.sourceEvidenceId)
  );
  const gmailDetails = await runtime.repositories.gmailMessageDetails.listBySourceEvidenceIds(
    sourceEvidenceIds
  );
  const canonicalEventById = new Map(
    canonicalEvents.map((event) => [event.id, event])
  );
  const timelineByCanonicalEventId = new Map(
    timelineRows
      .filter((row): row is TimelineProjectionRow => row !== null)
      .map((row) => [row.canonicalEventId, row])
  );
  const gmailDetailBySourceEvidenceId = new Map(
    gmailDetails.map((detail) => [detail.sourceEvidenceId, detail])
  );

  return Object.fromEntries(
    eventIds.map((eventId) => {
      const event = canonicalEventById.get(eventId);

      if (event === undefined) {
        return [eventId, null] as const;
      }

      return [
        eventId,
        gmailDetailBySourceEvidenceId.get(event.sourceEvidenceId)?.subject ??
          timelineByCanonicalEventId.get(eventId)?.summary ??
          null
      ] as const;
    })
  );
}

async function readInboxListCacheData(): Promise<InboxListCacheData> {
  const runtime = await getStage1WebRuntime();
  const projections = await runtime.repositories.inboxProjection.listAllOrderedByRecency();
  const contactIds = projections.map((projection) => projection.contactId);
  const [contacts, memberships, latestSubjectByCanonicalEventId] = await Promise.all([
    runtime.repositories.contacts.listByIds(contactIds),
    runtime.repositories.contactMemberships.listByContactIds(contactIds),
    loadLatestSubjectByCanonicalEventId(projections)
  ]);
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const membershipsByContactId = groupMembershipsByContactId(memberships);

  return {
    rows: projections.flatMap((inboxProjection) => {
      const contact = contactById.get(inboxProjection.contactId);

      if (contact === undefined) {
        return [];
      }

      return [
        {
          contact,
          inboxProjection,
          memberships: membershipsByContactId.get(inboxProjection.contactId) ?? [],
          latestSubject:
            latestSubjectByCanonicalEventId[inboxProjection.lastCanonicalEventId] ?? null
        } satisfies InboxListCacheRow
      ];
    }),
    projectNameById: await loadProjectNameById(memberships)
  };
}

async function readInboxDetailCacheData(
  contactId: string
): Promise<InboxDetailCacheData | null> {
  const runtime = await getStage1WebRuntime();
  const [contact, inboxProjection, memberships, timelineItems] = await Promise.all([
    runtime.repositories.contacts.findById(contactId),
    runtime.repositories.inboxProjection.findByContactId(contactId),
    runtime.repositories.contactMemberships.listByContactId(contactId),
    runtime.timelinePresentation.listTimelineItemsByContactId(contactId)
  ]);

  if (contact === null || inboxProjection === null) {
    return null;
  }

  return {
    contact,
    inboxProjection,
    memberships,
    timelineItems,
    projectNameById: await loadProjectNameById(memberships)
  };
}

const loadInboxListCacheData = unstable_cache(
  readInboxListCacheData,
  ["inbox:list:data"],
  {
    tags: ["inbox"]
  }
);

function loadInboxDetailCacheData(contactId: string) {
  return unstable_cache(
    () => readInboxDetailCacheData(contactId),
    [`inbox:detail:data:${contactId}`],
    {
      tags: ["inbox", `inbox:contact:${contactId}`, `timeline:contact:${contactId}`]
    }
  )();
}

function toListItemViewModel(
  row: InboxListCacheRow,
  projectNameById: Readonly<Record<string, string>>,
  referenceNowIso: string
): InboxListItemViewModel {
  const sortedMemberships = sortMemberships(row.memberships);
  const primaryMembership = sortedMemberships[0] ?? null;

  return {
    contactId: row.contact.id,
    displayName: row.contact.displayName,
    initials: toInitials(row.contact.displayName),
    avatarTone: avatarToneForContact(row.contact.id),
    latestSubject: defaultLatestSubject(
      row.inboxProjection.lastEventType,
      row.latestSubject
    ),
    snippet: row.inboxProjection.snippet,
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
    lastActivityAt: row.inboxProjection.lastActivityAt,
    lastEventType: row.inboxProjection.lastEventType,
    lastActivityLabel: formatRelativeTimestamp(
      row.inboxProjection.lastActivityAt,
      referenceNowIso
    )
  };
}

function buildContactSummary(
  input: {
    readonly contact: ContactRecord;
    readonly inboxProjection: InboxProjectionRow;
    readonly memberships: readonly ContactMembershipRecord[];
    readonly timelineItems: readonly TimelineItem[];
    readonly projectNameById: Readonly<Record<string, string>>;
    readonly referenceNowIso: string;
  }
): InboxContactSummaryViewModel {
  const memberships = sortMemberships(input.memberships);
  const projectMemberships = memberships
    .map((membership) =>
      buildProjectMembershipViewModel(membership, input.projectNameById)
    )
    .filter((membership): membership is InboxProjectMembershipViewModel => membership !== null);

  return {
    contactId: input.contact.id,
    displayName: input.contact.displayName,
    volunteerId: input.contact.salesforceContactId ?? input.contact.id,
    primaryEmail: input.contact.primaryEmail,
    primaryPhone: input.contact.primaryPhone,
    cityState: null,
    joinedAtLabel: formatJoinedAtLabel(input.contact.createdAt),
    hasUnresolved: input.inboxProjection.hasUnresolved,
    activeProjects: projectMemberships.filter(
      (membership) => !isPastProject(membership.status)
    ),
    pastProjects: projectMemberships.filter((membership) =>
      isPastProject(membership.status)
    ),
    recentActivity: buildRecentActivity(
      input.timelineItems,
      input.referenceNowIso
    )
  };
}

function matchesServerFilter(
  item: InboxListItemViewModel,
  filterId: InboxFilterId
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
  }
}

export async function getInboxList(
  filterId: InboxFilterId = "all"
): Promise<InboxListViewModel> {
  const cachedData = await loadInboxListCacheData();
  const referenceNowIso = new Date().toISOString();
  const items = cachedData.rows.map((row) =>
    toListItemViewModel(row, cachedData.projectNameById, referenceNowIso)
  );
  const totals = {
    all: items.length,
    unread: items.filter((item) => item.bucket === "new").length,
    followUp: items.filter((item) => item.needsFollowUp).length,
    unresolved: items.filter((item) => item.hasUnresolved).length
  };
  const filters: InboxFilterViewModel[] = INBOX_FILTERS.map((filter) => ({
    id: filter.id,
    label: filter.label,
    hint: filter.hint,
    count:
      filter.id === "follow-up"
        ? totals.followUp
        : filter.id === "unresolved"
          ? totals.unresolved
          : totals[filter.id]
  }));

  return {
    items: items.filter((item) => matchesServerFilter(item, filterId)),
    filters,
    totals
  };
}

export async function getInboxDetail(
  contactId: string
): Promise<InboxDetailViewModel | null> {
  const cachedData = await loadInboxDetailCacheData(contactId);

  if (cachedData === null) {
    return null;
  }

  const referenceNowIso = new Date().toISOString();

  return {
    contact: buildContactSummary({
      contact: cachedData.contact,
      inboxProjection: cachedData.inboxProjection,
      memberships: cachedData.memberships,
      timelineItems: cachedData.timelineItems,
      projectNameById: cachedData.projectNameById,
      referenceNowIso
    }),
    timeline: cachedData.timelineItems.map((item) =>
      buildTimelineEntry({
        contactDisplayName: cachedData.contact.displayName,
        inboxProjection: cachedData.inboxProjection,
        item,
        referenceNowIso
      })
    ),
    bucket: mapBucket(cachedData.inboxProjection.bucket),
    needsFollowUp: cachedData.inboxProjection.needsFollowUp,
    smsEligible: cachedData.contact.primaryPhone !== null
  };
}
