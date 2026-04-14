/**
 * Claude Inbox prototype — server-side selectors.
 *
 * These functions are the only place the mock records touch the view-model
 * contract. The Server Components consume these and pass the narrow view
 * models to client islands. In Phase 2 this module is the natural place to
 * substitute real projection reads — the view-model shapes stay stable.
 */

import { CLAUDE_INBOX_FILTERS } from "./filters.js";
import { getMockContactById, getMockContacts } from "./mock-data.js";
import type {
  ClaudeContactSummaryViewModel,
  ClaudeContextChipViewModel,
  ClaudeInboxDetailViewModel,
  ClaudeInboxFilterId,
  ClaudeInboxFilterViewModel,
  ClaudeInboxListItemViewModel,
  ClaudeInboxListViewModel,
  ClaudeRecentActivityViewModel
} from "./view-models.js";

const LIST_SORT = (
  a: ClaudeInboxListItemViewModel,
  b: ClaudeInboxListItemViewModel
): number => (a.lastActivityAt < b.lastActivityAt ? 1 : -1);

export function getClaudeInboxList(
  filterId: ClaudeInboxFilterId = "new"
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
    new: items.filter((i) => i.bucket === "new").length,
    opened: items.filter((i) => i.bucket === "opened").length,
    starred: items.filter((i) => i.isStarred).length,
    unresolved: items.filter((i) => i.hasUnresolved).length,
    all: items.length
  };

  const filters: ClaudeInboxFilterViewModel[] = CLAUDE_INBOX_FILTERS.map((f) => ({
    id: f.id,
    label: f.label,
    hint: f.hint,
    count: totals[f.id]
  }));

  const filtered = items
    .filter((item) => matchesFilter(item, filterId))
    .sort(LIST_SORT);

  return { items: filtered, filters, totals };
}

function matchesFilter(
  item: ClaudeInboxListItemViewModel,
  filterId: ClaudeInboxFilterId
): boolean {
  switch (filterId) {
    case "new":
      return item.bucket === "new";
    case "opened":
      return item.bucket === "opened";
    case "starred":
      return item.isStarred;
    case "unresolved":
      return item.hasUnresolved;
    case "all":
      return true;
  }
}

export function getClaudeInboxDetail(
  contactId: string
): ClaudeInboxDetailViewModel | null {
  const record = getMockContactById(contactId);
  if (!record) return null;

  const contextChips: ClaudeContextChipViewModel[] = [];
  contextChips.push({
    id: "stage",
    label: stageLabel(record.volunteerStage),
    tone: record.volunteerStage === "active" ? "success" : "info"
  });
  if (record.salesforceLinked) {
    contextChips.push({
      id: "salesforce",
      label: "Salesforce linked",
      tone: "neutral"
    });
  } else {
    contextChips.push({
      id: "salesforce-missing",
      label: "Not in Salesforce",
      tone: "warn"
    });
  }
  if (record.hasUnresolved) {
    contextChips.push({
      id: "unresolved",
      label: "Needs review",
      tone: "warn"
    });
  }

  const recentActivity: ClaudeRecentActivityViewModel[] = record.timeline
    .slice(0, 3)
    .map((entry) => ({
      id: `${entry.id}_recent`,
      label: recentActivityLabel(entry.kind),
      occurredAtLabel: entry.occurredAtLabel
    }));

  const contact: ClaudeContactSummaryViewModel = {
    contactId: record.contactId,
    displayName: record.displayName,
    initials: record.initials,
    avatarTone: record.avatarTone,
    volunteerStage: record.volunteerStage,
    primaryEmail: record.primaryEmail,
    primaryPhone: record.primaryPhone,
    location: record.location,
    joinedAtLabel: record.joinedAtLabel,
    salesforceLinked: record.salesforceLinked,
    hasUnresolved: record.hasUnresolved,
    projects: record.projects,
    contextChips,
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

function stageLabel(stage: ClaudeContactSummaryViewModel["volunteerStage"]): string {
  switch (stage) {
    case "active":
      return "Active volunteer";
    case "alumni":
      return "Alumni";
    case "applicant":
      return "Applicant";
    case "prospect":
      return "Prospect";
    case "lead":
      return "Lead";
    case "non-volunteer":
      return "Non-volunteer";
  }
}

function recentActivityLabel(
  kind: ClaudeInboxDetailViewModel["timeline"][number]["kind"]
): string {
  switch (kind) {
    case "inbound-email":
      return "Inbound email";
    case "outbound-email":
      return "Reply sent";
    case "inbound-sms":
      return "Inbound SMS";
    case "outbound-sms":
      return "SMS sent";
    case "internal-note":
      return "Internal note";
    case "campaign-event":
      return "Campaign touch";
    case "system-event":
      return "System event";
  }
}
