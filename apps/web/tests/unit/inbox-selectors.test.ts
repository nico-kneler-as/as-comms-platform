import { describe, expect, it } from "vitest";

import {
  compareInboxRecency,
  getInboxList
} from "../../app/inbox/_lib/selectors";
import type { InboxListItemViewModel } from "../../app/inbox/_lib/view-models";

function buildItem(
  overrides: Partial<InboxListItemViewModel>
): InboxListItemViewModel {
  return {
    contactId: overrides.contactId ?? "contact_1",
    displayName: overrides.displayName ?? "Contact One",
    initials: overrides.initials ?? "CO",
    avatarTone: overrides.avatarTone ?? "indigo",
    latestSubject: overrides.latestSubject ?? "Subject",
    snippet: overrides.snippet ?? "Snippet",
    latestChannel: overrides.latestChannel ?? "email",
    projectLabel: overrides.projectLabel ?? null,
    volunteerStage: overrides.volunteerStage ?? "active",
    bucket: overrides.bucket ?? "opened",
    needsFollowUp: overrides.needsFollowUp ?? false,
    hasUnresolved: overrides.hasUnresolved ?? false,
    unreadCount: overrides.unreadCount ?? 0,
    lastInboundAt: overrides.lastInboundAt ?? null,
    lastActivityAt:
      overrides.lastActivityAt ?? "2026-04-14T14:00:00.000Z",
    lastEventType:
      overrides.lastEventType ?? "communication.email.outbound",
    lastActivityLabel: overrides.lastActivityLabel ?? "today"
  };
}

describe("compareInboxRecency", () => {
  it("falls back to lastActivityAt when lastInboundAt is missing", () => {
    const outboundOnly = buildItem({
      contactId: "contact_outbound",
      lastInboundAt: null,
      lastActivityAt: "2026-04-14T15:00:00.000Z"
    });
    const olderInbound = buildItem({
      contactId: "contact_inbound",
      lastInboundAt: "2026-04-14T13:00:00.000Z",
      lastActivityAt: "2026-04-14T13:15:00.000Z"
    });

    expect(compareInboxRecency(outboundOnly, olderInbound)).toBeLessThan(0);
  });
});

describe("getInboxList", () => {
  it("uses bucket=new for unread filtering", async () => {
    const unreadContacts = (await getInboxList("unread")).items.map(
      (item) => item.displayName
    );

    expect(unreadContacts).toEqual([
      "Maya Patel",
      "Daniel Rivers",
      "Priya Chen",
      "Anita Ross",
      "+1 720 555 0199"
    ]);
  });

  it("uses needsFollowUp for follow-up filtering", async () => {
    const followUpContacts = (await getInboxList("follow-up")).items.map(
      (item) => item.displayName
    );

    expect(followUpContacts).toEqual([
      "Maya Patel",
      "Sam Whitehorse",
      "Elena Marquez"
    ]);
  });

  it("uses hasUnresolved for unresolved filtering", async () => {
    const unresolvedContacts = (await getInboxList("unresolved")).items.map(
      (item) => item.displayName
    );

    expect(unresolvedContacts).toEqual([
      "Priya Chen",
      "Anita Ross",
      "+1 720 555 0199"
    ]);
  });
});
