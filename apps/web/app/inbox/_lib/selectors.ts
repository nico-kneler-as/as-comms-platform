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
    lastEventType: c.lastEventType,
    lastActivityLabel: c.lastActivityLabel
  }));

  const totals = {
    all: items.length,
    unread: items.filter((i) => i.bucket === "new").length,
    followUp: items.filter((i) => i.needsFollowUp).length,
    unresolved: items.filter((i) => i.hasUnresolved).length
  };

  const filters: InboxFilterViewModel[] = INBOX_FILTERS.map((f) => ({
    id: f.id,
    label: f.label,
    hint: f.hint,
    count:
      f.id === "unresolved"
        ? totals.unresolved
        : f.id === "follow-up"
          ? totals.followUp
          : totals[f.id]
  }));

  const filtered = items
    .filter((item) => matchesServerFilter(item, filterId))
    .sort(compareInboxRecency);

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
      return item.needsFollowUp;
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
