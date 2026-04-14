/**
 * Claude Inbox prototype — UI-facing view models.
 *
 * These types shape the minimum payload the client UI needs. They deliberately
 * mirror the canonical Inbox / Timeline projection concepts from
 * docs/01-core/data-core.md and docs/01-core/interfaces-core.md rather than
 * echoing any provider payload shape.
 *
 * Locked rules reflected here:
 *   - one row per person, not per thread (P-02 / INBX-01)
 *   - primary buckets are "new" and "opened" (INBX-02)
 *   - "starred" is a flag, not a bucket (INBX-03)
 *   - "unresolved" is an overlay on top of the queue model (INBX-04)
 *   - campaign events may appear in the timeline but do not mutate buckets
 */

export type ClaudeInboxBucket = "new" | "opened";

export type ClaudeInboxFilterId =
  | "new"
  | "opened"
  | "starred"
  | "unresolved"
  | "all";

export type ClaudeInboxChannel = "email" | "sms";

export type ClaudeVolunteerStage =
  | "lead"
  | "prospect"
  | "applicant"
  | "active"
  | "alumni"
  | "non-volunteer";

export type ClaudeAvatarTone =
  | "indigo"
  | "emerald"
  | "amber"
  | "rose"
  | "sky"
  | "violet"
  | "teal"
  | "slate";

export interface ClaudeInboxListItemViewModel {
  readonly contactId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly avatarTone: ClaudeAvatarTone;
  readonly latestSubject: string;
  readonly snippet: string;
  readonly latestChannel: ClaudeInboxChannel;
  readonly projectLabel: string | null;
  readonly volunteerStage: ClaudeVolunteerStage;
  readonly bucket: ClaudeInboxBucket;
  readonly isStarred: boolean;
  readonly hasUnresolved: boolean;
  readonly unreadCount: number;
  readonly lastActivityAt: string;
  readonly lastActivityLabel: string;
}

export interface ClaudeProjectMembershipViewModel {
  readonly projectId: string;
  readonly projectName: string;
  readonly role: string;
  readonly status: string;
}

export interface ClaudeContextChipViewModel {
  readonly id: string;
  readonly label: string;
  readonly tone: "neutral" | "info" | "warn" | "success";
}

export interface ClaudeRecentActivityViewModel {
  readonly id: string;
  readonly label: string;
  readonly occurredAtLabel: string;
}

export interface ClaudeContactSummaryViewModel {
  readonly contactId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly avatarTone: ClaudeAvatarTone;
  readonly volunteerStage: ClaudeVolunteerStage;
  readonly primaryEmail: string | null;
  readonly primaryPhone: string | null;
  readonly location: string | null;
  readonly joinedAtLabel: string;
  readonly salesforceLinked: boolean;
  readonly hasUnresolved: boolean;
  readonly projects: readonly ClaudeProjectMembershipViewModel[];
  readonly contextChips: readonly ClaudeContextChipViewModel[];
  readonly recentActivity: readonly ClaudeRecentActivityViewModel[];
}

export type ClaudeTimelineEntryKind =
  | "inbound-email"
  | "outbound-email"
  | "inbound-sms"
  | "outbound-sms"
  | "internal-note"
  | "campaign-event"
  | "system-event";

export interface ClaudeTimelineEntryViewModel {
  readonly id: string;
  readonly kind: ClaudeTimelineEntryKind;
  readonly occurredAt: string;
  readonly occurredAtLabel: string;
  readonly actorLabel: string;
  readonly subject: string | null;
  readonly body: string;
  readonly channel: ClaudeInboxChannel | null;
  readonly isUnread: boolean;
}

export interface ClaudeInboxDetailViewModel {
  readonly contact: ClaudeContactSummaryViewModel;
  readonly timeline: readonly ClaudeTimelineEntryViewModel[];
  readonly bucket: ClaudeInboxBucket;
  readonly isStarred: boolean;
  readonly smsEligible: boolean;
}

export interface ClaudeInboxFilterViewModel {
  readonly id: ClaudeInboxFilterId;
  readonly label: string;
  readonly count: number;
  readonly hint: string | null;
}

export interface ClaudeInboxListViewModel {
  readonly items: readonly ClaudeInboxListItemViewModel[];
  readonly filters: readonly ClaudeInboxFilterViewModel[];
  readonly totals: {
    readonly new: number;
    readonly opened: number;
    readonly starred: number;
    readonly unresolved: number;
    readonly all: number;
  };
}
