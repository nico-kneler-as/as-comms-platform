import type { InboxDrivingEventType } from "@as-comms/contracts";

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
 *   - "unresolved" is an overlay on top of the queue model (INBX-04)
 *   - campaign and automated sends are surfaced in the timeline as collapsed
 *     entries so 1:1 history stays readable (INBX-05)
 *   - default list order: lastInboundAt desc nulls last, then lastActivityAt desc
 *   - toggling follow-up does NOT change row ordering
 */

export type InboxBucket = "new" | "opened";

export type InboxFilterId = "all" | "unread" | "follow-up" | "unresolved";

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
  readonly initials: string;
  readonly avatarTone: InboxAvatarTone;
  readonly latestSubject: string;
  readonly snippet: string;
  readonly latestChannel: InboxChannel;
  readonly projectLabel: string | null;
  readonly volunteerStage: InboxVolunteerStage;

  // ── Row states (all separate, not collapsed) ──
  readonly bucket: InboxBucket;
  readonly needsFollowUp: boolean;
  readonly hasUnresolved: boolean;
  readonly unreadCount: number;

  // ── Sort / display ──
  readonly lastInboundAt: string | null;
  readonly lastActivityAt: string;
  readonly lastEventType: InboxDrivingEventType;
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
  readonly projectName: string;
  readonly year: number;
  readonly status: InboxProjectStatus;
  readonly crmUrl: string;
}

export interface InboxRecentActivityViewModel {
  readonly id: string;
  readonly label: string;
  readonly occurredAtLabel: string;
}

export interface InboxContactSummaryViewModel {
  readonly contactId: string;
  readonly displayName: string;
  readonly volunteerId: string;
  readonly primaryEmail: string | null;
  readonly primaryPhone: string | null;
  readonly joinedAtLabel: string;
  readonly hasUnresolved: boolean;
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
  | "failed"
  | "orphaned"
  | null;

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
  readonly mailbox: string | null;
  readonly threadId: string | null;
  readonly rfc822MessageId: string | null;
  readonly inReplyToRfc822: string | null;
  readonly sendStatus: InboxTimelineEntrySendStatus;
  readonly attachmentCount: number;
  readonly noteId?: string | null;
  readonly authorId?: string | null;
}

export interface InboxComposerAliasOption {
  readonly id: string;
  readonly alias: string;
  readonly projectId: string;
  readonly projectName: string;
}

export interface InboxComposerReplyContext {
  readonly contactId: string;
  readonly contactDisplayName: string;
  readonly subject: string;
  readonly threadId: string | null;
  readonly inReplyToRfc822: string | null;
  readonly defaultAlias: string | null;
}

export interface InboxDetailViewModel {
  readonly contact: InboxContactSummaryViewModel;
  readonly timeline: readonly InboxTimelineEntryViewModel[];
  readonly bucket: InboxBucket;
  readonly needsFollowUp: boolean;
  readonly smsEligible: boolean;
  readonly composerReplyContext: InboxComposerReplyContext | null;
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

export interface InboxFilterViewModel {
  readonly id: InboxFilterId;
  readonly label: string;
  readonly count: number;
  readonly hint: string | null;
}

export interface InboxActiveProjectOption {
  readonly id: string;
  readonly name: string;
}

export interface InboxListViewModel {
  readonly items: readonly InboxListItemViewModel[];
  readonly filters: readonly InboxFilterViewModel[];
  readonly totals: {
    readonly all: number;
    readonly unread: number;
    readonly followUp: number;
    readonly unresolved: number;
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
