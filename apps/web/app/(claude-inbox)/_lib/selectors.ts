/**
 * Claude Inbox prototype — server-side selectors.
 *
 * These functions are the only place the mock records touch the view-model
 * contract. The Server Components consume these and pass the narrow view
 * models to client islands. In Phase 2 this module is the natural place to
 * substitute real projection reads — the view-model shapes stay stable.
 */

import { CLAUDE_INBOX_FILTERS } from "./filters";
import {
  getMockContactById,
  getMockContacts,
  type MockMilestone
} from "./mock-data";
import type {
  ClaudeContactSummaryViewModel,
  ClaudeInboxDetailViewModel,
  ClaudeInboxFilterId,
  ClaudeInboxFilterViewModel,
  ClaudeInboxListItemViewModel,
  ClaudeInboxListViewModel,
  ClaudeRecentActivityViewModel
} from "./view-models";

const LIST_SORT = (
  a: ClaudeInboxListItemViewModel,
  b: ClaudeInboxListItemViewModel
): number => (a.lastActivityAt < b.lastActivityAt ? 1 : -1);

export function getClaudeInboxList(
  filterId: ClaudeInboxFilterId = "all"
): ClaudeInboxListViewModel {
  const contacts = getMockContacts();

  const items: ClaudeInboxListItemViewModel[] = contacts.map((c) => ({
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
    isStarred: c.isStarred,
    hasUnresolved: c.hasUnresolved,
    unreadCount: c.unreadCount,
    lastActivityAt: c.lastActivityAt,
    lastActivityLabel: c.lastActivityLabel
  }));

  const totals = {
    all: items.length,
    unread: items.filter((i) => i.unreadCount > 0).length
  };

  const filters: ClaudeInboxFilterViewModel[] = CLAUDE_INBOX_FILTERS.map((f) => ({
    id: f.id,
    label: f.label,
    hint: f.hint,
    count: f.id === "follow-up" ? 0 : totals[f.id]
  }));

  const filtered = items
    .filter((item) => matchesServerFilter(item, filterId))
    .sort(LIST_SORT);

  return { items: filtered, filters, totals };
}

function matchesServerFilter(
  item: ClaudeInboxListItemViewModel,
  filterId: ClaudeInboxFilterId
): boolean {
  switch (filterId) {
    case "all":
      return true;
    case "unread":
      return item.unreadCount > 0;
    case "follow-up":
      // Follow-up is client-owned state; server returns everything and the
      // client narrows it. Keeping this branch exhaustive satisfies the
      // discriminated-union check.
      return true;
  }
}

export function getClaudeInboxDetail(
  contactId: string
): ClaudeInboxDetailViewModel | null {
  const record = getMockContactById(contactId);
  if (!record) return null;

  const recentActivity: ClaudeRecentActivityViewModel[] = record.milestones
    .slice()
    .sort((a, b) => a.daysAgo - b.daysAgo)
    .slice(0, 5)
    .map((milestone) => ({
      id: milestone.id,
      label: milestoneLabel(milestone),
      occurredAtLabel: relativeLabel(milestone.daysAgo)
    }));

  const contact: ClaudeContactSummaryViewModel = {
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
    isStarred: record.isStarred,
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
