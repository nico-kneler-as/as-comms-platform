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
 *   - campaign and automated sends are surfaced in the timeline as collapsed
 *     entries so 1:1 history stays readable (INBX-05)
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

/**
 * Canonical project participation status, per product brief.
 * `lead` → `applied` → `in-training` → `trip-planning` → `in-field` →
 * `successful`. Statuses are per-(volunteer, project) membership and do not
 * flow through the inbox bucket model.
 */
export type ClaudeProjectStatus =
  | "lead"
  | "applied"
  | "in-training"
  | "trip-planning"
  | "in-field"
  | "successful";

export interface ClaudeProjectMembershipViewModel {
  readonly membershipId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly year: number;
  readonly status: ClaudeProjectStatus;
  readonly crmUrl: string;
}

export interface ClaudeRecentActivityViewModel {
  readonly id: string;
  readonly label: string;
  readonly occurredAtLabel: string;
}

export interface ClaudeContactSummaryViewModel {
  readonly contactId: string;
  readonly displayName: string;
  readonly volunteerId: string;
  readonly primaryEmail: string | null;
  readonly primaryPhone: string | null;
  readonly cityState: string | null;
  readonly joinedAtLabel: string;
  readonly hasUnresolved: boolean;
  readonly activeProjects: readonly ClaudeProjectMembershipViewModel[];
  readonly pastProjects: readonly ClaudeProjectMembershipViewModel[];
  readonly recentActivity: readonly ClaudeRecentActivityViewModel[];
}

/**
 * Timeline entry kinds. 1:1 kinds render as full chat bubbles; campaign and
 * automated kinds render as collapsed single-line entries that expand on
 * click; internal notes and system events are visually distinct.
 */
export type ClaudeTimelineEntryKind =
  | "inbound-email"
  | "outbound-email"
  | "outbound-auto-email"
  | "outbound-campaign-email"
  | "inbound-sms"
  | "outbound-sms"
  | "outbound-campaign-sms"
  | "internal-note"
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
