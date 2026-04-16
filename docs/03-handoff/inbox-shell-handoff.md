# Inbox Shell — Codex Data Contracts

This document describes the data contracts the inbox frontend shell expects.
The shell is fully implemented with mock data and can be wired to real
projection reads by swapping the two selector functions in
`apps/web/app/inbox/_lib/selectors.ts`.

---

## View Model Interfaces

All types are defined in `apps/web/app/inbox/_lib/view-models.ts`.

### InboxListItemViewModel (one row per person)

```typescript
interface InboxListItemViewModel {
  contactId: string;
  displayName: string;
  initials: string;
  avatarTone: InboxAvatarTone;
  latestSubject: string;
  snippet: string;
  latestChannel: InboxChannel;        // "email" | "sms"
  projectLabel: string | null;
  volunteerStage: InboxVolunteerStage;

  // Row states (all separate, not collapsed)
  bucket: InboxBucket;                // "new" | "opened"
  needsFollowUp: boolean;             // explicit operator flag
  hasUnresolved: boolean;              // review overlay
  unreadCount: number;

  // Sort / display
  lastInboundAt: string;              // ISO 8601 — default sort field
  lastActivityAt: string;             // ISO 8601
  lastActivityLabel: string;          // relative time label
}
```

### InboxDetailViewModel (selected contact workspace)

```typescript
interface InboxDetailViewModel {
  contact: InboxContactSummaryViewModel;
  timeline: readonly InboxTimelineEntryViewModel[];
  bucket: InboxBucket;
  needsFollowUp: boolean;
  smsEligible: boolean;
}
```

### InboxTimelineEntryViewModel

```typescript
interface InboxTimelineEntryViewModel {
  id: string;
  kind: InboxTimelineEntryKind;       // 9 variants (see view-models.ts)
  occurredAt: string;
  occurredAtLabel: string;
  actorLabel: string;
  subject: string | null;
  body: string;
  channel: InboxChannel | null;
  isUnread: boolean;
}
```

### InboxContactSummaryViewModel

```typescript
interface InboxContactSummaryViewModel {
  contactId: string;
  displayName: string;
  volunteerId: string;
  primaryEmail: string | null;
  primaryPhone: string | null;
  cityState: string | null;
  joinedAtLabel: string;
  hasUnresolved: boolean;
  activeProjects: readonly InboxProjectMembershipViewModel[];
  pastProjects: readonly InboxProjectMembershipViewModel[];
  recentActivity: readonly InboxRecentActivityViewModel[];
}
```

---

## Selector Swap Points

Both selectors live in `apps/web/app/inbox/_lib/selectors.ts`. They currently
import from `mock-data.ts`. To wire to real data, replace the mock reads with
projection repository calls. The view-model shapes stay stable.

### getInboxList(filterId?)

```typescript
function getInboxList(filterId?: InboxFilterId): InboxListViewModel
```

- Returns the full contact list sorted by `lastInboundAt` descending
- Computes filter counts: all, unread (bucket = "new"), unresolved
- Follow-up count is 0 server-side (client-owned state for now)
- **Swap target:** Replace `getMockContacts()` with a projection query that
  reads from `contactInboxProjection` and joins to get display fields

### getInboxDetail(contactId)

```typescript
function getInboxDetail(contactId: string): InboxDetailViewModel | null
```

- Returns the full contact detail including timeline, project context, and
  recent activity milestones
- **Swap target:** Replace `getMockContactById()` with projection reads from
  `contactTimelineProjection` + `contacts` + `contactMemberships`

---

## Sort Contract

- Default list order: `lastInboundAt` descending (most recent inbound first)
- Toggling follow-up does NOT change row ordering
- `lastInboundAt` tracks the most recent inbound email or SMS from the contact
- `lastActivityAt` is kept for display but not used for sort

---

## Cache Tag Expectations (FP-05)

| Tag | Invalidation scope |
|-----|--------------------|
| `inbox` | Top-level inbox list shell |
| `inbox:contact:{contactId}` | Row-level contact inbox refresh |
| `timeline:contact:{contactId}` | Per-contact timeline refresh |

Server actions should call `revalidateTag()` for the narrowest affected tags
before returning. Webhook/worker-triggered changes should hit a protected
internal revalidation endpoint that calls `revalidateTag()`.

---

## Server Action Stubs Needed

| Action | Description |
|--------|-------------|
| `sendReply` | Send email or SMS reply to a contact |
| `saveNote` | Save an internal note to the contact timeline |
| `toggleFollowUp` | Set or clear `needsFollowUp` on the inbox projection |
| `markAsRead` | Transition bucket from "new" to "opened" |

All actions should return the safe error envelope:
```typescript
type UiSuccess<T> = { ok: true; data: T; requestId: string };
type UiError = { ok: false; code: string; message: string; requestId: string };
```

---

## Polling / Freshness Contract (FP-06)

- Inbox-like views should poll a lightweight freshness endpoint while visible
- Default interval: 30-60 seconds
- Pause when tab is hidden (use `document.visibilityState`)
- Polling is a resilience fallback, not the primary consistency mechanism
- Primary consistency comes from `revalidateTag` after mutations
