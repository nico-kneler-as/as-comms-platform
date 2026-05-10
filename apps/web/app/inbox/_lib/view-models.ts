import type { CanonicalEventType } from "@as-comms/contracts";

/**
 * Inbox — UI-facing view models.
 *
 * These types shape the minimum payload the client UI needs. They deliberately
 * mirror the canonical Inbox / Timeline projection concepts from
 * docs/01-core/data-core.md and docs/01-core/interfaces-core.md rather than
 * echoing any provider payload shape.
 *
 * Locked rules reflected here:
 *   - one row per person, not per thread (P-02 / INBX-01)
 *   - "new" and "opened" remain row-state bucket values, not primary tabs
 *   - "needsFollowUp" is a separate operator flag, not derived from bucket
 *   - unresolved is an overlay on top of the queue model (INBX-04)
 *   - campaign and automated sends are surfaced in the timeline as collapsed
 *     entries so 1:1 history stays readable (INBX-05)
 *   - default list order: lastInboundAt desc nulls last, then lastActivityAt desc
 *   - sent mode order: lastOutboundAt desc, then lastActivityAt desc
 *   - toggling follow-up does NOT change row ordering
 */

export type InboxBucket = "new" | "opened";

export type InboxFilterId =
  | "inbox"
  | "unread"
  | "follow-up"
  | "sent"
  | "archived";

export const INBOX_FILTER_IDS: readonly InboxFilterId[] = [
  "inbox",
  "unread",
  "follow-up",
  "sent",
  "archived",
];

export function parseInboxFilterId(
  value: string | null | undefined,
): InboxFilterId | null {
  if (value === "all") {
    return "inbox";
  }

  return INBOX_FILTER_IDS.includes(value as InboxFilterId)
    ? (value as InboxFilterId)
    : null;
}

export type InboxChannel = "email" | "sms";

export type InboxVolunteerStage =
  | "lead"
  | "prospect"
  | "applicant"
  | "active"
  | "alumni"
  | "non-volunteer";

export type InboxAvatarTone =
  | "indigo"
  | "emerald"
  | "amber"
  | "rose"
  | "sky"
  | "violet"
  | "teal"
  | "slate";

export interface InboxListItemViewModel {
  readonly contactId: string;
  readonly displayName: string;
  readonly primaryEmail: string | null;
  readonly initials: string;
  readonly avatarTone: InboxAvatarTone;
  readonly latestSubject: string;
  readonly snippet: string;
  readonly latestChannel: InboxChannel;
  readonly projectLabel: string | null;
  /**
   * When the row's primary project is a connected sub-project, this holds
   * the sub-project's own name so the chip can render "via {sub}" beneath
   * the host's name (which is in `projectLabel`). `null` when the project
   * is standalone or a host. Mirrors the membership-level
   * `subDisplayName` field so rail / row / header agree by construction.
   */
  readonly projectSubLabel: string | null;
  readonly additionalActiveProjectsCount: number;
  readonly volunteerStage: InboxVolunteerStage;

  // ── Row states (all separate, not collapsed) ──
  readonly bucket: InboxBucket;
  readonly needsFollowUp: boolean;
  readonly hasUnresolved: boolean;
  readonly isArchived: boolean;
  readonly isUnread: boolean;
  readonly unreadCount: number;
  /**
   * True when the last inbound is newer than the last outbound (or no outbound
   * exists), regardless of bucket. Drives the "unanswered" dot indicator on
   * the row: a thread the operator has opened but hasn't replied to yet.
   */
  readonly isUnanswered: boolean;

  // ── Sort / display ──
  readonly lastInboundAt: string | null;
  readonly lastNonAliasMessageAt: string | null;
  readonly lastOutboundAt: string | null;
  readonly lastActivityAt: string;
  readonly lastEventType: CanonicalEventType;
  readonly lastActivityLabel: string;
}

/**
 * Canonical project participation status, per product brief.
 * `lead` → `applied` → `in-training` → `trip-planning` → `in-field` →
 * `successful`. Statuses are per-(volunteer, project) membership and do not
 * flow through the inbox bucket model.
 */
export type InboxProjectStatus =
  | "lead"
  | "applied"
  | "in-training"
  | "trip-planning"
  | "in-field"
  | "successful";

export interface InboxProjectMembershipViewModel {
  readonly membershipId: string;
  readonly projectId: string;
  /**
   * The label the rail / chip shows as primary text. For a standalone or
   * host project this is just the project's own name. For a connected sub
   * (one whose `project_dimensions.connected_to_project_id` is set) this
   * is the **host's** name — so a Beech-only volunteer's rail entry reads
   * "Beech & Butternut" rather than "Beech".
   */
  readonly projectName: string;
  /**
   * Set when this membership's project is a connected sub. Holds the
   * sub-project's own name (e.g. "Saving American Beech") so the rail / chip
   * can render a small "via {subDisplayName}" line under the primary host
   * label. `null` for standalone or host projects.
   */
  readonly subDisplayName: string | null;
  /** True when this membership's project is a connected sub-project. */
  readonly isConnectedSub: boolean;
  readonly projectIsActive: boolean;
  readonly status: InboxProjectStatus;
  readonly statusLabel: string;
  readonly crmUrl: string;
  readonly expeditionMemberUrl: string | null;
}

export interface InboxRecentActivityViewModel {
  readonly id: string;
  readonly label: string;
  readonly occurredAtLabel: string;
  readonly isMostRecent?: boolean;
}

export interface InboxContactSummaryViewModel {
  readonly contactId: string;
  readonly displayName: string;
  readonly volunteerId: string;
  readonly primaryEmail: string | null;
  readonly primaryPhone: string | null;
  readonly joinedAtLabel: string;
  readonly hasUnresolved: boolean;
  readonly pinnedNote: {
    readonly body: string;
    readonly authorLabel: string;
    readonly createdAtLabel: string;
  } | null;
  readonly activeProjects: readonly InboxProjectMembershipViewModel[];
  readonly pastProjects: readonly InboxProjectMembershipViewModel[];
  readonly recentActivity: readonly InboxRecentActivityViewModel[];
}

/**
 * Timeline entry kinds. 1:1 kinds render as full chat bubbles; campaign and
 * automated kinds render as collapsed single-line entries that expand on
 * click; internal notes and system events are visually distinct.
 */
export type InboxTimelineEntryKind =
  | "inbound-email"
  | "outbound-email"
  | "email-activity"
  | "outbound-auto-email"
  | "outbound-auto-sms"
  | "outbound-campaign-email"
  | "inbound-sms"
  | "outbound-sms"
  | "outbound-campaign-sms"
  | "internal-note"
  | "system-event";

export type InboxTimelineEntrySendStatus =
  | "pending"
  | "confirmed"
  | "failed"
  | "orphaned"
  | null;

export interface InboxTimelineCampaignActivityViewModel {
  readonly activityType: "sent" | "opened" | "clicked" | "unsubscribed";
  readonly occurredAt: string;
  readonly occurredAtLabel: string;
  readonly label: string;
}

export interface InboxTimelineEntryParticipantRowViewModel {
  readonly label: "From" | "To" | "Cc";
  readonly name: string | null;
  readonly email: string | null;
}

export interface InboxTimelineEntryViewModel {
  readonly id: string;
  readonly kind: InboxTimelineEntryKind;
  readonly occurredAt: string;
  readonly occurredAtLabel: string;
  readonly actorLabel: string;
  readonly subject: string | null;
  readonly body: string;
  readonly channel: InboxChannel | null;
  readonly isUnread: boolean;
  readonly isPreview: boolean;
  readonly fromHeader: string | null;
  readonly toHeader: string | null;
  readonly recipientLabel?: string | null;
  /**
   * Resolved project alias label (e.g. "PNW Biodiversity") for the
   * conversation this email belongs to, derived from whichever side of
   * the From/To headers is one of our known project aliases. Null for
   * non-email entries or when the alias email can't be matched.
   *
   * Used by `EmailParticipantHeader` to render headers as
   *   outbound: <sender or projectAlias> → <volunteer>
   *   inbound:  <volunteer>     → <projectAlias>
   * without the bubble component needing access to the alias map.
   */
  readonly headerProjectLabel?: string | null;
  /**
   * Pre-resolved bubble-header rows for email entries. Always emits a
   * From and a To row even when one side of the captured header is
   * missing — the bubble's compact header reads
   * `participantRows[0].name → participantRows[1].name` regardless of
   * direction; the expanded debug view renders each row as
   * `<name> <email>` (or just `<email>` when the resolver couldn't
   * find a real name). `email` is null when only a label is known
   * (e.g. a project alias without a captured alias address).
   *
   * Cc, when present, is appended as a single row with the raw
   * comma-separated header in `name` and `email = null`. Per-address
   * parsing is a future follow-up.
   */
  readonly participantRows?: readonly InboxTimelineEntryParticipantRowViewModel[];
  readonly ccHeader: string | null;
  readonly mailbox: string | null;
  readonly threadId: string | null;
  readonly rfc822MessageId: string | null;
  readonly inReplyToRfc822: string | null;
  readonly sendStatus: InboxTimelineEntrySendStatus;
  readonly failedReason: string | null;
  readonly failedDetail: string | null;
  readonly attachmentCount: number;
  readonly attachments: readonly {
    readonly id: string | null;
    readonly mimeType: string;
    readonly filename: string | null;
    readonly sizeBytes: number;
    readonly proxyUrl: string | null;
  }[];
  readonly campaignActivity: readonly InboxTimelineCampaignActivityViewModel[];
  readonly noteId?: string | null;
  readonly authorId?: string | null;
}

export type OptimisticOutbound = InboxTimelineEntryViewModel & {
  readonly contactId: string | null;
  readonly clientGeneratedId: string;
  readonly settledAt: number | null;
};

export interface InboxTimelineSystemGroupViewModel {
  readonly id: string;
  readonly kind: "system-message-group";
  readonly entries: readonly InboxTimelineEntryViewModel[];
  readonly automatedCount: number;
  readonly campaignCount: number;
  readonly occurredAt: string;
  readonly occurredAtLabel: string;
}

export type InboxTimelinePresentationItem =
  | InboxTimelineEntryViewModel
  | InboxTimelineSystemGroupViewModel;

function isSystemGroupCandidate(entry: InboxTimelineEntryViewModel): boolean {
  return (
    entry.kind === "outbound-auto-email" ||
    entry.kind === "outbound-auto-sms" ||
    entry.kind === "outbound-campaign-email" ||
    entry.kind === "outbound-campaign-sms"
  );
}

function buildSystemMessageGroup(
  entries: readonly InboxTimelineEntryViewModel[],
): InboxTimelineSystemGroupViewModel | InboxTimelineEntryViewModel {
  const firstEntry = entries[0];

  if (entries.length === 1 && firstEntry !== undefined) {
    return firstEntry;
  }

  const mostRecent = entries.reduce((latest, entry) =>
    entry.occurredAt > latest.occurredAt ? entry : latest,
  );
  const automatedCount = entries.filter(
    (entry) =>
      entry.kind === "outbound-auto-email" ||
      entry.kind === "outbound-auto-sms",
  ).length;
  const campaignCount = entries.filter(
    (entry) =>
      entry.kind === "outbound-campaign-email" ||
      entry.kind === "outbound-campaign-sms",
  ).length;

  return {
    id: `system-message-group:${entries.map((entry) => entry.id).join("+")}`,
    kind: "system-message-group",
    entries,
    automatedCount,
    campaignCount,
    occurredAt: mostRecent.occurredAt,
    occurredAtLabel: mostRecent.occurredAtLabel,
  };
}

export function groupInboxTimelineSystemMessages(
  entries: readonly InboxTimelineEntryViewModel[],
): readonly InboxTimelinePresentationItem[] {
  const grouped: InboxTimelinePresentationItem[] = [];
  let pendingSystemEntries: InboxTimelineEntryViewModel[] = [];

  const flushPendingSystemEntries = () => {
    if (pendingSystemEntries.length === 0) {
      return;
    }

    grouped.push(buildSystemMessageGroup(pendingSystemEntries));
    pendingSystemEntries = [];
  };

  for (const entry of entries) {
    if (isSystemGroupCandidate(entry)) {
      pendingSystemEntries.push(entry);
      continue;
    }

    flushPendingSystemEntries();
    grouped.push(entry);
  }

  flushPendingSystemEntries();

  return grouped;
}

export interface InboxComposerAliasOption {
  readonly id: string;
  readonly alias: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly signature: string;
  /**
   * AI generation is available for this alias: the provider is configured and
   * the project is active.
   */
  readonly isAiReady: boolean;
  readonly isAiConfigured?: boolean;
  /**
   * Canonical project-knowledge signal: whether this alias's project has
   * cached Notion-backed context available for grounding.
   */
  readonly hasCachedContent?: boolean;
}

export interface InboxSmsSenderOption {
  readonly id: string;
  readonly phoneE164: string;
  readonly displayName: string;
}

export interface InboxComposerReplyContext {
  readonly contactId: string;
  readonly contactDisplayName: string;
  readonly contactPrimaryPhone: string | null;
  readonly subject: string;
  readonly threadCursor: string | null;
  readonly threadId: string | null;
  readonly inReplyToRfc822: string | null;
  readonly defaultAlias: string | null;
  readonly cc?: readonly string[];
}

export interface InboxDetailTimelinePageViewModel {
  readonly hasMore: boolean;
  readonly hasHiddenEarlierHistory: boolean;
  readonly nextCursor: string | null;
  readonly total: number;
}

export interface InboxDetailFreshnessViewModel {
  readonly inboxUpdatedAt: string | null;
  readonly timelineUpdatedAt: string | null;
  readonly timelineCount: number;
}

export interface InboxDetailSummaryViewModel {
  readonly contact: InboxContactSummaryViewModel;
  readonly projectionAvailable: boolean;
  readonly conversationProject: {
    readonly projectId: string;
    /**
     * Same convention as
     * {@link InboxProjectMembershipViewModel.projectName}: when the
     * resolved project is a connected sub, this is the host's name (so the
     * header chip says "Beech & Butternut") and the sub-project's own
     * name lives in `subProjectName`.
     */
    readonly projectName: string;
    /**
     * Sub-project's own name when the resolved project is a connected sub
     * (so the header chip can render "via {subProjectName}"). `null` for
     * standalone / host projects.
     */
    readonly subProjectName: string | null;
    readonly source: "membership" | "conversation";
  } | null;
  readonly initials: string;
  readonly avatarTone: InboxAvatarTone;
  readonly bucket: InboxBucket;
  readonly needsFollowUp: boolean;
  readonly isArchived: boolean;
  readonly isUnread: boolean;
  readonly smsEligible: boolean;
  readonly composerReplyContext: InboxComposerReplyContext | null;
  readonly freshness: InboxDetailFreshnessViewModel;
}

export interface InboxDetailTimelineViewModel {
  readonly timeline: readonly InboxTimelineEntryViewModel[];
  readonly timelinePage: InboxDetailTimelinePageViewModel;
}

export interface InboxDetailViewModel
  extends InboxDetailSummaryViewModel, InboxDetailTimelineViewModel {}

export interface InboxFilterViewModel {
  readonly id: InboxFilterId;
  readonly label: string;
  readonly count: number | null;
  readonly hint: string | null;
}

export interface InboxActiveProjectOption {
  readonly id: string;
  readonly name: string;
  readonly alias: string | null;
}

export interface InboxWelcomeProjectWorkloadViewModel {
  readonly projectId: string;
  readonly projectName: string;
  readonly unreadCount: number;
  readonly needsFollowUpCount: number;
}

export interface InboxWelcomeFollowUpEntryViewModel {
  readonly contactId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly avatarTone: InboxAvatarTone;
  readonly projectLabel: string | null;
  readonly latestSubject: string;
  readonly lastActivityLabel: string;
}

export interface InboxWelcomeWorkloadViewModel {
  readonly projects: readonly InboxWelcomeProjectWorkloadViewModel[];
  readonly totals: {
    readonly activeProjects: number;
    readonly unread: number;
    readonly needsFollowUp: number;
  };
  readonly followUpRail: {
    readonly totalCount: number;
    readonly entries: readonly InboxWelcomeFollowUpEntryViewModel[];
  };
}

/**
 * Unified inbox search row. Subsumes both projection-backed contacts (for
 * which `hasProjection === true` and `latestSubject`/`snippet` come from the
 * projection) and contact-only rows (for which `hasProjection === false` and
 * the secondary line shows email/phone instead).
 */
export interface InboxUnifiedSearchRowViewModel {
  readonly contactId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly avatarTone: InboxAvatarTone;
  readonly primaryEmail: string | null;
  readonly primaryPhone: string | null;
  readonly projectLabel: string | null;
  readonly hasProjection: boolean;
  /** Last activity across ALL canonical event types (lifecycle, comm, etc.). */
  readonly lastActivityAt: string | null;
  readonly lastActivityLabel: string;
  /** Latest message subject, when projection-backed. Null otherwise. */
  readonly latestSubject: string | null;
  /** Latest message snippet, when projection-backed. Null otherwise. */
  readonly snippet: string | null;
  /** Channel for the latest message; null when no projection. */
  readonly latestChannel: InboxChannel | null;
  readonly lastEventType: CanonicalEventType | null;
}

/**
 * Two-section unified search response. Both sections capped at 25 in v1.
 * `totals` reports the count BEFORE truncation.
 */
export interface InboxUnifiedSearchViewModel {
  readonly query: string;
  readonly contactMatches: readonly InboxUnifiedSearchRowViewModel[];
  readonly bodyMatches: readonly InboxUnifiedSearchRowViewModel[];
  readonly totals: {
    readonly contactMatches: number;
    readonly bodyMatches: number;
  };
}

export interface InboxListViewModel {
  readonly items: readonly InboxListItemViewModel[];
  readonly filters: readonly InboxFilterViewModel[];
  readonly totals: {
    readonly inbox: number;
    readonly unread: number;
    readonly followUp: number;
    readonly sent: number;
    readonly archived: number;
  };
  readonly activeProjects: readonly InboxActiveProjectOption[];
  readonly selectedProjectId: string | null;
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
