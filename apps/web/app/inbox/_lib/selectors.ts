/**
 * Inbox — server-side selectors.
 *
 * These functions are the only place the mock records touch the view-model
 * contract. The Server Components consume these and pass the narrow view
 * models to client islands. This module is the natural place to substitute
 * real projection reads — the view-model shapes stay stable.
 */

import { INBOX_FILTERS } from "./filters";
import {
  getMockContactById,
  getMockContacts,
  type MockMilestone
} from "./mock-data";
import type {
  InboxContactSummaryViewModel,
  InboxDetailViewModel,
  InboxFilterId,
  InboxFilterViewModel,
  InboxListItemViewModel,
  InboxListViewModel,
  InboxRecentActivityViewModel
} from "./view-models";

/**
 * Default list sort: last inbound message first.
 * Toggling follow-up does NOT change row ordering.
 */
const LIST_SORT = (
  a: InboxListItemViewModel,
  b: InboxListItemViewModel
): number => (a.lastInboundAt < b.lastInboundAt ? 1 : -1);

export function getInboxList(
  filterId: InboxFilterId = "all"
): InboxListViewModel {
  const contacts = getMockContacts();

  const items: InboxListItemViewModel[] = contacts.map((c) => ({
    contactId: c.contactId,
    displayName: c.displayName,
    initials: c.initials,
    avatarTone: c.avatarTone,
    latestSubject: c.latestSubject,
    snippet: c.snippet,
    latestChannel: c.latestChannel,
    projectLabel: c.projectLabel,
    volunteerStage: c.volunteerStage,
    bucket: c.bucket,
    needsFollowUp: c.needsFollowUp,
    hasUnresolved: c.hasUnresolved,
    unreadCount: c.unreadCount,
    lastInboundAt: c.lastInboundAt,
    lastActivityAt: c.lastActivityAt,
    lastActivityLabel: c.lastActivityLabel
  }));

  const totals = {
    all: items.length,
    unread: items.filter((i) => i.bucket === "new").length,
    unresolved: items.filter((i) => i.hasUnresolved).length
  };

  const filters: InboxFilterViewModel[] = INBOX_FILTERS.map((f) => ({
    id: f.id,
    label: f.label,
    hint: f.hint,
    count:
      f.id === "follow-up"
        ? 0 // follow-up count is client-side; server returns 0
        : f.id === "unresolved"
          ? totals.unresolved
          : totals[f.id]
  }));

  const filtered = items
    .filter((item) => matchesServerFilter(item, filterId))
    .sort(LIST_SORT);

  return { items: filtered, filters, totals };
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
      // Follow-up is client-owned state; server returns everything and the
      // client narrows it. Keeping this branch exhaustive satisfies the
      // discriminated-union check.
      return true;
    case "unresolved":
      return item.hasUnresolved;
  }
}

export function getInboxDetail(
  contactId: string
): InboxDetailViewModel | null {
  const record = getMockContactById(contactId);
  if (!record) return null;

  const recentActivity: InboxRecentActivityViewModel[] = record.milestones
    .slice()
    .sort((a, b) => a.daysAgo - b.daysAgo)
    .slice(0, 5)
    .map((milestone) => ({
      id: milestone.id,
      label: milestoneLabel(milestone),
      occurredAtLabel: relativeLabel(milestone.daysAgo)
    }));

  const contact: InboxContactSummaryViewModel = {
    contactId: record.contactId,
    displayName: record.displayName,
    volunteerId: record.volunteerId,
    primaryEmail: record.primaryEmail,
    primaryPhone: record.primaryPhone,
    cityState: record.cityState,
    joinedAtLabel: record.joinedAtLabel,
    hasUnresolved: record.hasUnresolved,
    activeProjects: record.activeProjects,
    pastProjects: record.pastProjects,
    recentActivity
  };

  return {
    contact,
    timeline: record.timeline,
    bucket: record.bucket,
    needsFollowUp: record.needsFollowUp,
    smsEligible: record.primaryPhone !== null
  };
}

function milestoneLabel(milestone: MockMilestone): string {
  const name = milestone.projectName;
  switch (milestone.kind) {
    case "signed-up":
      return `Signed up to ${name}`;
    case "training-received":
      return `Received training for ${name}`;
    case "training-completed":
      return `Completed training for ${name}`;
    case "trip-plan-submitted":
      return `Submitted trip plan for ${name}`;
    case "first-record-submitted":
      return `Submitted first record for ${name}`;
  }
}

function relativeLabel(daysAgo: number): string {
  if (daysAgo === 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo < 7) return `${daysAgo.toString()} days ago`;
  if (daysAgo < 14) return "last week";
  if (daysAgo < 60) return `${Math.floor(daysAgo / 7).toString()} weeks ago`;
  if (daysAgo < 365) return `${Math.floor(daysAgo / 30).toString()} months ago`;
  return `${Math.floor(daysAgo / 365).toString()} years ago`;
}
