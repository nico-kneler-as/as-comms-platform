import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ContactMembershipRecord } from "@as-comms/contracts";
import { smsSenders } from "@as-comms/db";

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
  revalidateTag: vi.fn(),
}));

// Stub the session module so importing selectors.ts does not pull in
// next-auth (and therefore `next/server`, which Node ESM cannot resolve
// from inside next-auth's package layout in the test environment).
vi.mock("@/src/server/auth/session", () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
}));

Object.assign(globalThis, { React });

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { readonly children?: ReactNode }) =>
    createElement("button", null, children),
}));

vi.mock("@/components/ui/section-label", () => ({
  SectionLabel: ({ children }: { readonly children?: ReactNode }) =>
    createElement("span", null, children),
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ label }: { readonly label: string }) =>
    createElement("span", null, label),
}));

vi.mock("@/app/_lib/design-tokens", () => ({
  LAYOUT: {
    railWidth: "w-80",
    headerHeight: "h-14",
  },
  PROJECT_STATUS_BADGE: {
    lead: "",
    applied: "",
    "in-training": "",
    "trip-planning": "",
    "in-field": "",
    successful: "",
  },
  TEXT: {
    headingSm: "text-sm",
    label: "text-xs",
  },
  TONE: {
    slate: {
      subtle: "bg-slate-50",
    },
  },
  SPACING: {
    section: "p-4",
  },
}));

import {
  compareInboxOutboundRecency,
  compareInboxRecency,
  formatBubbleTimestamp,
  getInboxDetail,
  getInboxDetailSummary,
  getInboxDetailTimeline,
  getInboxList,
  getInboxTimelinePage,
  getInboxWelcomeWorkload,
  groupInboxTimelineSystemMessages,
  resolvePrimaryMembership,
  sortMembershipsByCreatedAt,
  stripSignature,
} from "../../app/inbox/_lib/selectors";
import { InboxContactRail } from "../../app/inbox/_components/inbox-contact-rail";
import type {
  InboxListItemViewModel,
  InboxTimelineEntryViewModel,
} from "../../app/inbox/_lib/view-models";
import {
  createInboxTestRuntime,
  seedInboxAutoEmailEvent,
  seedInboxAutoSmsEvent,
  seedInboxCampaignEmailEvent,
  seedInboxCampaignSmsEvent,
  seedInboxContact,
  seedInboxEmailEvent,
  seedInboxInternalNoteEvent,
  seedInboxLifecycleEvent,
  seedInboxMessageAttachment,
  seedInboxProjection,
  seedInboxLegacySalesforceOutboundEmailEvent,
  seedInboxSalesforceOutboundEmailEvent,
  seedInboxSmsEvent,
  type InboxTestRuntime,
} from "./inbox-stage1-helpers";
import {
  inboxRecencyExpectedOrder,
  inboxRecencyFixture,
  inboxSentExpectedOrder,
} from "./fixtures/inbox-recency-fixture.js";

function buildItem(
  overrides: Partial<InboxListItemViewModel>,
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
    additionalActiveProjectsCount: overrides.additionalActiveProjectsCount ?? 0,
    volunteerStage: overrides.volunteerStage ?? "active",
    bucket: overrides.bucket ?? "opened",
    needsFollowUp: overrides.needsFollowUp ?? false,
    hasUnresolved: overrides.hasUnresolved ?? false,
    isArchived: overrides.isArchived ?? false,
    isUnread: overrides.isUnread ?? false,
    unreadCount: overrides.unreadCount ?? 0,
    isUnanswered: overrides.isUnanswered ?? false,
    lastInboundAt: overrides.lastInboundAt ?? null,
    lastNonAliasMessageAt:
      overrides.lastNonAliasMessageAt ?? overrides.lastInboundAt ?? null,
    lastOutboundAt: overrides.lastOutboundAt ?? null,
    lastActivityAt: overrides.lastActivityAt ?? "2026-04-14T14:00:00.000Z",
    lastEventType: overrides.lastEventType ?? "communication.email.outbound",
    lastActivityLabel: overrides.lastActivityLabel ?? "today",
  };
}

function buildTimelineEntry(
  overrides: Partial<InboxTimelineEntryViewModel>,
): InboxTimelineEntryViewModel {
  return {
    id: "timeline:entry",
    kind: "inbound-email",
    occurredAt: "2026-04-16T12:00:00.000Z",
    occurredAtLabel: "2h ago",
    actorLabel: "Sarah Martinez",
    subject: "Question",
    body: "Can you send the field packet?",
    channel: "email",
    isUnread: false,
    isPreview: true,
    fromHeader: null,
    toHeader: null,
    ccHeader: null,
    mailbox: null,
    threadId: null,
    rfc822MessageId: null,
    inReplyToRfc822: null,
    sendStatus: null,
    failedReason: null,
    failedDetail: null,
    attachmentCount: 0,
    attachments: [],
    campaignActivity: [],
    ...overrides,
  };
}

describe("formatBubbleTimestamp", () => {
  const timeZone = "UTC";

  it("renders time only for messages from today", () => {
    expect(
      formatBubbleTimestamp(
        "2026-05-01T21:42:00.000Z",
        "2026-05-01T22:15:00.000Z",
        timeZone,
      ),
    ).toBe("9:42 PM");
  });

  it("renders month and day for yesterday", () => {
    expect(
      formatBubbleTimestamp(
        "2026-05-01T18:00:00.000Z",
        "2026-05-02T12:00:00.000Z",
        timeZone,
      ),
    ).toBe("May 1");
  });

  it("renders month and day for five days ago in the current year", () => {
    expect(
      formatBubbleTimestamp(
        "2026-04-26T12:00:00.000Z",
        "2026-05-01T12:00:00.000Z",
        timeZone,
      ),
    ).toBe("Apr 26");
  });

  it("renders month and day for older messages in the current year", () => {
    expect(
      formatBubbleTimestamp(
        "2026-03-01T12:00:00.000Z",
        "2026-05-01T12:00:00.000Z",
        timeZone,
      ),
    ).toBe("Mar 1");
  });

  it("renders month, day, and year for prior-year messages", () => {
    expect(
      formatBubbleTimestamp(
        "2025-11-10T12:00:00.000Z",
        "2026-01-15T12:00:00.000Z",
        timeZone,
      ),
    ).toBe("Nov 10, 2025");
  });
});

function buildMembership(
  overrides: Partial<ContactMembershipRecord> & {
    readonly id: string;
    readonly projectId: string | null;
    readonly createdAt: string;
  },
): ContactMembershipRecord {
  return {
    id: overrides.id,
    contactId: overrides.contactId ?? "contact:test",
    projectId: overrides.projectId,
    expeditionId: overrides.expeditionId ?? null,
    role: overrides.role ?? "volunteer",
    status: overrides.status ?? "active",
    source: overrides.source ?? "salesforce",
    createdAt: overrides.createdAt,
  };
}

async function seedOperatorUser(runtime: InboxTestRuntime): Promise<void> {
  const now = new Date("2026-04-20T10:00:00.000Z");
  await runtime.context.settings.users.upsert({
    id: "user:operator",
    email: "operator@test.local",
    name: "Operator",
    emailVerified: now,
    image: null,
    role: "operator",
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedInboxFixture(runtime: InboxTestRuntime): Promise<void> {
  await seedInboxContact(runtime.context, {
    contactId: "contact:lisa-zhang",
    salesforceContactId: "003-lisa",
    displayName: "Lisa Zhang",
    primaryEmail: "lisa@example.org",
    primaryPhone: null,
    projectId: "project:killer-whales",
    projectName: "Searching for Killer Whales",
    membershipId: "membership:lisa",
    membershipStatus: "successful",
  });
  const lisaLatest = await seedInboxEmailEvent(runtime.context, {
    id: "lisa-outbound-1",
    contactId: "contact:lisa-zhang",
    occurredAt: "2026-04-14T15:00:00.000Z",
    direction: "outbound",
    subject: "Safety protocols",
    snippet: "Sending the final safety protocol packet for review.",
  });
  await seedInboxProjection(runtime.context, {
    contactId: "contact:lisa-zhang",
    bucket: "Opened",
    needsFollowUp: false,
    hasUnresolved: false,
    // PR #329: Inbox default scope requires lastInboundAt IS NOT NULL.
    // Synthesize an inbound timestamp older than alex's (2026-04-12T19:00Z)
    // so the [sarah, alex, lisa] ordering is preserved under inbound-first
    // sort. Outbound stays the latest activity.
    lastInboundAt: "2026-04-10T00:00:00.000Z",
    lastOutboundAt: "2026-04-14T15:00:00.000Z",
    lastActivityAt: "2026-04-14T15:00:00.000Z",
    snippet: "Sending the final safety protocol packet for review.",
    lastCanonicalEventId: lisaLatest.canonicalEventId,
    lastEventType: "communication.email.outbound",
  });

  await seedInboxContact(runtime.context, {
    contactId: "contact:sarah-martinez",
    salesforceContactId: "003-sarah",
    displayName: "Sarah Martinez",
    primaryEmail: "sarah@example.org",
    primaryPhone: "+15550000001",
    projectId: "project:amazon-basin",
    projectName: "Amazon Basin Research",
    membershipId: "membership:sarah",
    salesforceMembershipId: "a0B-sarah-membership",
    membershipStatus: "in_training",
  });
  await seedInboxEmailEvent(runtime.context, {
    id: "sarah-outbound-1",
    contactId: "contact:sarah-martinez",
    occurredAt: "2026-04-13T12:00:00.000Z",
    direction: "outbound",
    subject: "Amazon Basin equipment list",
    snippet: "Sharing the equipment list for the next field session.",
  });
  const sarahLatest = await seedInboxEmailEvent(runtime.context, {
    id: "sarah-inbound-1",
    contactId: "contact:sarah-martinez",
    occurredAt: "2026-04-14T13:00:00.000Z",
    direction: "inbound",
    subject: "Re: Amazon Basin equipment list",
    snippet:
      "Following up on the field study logistics for the Amazon basin project.",
  });
  await seedInboxProjection(runtime.context, {
    contactId: "contact:sarah-martinez",
    bucket: "New",
    needsFollowUp: true,
    hasUnresolved: false,
    lastInboundAt: "2026-04-14T13:00:00.000Z",
    lastOutboundAt: "2026-04-13T12:00:00.000Z",
    lastActivityAt: "2026-04-14T13:00:00.000Z",
    snippet:
      "Following up on the field study logistics for the Amazon basin project.",
    lastCanonicalEventId: sarahLatest.canonicalEventId,
    lastEventType: "communication.email.inbound",
  });

  await seedInboxContact(runtime.context, {
    contactId: "contact:alex-thompson",
    salesforceContactId: "003-alex",
    displayName: "Alex Thompson",
    primaryEmail: null,
    primaryPhone: "+15550000002",
    projectId: "project:whitebark-pine",
    projectName: "Tracking Whitebark Pine",
    membershipId: "membership:alex",
    membershipStatus: "trip_planning",
  });
  await seedInboxSmsEvent(runtime.context, {
    id: "alex-outbound-1",
    contactId: "contact:alex-thompson",
    occurredAt: "2026-04-12T18:00:00.000Z",
    direction: "outbound",
    summary: "We can shift the mountain research dates if weather stays rough.",
  });
  const alexLatest = await seedInboxSmsEvent(runtime.context, {
    id: "alex-inbound-1",
    contactId: "contact:alex-thompson",
    occurredAt: "2026-04-12T19:00:00.000Z",
    direction: "inbound",
    summary: "Had to postpone due to weather. Proposing new dates.",
  });
  await seedInboxProjection(runtime.context, {
    contactId: "contact:alex-thompson",
    bucket: "Opened",
    needsFollowUp: false,
    hasUnresolved: true,
    lastInboundAt: "2026-04-12T19:00:00.000Z",
    lastOutboundAt: "2026-04-12T18:00:00.000Z",
    lastActivityAt: "2026-04-12T19:00:00.000Z",
    snippet: "Had to postpone due to weather. Proposing new dates.",
    lastCanonicalEventId: alexLatest.canonicalEventId,
    lastEventType: "communication.sms.inbound",
  });
}

async function seedInboxEmailOnlyContact(
  runtime: InboxTestRuntime,
  input: {
    readonly contactId: string;
    readonly displayName: string;
    readonly salesforceContactId: string | null;
    readonly subject: string;
    readonly snippet: string;
    readonly occurredAt: string;
  },
): Promise<void> {
  await seedInboxContact(runtime.context, {
    contactId: input.contactId,
    salesforceContactId: input.salesforceContactId,
    displayName: input.displayName,
    primaryEmail: `${input.contactId}@example.org`,
    primaryPhone: null,
  });

  const latest = await seedInboxEmailEvent(runtime.context, {
    id: `${input.contactId}-email-1`,
    contactId: input.contactId,
    occurredAt: input.occurredAt,
    direction: "inbound",
    subject: input.subject,
    snippet: input.snippet,
  });

  await seedInboxProjection(runtime.context, {
    contactId: input.contactId,
    bucket: "New",
    needsFollowUp: false,
    hasUnresolved: false,
    lastInboundAt: input.occurredAt,
    lastOutboundAt: null,
    lastActivityAt: input.occurredAt,
    snippet: input.snippet,
    lastCanonicalEventId: latest.canonicalEventId,
    lastEventType: "communication.email.inbound",
  });
}

async function seedSharedInboxRecencyFixture(
  runtime: InboxTestRuntime,
): Promise<void> {
  for (const row of inboxRecencyFixture) {
    await seedInboxContact(runtime.context, {
      contactId: row.contactId,
      salesforceContactId: row.contactId.replace("contact:", "003-"),
      displayName: row.displayName,
      primaryEmail: `${row.contactId}@example.org`,
      primaryPhone: null,
    });

    if (row.lastInboundAt !== null) {
      await seedInboxEmailEvent(runtime.context, {
        id: `${row.contactId}-inbound`,
        contactId: row.contactId,
        occurredAt: row.lastInboundAt,
        direction: "inbound",
        subject: `${row.displayName} inbound`,
        snippet: `${row.displayName} inbound message`,
      });
    }

    if (row.lastOutboundAt !== null) {
      await seedInboxEmailEvent(runtime.context, {
        id: `${row.contactId}-outbound`,
        contactId: row.contactId,
        occurredAt: row.lastOutboundAt,
        direction: "outbound",
        subject: `${row.displayName} outbound`,
        snippet: `${row.displayName} outbound message`,
      });
    }

    await seedInboxProjection(runtime.context, {
      contactId: row.contactId,
      bucket: row.lastInboundAt === null ? "Opened" : "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: row.lastInboundAt,
      lastOutboundAt: row.lastOutboundAt,
      lastActivityAt: row.lastActivityAt,
      snippet: `${row.displayName} preview`,
      lastCanonicalEventId:
        row.lastActivityAt === row.lastInboundAt
          ? `event:${row.contactId}-inbound`
          : `event:${row.contactId}-outbound`,
      lastEventType:
        row.lastActivityAt === row.lastInboundAt
          ? "communication.email.inbound"
          : "communication.email.outbound",
    });
  }
}

describe("compareInboxRecency", () => {
  it("matches the shared inbound-first ordering fixture", () => {
    const orderedContactIds = inboxRecencyFixture
      .map((row) =>
        buildItem({
          contactId: row.contactId,
          displayName: row.displayName,
          lastInboundAt: row.lastInboundAt,
          lastActivityAt: row.lastActivityAt,
          lastEventType:
            row.lastActivityAt === row.lastInboundAt
              ? "communication.email.inbound"
              : "communication.email.outbound",
        }),
      )
      .sort(compareInboxRecency)
      .map((item) => item.contactId);

    expect(orderedContactIds).toEqual(inboxRecencyExpectedOrder);
  });

  it("orders sent mode by last outbound activity", () => {
    const orderedContactIds = inboxRecencyFixture
      .map((row) =>
        buildItem({
          contactId: row.contactId,
          displayName: row.displayName,
          lastInboundAt: row.lastInboundAt,
          lastOutboundAt: row.lastOutboundAt,
          lastActivityAt: row.lastActivityAt,
          lastEventType:
            row.lastActivityAt === row.lastInboundAt
              ? "communication.email.inbound"
              : "communication.email.outbound",
        }),
      )
      .filter((item) => item.lastOutboundAt !== null)
      .sort(compareInboxOutboundRecency)
      .map((item) => item.contactId);

    expect(orderedContactIds).toEqual(inboxSentExpectedOrder);
  });
});

describe("groupInboxTimelineSystemMessages", () => {
  it("leaves non-system timelines unchanged", () => {
    const inbound = buildTimelineEntry({ id: "timeline:inbound-1" });
    const note = buildTimelineEntry({
      id: "timeline:note-1",
      kind: "internal-note",
      channel: null,
    });

    expect(groupInboxTimelineSystemMessages([inbound, note])).toEqual([
      inbound,
      note,
    ]);
  });

  it("collapses three consecutive automated entries into one group", () => {
    const grouped = groupInboxTimelineSystemMessages([
      buildTimelineEntry({
        id: "timeline:auto-1",
        kind: "outbound-auto-email",
      }),
      buildTimelineEntry({
        id: "timeline:auto-2",
        kind: "outbound-auto-email",
      }),
      buildTimelineEntry({
        id: "timeline:auto-3",
        kind: "outbound-auto-sms",
        channel: "sms",
      }),
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      kind: "system-message-group",
      automatedCount: 3,
      campaignCount: 0,
    });
  });

  it("collapses mixed consecutive automated and campaign entries with separate counts", () => {
    const grouped = groupInboxTimelineSystemMessages([
      buildTimelineEntry({
        id: "timeline:auto-1",
        kind: "outbound-auto-email",
      }),
      buildTimelineEntry({
        id: "timeline:auto-2",
        kind: "outbound-auto-email",
      }),
      buildTimelineEntry({
        id: "timeline:campaign-1",
        kind: "outbound-campaign-email",
      }),
    ]);

    expect(grouped[0]).toMatchObject({
      kind: "system-message-group",
      automatedCount: 2,
      campaignCount: 1,
    });
  });

  it("does not group non-consecutive automated entries across a 1:1 entry", () => {
    const autoOne = buildTimelineEntry({
      id: "timeline:auto-1",
      kind: "outbound-auto-email",
    });
    const inbound = buildTimelineEntry({ id: "timeline:inbound-1" });
    const autoTwo = buildTimelineEntry({
      id: "timeline:auto-2",
      kind: "outbound-auto-email",
    });

    expect(
      groupInboxTimelineSystemMessages([autoOne, inbound, autoTwo]),
    ).toEqual([autoOne, inbound, autoTwo]);
  });

  it("renders a single automated entry inline instead of wrapping it in a group", () => {
    const auto = buildTimelineEntry({
      id: "timeline:auto-1",
      kind: "outbound-auto-email",
    });

    expect(groupInboxTimelineSystemMessages([auto])).toEqual([auto]);
  });

  it("preserves child ordering and content inside grouped entries", () => {
    const autoOne = buildTimelineEntry({
      id: "timeline:auto-1",
      kind: "outbound-auto-email",
      body: "First automation body",
    });
    const campaign = buildTimelineEntry({
      id: "timeline:campaign-1",
      kind: "outbound-campaign-email",
      body: "Campaign body",
    });
    const autoTwo = buildTimelineEntry({
      id: "timeline:auto-2",
      kind: "outbound-auto-sms",
      channel: "sms",
      body: "Second automation body",
    });

    const grouped = groupInboxTimelineSystemMessages([
      autoOne,
      campaign,
      autoTwo,
    ]);

    expect(grouped[0]?.kind).toBe("system-message-group");

    if (grouped[0]?.kind !== "system-message-group") {
      throw new Error("Expected a grouped system message");
    }

    expect(grouped[0].entries.map((entry) => entry.id)).toEqual([
      "timeline:auto-1",
      "timeline:campaign-1",
      "timeline:auto-2",
    ]);
    expect(grouped[0].entries.map((entry) => entry.body)).toEqual([
      "First automation body",
      "Campaign body",
      "Second automation body",
    ]);
  });
});

describe("sortMembershipsByCreatedAt", () => {
  it("sorts memberships by createdAt descending", () => {
    const memberships = [
      buildMembership({
        id: "membership:1",
        projectId: "project:illegal-timber",
        createdAt: "2026-04-04T23:52:53.343Z",
      }),
      buildMembership({
        id: "membership:2",
        projectId: "project:passive-acoustic",
        createdAt: "2026-04-04T23:52:53.368Z",
      }),
      buildMembership({
        id: "membership:3",
        projectId: "project:whitebark-pine",
        createdAt: "2026-04-04T23:52:53.349Z",
      }),
    ];

    expect(
      sortMembershipsByCreatedAt(memberships).map(
        (membership) => membership.id,
      ),
    ).toEqual(["membership:2", "membership:3", "membership:1"]);
  });
});

describe("resolvePrimaryMembership", () => {
  const memberships = [
    buildMembership({
      id: "membership:older",
      projectId: "project:illegal-timber",
      createdAt: "2026-04-01T10:00:00.000Z",
      status: "lead",
    }),
    buildMembership({
      id: "membership:newest",
      projectId: "project:passive-acoustic",
      createdAt: "2026-04-03T10:00:00.000Z",
      status: "active",
    }),
  ];

  it("returns the membership whose project matches the last-inbound alias", () => {
    const primaryMembership = resolvePrimaryMembership({
      memberships,
      lastInboundAlias: "pnwbio@adventurescientists.org",
      aliasToProjectId: new Map([
        ["pnwbio@adventurescientists.org", "project:passive-acoustic"],
      ]),
    });

    expect(primaryMembership?.id).toBe("membership:newest");
  });

  it("falls back to newest-by-createdAt when alias maps to a different project", () => {
    const primaryMembership = resolvePrimaryMembership({
      memberships,
      lastInboundAlias: "whitebark@adventurescientists.org",
      aliasToProjectId: new Map([
        ["whitebark@adventurescientists.org", "project:whitebark-pine"],
      ]),
    });

    expect(primaryMembership?.id).toBe("membership:newest");
  });

  it("falls back to newest-by-createdAt when no inbound alias exists", () => {
    const primaryMembership = resolvePrimaryMembership({
      memberships,
      lastInboundAlias: null,
      aliasToProjectId: new Map(),
    });

    expect(primaryMembership?.id).toBe("membership:newest");
  });

  it("returns null when memberships is empty", () => {
    expect(
      resolvePrimaryMembership({
        memberships: [],
        lastInboundAlias: "pnwbio@adventurescientists.org",
        aliasToProjectId: new Map([
          ["pnwbio@adventurescientists.org", "project:passive-acoustic"],
        ]),
      }),
    ).toBeNull();
  });
});

describe("real inbox selectors", () => {
  let runtime: InboxTestRuntime | null = null;

  beforeEach(async () => {
    runtime = await createInboxTestRuntime();
    await seedInboxFixture(runtime);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await runtime?.dispose();
    runtime = null;
  });

  it("reads one row per contact from real projections with inbound-first sorting and activity fallback", async () => {
    const list = await getInboxList();

    expect(list.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
      "contact:alex-thompson",
      "contact:lisa-zhang",
    ]);
    expect(list.items[0]).toMatchObject({
      contactId: "contact:sarah-martinez",
      latestSubject: "Re: Amazon Basin equipment list",
      needsFollowUp: true,
      bucket: "new",
    });
    expect(list.items[2]).toMatchObject({
      contactId: "contact:lisa-zhang",
      latestSubject: "Safety protocols",
      bucket: "opened",
    });
  });

  it("keeps one-to-one SMS visible in the timeline regardless of SMS compose availability", async () => {
    const originalSmsEnabled = process.env.SMS_ENABLED;
    process.env.SMS_ENABLED = "false";

    try {
      const detail = await getInboxDetail("contact:alex-thompson");

      expect(detail?.timeline).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "outbound-sms",
            actorLabel: "Adventure Scientists",
            body: "We can shift the mountain research dates if weather stays rough.",
            channel: "sms",
          }),
          expect.objectContaining({
            kind: "inbound-sms",
            actorLabel: "Alex Thompson",
            body: "Had to postpone due to weather. Proposing new dates.",
            channel: "sms",
          }),
        ]),
      );
    } finally {
      if (originalSmsEnabled === undefined) {
        delete process.env.SMS_ENABLED;
      } else {
        process.env.SMS_ENABLED = originalSmsEnabled;
      }
    }
  });

  it("renders historical SimpleTexting SMS from canonical timeline details even without sms_messages rows", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    const originalSmsEnabled = process.env.SMS_ENABLED;
    process.env.SMS_ENABLED = "false";

    try {
      await seedInboxContact(runtime.context, {
        contactId: "contact:keyla-chavarria",
        salesforceContactId: "003-keyla",
        displayName: "Keyla Chavarria",
        primaryEmail: null,
        primaryPhone: "+15550000007",
      });

      const sourceEvidenceId = "source:keyla-simpletexting-1";
      const canonicalEventId = "event:keyla-simpletexting-1";
      const occurredAt = "2026-04-06T16:33:00.000Z";
      const body =
        "Hi Keyla. We had an issue with this number and only now recovered it.";

      await runtime.context.repositories.sourceEvidence.append({
        id: sourceEvidenceId,
        provider: "simpletexting",
        providerRecordType: "message",
        providerRecordId: "export:keyla-simpletexting-1",
        receivedAt: occurredAt,
        occurredAt,
        payloadRef: "payloads/simpletexting/keyla-simpletexting-1.json",
        idempotencyKey: "simpletexting:keyla-simpletexting-1",
        checksum: "checksum:keyla-simpletexting-1",
      });
      await runtime.context.repositories.canonicalEvents.upsert({
        id: canonicalEventId,
        contactId: "contact:keyla-chavarria",
        eventType: "communication.sms.outbound",
        channel: "sms",
        occurredAt,
        sourceEvidenceId,
        idempotencyKey: "canonical:keyla-simpletexting-1",
        contentFingerprint: null,
        provenance: {
          primaryProvider: "simpletexting",
          primarySourceEvidenceId: sourceEvidenceId,
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "message",
          sourceRecordId: "export:keyla-simpletexting-1",
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey: "sms-thread:keyla",
            providerThreadId: "st-thread:keyla",
          },
          direction: "outbound",
          notes: null,
        },
        reviewState: "clear",
      });
      await runtime.context.repositories.simpleTextingMessageDetails.upsert({
        sourceEvidenceId,
        providerRecordId: "export:keyla-simpletexting-1",
        direction: "outbound",
        messageKind: "one_to_one",
        messageTextPreview: body,
        normalizedPhone: "+15550000007",
        campaignId: null,
        campaignName: null,
        providerThreadId: "st-thread:keyla",
        threadKey: "sms-thread:keyla",
      });
      await runtime.context.repositories.timelineProjection.upsert({
        id: "timeline:keyla-simpletexting-1",
        contactId: "contact:keyla-chavarria",
        canonicalEventId,
        occurredAt,
        sortKey: `${occurredAt}::${canonicalEventId}`,
        eventType: "communication.sms.outbound",
        summary: body,
        channel: "sms",
        primaryProvider: "simpletexting",
        reviewState: "clear",
      });
      await seedInboxProjection(runtime.context, {
        contactId: "contact:keyla-chavarria",
        bucket: "Opened",
        needsFollowUp: false,
        hasUnresolved: false,
        lastInboundAt: null,
        lastOutboundAt: occurredAt,
        lastActivityAt: occurredAt,
        snippet: body,
        lastCanonicalEventId: canonicalEventId,
        lastEventType: "communication.sms.outbound",
      });

      const detail = await getInboxDetailTimeline("contact:keyla-chavarria");

      expect(detail?.timeline).toEqual([
        expect.objectContaining({
          kind: "outbound-sms",
          actorLabel: "Adventure Scientists",
          body,
          channel: "sms",
        }),
      ]);
    } finally {
      if (originalSmsEnabled === undefined) {
        delete process.env.SMS_ENABLED;
      } else {
        process.env.SMS_ENABLED = originalSmsEnabled;
      }
    }
  });

  it("renders future Twilio SMS from sms_messages rows even when SMS compose is disabled", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    const originalSmsEnabled = process.env.SMS_ENABLED;
    process.env.SMS_ENABLED = "false";

    try {
      await seedInboxContact(runtime.context, {
        contactId: "contact:twilio-sms-thread",
        salesforceContactId: null,
        displayName: "Twilio Volunteer",
        primaryEmail: null,
        primaryPhone: "+15550000008",
      });
      await runtime.context.db.insert(smsSenders).values({
        id: "sender:twilio-ui",
        phoneE164: "+15550000001",
        displayName: "Adventure Scientists SMS",
        monthlyCap: null,
        isActive: true,
        createdAt: new Date("2026-05-03T12:00:00.000Z"),
        updatedAt: new Date("2026-05-03T12:00:00.000Z"),
      });
      await runtime.context.repositories.sourceEvidence.append({
        id: "source:twilio-inbound-visible",
        provider: "twilio",
        providerRecordType: "message",
        providerRecordId: "SMinboundvisible",
        receivedAt: "2026-05-03T12:01:00.000Z",
        occurredAt: "2026-05-03T12:01:00.000Z",
        payloadRef: "twilio:webhooks/inbound:SMinboundvisible",
        idempotencyKey: "twilio:message:SMinboundvisible",
        checksum: "checksum:twilio-inbound-visible",
      });
      await runtime.context.repositories.canonicalEvents.upsert({
        id: "event:twilio-inbound-visible",
        contactId: "contact:twilio-sms-thread",
        eventType: "communication.sms.inbound",
        channel: "sms",
        occurredAt: "2026-05-03T12:01:00.000Z",
        sourceEvidenceId: "source:twilio-inbound-visible",
        idempotencyKey:
          "twilio:message:SMinboundvisible:communication.sms.inbound",
        contentFingerprint: null,
        provenance: {
          primaryProvider: "twilio",
          primarySourceEvidenceId: "source:twilio-inbound-visible",
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "message",
          sourceRecordId: "SMinboundvisible",
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey: "+15550000008",
            providerThreadId: "+15550000008",
          },
          direction: "inbound",
          notes: null,
        },
        reviewState: "clear",
      });
      await runtime.context.repositories.sourceEvidence.append({
        id: "source:twilio-outbound-visible",
        provider: "twilio",
        providerRecordType: "message",
        providerRecordId: "SMoutboundvisible",
        receivedAt: "2026-05-03T12:03:00.000Z",
        occurredAt: "2026-05-03T12:03:00.000Z",
        payloadRef: "twilio:messages:SMoutboundvisible",
        idempotencyKey: "twilio:message:SMoutboundvisible",
        checksum: "checksum:twilio-outbound-visible",
      });
      await runtime.context.repositories.canonicalEvents.upsert({
        id: "event:twilio-outbound-visible",
        contactId: "contact:twilio-sms-thread",
        eventType: "communication.sms.outbound",
        channel: "sms",
        occurredAt: "2026-05-03T12:03:00.000Z",
        sourceEvidenceId: "source:twilio-outbound-visible",
        idempotencyKey:
          "twilio:message:SMoutboundvisible:communication.sms.outbound",
        contentFingerprint: null,
        provenance: {
          primaryProvider: "twilio",
          primarySourceEvidenceId: "source:twilio-outbound-visible",
          supportingSourceEvidenceIds: [],
          winnerReason: "single_source",
          sourceRecordType: "message",
          sourceRecordId: "SMoutboundvisible",
          messageKind: "one_to_one",
          campaignRef: null,
          threadRef: {
            crossProviderCollapseKey: "+15550000008",
            providerThreadId: "+15550000008",
          },
          direction: "outbound",
          notes: null,
        },
        reviewState: "clear",
      });
      await runtime.context.repositories.smsMessages.insert({
        id: "sms-message:twilio-inbound",
        twilioMessageSid: "SMinboundvisible",
        direction: "inbound",
        contactId: "contact:twilio-sms-thread",
        phoneE164: "+15550000008",
        senderId: "sender:twilio-ui",
        body: "Can you text me the pickup instructions?",
        segments: 1,
        encoding: "GSM-7",
        mediaUrls: null,
        sendStatus: "received",
        failedReason: null,
        failedDetail: null,
        sentAt: null,
        receivedAt: new Date("2026-05-03T12:01:00.000Z"),
        actorId: null,
        createdAt: new Date("2026-05-03T12:01:00.000Z"),
        updatedAt: new Date("2026-05-03T12:01:00.000Z"),
      });
      await runtime.context.repositories.smsMessages.insert({
        id: "sms-message:twilio-outbound",
        twilioMessageSid: "SMoutboundvisible",
        direction: "outbound",
        contactId: "contact:twilio-sms-thread",
        phoneE164: "+15550000008",
        senderId: "sender:twilio-ui",
        body: "Absolutely, I will send those pickup details now.",
        segments: 1,
        encoding: "GSM-7",
        mediaUrls: null,
        sendStatus: "delivered",
        failedReason: null,
        failedDetail: null,
        sentAt: new Date("2026-05-03T12:03:00.000Z"),
        receivedAt: null,
        actorId: null,
        createdAt: new Date("2026-05-03T12:03:00.000Z"),
        updatedAt: new Date("2026-05-03T12:03:00.000Z"),
      });
      await seedInboxProjection(runtime.context, {
        contactId: "contact:twilio-sms-thread",
        bucket: "Opened",
        needsFollowUp: false,
        hasUnresolved: false,
        lastInboundAt: "2026-05-03T12:01:00.000Z",
        lastOutboundAt: "2026-05-03T12:03:00.000Z",
        lastActivityAt: "2026-05-03T12:03:00.000Z",
        snippet: "Absolutely, I will send those pickup details now.",
        lastCanonicalEventId: "event:twilio-outbound-visible",
        lastEventType: "communication.sms.outbound",
      });

      const detail = await getInboxDetailTimeline("contact:twilio-sms-thread");

      expect(detail?.timeline).toEqual([
        expect.objectContaining({
          kind: "inbound-sms",
          actorLabel: "Twilio Volunteer",
          body: "Can you text me the pickup instructions?",
          channel: "sms",
        }),
        expect.objectContaining({
          kind: "outbound-sms",
          actorLabel: "Adventure Scientists",
          body: "Absolutely, I will send those pickup details now.",
          channel: "sms",
          sendStatus: "confirmed",
        }),
      ]);
    } finally {
      if (originalSmsEnabled === undefined) {
        delete process.env.SMS_ENABLED;
      } else {
        process.env.SMS_ENABLED = originalSmsEnabled;
      }
    }
  });

  it("renders third-party Gmail outbound body and sender identity instead of a generic event label", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:darrel-robertson",
      salesforceContactId: null,
      displayName: "Darrel Robertson",
      primaryEmail: "darrel@example.org",
      primaryPhone: null,
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "darrel-scotty-gmail-1",
      contactId: "contact:darrel-robertson",
      occurredAt: "2026-04-16T16:00:00.000Z",
      direction: "outbound",
      subject: "Adventure Scientists follow-up",
      snippet: "Hi Darrel, looping back with the details we discussed.",
      bodyTextPreview: "Hi Darrel, looping back with the details we discussed.",
      fromHeader: "Scotty Stalp <scotty@adventurescientists.org>",
      toHeader: "Darrel Robertson <darrel@example.org>",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:darrel-robertson",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-04-16T16:00:00.000Z",
      lastActivityAt: "2026-04-16T16:00:00.000Z",
      snippet: "Outbound email sent",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const detail = await getInboxDetail("contact:darrel-robertson");
    const entry = detail?.timeline.at(-1);

    expect(entry).toMatchObject({
      kind: "outbound-email",
      actorLabel: "Scotty Stalp",
      subject: "Adventure Scientists follow-up",
      body: "Hi Darrel, looping back with the details we discussed.",
      fromHeader: "Scotty Stalp <scotty@adventurescientists.org>",
      toHeader: "Darrel Robertson <darrel@example.org>",
    });
  });

  it("prefers a known teammate identity over a project alias in outbound email headers", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:darrel-robertson",
      salesforceContactId: null,
      displayName: "Darrel Robertson",
      primaryEmail: "darrel@example.org",
      primaryPhone: null,
      projectId: "project:pnw-bio",
      projectName: "PNW Biodiversity",
      projectAlias: "PNW Biodiversity",
      membershipId: "membership:darrel:pnw-bio",
      membershipStatus: "active",
      membershipCreatedAt: "2026-04-01T10:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:scotty-stalp",
      salesforceContactId: null,
      displayName: "Scotty Stalp",
      primaryEmail: "or-rural-coordinator@adventurescientists.org",
      primaryPhone: null,
    });
    await runtime.context.repositories.contactIdentities.upsert({
      id: "identity:scotty-or-rural",
      contactId: "contact:scotty-stalp",
      kind: "email",
      normalizedValue: "or-rural-coordinator@adventurescientists.org",
      isPrimary: true,
      source: "gmail",
      verifiedAt: null,
    });
    await runtime.context.settings.aliases.create({
      id: "alias:or-rural-coordinator",
      alias: "or-rural-coordinator@adventurescientists.org",
      signature: "",
      projectId: "project:pnw-bio",
      createdAt: new Date("2026-05-03T12:00:00.000Z"),
      updatedAt: new Date("2026-05-03T12:00:00.000Z"),
      createdBy: null,
      updatedBy: null,
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "darrel-scotty-alias-gmail-1",
      contactId: "contact:darrel-robertson",
      occurredAt: "2026-05-03T16:00:00.000Z",
      direction: "outbound",
      subject: "Re: Shipping ARUs",
      snippet: "Hey Darrel, I shipped 8 ARUs via FedEx today.",
      bodyTextPreview: "Hey Darrel, I shipped 8 ARUs via FedEx today.",
      fromHeader:
        "PNW Biodiversity <or-rural-coordinator@adventurescientists.org>",
      toHeader: "Darrel Robertson <darrel@example.org>",
      ccHeader: "Adventure Scientists <pnwbio@adventurescientists.org>",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:darrel-robertson",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-05-03T16:00:00.000Z",
      lastActivityAt: "2026-05-03T16:00:00.000Z",
      snippet: "Hey Darrel, I shipped 8 ARUs via FedEx today.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const detail = await getInboxDetail("contact:darrel-robertson");
    const entry = detail?.timeline.at(-1);

    expect(entry).toMatchObject({
      kind: "outbound-email",
      actorLabel: "Scotty Stalp",
      headerProjectLabel: "PNW Biodiversity",
      body: "Hey Darrel, I shipped 8 ARUs via FedEx today.",
      participantRows: [
        {
          label: "From",
          name: "Scotty Stalp",
          email: "or-rural-coordinator@adventurescientists.org",
        },
        {
          label: "To",
          name: "Darrel Robertson",
          email: "darrel@example.org",
        },
        {
          label: "Cc",
          name: "Adventure Scientists <pnwbio@adventurescientists.org>",
          email: null,
        },
      ],
    });
  });

  it("batches list-side canonical event and audit reads per page load", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    const canonicalBatchSpy = vi.spyOn(
      runtime.context.repositories.canonicalEvents,
      "listByContactIds",
    );
    const canonicalSingleSpy = vi.spyOn(
      runtime.context.repositories.canonicalEvents,
      "listByContactId",
    );
    const auditBatchSpy = vi.spyOn(
      runtime.context.repositories.auditEvidence,
      "listByEntities",
    );
    const auditSingleSpy = vi.spyOn(
      runtime.context.repositories.auditEvidence,
      "listByEntity",
    );

    const list = await getInboxList();

    expect(list.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
      "contact:alex-thompson",
      "contact:lisa-zhang",
    ]);
    expect(canonicalBatchSpy).toHaveBeenCalledTimes(1);
    expect(new Set(canonicalBatchSpy.mock.calls[0]?.[0] ?? [])).toEqual(
      new Set([
        "contact:sarah-martinez",
        "contact:alex-thompson",
        "contact:lisa-zhang",
      ]),
    );
    expect(canonicalSingleSpy).not.toHaveBeenCalled();
    expect(auditBatchSpy).toHaveBeenCalledTimes(1);
    expect(auditBatchSpy.mock.calls[0]?.[0]).toMatchObject({
      entityType: "contact",
    });
    expect(new Set(auditBatchSpy.mock.calls[0]?.[0].entityIds ?? [])).toEqual(
      new Set([
        "contact:sarah-martinez",
        "contact:alex-thompson",
        "contact:lisa-zhang",
      ]),
    );
    expect(auditSingleSpy).not.toHaveBeenCalled();
  });

  it("uses Inbox as the default scope and excludes outbound-only plus archived contacts", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:outbound-only",
      salesforceContactId: null,
      displayName: "Outbound Only",
      primaryEmail: "outbound-only@example.org",
      primaryPhone: null,
    });
    const outboundOnlyLatest = await seedInboxEmailEvent(runtime.context, {
      id: "outbound-only-email-1",
      contactId: "contact:outbound-only",
      occurredAt: "2026-04-21T10:00:00.000Z",
      direction: "outbound",
      subject: "Outbound-only touchpoint",
      snippet: "This contact has only outbound mail so far.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:outbound-only",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-04-21T10:00:00.000Z",
      lastActivityAt: "2026-04-21T10:00:00.000Z",
      snippet: "This contact has only outbound mail so far.",
      lastCanonicalEventId: outboundOnlyLatest.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    await seedInboxContact(runtime.context, {
      contactId: "contact:archived-inbox",
      salesforceContactId: "003-archived-inbox",
      displayName: "Archived Inbox",
      primaryEmail: "archived-inbox@example.org",
      primaryPhone: null,
    });
    const archivedLatest = await seedInboxEmailEvent(runtime.context, {
      id: "archived-inbox-email-1",
      contactId: "contact:archived-inbox",
      occurredAt: "2026-04-22T10:00:00.000Z",
      direction: "inbound",
      subject: "Archived contact",
      snippet: "I wrote in, but this row is archived.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:archived-inbox",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-22T10:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-22T10:00:00.000Z",
      snippet: "I wrote in, but this row is archived.",
      archivedAt: "2026-04-23T10:00:00.000Z",
      lastCanonicalEventId: archivedLatest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const list = await getInboxList("inbox");

    expect(list.items.map((item) => item.contactId)).not.toContain(
      "contact:outbound-only",
    );
    expect(list.items.map((item) => item.contactId)).not.toContain(
      "contact:archived-inbox",
    );
  });

  it("dedupes archived rows by contactId when loading the archived filter", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:archived-dedupe",
      salesforceContactId: "003-archived-dedupe",
      displayName: "Archived Dedupe",
      primaryEmail: "archived-dedupe@example.org",
      primaryPhone: null,
    });
    const archivedLatest = await seedInboxEmailEvent(runtime.context, {
      id: "archived-dedupe-email-1",
      contactId: "contact:archived-dedupe",
      occurredAt: "2026-04-24T10:00:00.000Z",
      direction: "inbound",
      subject: "Archived dedupe check",
      snippet: "This archived row should only render once.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:archived-dedupe",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-24T10:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-24T10:00:00.000Z",
      snippet: "This archived row should only render once.",
      archivedAt: "2026-04-24T11:00:00.000Z",
      lastCanonicalEventId: archivedLatest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const list = await getInboxList("archived");

    expect(
      list.items.filter((item) => item.contactId === "contact:archived-dedupe"),
    ).toHaveLength(1);
  });

  it("emits count chips only for unread and pending", async () => {
    const list = await getInboxList("inbox");
    const filtersById = new Map(
      list.filters.map((filter) => [filter.id, filter]),
    );

    expect(filtersById.get("inbox")).toMatchObject({
      label: "Inbox",
      count: null,
    });
    expect(filtersById.get("unread")).toMatchObject({
      label: "Unread",
      count: 1,
    });
    expect(filtersById.get("follow-up")).toMatchObject({
      label: "Pending",
      count: 1,
    });
    expect(filtersById.get("archived")).toMatchObject({
      label: "Archived",
      count: null,
    });
    expect(filtersById.get("sent")).toMatchObject({
      label: "Sent",
      count: null,
    });
  });

  it("prefers the short project alias for inbox row tags", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:amazon-basin",
      projectName: "Amazon Basin Research",
      projectAlias: "Amazon Basin",
      source: "salesforce",
      isActive: true,
    });

    const list = await getInboxList();

    expect(
      list.items.find((item) => item.contactId === "contact:sarah-martinez")
        ?.projectLabel,
    ).toBe("Amazon Basin");
  });

  it("uses the last inbound alias project for inbox row tags before rank sorting", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:steve-herman",
      salesforceContactId: "003-steve",
      displayName: "Steve Herman",
      primaryEmail: "steve@example.org",
      primaryPhone: null,
      projectId: "project:illegal-timber",
      projectName: "Illegal Timber Tracking",
      projectAlias: "Illegal Timber",
      membershipId: "membership:steve:illegal-timber",
      membershipStatus: "lead",
      membershipCreatedAt: "2026-04-01T10:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:steve-herman",
      salesforceContactId: "003-steve",
      displayName: "Steve Herman",
      primaryEmail: "steve@example.org",
      primaryPhone: null,
      projectId: "project:passive-acoustic",
      projectName: "Passive Acoustic Monitoring of Pacific Northwest Forests",
      projectAlias: "Passive Acoustic",
      membershipId: "membership:steve:passive-acoustic",
      membershipStatus: "active",
      membershipCreatedAt: "2026-04-03T10:00:00.000Z",
    });
    await runtime.context.settings.aliases.create({
      id: "alias:pnwbio",
      alias: "pnwbio@adventurescientists.org",
      signature: "",
      projectId: "project:passive-acoustic",
      createdAt: new Date("2026-04-20T12:00:00.000Z"),
      updatedAt: new Date("2026-04-20T12:00:00.000Z"),
      createdBy: null,
      updatedBy: null,
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "steve-inbound-1",
      contactId: "contact:steve-herman",
      occurredAt: "2026-04-20T12:30:00.000Z",
      direction: "inbound",
      subject: "Re: Field logistics",
      snippet: "Replying from the PNW project alias.",
      projectInboxAlias: "pnwbio@adventurescientists.org",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:steve-herman",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-20T12:30:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-20T12:30:00.000Z",
      snippet: "Replying from the PNW project alias.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const list = await getInboxList();

    expect(
      list.items.find((item) => item.contactId === "contact:steve-herman")
        ?.projectLabel,
    ).toBe("Passive Acoustic");
  });

  it("counts only other active memberships for the inbox row +N indicator", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:matt-bromley",
      salesforceContactId: "003-matt",
      displayName: "Matt Bromley",
      primaryEmail: "matt@example.org",
      primaryPhone: null,
      projectId: "project:pnw-bio",
      projectName: "PNW Biodiversity",
      projectAlias: "PNW Biodiversity",
      membershipId: "membership:matt:pnw",
      membershipStatus: "lead",
      membershipCreatedAt: "2026-04-01T10:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:matt-bromley",
      salesforceContactId: "003-matt",
      displayName: "Matt Bromley",
      primaryEmail: "matt@example.org",
      primaryPhone: null,
      projectId: "project:whitebark-pine",
      projectName: "Tracking Whitebark Pine",
      projectAlias: "Whitebark Pine",
      membershipId: "membership:matt:whitebark",
      membershipStatus: "in_training",
      membershipCreatedAt: "2026-04-02T10:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:matt-bromley",
      salesforceContactId: "003-matt",
      displayName: "Matt Bromley",
      primaryEmail: "matt@example.org",
      primaryPhone: null,
      projectId: "project:wild-scenic-rivers",
      projectName: "Wild and Scenic Rivers",
      projectAlias: "Wild and Scenic Rivers",
      membershipId: "membership:matt:wsr",
      membershipStatus: "successful",
      membershipCreatedAt: "2026-04-03T10:00:00.000Z",
    });
    await runtime.context.settings.aliases.create({
      id: "alias:matt:whitebark",
      alias: "whitebark@adventurescientists.org",
      signature: "",
      projectId: "project:whitebark-pine",
      createdAt: new Date("2026-04-20T12:00:00.000Z"),
      updatedAt: new Date("2026-04-20T12:00:00.000Z"),
      createdBy: null,
      updatedBy: null,
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "matt-inbound-1",
      contactId: "contact:matt-bromley",
      occurredAt: "2026-04-20T13:00:00.000Z",
      direction: "inbound",
      subject: "Re: Whitebark logistics",
      snippet: "Checking the latest whitebark plan.",
      projectInboxAlias: "whitebark@adventurescientists.org",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:matt-bromley",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-20T13:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-20T13:00:00.000Z",
      snippet: "Checking the latest whitebark plan.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const matt = (await getInboxList()).items.find(
      (item) => item.contactId === "contact:matt-bromley",
    );

    expect(matt).toMatchObject({
      projectLabel: "Whitebark Pine",
      additionalActiveProjectsCount: 2,
    });
  });

  it("ignores inactive memberships when computing additional row project counts and filters", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:ryan-davis",
      salesforceContactId: "003-ryan",
      displayName: "Ryan Davis",
      primaryEmail: "ryan@example.org",
      primaryPhone: null,
      projectId: "project:pnw-bio",
      projectName: "PNW Biodiversity",
      projectAlias: "PNW Biodiversity",
      membershipId: "membership:ryan:pnw",
      membershipStatus: "applied",
      membershipCreatedAt: "2026-04-03T10:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:ryan-davis",
      salesforceContactId: "003-ryan",
      displayName: "Ryan Davis",
      primaryEmail: "ryan@example.org",
      primaryPhone: null,
      projectId: "project:whitebark-pine",
      projectName: "Tracking Whitebark Pine",
      projectAlias: "Whitebark Pine",
      membershipId: "membership:ryan:whitebark",
      membershipStatus: "successful",
      membershipCreatedAt: "2026-04-02T10:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:ryan-davis",
      salesforceContactId: "003-ryan",
      displayName: "Ryan Davis",
      primaryEmail: "ryan@example.org",
      primaryPhone: null,
      projectId: "project:wild-scenic-rivers",
      projectName: "Wild and Scenic Rivers",
      projectAlias: "Wild and Scenic Rivers",
      membershipId: "membership:ryan:wsr",
      membershipStatus: "in_training",
      membershipCreatedAt: "2026-04-01T10:00:00.000Z",
    });
    await runtime.context.settings.projects.setActive(
      "project:whitebark-pine",
      false,
    );
    await runtime.context.settings.projects.setActive(
      "project:wild-scenic-rivers",
      false,
    );
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "ryan-inbound-1",
      contactId: "contact:ryan-davis",
      occurredAt: "2026-04-20T14:00:00.000Z",
      direction: "inbound",
      subject: "Re: PNW timing",
      snippet: "Only the active project should count here.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:ryan-davis",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-20T14:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-20T14:00:00.000Z",
      snippet: "Only the active project should count here.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const list = await getInboxList();
    const activeProjectFilter = await getInboxList("inbox", {
      projectId: "project:pnw-bio",
    });
    const inactiveProjectFilter = await getInboxList("inbox", {
      projectId: "project:whitebark-pine",
    });
    const ryan = list.items.find(
      (item) => item.contactId === "contact:ryan-davis",
    );

    expect(ryan).toMatchObject({
      projectLabel: "PNW Biodiversity",
      additionalActiveProjectsCount: 0,
    });
    expect(
      activeProjectFilter.items.some(
        (item) => item.contactId === "contact:ryan-davis",
      ),
    ).toBe(true);
    expect(
      inactiveProjectFilter.items.some(
        (item) => item.contactId === "contact:ryan-davis",
      ),
    ).toBe(false);
  });

  it("counts one additional active project when a volunteer has two active memberships", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:steve-two-projects",
      salesforceContactId: "003-steve-two",
      displayName: "Steve Two Projects",
      primaryEmail: "steve.two@example.org",
      primaryPhone: null,
      projectId: "project:pnw-bio",
      projectName: "PNW Biodiversity",
      projectAlias: "PNW Biodiversity",
      membershipId: "membership:steve-two:pnw",
      membershipStatus: "lead",
      membershipCreatedAt: "2026-04-01T10:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:steve-two-projects",
      salesforceContactId: "003-steve-two",
      displayName: "Steve Two Projects",
      primaryEmail: "steve.two@example.org",
      primaryPhone: null,
      projectId: "project:whitebark-pine",
      projectName: "Tracking Whitebark Pine",
      projectAlias: "Whitebark Pine",
      membershipId: "membership:steve-two:whitebark",
      membershipStatus: "trip_planning",
      membershipCreatedAt: "2026-04-02T10:00:00.000Z",
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "steve-two-inbound-1",
      contactId: "contact:steve-two-projects",
      occurredAt: "2026-04-20T15:00:00.000Z",
      direction: "inbound",
      subject: "Re: Whitebark route",
      snippet: "Two active projects should yield +1.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:steve-two-projects",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-20T15:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-20T15:00:00.000Z",
      snippet: "Two active projects should yield +1.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const steve = (await getInboxList()).items.find(
      (item) => item.contactId === "contact:steve-two-projects",
    );

    expect(steve).toMatchObject({
      projectLabel: "Whitebark Pine",
      additionalActiveProjectsCount: 1,
    });
  });

  it("matches project filters against any active membership while keeping the primary chip unchanged", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:matt-filter",
      salesforceContactId: "003-matt-filter",
      displayName: "Matt Bromley",
      primaryEmail: "matt.filter@example.org",
      primaryPhone: null,
      projectId: "project:pnw-bio",
      projectName: "PNW Biodiversity",
      projectAlias: "PNW Biodiversity",
      membershipId: "membership:matt-filter:pnw",
      membershipStatus: "lead",
      membershipCreatedAt: "2026-04-01T10:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:matt-filter",
      salesforceContactId: "003-matt-filter",
      displayName: "Matt Bromley",
      primaryEmail: "matt.filter@example.org",
      primaryPhone: null,
      projectId: "project:whitebark-pine",
      projectName: "Tracking Whitebark Pine",
      projectAlias: "Whitebark Pine",
      membershipId: "membership:matt-filter:whitebark",
      membershipStatus: "in_training",
      membershipCreatedAt: "2026-04-02T10:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:matt-filter",
      salesforceContactId: "003-matt-filter",
      displayName: "Matt Bromley",
      primaryEmail: "matt.filter@example.org",
      primaryPhone: null,
      projectId: "project:wild-scenic-rivers",
      projectName: "Wild and Scenic Rivers",
      projectAlias: "Wild and Scenic Rivers",
      membershipId: "membership:matt-filter:wsr",
      membershipStatus: "successful",
      membershipCreatedAt: "2026-04-03T10:00:00.000Z",
    });
    await runtime.context.settings.aliases.create({
      id: "alias:matt-filter:whitebark",
      alias: "whitebark-filter@adventurescientists.org",
      signature: "",
      projectId: "project:whitebark-pine",
      createdAt: new Date("2026-04-20T12:00:00.000Z"),
      updatedAt: new Date("2026-04-20T12:00:00.000Z"),
      createdBy: null,
      updatedBy: null,
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "matt-filter-inbound-1",
      contactId: "contact:matt-filter",
      occurredAt: "2026-04-20T16:00:00.000Z",
      direction: "inbound",
      subject: "Re: Whitebark logistics",
      snippet: "Project filters should match any active membership.",
      projectInboxAlias: "whitebark-filter@adventurescientists.org",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:matt-filter",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-20T16:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-20T16:00:00.000Z",
      snippet: "Project filters should match any active membership.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const pnwFilter = await getInboxList("inbox", {
      projectId: "project:pnw-bio",
    });
    const whitebarkFilter = await getInboxList("inbox", {
      projectId: "project:whitebark-pine",
    });
    const mattInPnw = pnwFilter.items.find(
      (item) => item.contactId === "contact:matt-filter",
    );
    const mattInWhitebark = whitebarkFilter.items.find(
      (item) => item.contactId === "contact:matt-filter",
    );

    expect(mattInPnw).toMatchObject({
      projectLabel: "Whitebark Pine",
      additionalActiveProjectsCount: 2,
    });
    expect(mattInWhitebark).toMatchObject({
      projectLabel: "Whitebark Pine",
      additionalActiveProjectsCount: 2,
    });
  });

  it("uses bucket, needsFollowUp, and hasUnresolved for the secondary filters", async () => {
    const unread = await getInboxList("unread");
    const followUp = await getInboxList("follow-up");
    expect(unread.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
    ]);
    expect(followUp.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
    ]);
  });

  it("treats non-alias teammate replies as inbox attention while preserving alias replies as handled", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:pnw-bio",
      projectName: "Passive Acoustic Monitoring of Pacific Northwest Forests",
      projectAlias: "PNW Bio",
      source: "salesforce",
      isActive: true,
    });
    await runtime.context.settings.aliases.create({
      id: "alias:pnw-primary",
      alias: "pnwbio@adventurescientists.org",
      signature: "",
      projectId: "project:pnw-bio",
      createdAt: new Date("2026-04-20T08:00:00.000Z"),
      updatedAt: new Date("2026-04-20T08:00:00.000Z"),
      createdBy: null,
      updatedBy: null,
    });
    await runtime.context.settings.aliases.create({
      id: "alias:pnw-secondary",
      alias: "field-coordinator@adventurescientists.org",
      signature: "",
      projectId: "project:pnw-bio",
      createdAt: new Date("2026-04-20T08:01:00.000Z"),
      updatedAt: new Date("2026-04-20T08:01:00.000Z"),
      createdBy: null,
      updatedBy: null,
    });

    await seedInboxContact(runtime.context, {
      contactId: "contact:primary-alias",
      salesforceContactId: "003-primary",
      displayName: "Primary Alias Reply",
      primaryEmail: "primary@example.org",
      primaryPhone: null,
      projectId: "project:pnw-bio",
      projectName: "Passive Acoustic Monitoring of Pacific Northwest Forests",
      projectAlias: "PNW Bio",
      membershipId: "membership:primary-alias",
      membershipStatus: "active",
    });
    const primaryOutbound = await seedInboxEmailEvent(runtime.context, {
      id: "primary-alias-outbound-1",
      contactId: "contact:primary-alias",
      occurredAt: "2026-04-26T11:00:00.000Z",
      direction: "outbound",
      subject: "Re: PNW logistics",
      snippet: "Replying from the primary project alias.",
      fromHeader: "PNW Bio <pnwbio@adventurescientists.org>",
      projectInboxAlias: "pnwbio@adventurescientists.org",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:primary-alias",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-25T09:00:00.000Z",
      lastOutboundAt: "2026-04-26T11:00:00.000Z",
      lastActivityAt: "2026-04-26T11:00:00.000Z",
      snippet: "Replying from the primary project alias.",
      lastCanonicalEventId: primaryOutbound.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    await seedInboxContact(runtime.context, {
      contactId: "contact:cross-dept",
      salesforceContactId: "003-cross",
      displayName: "Cross Dept Reply",
      primaryEmail: "cross@example.org",
      primaryPhone: null,
      projectId: "project:pnw-bio",
      projectName: "Passive Acoustic Monitoring of Pacific Northwest Forests",
      projectAlias: "PNW Bio",
      membershipId: "membership:cross-dept",
      membershipStatus: "active",
    });
    const crossDeptOutbound = await seedInboxEmailEvent(runtime.context, {
      id: "cross-dept-outbound-1",
      contactId: "contact:cross-dept",
      occurredAt: "2026-04-27T12:00:00.000Z",
      direction: "outbound",
      subject: "Re: PNW logistics",
      snippet: "Jumping in from my org Gmail with field coordination details.",
      fromHeader: "Pat Jones <pj@adventurescientists.org>",
      projectInboxAlias: "pnwbio@adventurescientists.org",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:cross-dept",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-25T10:00:00.000Z",
      lastOutboundAt: "2026-04-27T12:00:00.000Z",
      lastActivityAt: "2026-04-27T12:00:00.000Z",
      snippet: "Jumping in from my org Gmail with field coordination details.",
      lastCanonicalEventId: crossDeptOutbound.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    await seedInboxContact(runtime.context, {
      contactId: "contact:secondary-alias",
      salesforceContactId: "003-secondary",
      displayName: "Secondary Alias Reply",
      primaryEmail: "secondary@example.org",
      primaryPhone: null,
      projectId: "project:pnw-bio",
      projectName: "Passive Acoustic Monitoring of Pacific Northwest Forests",
      projectAlias: "PNW Bio",
      membershipId: "membership:secondary-alias",
      membershipStatus: "active",
    });
    const secondaryOutbound = await seedInboxEmailEvent(runtime.context, {
      id: "secondary-alias-outbound-1",
      contactId: "contact:secondary-alias",
      occurredAt: "2026-04-26T13:00:00.000Z",
      direction: "outbound",
      subject: "Re: PNW logistics",
      snippet: "Replying from the secondary project alias.",
      fromHeader:
        "Field Coordinator <field-coordinator@adventurescientists.org>",
      projectInboxAlias: "field-coordinator@adventurescientists.org",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:secondary-alias",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-25T11:00:00.000Z",
      lastOutboundAt: "2026-04-26T13:00:00.000Z",
      lastActivityAt: "2026-04-26T13:00:00.000Z",
      snippet: "Replying from the secondary project alias.",
      lastCanonicalEventId: secondaryOutbound.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const list = await getInboxList();
    const unread = await getInboxList("unread");
    const primaryAlias = list.items.find(
      (item) => item.contactId === "contact:primary-alias",
    );
    const crossDept = list.items.find(
      (item) => item.contactId === "contact:cross-dept",
    );
    const secondaryAlias = list.items.find(
      (item) => item.contactId === "contact:secondary-alias",
    );
    const volunteerInbound = list.items.find(
      (item) => item.contactId === "contact:sarah-martinez",
    );
    const crossDeptDetail = await getInboxDetail("contact:cross-dept");

    expect(list.items[0]?.contactId).toBe("contact:cross-dept");
    expect(volunteerInbound?.isUnread).toBe(true);
    expect(primaryAlias?.isUnread).toBe(false);
    expect(crossDept?.isUnread).toBe(true);
    expect(secondaryAlias?.isUnread).toBe(false);
    expect(unread.items.map((item) => item.contactId)).toEqual([
      "contact:cross-dept",
      "contact:sarah-martinez",
    ]);
    expect(crossDeptDetail?.isUnread).toBe(true);
    expect(crossDeptDetail?.bucket).toBe("opened");
  });

  it("builds welcome workload counts from active project projections only", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:amazon-basin",
      projectName: "Amazon Basin Research",
      projectAlias: "Amazon Basin",
      source: "salesforce",
      isActive: true,
    });
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:whitebark-pine",
      projectName: "Tracking Whitebark Pine",
      projectAlias: "Whitebark Pine",
      source: "salesforce",
      isActive: true,
    });
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:river-cleanup",
      projectName: "River Cleanup",
      projectAlias: "River Cleanup",
      source: "salesforce",
      isActive: true,
    });
    // killer-whales was seeded by the fixture with isActive=true (default).
    // Use the Settings projects repo to flip it — upsert no longer toggles
    // isActive on conflict-update (PR #141 protects admin-managed state).
    await runtime.context.settings.projects.setActive(
      "project:killer-whales",
      false,
    );

    const workload = await getInboxWelcomeWorkload();

    expect(workload.projects).toEqual([
      {
        projectId: "project:amazon-basin",
        projectName: "Amazon Basin",
        unreadCount: 1,
        needsFollowUpCount: 1,
      },
      {
        projectId: "project:river-cleanup",
        projectName: "River Cleanup",
        unreadCount: 0,
        needsFollowUpCount: 0,
      },
      {
        projectId: "project:whitebark-pine",
        projectName: "Whitebark Pine",
        unreadCount: 0,
        needsFollowUpCount: 0,
      },
    ]);
    expect(
      workload.projects.some(
        (project) => project.projectId === "project:killer-whales",
      ),
    ).toBe(false);
    expect(workload.totals).toEqual({
      activeProjects: 3,
      unread: 1,
      needsFollowUp: 1,
    });
  });

  it("keeps per-project welcome counts while deduplicating top-level totals across active projects", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:amazon-basin",
      projectName: "Amazon Basin Research",
      projectAlias: "Amazon Basin",
      source: "salesforce",
      isActive: true,
    });
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:whitebark-pine",
      projectName: "Tracking Whitebark Pine",
      projectAlias: "Whitebark Pine",
      source: "salesforce",
      isActive: true,
    });
    // killer-whales is seeded by the fixture with isActive=true (default) but
    // this test only wants the two projects above as "active". Use setActive()
    // since upsert no longer toggles isActive on conflict-update (PR #141).
    await runtime.context.settings.projects.setActive(
      "project:killer-whales",
      false,
    );
    await runtime.context.repositories.contactMemberships.upsert({
      id: "membership:sarah:whitebark",
      contactId: "contact:sarah-martinez",
      projectId: "project:whitebark-pine",
      expeditionId: null,
      salesforceMembershipId: "membership:sarah:whitebark:sf",
      role: "volunteer",
      status: "trip_planning",
      source: "salesforce",
      createdAt: "2026-04-14T12:00:00.000Z",
    });

    const workload = await getInboxWelcomeWorkload();

    expect(workload.projects).toEqual([
      {
        projectId: "project:amazon-basin",
        projectName: "Amazon Basin",
        unreadCount: 1,
        needsFollowUpCount: 1,
      },
      {
        projectId: "project:whitebark-pine",
        projectName: "Whitebark Pine",
        unreadCount: 1,
        needsFollowUpCount: 1,
      },
    ]);
    expect(workload.totals).toEqual({
      activeProjects: 2,
      unread: 1,
      needsFollowUp: 1,
    });
  });

  it("returns an empty follow-up rail when no active workload row needs follow-up", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxProjection(runtime.context, {
      contactId: "contact:sarah-martinez",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-14T13:00:00.000Z",
      lastOutboundAt: "2026-04-13T12:00:00.000Z",
      lastActivityAt: "2026-04-14T13:00:00.000Z",
      snippet:
        "Following up on the field study logistics for the Amazon basin project.",
      lastCanonicalEventId: "event:sarah-inbound-1",
      lastEventType: "communication.email.inbound",
    });

    const workload = await getInboxWelcomeWorkload();

    expect(workload.followUpRail).toEqual({
      totalCount: 0,
      entries: [],
    });
  });

  it("excludes follow-up rows whose memberships only touch inactive projects", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.settings.projects.setActive(
      "project:killer-whales",
      false,
    );
    await seedInboxProjection(runtime.context, {
      contactId: "contact:sarah-martinez",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-14T13:00:00.000Z",
      lastOutboundAt: "2026-04-13T12:00:00.000Z",
      lastActivityAt: "2026-04-14T13:00:00.000Z",
      snippet:
        "Following up on the field study logistics for the Amazon basin project.",
      lastCanonicalEventId: "event:sarah-inbound-1",
      lastEventType: "communication.email.inbound",
    });

    await seedInboxContact(runtime.context, {
      contactId: "contact:hidden-follow-up",
      salesforceContactId: "003-hidden-follow-up",
      displayName: "Hidden Follow Up",
      primaryEmail: "hidden-follow-up@example.org",
      primaryPhone: null,
      projectId: "project:killer-whales",
      projectName: "Searching for Killer Whales",
      membershipId: "membership:hidden-follow-up",
      membershipStatus: "active",
      membershipCreatedAt: "2026-04-10T10:00:00.000Z",
    });
    const hiddenLatest = await seedInboxEmailEvent(runtime.context, {
      id: "hidden-follow-up-1",
      contactId: "contact:hidden-follow-up",
      occurredAt: "2026-04-10T10:00:00.000Z",
      direction: "inbound",
      subject: "Killer whales check-in",
      snippet: "Checking in from the inactive project.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:hidden-follow-up",
      bucket: "New",
      needsFollowUp: true,
      hasUnresolved: false,
      lastInboundAt: "2026-04-10T10:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-10T10:00:00.000Z",
      snippet: "Checking in from the inactive project.",
      lastCanonicalEventId: hiddenLatest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const workload = await getInboxWelcomeWorkload();

    expect(workload.followUpRail.totalCount).toBe(0);
    expect(workload.followUpRail.entries).toEqual([]);
  });

  it("caps the follow-up rail inline list at three rows while preserving the full count", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxProjection(runtime.context, {
      contactId: "contact:sarah-martinez",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-14T13:00:00.000Z",
      lastOutboundAt: "2026-04-13T12:00:00.000Z",
      lastActivityAt: "2026-04-14T13:00:00.000Z",
      snippet:
        "Following up on the field study logistics for the Amazon basin project.",
      lastCanonicalEventId: "event:sarah-inbound-1",
      lastEventType: "communication.email.inbound",
    });

    const contacts = [
      {
        contactId: "contact:follow-up-a",
        displayName: "Follow Up A",
        occurredAt: "2026-04-09T09:00:00.000Z",
      },
      {
        contactId: "contact:follow-up-b",
        displayName: "Follow Up B",
        occurredAt: "2026-04-10T09:00:00.000Z",
      },
      {
        contactId: "contact:follow-up-c",
        displayName: "Follow Up C",
        occurredAt: "2026-04-11T09:00:00.000Z",
      },
      {
        contactId: "contact:follow-up-d",
        displayName: "Follow Up D",
        occurredAt: "2026-04-12T09:00:00.000Z",
      },
      {
        contactId: "contact:follow-up-e",
        displayName: "Follow Up E",
        occurredAt: "2026-04-13T09:00:00.000Z",
      },
    ] as const;

    for (const contact of contacts) {
      await seedInboxContact(runtime.context, {
        contactId: contact.contactId,
        salesforceContactId: contact.contactId.replace("contact:", "003-"),
        displayName: contact.displayName,
        primaryEmail: `${contact.contactId}@example.org`,
        primaryPhone: null,
        projectId: "project:amazon-basin",
        projectName: "Amazon Basin Research",
        membershipId: `membership:${contact.contactId}`,
        membershipStatus: "active",
        membershipCreatedAt: contact.occurredAt,
      });
      const latest = await seedInboxEmailEvent(runtime.context, {
        id: `${contact.contactId}-follow-up`,
        contactId: contact.contactId,
        occurredAt: contact.occurredAt,
        direction: "inbound",
        subject: `${contact.displayName} subject`,
        snippet: `${contact.displayName} snippet`,
      });
      await seedInboxProjection(runtime.context, {
        contactId: contact.contactId,
        bucket: "New",
        needsFollowUp: true,
        hasUnresolved: false,
        lastInboundAt: contact.occurredAt,
        lastOutboundAt: null,
        lastActivityAt: contact.occurredAt,
        snippet: `${contact.displayName} snippet`,
        lastCanonicalEventId: latest.canonicalEventId,
        lastEventType: "communication.email.inbound",
      });
    }

    const workload = await getInboxWelcomeWorkload();

    expect(workload.followUpRail.totalCount).toBe(5);
    expect(workload.followUpRail.entries).toHaveLength(3);
    expect(
      workload.followUpRail.entries.map((entry) => entry.contactId),
    ).toEqual([
      "contact:follow-up-a",
      "contact:follow-up-b",
      "contact:follow-up-c",
    ]);
  });

  it("orders follow-up rail rows by oldest lastActivityAt first with contactId tiebreaks", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxProjection(runtime.context, {
      contactId: "contact:sarah-martinez",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-14T13:00:00.000Z",
      lastOutboundAt: "2026-04-13T12:00:00.000Z",
      lastActivityAt: "2026-04-14T13:00:00.000Z",
      snippet:
        "Following up on the field study logistics for the Amazon basin project.",
      lastCanonicalEventId: "event:sarah-inbound-1",
      lastEventType: "communication.email.inbound",
    });

    const contacts = [
      {
        contactId: "contact:zeta",
        displayName: "Zeta Contact",
        occurredAt: "2026-04-10T09:00:00.000Z",
      },
      {
        contactId: "contact:alpha",
        displayName: "Alpha Contact",
        occurredAt: "2026-04-10T09:00:00.000Z",
      },
      {
        contactId: "contact:middle",
        displayName: "Middle Contact",
        occurredAt: "2026-04-11T09:00:00.000Z",
      },
    ] as const;

    for (const contact of contacts) {
      await seedInboxContact(runtime.context, {
        contactId: contact.contactId,
        salesforceContactId: contact.contactId.replace("contact:", "003-"),
        displayName: contact.displayName,
        primaryEmail: `${contact.contactId}@example.org`,
        primaryPhone: null,
        projectId: "project:amazon-basin",
        projectName: "Amazon Basin Research",
        membershipId: `membership:${contact.contactId}`,
        membershipStatus: "active",
        membershipCreatedAt: contact.occurredAt,
      });
      const latest = await seedInboxEmailEvent(runtime.context, {
        id: `${contact.contactId}-order`,
        contactId: contact.contactId,
        occurredAt: contact.occurredAt,
        direction: "inbound",
        subject: `${contact.displayName} subject`,
        snippet: `${contact.displayName} snippet`,
      });
      await seedInboxProjection(runtime.context, {
        contactId: contact.contactId,
        bucket: "New",
        needsFollowUp: true,
        hasUnresolved: false,
        lastInboundAt: contact.occurredAt,
        lastOutboundAt: null,
        lastActivityAt: contact.occurredAt,
        snippet: `${contact.displayName} snippet`,
        lastCanonicalEventId: latest.canonicalEventId,
        lastEventType: "communication.email.inbound",
      });
    }

    const workload = await getInboxWelcomeWorkload();

    expect(
      workload.followUpRail.entries.map((entry) => entry.contactId),
    ).toEqual(["contact:alpha", "contact:zeta", "contact:middle"]);
  });

  it("uses one active project label per row based on the newest active membership", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxProjection(runtime.context, {
      contactId: "contact:sarah-martinez",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-14T13:00:00.000Z",
      lastOutboundAt: "2026-04-13T12:00:00.000Z",
      lastActivityAt: "2026-04-14T13:00:00.000Z",
      snippet:
        "Following up on the field study logistics for the Amazon basin project.",
      lastCanonicalEventId: "event:sarah-inbound-1",
      lastEventType: "communication.email.inbound",
    });
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:whitebark-pine",
      projectName: "Tracking Whitebark Pine",
      projectAlias: "Whitebark Pine",
      source: "salesforce",
      isActive: true,
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:multi-membership",
      salesforceContactId: "003-multi-membership",
      displayName: "Multi Membership",
      primaryEmail: "multi-membership@example.org",
      primaryPhone: null,
      projectId: "project:amazon-basin",
      projectName: "Amazon Basin Research",
      membershipId: "membership:multi-membership:amazon",
      membershipStatus: "lead",
      membershipCreatedAt: "2026-04-08T09:00:00.000Z",
    });
    await runtime.context.repositories.contactMemberships.upsert({
      id: "membership:multi-membership:whitebark",
      contactId: "contact:multi-membership",
      projectId: "project:whitebark-pine",
      expeditionId: null,
      salesforceMembershipId: "membership:multi-membership:whitebark:sf",
      role: "volunteer",
      status: "active",
      source: "salesforce",
      createdAt: "2026-04-12T09:00:00.000Z",
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "multi-membership-follow-up",
      contactId: "contact:multi-membership",
      occurredAt: "2026-04-12T09:00:00.000Z",
      direction: "inbound",
      subject: "Multi membership subject",
      snippet: "Multi membership snippet",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:multi-membership",
      bucket: "New",
      needsFollowUp: true,
      hasUnresolved: false,
      lastInboundAt: "2026-04-12T09:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-12T09:00:00.000Z",
      snippet: "Multi membership snippet",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const workload = await getInboxWelcomeWorkload();
    const entry = workload.followUpRail.entries.find(
      (item) => item.contactId === "contact:multi-membership",
    );

    expect(entry?.projectLabel).toBe("Whitebark Pine");
  });

  it("uses the event-type fallback subject for follow-up rows", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxProjection(runtime.context, {
      contactId: "contact:sarah-martinez",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-14T13:00:00.000Z",
      lastOutboundAt: "2026-04-13T12:00:00.000Z",
      lastActivityAt: "2026-04-14T13:00:00.000Z",
      snippet:
        "Following up on the field study logistics for the Amazon basin project.",
      lastCanonicalEventId: "event:sarah-inbound-1",
      lastEventType: "communication.email.inbound",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:fallback-follow-up",
      salesforceContactId: "003-fallback-follow-up",
      displayName: "Fallback Follow Up",
      primaryEmail: "fallback-follow-up@example.org",
      primaryPhone: null,
      projectId: "project:amazon-basin",
      projectName: "Amazon Basin Research",
      membershipId: "membership:fallback-follow-up",
      membershipStatus: "active",
      membershipCreatedAt: "2026-04-09T08:00:00.000Z",
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "fallback-follow-up",
      contactId: "contact:fallback-follow-up",
      occurredAt: "2026-04-09T08:00:00.000Z",
      direction: "outbound",
      subject: "Ignored explicit subject",
      snippet: "",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:fallback-follow-up",
      bucket: "Opened",
      needsFollowUp: true,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-04-09T08:00:00.000Z",
      lastActivityAt: "2026-04-09T08:00:00.000Z",
      snippet: "",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const workload = await getInboxWelcomeWorkload();
    const entry = workload.followUpRail.entries.find(
      (item) => item.contactId === "contact:fallback-follow-up",
    );

    expect(entry?.latestSubject).toBe("Outbound email sent");
  });

  it("assembles selected-contact detail from real contact, membership, timeline, and projection data", async () => {
    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      projectionAvailable: true,
      bucket: "new",
      needsFollowUp: true,
      smsEligible: true,
    });
    expect(detail?.contact).toMatchObject({
      contactId: "contact:sarah-martinez",
      displayName: "Sarah Martinez",
      volunteerId: "003-sarah",
      pinnedNote: null,
    });
    expect(detail?.contact.activeProjects[0]).toMatchObject({
      projectName: "Amazon Basin Research",
      status: "in-training",
      statusLabel: "In Training",
      crmUrl:
        "https://adventurescientists.lightning.force.com/lightning/r/Project__c/project%3Aamazon-basin/view",
      expeditionMemberUrl:
        "https://adventurescientists.lightning.force.com/lightning/r/Expedition_Members__c/a0B-sarah-membership/view",
    });
    expect(detail?.timeline.map((entry) => entry.kind)).toEqual([
      "outbound-email",
      "inbound-email",
    ]);
    expect(detail?.timeline.at(-1)).toMatchObject({
      subject: "Re: Amazon Basin equipment list",
      isUnread: true,
      isPreview: true,
    });
    expect(detail?.timelinePage).toEqual({
      hasMore: false,
      hasHiddenEarlierHistory: false,
      nextCursor: null,
      total: 2,
    });
    expect(detail?.composerReplyContext).toMatchObject({
      subject: "Re: Amazon Basin equipment list",
    });
  });

  it("splits the summary and streamed timeline selectors into disjoint payloads", async () => {
    const summary = await getInboxDetailSummary("contact:sarah-martinez");
    const timeline = await getInboxDetailTimeline("contact:sarah-martinez", {
      limit: 1,
    });

    expect(summary).not.toBeNull();
    expect(summary).toMatchObject({
      projectionAvailable: true,
      bucket: "new",
      needsFollowUp: true,
      contact: {
        contactId: "contact:sarah-martinez",
        displayName: "Sarah Martinez",
      },
      composerReplyContext: {
        subject: "Re: Amazon Basin equipment list",
      },
    });
    expect("timeline" in (summary ?? {})).toBe(false);
    expect("timelinePage" in (summary ?? {})).toBe(false);

    expect(timeline).not.toBeNull();
    expect(timeline?.timeline).toHaveLength(1);
    expect(timeline?.timeline[0]).toMatchObject({
      kind: "inbound-email",
      subject: "Re: Amazon Basin equipment list",
    });
    expect(timeline?.timelinePage.hasMore).toBe(true);
    expect(timeline?.timelinePage.hasHiddenEarlierHistory).toBe(false);
    expect(typeof timeline?.timelinePage.nextCursor).toBe("string");
    expect(timeline?.timelinePage.total).toBe(2);
  });

  it("defaults the initial streamed timeline page size to twenty entries", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:timeline-page-size",
      salesforceContactId: "003-timeline-page-size",
      displayName: "Timeline Page Size",
      primaryEmail: "timeline-page-size@example.org",
      primaryPhone: null,
    });

    let newestEventId: string | null = null;

    for (let index = 0; index < 21; index += 1) {
      const occurredAt = new Date(
        Date.UTC(2026, 3, 1, 12, index, 0, 0),
      ).toISOString();
      const seeded = await seedInboxEmailEvent(runtime.context, {
        id: `timeline-page-size-${index.toString().padStart(2, "0")}`,
        contactId: "contact:timeline-page-size",
        occurredAt,
        direction: index % 2 === 0 ? "inbound" : "outbound",
        subject: `Timeline page size ${index.toString()}`,
        snippet: `Timeline page size ${index.toString()}`,
      });

      newestEventId = seeded.canonicalEventId;
    }

    if (newestEventId === null) {
      throw new Error("Expected newest timeline event id");
    }

    await seedInboxProjection(runtime.context, {
      contactId: "contact:timeline-page-size",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-01T12:20:00.000Z",
      lastOutboundAt: "2026-04-01T12:19:00.000Z",
      lastActivityAt: "2026-04-01T12:20:00.000Z",
      snippet: "Timeline page size 20",
      lastCanonicalEventId: newestEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:timeline-page-size");
    const timeline = await getInboxDetailTimeline("contact:timeline-page-size");

    expect(detail?.timeline).toHaveLength(20);
    expect(detail?.timelinePage.hasMore).toBe(true);
    expect(detail?.timelinePage.hasHiddenEarlierHistory).toBe(false);
    expect(typeof detail?.timelinePage.nextCursor).toBe("string");
    expect(detail?.timelinePage.total).toBe(21);
    expect(timeline?.timeline).toHaveLength(20);
    expect(timeline?.timelinePage.hasMore).toBe(true);
    expect(timeline?.timelinePage.hasHiddenEarlierHistory).toBe(false);
    expect(typeof timeline?.timelinePage.nextCursor).toBe("string");
    expect(timeline?.timelinePage.total).toBe(21);
  });

  it("synthesizes a degraded detail view when the projection row is missing but canonical events exist", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.repositories.inboxProjection.deleteByContactId(
      "contact:sarah-martinez",
    );

    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      projectionAvailable: false,
      bucket: "opened",
      needsFollowUp: false,
      isArchived: false,
    });
    expect(detail?.freshness.inboxUpdatedAt).toBeNull();
    expect(detail?.timelinePage).toEqual({
      hasMore: false,
      hasHiddenEarlierHistory: false,
      nextCursor: null,
      total: 2,
    });
    expect(detail?.timeline.at(-1)).toMatchObject({
      occurredAt: "2026-04-14T13:00:00.000Z",
      isUnread: false,
    });
  });

  it("falls back to contact.updatedAt when the projection row and canonical events are both missing", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:no-projection-no-events",
      salesforceContactId: "003-no-projection-no-events",
      displayName: "No Projection No Events",
      primaryEmail: "no-projection-no-events@example.org",
      primaryPhone: null,
    });
    await runtime.context.repositories.contacts.upsert({
      id: "contact:no-projection-no-events",
      salesforceContactId: "003-no-projection-no-events",
      displayName: "No Projection No Events",
      primaryEmail: "no-projection-no-events@example.org",
      primaryPhone: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-04-22T09:45:00.000Z",
    });

    const detail = await getInboxDetail("contact:no-projection-no-events");

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      projectionAvailable: false,
      bucket: "opened",
      needsFollowUp: false,
      isArchived: false,
    });
    expect(detail?.timeline).toEqual([]);
    expect(detail?.timelinePage).toEqual({
      hasMore: false,
      hasHiddenEarlierHistory: false,
      nextCursor: null,
      total: 0,
    });
    expect(detail?.freshness).toEqual({
      inboxUpdatedAt: null,
      timelineUpdatedAt: null,
      timelineCount: 0,
    });
  });

  it("still returns null when the contact does not exist", async () => {
    await expect(getInboxDetail("contact:missing")).resolves.toBeNull();
  });

  it("sets conversationProject from membership when the contact has an active project membership", async () => {
    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail?.conversationProject).toEqual({
      projectId: "project:amazon-basin",
      projectName: "Amazon Basin Research",
      source: "membership",
    });
  });

  it("falls back to a conversation-derived project when there is no membership project", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:orcas",
      projectName: "Orca Listening Network",
      projectAlias: "Orcas",
      source: "salesforce",
      isActive: true,
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:external-orcas",
      salesforceContactId: null,
      displayName: "External Orcas",
      primaryEmail: "external-orcas@example.org",
      primaryPhone: null,
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "external-orcas-outbound",
      contactId: "contact:external-orcas",
      occurredAt: "2026-04-19T16:00:00.000Z",
      direction: "outbound",
      subject: "Project alias send",
      snippet: "Sent from the orcas alias.",
      bodyTextPreview: "Sent from the orcas alias.",
      fromHeader: "Orcas <orcas@adventurescientists.org>",
      toHeader: "External Orcas <external-orcas@example.org>",
      projectInboxAlias: "orcas@adventurescientists.org",
    });
    await runtime.context.repositories.salesforceEventContext.upsert({
      sourceEvidenceId: "source:external-orcas-outbound",
      salesforceContactId: null,
      projectId: "project:orcas",
      expeditionId: null,
      sourceField: null,
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:external-orcas",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-04-19T16:00:00.000Z",
      lastActivityAt: "2026-04-19T16:00:00.000Z",
      snippet: "Sent from the orcas alias.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const detail = await getInboxDetail("contact:external-orcas");

    expect(detail?.contact.activeProjects).toHaveLength(0);
    // loadProjectMetadataById prefers projectAlias over projectName
    // (system convention — the alias is the operator-facing label).
    expect(detail?.conversationProject).toEqual({
      projectId: "project:orcas",
      projectName: "Orcas",
      source: "conversation",
    });
  });

  it("leaves conversationProject null when there is no membership or project-linked event context", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:no-project-context",
      salesforceContactId: null,
      displayName: "No Project Context",
      primaryEmail: "no-project-context@example.org",
      primaryPhone: null,
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "no-project-context-inbound",
      contactId: "contact:no-project-context",
      occurredAt: "2026-04-19T17:00:00.000Z",
      direction: "inbound",
      subject: "No project context",
      snippet: "No project-linked event context.",
      bodyTextPreview: "No project-linked event context.",
      fromHeader: "No Project Context <no-project-context@example.org>",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:no-project-context",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-19T17:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-19T17:00:00.000Z",
      snippet: "No project-linked event context.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:no-project-context");

    expect(detail?.contact.activeProjects).toHaveLength(0);
    expect(detail?.conversationProject).toBeNull();
  });

  it("filters pre-cutover timeline entries while keeping the cutover boundary inclusive", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:cutover-boundary",
      salesforceContactId: "003-cutover-boundary",
      displayName: "Cutover Boundary",
      primaryEmail: "cutover-boundary@example.org",
      primaryPhone: null,
      projectId: "project:cutover-boundary",
      projectName: "Cutover Boundary Project",
      membershipId: "membership:cutover-boundary",
      membershipStatus: "active",
    });
    await seedInboxEmailEvent(runtime.context, {
      id: "cutover-pre-outbound",
      contactId: "contact:cutover-boundary",
      occurredAt: "2024-12-31T23:59:59.999Z",
      direction: "outbound",
      subject: "Older hidden email",
      snippet: "This email should be hidden from the timeline.",
    });
    const boundaryInbound = await seedInboxEmailEvent(runtime.context, {
      id: "cutover-boundary-inbound",
      contactId: "contact:cutover-boundary",
      occurredAt: "2025-01-01T00:00:00.000Z",
      direction: "inbound",
      subject: "Boundary inbound email",
      snippet: "This inbound message sits exactly on the cutover.",
    });
    const postCutoverOutbound = await seedInboxEmailEvent(runtime.context, {
      id: "cutover-post-outbound",
      contactId: "contact:cutover-boundary",
      occurredAt: "2025-01-02T12:00:00.000Z",
      direction: "outbound",
      subject: "Visible post-cutover email",
      snippet: "This email should remain visible.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:cutover-boundary",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2025-01-01T00:00:00.000Z",
      lastOutboundAt: "2025-01-02T12:00:00.000Z",
      lastActivityAt: "2025-01-02T12:00:00.000Z",
      snippet: "This email should remain visible.",
      lastCanonicalEventId: postCutoverOutbound.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const detail = await getInboxDetail("contact:cutover-boundary");

    expect(detail?.timeline.map((entry) => entry.subject)).toEqual([
      "Boundary inbound email",
      "Visible post-cutover email",
    ]);
    expect(detail?.timeline.map((entry) => entry.occurredAt)).toEqual([
      "2025-01-01T00:00:00.000Z",
      "2025-01-02T12:00:00.000Z",
    ]);
    expect(detail?.timelinePage).toEqual({
      hasMore: false,
      hasHiddenEarlierHistory: true,
      nextCursor: null,
      total: 2,
    });
    expect(detail?.composerReplyContext).toMatchObject({
      threadCursor: boundaryInbound.canonicalEventId,
      subject: "Re: Boundary inbound email",
    });
  });

  it("shows only-pre-cutover contact history when there is no post-cutover activity", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:pre-cutover-only",
      salesforceContactId: "003-pre-cutover-only",
      displayName: "Pre Cutover Only",
      primaryEmail: "pre-cutover-only@example.org",
      primaryPhone: null,
      projectId: "project:pre-cutover-only",
      projectName: "Pre Cutover Only Project",
      membershipId: "membership:pre-cutover-only",
      membershipStatus: "active",
    });
    await seedInboxEmailEvent(runtime.context, {
      id: "pre-cutover-only-inbound",
      contactId: "contact:pre-cutover-only",
      occurredAt: "2024-11-15T15:00:00.000Z",
      direction: "inbound",
      subject: "Older inbound email",
      snippet: "This pre-cutover history should remain visible.",
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "pre-cutover-only-outbound",
      contactId: "contact:pre-cutover-only",
      occurredAt: "2024-12-20T18:00:00.000Z",
      direction: "outbound",
      subject: "Older outbound email",
      snippet: "This outbound is still the latest activity before cutover.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:pre-cutover-only",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2024-11-15T15:00:00.000Z",
      lastOutboundAt: "2024-12-20T18:00:00.000Z",
      lastActivityAt: "2024-12-20T18:00:00.000Z",
      snippet: "This outbound is still the latest activity before cutover.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const detail = await getInboxDetail("contact:pre-cutover-only");

    expect(detail?.timeline.map((entry) => entry.subject)).toEqual([
      "Older inbound email",
      "Older outbound email",
    ]);
    expect(detail?.timelinePage).toEqual({
      hasMore: false,
      hasHiddenEarlierHistory: false,
      nextCursor: null,
      total: 2,
    });
    expect(detail?.composerReplyContext).toMatchObject({
      subject: "Re: Older inbound email",
    });
  });

  it("shows only-post-cutover contact history without an earlier-history expander", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:post-cutover-only",
      salesforceContactId: "003-post-cutover-only",
      displayName: "Post Cutover Only",
      primaryEmail: "post-cutover-only@example.org",
      primaryPhone: null,
      projectId: "project:post-cutover-only",
      projectName: "Post Cutover Only Project",
      membershipId: "membership:post-cutover-only",
      membershipStatus: "active",
    });
    await seedInboxEmailEvent(runtime.context, {
      id: "post-cutover-only-inbound",
      contactId: "contact:post-cutover-only",
      occurredAt: "2025-01-05T09:00:00.000Z",
      direction: "inbound",
      subject: "Visible inbound email",
      snippet: "This post-cutover history should stay visible.",
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "post-cutover-only-outbound",
      contactId: "contact:post-cutover-only",
      occurredAt: "2025-01-06T11:30:00.000Z",
      direction: "outbound",
      subject: "Visible outbound email",
      snippet: "This is the latest visible post-cutover activity.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:post-cutover-only",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2025-01-05T09:00:00.000Z",
      lastOutboundAt: "2025-01-06T11:30:00.000Z",
      lastActivityAt: "2025-01-06T11:30:00.000Z",
      snippet: "This is the latest visible post-cutover activity.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const detail = await getInboxDetail("contact:post-cutover-only");

    expect(detail?.timeline.map((entry) => entry.subject)).toEqual([
      "Visible inbound email",
      "Visible outbound email",
    ]);
    expect(detail?.timelinePage).toEqual({
      hasMore: false,
      hasHiddenEarlierHistory: false,
      nextCursor: null,
      total: 2,
    });
  });

  it("filters pre-cutover message history out of the composer reply context", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:cutover-reply",
      salesforceContactId: "003-cutover-reply",
      displayName: "Cutover Reply",
      primaryEmail: "cutover-reply@example.org",
      primaryPhone: null,
      projectId: "project:cutover-reply",
      projectName: "Cutover Reply Project",
      membershipId: "membership:cutover-reply",
      membershipStatus: "active",
    });
    await seedInboxEmailEvent(runtime.context, {
      id: "cutover-reply-pre-inbound",
      contactId: "contact:cutover-reply",
      occurredAt: "2024-12-15T15:00:00.000Z",
      direction: "inbound",
      subject: "Only older inbound",
      snippet: "This is the last inbound before full capture.",
    });
    const visibleOutbound = await seedInboxEmailEvent(runtime.context, {
      id: "cutover-reply-visible-outbound",
      contactId: "contact:cutover-reply",
      occurredAt: "2025-02-01T15:00:00.000Z",
      direction: "outbound",
      subject: "Visible outbound",
      snippet: "Visible outbound with no visible inbound to reply to.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:cutover-reply",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2024-12-15T15:00:00.000Z",
      lastOutboundAt: "2025-02-01T15:00:00.000Z",
      lastActivityAt: "2025-02-01T15:00:00.000Z",
      snippet: "Visible outbound with no visible inbound to reply to.",
      lastCanonicalEventId: visibleOutbound.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const detail = await getInboxDetail("contact:cutover-reply");

    expect(detail?.timeline.map((entry) => entry.subject)).toEqual([
      "Visible outbound",
    ]);
    expect(detail?.composerReplyContext).toBeNull();
  });

  it("renders the contact rail project row as a single expedition-member anchor with a hover affordance", async () => {
    const detail = await getInboxDetail("contact:sarah-martinez");

    if (detail === null) {
      throw new Error("Expected inbox detail for Sarah Martinez");
    }
    const markup = renderToStaticMarkup(
      createElement(InboxContactRail, {
        contact: detail.contact,
      }),
    );

    expect(markup).toContain(
      'href="https://adventurescientists.lightning.force.com/lightning/r/Expedition_Members__c/a0B-sarah-membership/view"',
    );
    expect(markup).toContain("group-hover:opacity-100");
    expect(markup).not.toContain("↗ Project");
  });

  it("renders the expedition member link for Salesforce-backed past projects", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.settings.projects.setActive(
      "project:killer-whales",
      false,
    );
    const detail = await getInboxDetail("contact:lisa-zhang");

    if (detail === null) {
      throw new Error("Expected inbox detail for Lisa Zhang");
    }
    const markup = renderToStaticMarkup(
      createElement(InboxContactRail, {
        contact: detail.contact,
      }),
    );

    expect(markup).toContain(
      'href="https://adventurescientists.lightning.force.com/lightning/r/Expedition_Members__c/membership%3Alisa%3Asf/view"',
    );
    expect(markup).not.toContain("↗ Project");
  });

  it("keeps a successful membership on an active project in Active Projects", async () => {
    const detail = await getInboxDetail("contact:lisa-zhang");

    expect(detail).not.toBeNull();
    expect(detail?.contact.activeProjects).toHaveLength(1);
    expect(detail?.contact.activeProjects[0]).toMatchObject({
      projectName: "Searching for Killer Whales",
      projectIsActive: true,
      status: "successful",
      statusLabel: "Successful",
    });
    expect(detail?.contact.pastProjects).toHaveLength(0);
  });

  it("keeps all-time project memberships visible even when the membership predates the cutover", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:membership-all-time",
      salesforceContactId: "003-membership-all-time",
      displayName: "Membership All Time",
      primaryEmail: "membership-all-time@example.org",
      primaryPhone: null,
      contactCreatedAt: "2023-06-01T12:00:00.000Z",
      projectId: "project:all-time-membership",
      projectName: "All-Time Membership Project",
      membershipId: "membership:all-time-membership",
      membershipStatus: "successful",
      membershipCreatedAt: "2023-06-01T12:00:00.000Z",
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "membership-all-time-inbound",
      contactId: "contact:membership-all-time",
      occurredAt: "2025-03-01T12:00:00.000Z",
      direction: "inbound",
      subject: "Visible 2025 email",
      snippet: "The timeline should filter events, not memberships.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:membership-all-time",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2025-03-01T12:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2025-03-01T12:00:00.000Z",
      snippet: "The timeline should filter events, not memberships.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:membership-all-time");

    expect(detail?.contact.activeProjects[0]).toMatchObject({
      projectName: "All-Time Membership Project",
      signupYear: 2023,
      status: "successful",
    });
  });

  it("places inactive memberships in Past Projects regardless of volunteer status", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:ryan-davis",
      salesforceContactId: "003-ryan",
      displayName: "Ryan Davis",
      primaryEmail: "ryan@example.org",
      primaryPhone: null,
      projectId: "project:plastic-free-parks",
      projectName: "Plastic Free Parks 2025",
      membershipId: "membership:ryan:parks",
      salesforceMembershipId: "a0B-ryan-parks",
      membershipStatus: "applied",
      membershipCreatedAt: "2024-02-01T12:00:00.000Z",
    });
    await runtime.context.settings.projects.setActive(
      "project:plastic-free-parks",
      false,
    );
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "ryan-inbound-1",
      contactId: "contact:ryan-davis",
      occurredAt: "2026-04-20T13:00:00.000Z",
      direction: "inbound",
      subject: "Checking project placement",
      snippet: "This project should now be in past projects.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:ryan-davis",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-20T13:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-20T13:00:00.000Z",
      snippet: "This project should now be in past projects.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:ryan-davis");

    expect(detail).not.toBeNull();
    expect(detail?.contact.activeProjects).toHaveLength(0);
    expect(detail?.contact.pastProjects[0]).toMatchObject({
      projectName: "Plastic Free Parks 2025",
      projectIsActive: false,
      status: "applied",
      statusLabel: "Applied",
      signupYear: null,
      expeditionMemberUrl:
        "https://adventurescientists.lightning.force.com/lightning/r/Expedition_Members__c/a0B-ryan-parks/view",
    });
  });

  it("sorts Past Projects by membership createdAt descending", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:past-order",
      salesforceContactId: "003-past-order",
      displayName: "Past Order",
      primaryEmail: "past@example.org",
      primaryPhone: null,
      projectId: "project:older",
      projectName: "Older Project",
      membershipId: "membership:past:older",
      salesforceMembershipId: "a0B-past-older",
      membershipStatus: "lead",
      membershipCreatedAt: "2022-01-01T12:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:past-order",
      salesforceContactId: "003-past-order",
      displayName: "Past Order",
      primaryEmail: "past@example.org",
      primaryPhone: null,
      projectId: "project:newer",
      projectName: "Newer Project",
      membershipId: "membership:past:newer",
      salesforceMembershipId: "a0B-past-newer",
      membershipStatus: "successful",
      membershipCreatedAt: "2025-01-01T12:00:00.000Z",
    });
    await runtime.context.settings.projects.setActive("project:older", false);
    await runtime.context.settings.projects.setActive("project:newer", false);
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "past-order-inbound-1",
      contactId: "contact:past-order",
      occurredAt: "2026-04-22T13:00:00.000Z",
      direction: "inbound",
      subject: "Past sort",
      snippet: "Checking past project order.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:past-order",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-22T13:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-22T13:00:00.000Z",
      snippet: "Checking past project order.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:past-order");

    expect(
      detail?.contact.pastProjects.map((project) => project.projectName),
    ).toEqual(["Newer Project", "Older Project"]);
    expect(
      detail?.contact.pastProjects.map((project) => project.signupYear),
    ).toEqual([null, null]);
  });

  it("normalizes the full Salesforce membership-status label surface for rail badges", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    const statuses = [
      ["lead", "Lead"],
      ["confirmed", "Confirmed"],
      ["applied", "Applied"],
      ["pending_acceptance", "Pending Acceptance"],
      ["accepted", "Accepted"],
      ["in_training", "In Training"],
      ["trip_planning", "Trip Planning"],
      ["in_the_field", "In the Field"],
      ["returning_gear", "Returning Gear"],
      ["successful", "Successful"],
      ["completed", "Completed"],
      ["denied", "Denied"],
      ["declined", "Declined"],
      ["aborted", "Aborted"],
      ["failed", "Failed"],
      ["waitlist", "Waitlist"],
    ] as const;

    for (const [index, [status]] of statuses.entries()) {
      const projectId = `project:status-${index.toString()}`;
      await seedInboxContact(runtime.context, {
        contactId: "contact:status-labels",
        salesforceContactId: "003-status-labels",
        displayName: "Status Labels",
        primaryEmail: "status@example.org",
        primaryPhone: null,
        projectId,
        projectName: `Status Project ${index.toString()}`,
        membershipId: `membership:status:${index.toString()}`,
        salesforceMembershipId: `a0B-status-${index.toString()}`,
        membershipStatus: status,
        membershipCreatedAt: `202${Math.min(index, 9).toString()}-01-01T00:00:00.000Z`,
      });
      await runtime.context.settings.projects.setActive(projectId, false);
    }

    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "status-labels-inbound-1",
      contactId: "contact:status-labels",
      occurredAt: "2026-04-24T13:00:00.000Z",
      direction: "inbound",
      subject: "Status labels",
      snippet: "Checking status labels.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:status-labels",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-24T13:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-24T13:00:00.000Z",
      snippet: "Checking status labels.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:status-labels");

    expect(detail).not.toBeNull();
    expect(
      new Set(
        detail?.contact.pastProjects.map((project) => project.statusLabel),
      ),
    ).toEqual(new Set(statuses.map(([, label]) => label)));
  });

  it("shows signup year only for past-project rows", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.settings.projects.setActive(
      "project:killer-whales",
      false,
    );

    // Seed a project-linked lifecycle event so signupYear resolves to a real
    // historical year (otherwise the fallback chain reaches contact.createdAt
    // which equals the current/backfill year and is intentionally suppressed —
    // see "correct past-project signup year").
    await seedInboxLifecycleEvent(runtime.context, {
      id: "lisa-killer-whales-signup",
      contactId: "contact:lisa-zhang",
      occurredAt: "2023-06-15T15:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up - Searching for Killer Whales",
      projectId: "project:killer-whales",
    });

    const [activeDetail, pastDetail] = await Promise.all([
      getInboxDetail("contact:sarah-martinez"),
      getInboxDetail("contact:lisa-zhang"),
    ]);

    if (activeDetail === null || pastDetail === null) {
      throw new Error("Expected inbox detail for active and past contacts");
    }

    const activeMarkup = renderToStaticMarkup(
      createElement(InboxContactRail, {
        contact: activeDetail.contact,
      }),
    );
    const pastMarkup = renderToStaticMarkup(
      createElement(InboxContactRail, {
        contact: pastDetail.contact,
      }),
    );

    const activeSection =
      activeMarkup.split("Past Projects")[0] ?? activeMarkup;
    const pastSection = pastMarkup.split("Past Projects")[1] ?? pastMarkup;

    expect(activeSection).not.toContain("tabular-nums");
    expect(pastSection).toContain("tabular-nums");
    expect(pastSection).toContain("2023");
  });

  it("uses the most recent internal note as the pinned note proxy", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxInternalNoteEvent(runtime.context, {
      id: "sarah-note-older",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-15T09:00:00.000Z",
      body: "Older note body",
      authorDisplayName: "Jordan",
      authorId: "user:jordan",
    });
    await seedInboxInternalNoteEvent(runtime.context, {
      id: "sarah-note-latest",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-15T11:30:00.000Z",
      body: "Latest note body",
      authorDisplayName: "Sam Bowes",
      authorId: "user:sam",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");

    // The pinned-note timestamp is rendered as a relative label, so assert the
    // content and structure without pinning the exact phrasing.
    expect(detail?.contact.pinnedNote).toMatchObject({
      body: "Latest note body",
      authorLabel: "Sam Bowes",
    });
    expect(detail?.contact.pinnedNote?.createdAtLabel).toMatch(
      /^(?:Just now|\d+[smhdw] ago)$/u,
    );
  });

  it("orders contact rail active projects by latest lifecycle activity and uses short aliases", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:steve-herman",
      salesforceContactId: "003-steve",
      displayName: "Steve Herman",
      primaryEmail: "steve@example.org",
      primaryPhone: null,
      projectId: "project:illegal-timber",
      projectName: "Illegal Timber Tracking",
      projectAlias: "Illegal Timber",
      membershipId: "membership:steve:illegal-timber",
      membershipStatus: "lead",
      membershipCreatedAt: "2026-04-01T10:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:steve-herman",
      salesforceContactId: "003-steve",
      displayName: "Steve Herman",
      primaryEmail: "steve@example.org",
      primaryPhone: null,
      projectId: "project:whitebark-pine",
      projectName: "WPEF Tracking Whitebark Pine OR WA 2025-2026 2026",
      projectAlias: "Whitebark Pine",
      membershipId: "membership:steve:whitebark",
      membershipStatus: "applied",
      membershipCreatedAt: "2026-04-02T10:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:steve-herman",
      salesforceContactId: "003-steve",
      displayName: "Steve Herman",
      primaryEmail: "steve@example.org",
      primaryPhone: null,
      projectId: "project:passive-acoustic",
      projectName: "Passive Acoustic Monitoring of Pacific Northwest Forests",
      projectAlias: "Passive Acoustic",
      membershipId: "membership:steve:passive-acoustic",
      membershipStatus: "active",
      membershipCreatedAt: "2026-04-03T10:00:00.000Z",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "steve-whitebark-received-training",
      contactId: "contact:steve-herman",
      occurredAt: "2026-04-15T10:00:00.000Z",
      eventType: "lifecycle.received_training",
      summary: "Received training",
      projectId: "project:whitebark-pine",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "steve-illegal-signed-up",
      contactId: "contact:steve-herman",
      occurredAt: "2026-04-12T10:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:illegal-timber",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "steve-passive-submitted-data",
      contactId: "contact:steve-herman",
      occurredAt: "2026-04-20T10:00:00.000Z",
      eventType: "lifecycle.submitted_first_data",
      summary: "Submitted first data",
      projectId: "project:passive-acoustic",
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "steve-detail-inbound-1",
      contactId: "contact:steve-herman",
      occurredAt: "2026-04-20T13:00:00.000Z",
      direction: "inbound",
      subject: "Re: Project recap",
      snippet: "Here is the latest project update.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:steve-herman",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-20T13:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-20T13:00:00.000Z",
      snippet: "Here is the latest project update.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:steve-herman");

    if (detail === null) {
      throw new Error("Expected inbox detail for Steve Herman");
    }

    expect(
      detail.contact.activeProjects.map((project) => project.projectName),
    ).toEqual(["Passive Acoustic", "Whitebark Pine", "Illegal Timber"]);
    expect(
      renderToStaticMarkup(
        createElement(InboxContactRail, {
          contact: detail.contact,
        }),
      ),
    ).not.toContain("WPEF Tracking Whitebark Pine OR WA 2025-2026 2026");
  });

  it("keeps inactive memberships in past projects with their Salesforce membership link", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.settings.projects.setActive(
      "project:killer-whales",
      false,
    );
    const detail = await getInboxDetail("contact:lisa-zhang");

    expect(detail).not.toBeNull();
    expect(detail?.contact.pastProjects[0]).toMatchObject({
      projectIsActive: false,
      signupYear: null,
      status: "successful",
      statusLabel: "Successful",
      crmUrl:
        "https://adventurescientists.lightning.force.com/lightning/r/Project__c/project%3Akiller-whales/view",
      expeditionMemberUrl:
        "https://adventurescientists.lightning.force.com/lightning/r/Expedition_Members__c/membership%3Alisa%3Asf/view",
    });
  });

  it("derives past-project signup year from project events, contact-level events, and suppresses backfill-year fallbacks", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:past-signup-year",
      salesforceContactId: "003-past-signup-year",
      displayName: "Past Signup Year",
      primaryEmail: "past-signup-year@example.org",
      primaryPhone: null,
      projectId: "project:old-ledger-year",
      projectName: "Old Ledger Year",
      membershipId: "membership:past:old-ledger-year",
      salesforceMembershipId: "a0B-past-old-ledger-year",
      membershipStatus: "successful",
      membershipCreatedAt: "2026-02-01T00:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:contact-event-signup-year",
      salesforceContactId: "003-contact-event-signup-year",
      displayName: "Contact Event Signup Year",
      primaryEmail: "contact-event-signup-year@example.org",
      primaryPhone: null,
      contactCreatedAt: "2018-01-01T00:00:00.000Z",
      projectId: "project:contact-event-fallback-year",
      projectName: "Contact Event Fallback Year",
      membershipId: "membership:contact-event-fallback-year",
      salesforceMembershipId: "a0B-contact-event-fallback-year",
      membershipStatus: "completed",
      membershipCreatedAt: "2026-04-15T00:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:null-project-fallback-year",
      salesforceContactId: "003-null-project-fallback-year",
      displayName: "Null Project Fallback Year",
      primaryEmail: "null-project-fallback-year@example.org",
      primaryPhone: null,
      contactCreatedAt: "2019-01-01T00:00:00.000Z",
      projectId: "project:null-project-fallback-year",
      projectName: "Null Project Fallback Year",
      membershipId: "membership:null-project-fallback-year",
      salesforceMembershipId: "a0B-null-project-fallback-year",
      membershipStatus: "successful",
      membershipCreatedAt: "2026-04-15T00:00:00.000Z",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:suppressed-signup-year",
      salesforceContactId: "003-suppressed-signup-year",
      displayName: "Suppressed Signup Year",
      primaryEmail: "suppressed-signup-year@example.org",
      primaryPhone: null,
      contactCreatedAt: "2026-01-05T00:00:00.000Z",
      projectId: "project:suppressed-signup-year",
      projectName: "Suppressed Signup Year",
      membershipId: "membership:suppressed-signup-year",
      salesforceMembershipId: "a0B-suppressed-signup-year",
      membershipStatus: "completed",
      membershipCreatedAt: "2026-04-15T00:00:00.000Z",
    });
    await runtime.context.settings.projects.setActive(
      "project:old-ledger-year",
      false,
    );
    await runtime.context.settings.projects.setActive(
      "project:contact-event-fallback-year",
      false,
    );
    await runtime.context.settings.projects.setActive(
      "project:null-project-fallback-year",
      false,
    );
    await runtime.context.settings.projects.setActive(
      "project:suppressed-signup-year",
      false,
    );
    await seedInboxLifecycleEvent(runtime.context, {
      id: "past-signup-year-oldest",
      contactId: "contact:past-signup-year",
      occurredAt: "2021-07-14T00:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:old-ledger-year",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "past-signup-year-newer",
      contactId: "contact:past-signup-year",
      occurredAt: "2023-03-20T00:00:00.000Z",
      eventType: "lifecycle.completed_training",
      summary: "Completed training",
      projectId: "project:old-ledger-year",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "contact-event-fallback-year-earliest",
      contactId: "contact:contact-event-signup-year",
      occurredAt: "2020-05-09T00:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:other-contact-project",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "null-project-fallback-year-earliest",
      contactId: "contact:null-project-fallback-year",
      occurredAt: "2022-09-10T00:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: null,
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "past-signup-year-inbound",
      contactId: "contact:past-signup-year",
      occurredAt: "2026-04-25T13:00:00.000Z",
      direction: "inbound",
      subject: "Past signup year check",
      snippet: "Checking lifecycle-derived signup year.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:past-signup-year",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-25T13:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-25T13:00:00.000Z",
      snippet: "Checking lifecycle-derived signup year.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });
    const contactFallbackLatest = await seedInboxEmailEvent(runtime.context, {
      id: "contact-event-signup-year-inbound",
      contactId: "contact:contact-event-signup-year",
      occurredAt: "2026-04-25T13:00:00.000Z",
      direction: "inbound",
      subject: "Contact event signup year check",
      snippet: "Checking contact-level signup year fallback.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:contact-event-signup-year",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-25T13:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-25T13:00:00.000Z",
      snippet: "Checking contact-level signup year fallback.",
      lastCanonicalEventId: contactFallbackLatest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });
    const nullProjectLatest = await seedInboxEmailEvent(runtime.context, {
      id: "null-project-fallback-year-inbound",
      contactId: "contact:null-project-fallback-year",
      occurredAt: "2026-04-25T13:00:00.000Z",
      direction: "inbound",
      subject: "Null project signup year check",
      snippet: "Checking null-project contact-level signup year fallback.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:null-project-fallback-year",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-25T13:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-25T13:00:00.000Z",
      snippet: "Checking null-project contact-level signup year fallback.",
      lastCanonicalEventId: nullProjectLatest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });
    const suppressedLatest = await seedInboxEmailEvent(runtime.context, {
      id: "suppressed-signup-year-inbound",
      contactId: "contact:suppressed-signup-year",
      occurredAt: "2026-04-25T13:00:00.000Z",
      direction: "inbound",
      subject: "Suppressed signup year check",
      snippet: "Checking backfill-year suppression.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:suppressed-signup-year",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-25T13:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-25T13:00:00.000Z",
      snippet: "Checking backfill-year suppression.",
      lastCanonicalEventId: suppressedLatest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:past-signup-year");
    const contactEventDetail = await getInboxDetail(
      "contact:contact-event-signup-year",
    );
    const nullProjectDetail = await getInboxDetail(
      "contact:null-project-fallback-year",
    );

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00.000Z"));
    const suppressedDetail = await getInboxDetail(
      "contact:suppressed-signup-year",
    );

    // Past projects sort by membership.createdAt desc (newest first).
    // signupYear is independent of sort and resolves via:
    // project-linked event -> contact-level event -> contact createdAt.
    expect(detail?.contact.pastProjects).toMatchObject([
      {
        projectName: "Old Ledger Year",
        signupYear: 2021,
      },
    ]);
    expect(contactEventDetail?.contact.pastProjects).toMatchObject([
      {
        projectName: "Contact Event Fallback Year",
        signupYear: 2020,
      },
    ]);
    expect(nullProjectDetail?.contact.pastProjects).toMatchObject([
      {
        projectName: "Null Project Fallback Year",
        signupYear: 2022,
      },
    ]);
    expect(suppressedDetail?.contact.pastProjects).toMatchObject([
      {
        projectName: "Suppressed Signup Year",
        signupYear: null,
      },
    ]);
  });

  it("threads Gmail From, To, and Cc headers into the timeline detail view model", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:shaina-participants",
      salesforceContactId: "003-shaina-participants",
      displayName: "Shaina Dotson",
      primaryEmail: "shaina.dotson@gmail.com",
      primaryPhone: null,
    });
    const latestShainaEvent = await seedInboxEmailEvent(runtime.context, {
      id: "shaina-participants-latest",
      contactId: "contact:shaina-participants",
      occurredAt: "2026-04-22T01:41:44.000Z",
      direction: "outbound",
      subject: "Re: Update on Hex 43191",
      snippet: "Looping Samantha in here as well.",
      bodyTextPreview: "Looping Samantha in here as well.",
      fromHeader: "PNW Project <pnwbio@adventurescientists.org>",
      toHeader: "Shaina Dotson <shaina.dotson@gmail.com>",
      ccHeader:
        "Ricky Jones <ricky@adventurescientists.org>, Samantha Doe <samantha@adventurescientists.org>",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:shaina-participants",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-04-22T01:41:44.000Z",
      lastActivityAt: "2026-04-22T01:41:44.000Z",
      snippet: "Looping Samantha in here as well.",
      lastCanonicalEventId: latestShainaEvent.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const detail = await getInboxDetail("contact:shaina-participants");
    const latestEntry = detail?.timeline.at(-1);

    expect(latestEntry).toMatchObject({
      kind: "outbound-email",
      fromHeader: "PNW Project <pnwbio@adventurescientists.org>",
      toHeader: "Shaina Dotson <shaina.dotson@gmail.com>",
      recipientLabel: "Shaina Dotson",
      ccHeader:
        "Ricky Jones <ricky@adventurescientists.org>, Samantha Doe <samantha@adventurescientists.org>",
    });
  });

  it("infers timeline recipient labels from display names, bare emails, and project aliases", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:recipient-labels",
      salesforceContactId: "003-recipient-labels",
      displayName: "Recipient Label",
      primaryEmail: "recipient@example.org",
      primaryPhone: null,
      projectId: "project:pnw-forest",
      projectName: "Pacific Northwest Forest Biodiversity",
      projectAlias: "PNW Forest Biodiversity",
      membershipId: "membership:recipient-labels",
      membershipStatus: "active",
    });
    await runtime.context.settings.aliases.create({
      id: "alias:pnw-forest",
      alias: "pnwbio@adventurescientists.org",
      signature: "",
      projectId: "project:pnw-forest",
      createdAt: new Date("2026-04-20T12:00:00.000Z"),
      updatedAt: new Date("2026-04-20T12:00:00.000Z"),
      createdBy: null,
      updatedBy: null,
    });
    const displayNameEvent = await seedInboxEmailEvent(runtime.context, {
      id: "recipient-label-display",
      contactId: "contact:recipient-labels",
      occurredAt: "2026-04-22T01:00:00.000Z",
      direction: "outbound",
      subject: "Display recipient",
      snippet: "Display recipient body.",
      bodyTextPreview: "Display recipient body.",
      toHeader: "Display Name <email@example.com>",
    });
    const bareEmailEvent = await seedInboxEmailEvent(runtime.context, {
      id: "recipient-label-bare",
      contactId: "contact:recipient-labels",
      occurredAt: "2026-04-22T01:01:00.000Z",
      direction: "outbound",
      subject: "Bare recipient",
      snippet: "Bare recipient body.",
      bodyTextPreview: "Bare recipient body.",
      toHeader: "email@example.com",
    });
    const projectAliasEvent = await seedInboxEmailEvent(runtime.context, {
      id: "recipient-label-project",
      contactId: "contact:recipient-labels",
      occurredAt: "2026-04-22T01:02:00.000Z",
      direction: "inbound",
      subject: "Project recipient",
      snippet: "Project recipient body.",
      bodyTextPreview: "Project recipient body.",
      fromHeader: "Volunteer <recipient@example.org>",
      toHeader: "pnwbio@adventurescientists.org",
      projectInboxAlias: "pnwbio@adventurescientists.org",
    });
    const missingHeaderEvent = await seedInboxEmailEvent(runtime.context, {
      id: "recipient-label-missing",
      contactId: "contact:recipient-labels",
      occurredAt: "2026-04-22T01:03:00.000Z",
      direction: "inbound",
      subject: "Missing recipient",
      snippet: "Missing recipient body.",
      bodyTextPreview: "Missing recipient body.",
      fromHeader: "Volunteer <recipient@example.org>",
      toHeader: null,
      projectInboxAlias: "pnwbio@adventurescientists.org",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:recipient-labels",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-22T01:03:00.000Z",
      lastOutboundAt: "2026-04-22T01:01:00.000Z",
      lastActivityAt: "2026-04-22T01:03:00.000Z",
      snippet: "Missing recipient body.",
      lastCanonicalEventId: missingHeaderEvent.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:recipient-labels");
    const labelBySubject = new Map(
      detail?.timeline.map((entry) => [entry.subject, entry.recipientLabel]),
    );

    expect(displayNameEvent.canonicalEventId).toBeTruthy();
    expect(bareEmailEvent.canonicalEventId).toBeTruthy();
    expect(projectAliasEvent.canonicalEventId).toBeTruthy();
    expect(labelBySubject.get("Display recipient")).toBe("Display Name");
    expect(labelBySubject.get("Bare recipient")).toBe("email@example.com");
    expect(labelBySubject.get("Project recipient")).toBe(
      "PNW Forest Biodiversity",
    );
    expect(labelBySubject.get("Missing recipient")).toBe(
      "PNW Forest Biodiversity",
    );
  });

  it("uses the Gmail From header as the inbound actor label when present", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:shaina-ricky",
      salesforceContactId: "003-shaina-ricky",
      displayName: "Shaina Dotson",
      primaryEmail: "shaina.dotson@gmail.com",
      primaryPhone: null,
    });
    const latestEvent = await seedInboxEmailEvent(runtime.context, {
      id: "shaina-ricky-latest",
      contactId: "contact:shaina-ricky",
      occurredAt: "2026-04-21T15:47:27.000Z",
      direction: "inbound",
      subject: "Re: Update on Hex 43191",
      snippet: "Hi Shaina, Sorry for the delay.",
      bodyTextPreview: "Hi Shaina, Sorry for the delay.",
      fromHeader: "Ricky Jones <ricky@adventurescientists.org>",
      toHeader: "Shaina Dotson <shaina.dotson@gmail.com>",
      ccHeader: "PNW Forest Biodiversity <pnwbio@adventurescientists.org>",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:shaina-ricky",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-21T15:47:27.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-21T15:47:27.000Z",
      snippet: "Hi Shaina, Sorry for the delay.",
      lastCanonicalEventId: latestEvent.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:shaina-ricky");
    const latestEntry = detail?.timeline.at(-1);

    expect(latestEntry).toMatchObject({
      kind: "inbound-email",
      actorLabel: "Ricky Jones",
      fromHeader: "Ricky Jones <ricky@adventurescientists.org>",
      toHeader: "Shaina Dotson <shaina.dotson@gmail.com>",
      ccHeader: "PNW Forest Biodiversity <pnwbio@adventurescientists.org>",
    });
  });

  it("normalizes canonical inbound contact names instead of using inconsistent From headers", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    const cases = [
      {
        contactId: "contact:normalized-last-first",
        displayName: "RUTLEDGE, JOE",
        primaryEmail: "last-first@example.org",
        fromHeader: "jrutle <last-first@example.org>",
        expected: "Joe Rutledge",
      },
      {
        contactId: "contact:normalized-all-caps",
        displayName: "JOE RUTLEDGE",
        primaryEmail: "all-caps@example.org",
        fromHeader: "Joe rutledge <all-caps@example.org>",
        expected: "Joe Rutledge",
      },
      {
        contactId: "contact:normalized-lowercase",
        displayName: "Joe rutledge",
        primaryEmail: "lowercase@example.org",
        fromHeader: "JOE RUTLEDGE <lowercase@example.org>",
        expected: "Joe Rutledge",
      },
      {
        contactId: "contact:normalized-username",
        displayName: "jrutle",
        primaryEmail: "username@example.org",
        fromHeader: "JOE RUTLEDGE <username@example.org>",
        expected: "jrutle",
      },
    ] as const;

    for (const entry of cases) {
      await seedInboxContact(runtime.context, {
        contactId: entry.contactId,
        salesforceContactId: null,
        displayName: entry.displayName,
        primaryEmail: entry.primaryEmail,
        primaryPhone: null,
      });
      const latest = await seedInboxEmailEvent(runtime.context, {
        id: `${entry.contactId}-latest`,
        contactId: entry.contactId,
        occurredAt: "2026-04-23T12:00:00.000Z",
        direction: "inbound",
        subject: "Author normalization",
        snippet: "Testing author normalization.",
        bodyTextPreview: "Testing author normalization.",
        fromHeader: entry.fromHeader,
      });
      await seedInboxProjection(runtime.context, {
        contactId: entry.contactId,
        bucket: "New",
        needsFollowUp: false,
        hasUnresolved: false,
        lastInboundAt: "2026-04-23T12:00:00.000Z",
        lastOutboundAt: null,
        lastActivityAt: "2026-04-23T12:00:00.000Z",
        snippet: "Testing author normalization.",
        lastCanonicalEventId: latest.canonicalEventId,
        lastEventType: "communication.email.inbound",
      });
    }

    const detailByContactId = new Map<
      string,
      Awaited<ReturnType<typeof getInboxDetail>>
    >(
      await Promise.all(
        cases.map(async (entry) => {
          const detail = await getInboxDetail(entry.contactId);
          return [entry.contactId, detail] as const;
        }),
      ),
    );

    expect(
      detailByContactId.get("contact:normalized-last-first")?.timeline.at(-1),
    ).toMatchObject({ actorLabel: "Joe Rutledge" });
    expect(
      detailByContactId.get("contact:normalized-all-caps")?.timeline.at(-1),
    ).toMatchObject({ actorLabel: "Joe Rutledge" });
    expect(
      detailByContactId.get("contact:normalized-lowercase")?.timeline.at(-1),
    ).toMatchObject({ actorLabel: "Joe Rutledge" });
    expect(
      detailByContactId.get("contact:normalized-username")?.timeline.at(-1),
    ).toMatchObject({ actorLabel: "jrutle" });
  });

  it("uses a known sender contact record for inbound actor labels when the sender already exists", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:primary-thread",
      salesforceContactId: null,
      displayName: "Primary Thread",
      primaryEmail: "primary-thread@example.org",
      primaryPhone: null,
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:known-sender",
      salesforceContactId: null,
      displayName: "RUTLEDGE, JOE",
      primaryEmail: "joe.sender@example.org",
      primaryPhone: null,
    });
    await runtime.context.repositories.contactIdentities.upsert({
      id: "identity:known-sender-email",
      contactId: "contact:known-sender",
      kind: "email",
      normalizedValue: "joe.sender@example.org",
      isPrimary: true,
      source: "gmail",
      verifiedAt: null,
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "known-sender-inbound",
      contactId: "contact:primary-thread",
      occurredAt: "2026-04-23T13:00:00.000Z",
      direction: "inbound",
      subject: "Known sender",
      snippet: "Known sender body.",
      bodyTextPreview: "Known sender body.",
      fromHeader: "JOE RUTLEDGE <joe.sender@example.org>",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:primary-thread",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-23T13:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-23T13:00:00.000Z",
      snippet: "Known sender body.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:primary-thread");

    expect(detail?.timeline.at(-1)).toMatchObject({
      actorLabel: "Joe Rutledge",
    });
  });

  it("preserves Stage 1 timeline families instead of flattening them into generic system events", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "sarah-campaign-email-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-10T09:00:00.000Z",
      activityType: "sent",
      campaignName: "Spring Kickoff",
      snippet: "Welcome to the new field season.",
    });
    await seedInboxAutoEmailEvent(runtime.context, {
      id: "sarah-auto-email-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-11T09:00:00.000Z",
      subject: "Training confirmation",
      snippet: "You are confirmed for training.",
    });
    await seedInboxAutoSmsEvent(runtime.context, {
      id: "sarah-auto-sms-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-11T12:00:00.000Z",
      messageTextPreview: "Automated SMS reminder body",
    });
    await seedInboxCampaignSmsEvent(runtime.context, {
      id: "sarah-campaign-sms-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T09:00:00.000Z",
      campaignName: "Field Reminder",
      messageTextPreview: "Field reminder text",
    });
    await seedInboxInternalNoteEvent(runtime.context, {
      id: "sarah-note-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T12:00:00.000Z",
      body: "Prefers SMS check-ins before training.",
      authorDisplayName: "Jordan",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-lifecycle-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-09T09:00:00.000Z",
      eventType: "lifecycle.received_training",
      summary: "Received training materials",
      projectId: "project:amazon-basin",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail).not.toBeNull();
    expect(detail?.timeline.map((entry) => entry.kind)).toEqual([
      "system-event",
      "outbound-campaign-email",
      "outbound-auto-email",
      "outbound-auto-sms",
      "outbound-campaign-sms",
      "internal-note",
      "outbound-email",
      "inbound-email",
    ]);
    expect(detail?.timeline[1]).toMatchObject({
      kind: "outbound-campaign-email",
      subject: "Spring Kickoff",
      body: "Welcome to the new field season.",
    });
    expect(detail?.timeline[2]).toMatchObject({
      kind: "outbound-auto-email",
      subject: "Training confirmation",
      body: "You are confirmed for training.",
      isPreview: true,
    });
    expect(detail?.timeline[3]).toMatchObject({
      kind: "outbound-auto-sms",
      subject: null,
      body: "Automated SMS reminder body",
      isPreview: true,
    });
    expect(detail?.timeline[4]).toMatchObject({
      kind: "outbound-campaign-sms",
      subject: "Field reminder text",
      body: "Field reminder text",
      isPreview: true,
    });
    expect(detail?.timeline[5]).toMatchObject({
      kind: "internal-note",
      actorLabel: "Jordan",
      body: "Prefers SMS check-ins before training.",
    });
    expect(detail?.contact.recentActivity).toHaveLength(1);
    expect(detail?.contact.recentActivity[0]).toMatchObject({
      id: "timeline:sarah-lifecycle-1",
      label: "Received training - Amazon Basin Research",
      occurredAtLabel: "Apr 9",
    });
  });

  it("uses short project aliases in lifecycle timeline bodies and project activity labels", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:amazon-basin",
      projectName: "Amazon Basin Research",
      projectAlias: "Amazon Basin",
      source: "salesforce",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-lifecycle-alias",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-09T09:00:00.000Z",
      eventType: "lifecycle.received_training",
      summary: "Received training materials",
      projectId: "project:amazon-basin",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");
    const lifecycleEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-lifecycle-alias",
    );

    expect(lifecycleEntry).toMatchObject({
      kind: "system-event",
      body: "Received training for Amazon Basin",
    });
    expect(detail?.contact.recentActivity).toMatchObject([
      {
        label: "Received training - Amazon Basin",
      },
    ]);
  });

  it("builds right-rail lifecycle activity newest-first within the active project", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-signed-up",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-08T09:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-received-training",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-09T09:00:00.000Z",
      eventType: "lifecycle.received_training",
      summary: "Received training",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-completed-training",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-10T09:00:00.000Z",
      eventType: "lifecycle.completed_training",
      summary: "Completed training",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-submitted-first-data",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-11T09:00:00.000Z",
      eventType: "lifecycle.submitted_first_data",
      summary: "Submitted first data",
      projectId: "project:amazon-basin",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail?.contact.recentActivity.map((entry) => entry.label)).toEqual([
      "Submitted first data - Amazon Basin Research",
      "Completed training - Amazon Basin Research",
      "Received training - Amazon Basin Research",
      "Signed up - Amazon Basin Research",
    ]);
    expect(
      detail?.contact.recentActivity.map((entry) => entry.occurredAtLabel),
    ).toEqual(["Apr 11", "Apr 10", "Apr 9", "Apr 8"]);
    expect(
      detail?.contact.recentActivity.map((entry) => entry.isMostRecent),
    ).toEqual([true, false, false, false]);
  });

  it("returns all lifecycle activity items and does not hard-cap the rail feed at five", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-activity-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-06T09:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-activity-2",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-07T09:00:00.000Z",
      eventType: "lifecycle.received_training",
      summary: "Received training",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-activity-3",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-08T09:00:00.000Z",
      eventType: "lifecycle.completed_training",
      summary: "Completed training",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-activity-4",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-09T09:00:00.000Z",
      eventType: "lifecycle.submitted_first_data",
      summary: "Submitted first data",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-activity-5",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-10T09:00:00.000Z",
      eventType: "lifecycle.received_training",
      summary: "Received training",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-activity-6",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-11T09:00:00.000Z",
      eventType: "lifecycle.completed_training",
      summary: "Completed training",
      projectId: "project:amazon-basin",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail?.contact.recentActivity).toHaveLength(6);
    expect(detail?.contact.recentActivity.map((entry) => entry.label)).toEqual([
      "Completed training - Amazon Basin Research",
      "Received training - Amazon Basin Research",
      "Submitted first data - Amazon Basin Research",
      "Completed training - Amazon Basin Research",
      "Received training - Amazon Basin Research",
      "Signed up - Amazon Basin Research",
    ]);
  });

  it("shows only the lifecycle milestones that exist for a contact", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-partial-signed-up",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-08T09:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-partial-completed-training",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-10T09:00:00.000Z",
      eventType: "lifecycle.completed_training",
      summary: "Completed training",
      projectId: "project:amazon-basin",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail?.contact.recentActivity.map((entry) => entry.label)).toEqual([
      "Completed training - Amazon Basin Research",
      "Signed up - Amazon Basin Research",
    ]);
  });

  it("orders lifecycle events by UTC day desc + canonical ordinal asc within day, faithful to SF cross-day timestamps", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxLifecycleEvent(runtime.context, {
      id: "heidi-received-training",
      contactId: "contact:sarah-martinez",
      occurredAt: "2025-10-27T12:00:00.000Z",
      eventType: "lifecycle.received_training",
      summary: "Received training",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "heidi-completed-training",
      contactId: "contact:sarah-martinez",
      occurredAt: "2025-10-27T16:00:00.000Z",
      eventType: "lifecycle.completed_training",
      summary: "Completed training",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "heidi-signed-up",
      contactId: "contact:sarah-martinez",
      occurredAt: "2025-10-28T00:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "heidi-first-data",
      contactId: "contact:sarah-martinez",
      occurredAt: "2025-11-21T12:00:00.000Z",
      eventType: "lifecycle.submitted_first_data",
      summary: "Submitted first data",
      projectId: "project:amazon-basin",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");

    // Cross-day order is faithful to SF timestamps (SF anomaly: training stamped
    // before signup). Within the Oct 27 group, both training events share a
    // UTC day so they sort by canonical ordinal asc (received before completed).
    expect(detail?.contact.recentActivity.map((entry) => entry.label)).toEqual([
      "Submitted first data - Amazon Basin Research",
      "Signed up - Amazon Basin Research",
      "Received training - Amazon Basin Research",
      "Completed training - Amazon Basin Research",
    ]);
  });

  it("uses canonical lifecycle order for milestones that share the same UTC day in both rail and timeline", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxLifecycleEvent(runtime.context, {
      id: "same-day-received-training",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-08T09:00:00.000Z",
      eventType: "lifecycle.received_training",
      summary: "Received training",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "same-day-signed-up",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-08T17:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:amazon-basin",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "same-day-completed-training",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-09T08:00:00.000Z",
      eventType: "lifecycle.completed_training",
      summary: "Completed training",
      projectId: "project:amazon-basin",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail?.contact.recentActivity.map((entry) => entry.label)).toEqual([
      "Completed training - Amazon Basin Research",
      "Signed up - Amazon Basin Research",
      "Received training - Amazon Basin Research",
    ]);
    // Filter to lifecycle pills only — the shared runtime seeds non-lifecycle
    // sarah events that are unrelated to this same-day-canonical-order check.
    expect(
      detail?.timeline
        .filter((entry) => entry.kind === "system-event")
        .map((entry) => entry.id),
    ).toEqual([
      "timeline:same-day-signed-up",
      "timeline:same-day-received-training",
      "timeline:same-day-completed-training",
    ]);
  });

  it("formats lifecycle rail dates by UTC calendar day to avoid midnight drift", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-midnight-lifecycle",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-09T00:00:00.000Z",
      eventType: "lifecycle.received_training",
      summary: "Received training",
      projectId: "project:amazon-basin",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail?.contact.recentActivity).toMatchObject([
      {
        label: "Received training - Amazon Basin Research",
        occurredAtLabel: "Apr 9",
      },
    ]);
  });

  it("falls back to expeditionName when projectName is unavailable", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.repositories.expeditionDimensions.upsert({
      expeditionId: "expedition:amazon-fallback",
      projectId: null,
      expeditionName: "Amazon Basin Expedition",
      source: "salesforce",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-expedition-only",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-10T09:00:00.000Z",
      eventType: "lifecycle.completed_training",
      summary: "Completed training",
      expeditionId: "expedition:amazon-fallback",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail?.contact.recentActivity).toMatchObject([
      {
        label: "Completed training - Amazon Basin Expedition",
      },
    ]);
  });

  it("renders the milestone alone when lifecycle activity has no project context", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxLifecycleEvent(runtime.context, {
      id: "sarah-no-context",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-10T09:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail?.contact.recentActivity).toMatchObject([
      {
        label: "Signed up",
      },
    ]);
  });

  it("shows an empty project-activity state for non-volunteer contacts without lifecycle events", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxEmailOnlyContact(runtime, {
      contactId: "contact:morgan-sponsor",
      displayName: "Morgan Sponsor",
      salesforceContactId: null,
      subject: "Sponsorship follow-up",
      snippet: "Checking on the sponsorship paperwork timeline.",
      occurredAt: "2026-04-15T10:00:00.000Z",
    });

    const detail = await getInboxDetail("contact:morgan-sponsor");
    if (detail === null) {
      throw new Error("Expected inbox detail for non-volunteer contact");
    }

    expect(detail.contact.recentActivity).toEqual([]);
    expect(detail.contact.volunteerId).toEqual("contact:morgan-sponsor");
    expect(
      renderToStaticMarkup(
        createElement(InboxContactRail, {
          contact: detail.contact,
        }),
      ),
    ).toContain("No project activity recorded.");
  });

  it("highlights the most recent project-activity dot and date in the rail", async () => {
    const detail = await getInboxDetail("contact:sarah-martinez");

    if (detail === null) {
      throw new Error("Expected inbox detail for Sarah Martinez");
    }

    const markup = renderToStaticMarkup(
      createElement(InboxContactRail, {
        contact: {
          ...detail.contact,
          recentActivity: [
            {
              id: "recent-1",
              label: "Signed up - Amazon Basin",
              occurredAtLabel: "Apr 8",
            },
            {
              id: "recent-2",
              label: "Submitted first data - Amazon Basin",
              occurredAtLabel: "Apr 11",
              isMostRecent: true,
            },
          ],
        },
      }),
    );

    expect(markup).toContain("border-sky-500 bg-sky-500");
    expect(markup).toContain("text-[11px] text-slate-700");
    expect(markup).toContain("text-[11px] text-slate-400");
  });

  it("does not borrow email or campaign timeline entries when no lifecycle activity exists", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "lisa-campaign-email-1",
      contactId: "contact:lisa-zhang",
      occurredAt: "2026-04-15T09:00:00.000Z",
      activityType: "opened",
      campaignName: "Spring Kickoff",
      snippet: "Opened the kickoff campaign.",
    });

    const detail = await getInboxDetail("contact:lisa-zhang");

    expect(
      detail?.timeline.some(
        (entry) => entry.kind === "outbound-campaign-email",
      ),
    ).toBe(true);
    expect(
      detail?.timeline.some((entry) => entry.kind === "outbound-email"),
    ).toBe(true);
    expect(detail?.contact.recentActivity).toEqual([]);
  });

  it("keeps Salesforce outbound email in the 1:1 contract unless canon explicitly marks it auto", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxSalesforceOutboundEmailEvent(runtime.context, {
      id: "sarah-salesforce-null-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-10T06:00:00.000Z",
      subject: "Logged Salesforce follow-up",
      snippet: "Logged Salesforce follow-up body.",
      messageKind: null,
    });
    await seedInboxSalesforceOutboundEmailEvent(runtime.context, {
      id: "sarah-salesforce-one-to-one-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-10T07:00:00.000Z",
      subject: "Explicit Salesforce one-to-one",
      snippet: "Explicit Salesforce one-to-one body.",
      messageKind: "one_to_one",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");
    const nullClassifiedEntry = detail?.timeline.find(
      (entry) => entry.subject === "Logged Salesforce follow-up",
    );
    const explicitOneToOneEntry = detail?.timeline.find(
      (entry) => entry.subject === "Explicit Salesforce one-to-one",
    );

    expect(nullClassifiedEntry).toMatchObject({
      kind: "outbound-email",
      actorLabel: "Adventure Scientists",
      channel: "email",
      body: "Logged Salesforce follow-up body.",
    });
    expect(explicitOneToOneEntry).toMatchObject({
      kind: "outbound-email",
      actorLabel: "Adventure Scientists",
      channel: "email",
      body: "Explicit Salesforce one-to-one body.",
    });
    expect(
      detail?.timeline
        .filter((entry) => entry.kind === "outbound-auto-email")
        .map((entry) => entry.subject),
    ).not.toEqual(
      expect.arrayContaining([
        "Logged Salesforce follow-up",
        "Explicit Salesforce one-to-one",
      ]),
    );
  });

  it("keeps Salesforce-backed list subjects aligned with detail entries", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    const latestSalesforceEvent = await seedInboxSalesforceOutboundEmailEvent(
      runtime.context,
      {
        id: "sarah-salesforce-latest",
        contactId: "contact:sarah-martinez",
        occurredAt: "2026-04-15T08:00:00.000Z",
        subject: "Logged Salesforce follow-up",
        snippet: "Logged Salesforce follow-up body.",
        messageKind: "one_to_one",
      },
    );

    await seedInboxProjection(runtime.context, {
      contactId: "contact:sarah-martinez",
      bucket: "Opened",
      needsFollowUp: true,
      hasUnresolved: false,
      lastInboundAt: "2026-04-14T13:00:00.000Z",
      lastOutboundAt: "2026-04-15T08:00:00.000Z",
      lastActivityAt: "2026-04-15T08:00:00.000Z",
      snippet: "Logged Salesforce follow-up body.",
      lastCanonicalEventId: latestSalesforceEvent.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const list = await getInboxList();
    const detail = await getInboxDetail("contact:sarah-martinez");
    const row = list.items.find(
      (item) => item.contactId === "contact:sarah-martinez",
    );
    const entry = detail?.timeline.find(
      (timelineEntry) =>
        timelineEntry.subject === "Logged Salesforce follow-up",
    );

    expect(row).toMatchObject({
      latestSubject: "Logged Salesforce follow-up",
      snippet: "Logged Salesforce follow-up body.",
    });
    expect(entry).toMatchObject({
      kind: "outbound-email",
      body: "Logged Salesforce follow-up body.",
      isPreview: true,
    });
  });

  it("sanitizes legacy Salesforce email previews and uses the inbox projection as the newest-entry fallback", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    const latestLegacyEvent = await seedInboxLegacySalesforceOutboundEmailEvent(
      runtime.context,
      {
        id: "sarah-salesforce-legacy-latest",
        contactId: "contact:sarah-martinez",
        occurredAt: "2026-04-15T09:00:00.000Z",
        messageKind: null,
      },
    );
    await seedInboxLegacySalesforceOutboundEmailEvent(runtime.context, {
      id: "sarah-salesforce-legacy-older",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-15T08:00:00.000Z",
      messageKind: null,
    });

    await seedInboxProjection(runtime.context, {
      contactId: "contact:sarah-martinez",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-14T13:00:00.000Z",
      lastOutboundAt: "2026-04-15T09:00:00.000Z",
      lastActivityAt: "2026-04-15T09:00:00.000Z",
      snippet: [
        "From: sarah@example.org",
        "Recipients: alison@example.org",
        "",
        "Subject: Re: Field schedule",
        "Body:",
        "Here is the updated field schedule.",
        "",
        "On Tue, Apr 15, 2026 at 7:00 AM Alison Example wrote:",
        "> Prior thread content",
      ].join("\n"),
      lastCanonicalEventId: latestLegacyEvent.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const list = await getInboxList();
    const detail = await getInboxDetail("contact:sarah-martinez");
    const row = list.items.find(
      (item) => item.contactId === "contact:sarah-martinez",
    );
    const latestLegacyEntry = detail?.timeline.find(
      (entry) => entry.subject === "Re: Field schedule",
    );
    const activityEntries =
      detail?.timeline.filter((entry) => entry.kind === "email-activity") ?? [];

    expect(row).toMatchObject({
      latestSubject: "Re: Field schedule",
      snippet: "Here is the updated field schedule.",
    });
    expect(latestLegacyEntry).toMatchObject({
      kind: "inbound-email",
      subject: "Re: Field schedule",
      body: "Here is the updated field schedule.",
    });
    expect(activityEntries.at(-1)).toMatchObject({
      kind: "email-activity",
      subject: null,
      body: "Email body not cached - open in Salesforce",
    });
  });

  it("strips html-heavy projection snippets instead of rendering raw tags in the inbox list", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:alice-preview",
      salesforceContactId: "003-alice-preview",
      displayName: "Alice Preview",
      primaryEmail: "alice@example.org",
      primaryPhone: null,
    });
    const latestLegacyEvent = await seedInboxLegacySalesforceOutboundEmailEvent(
      runtime.context,
      {
        id: "alice-salesforce-legacy-html",
        contactId: "contact:alice-preview",
        occurredAt: "2026-04-16T09:00:00.000Z",
        messageKind: null,
      },
    );
    await seedInboxProjection(runtime.context, {
      contactId: "contact:alice-preview",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      // PR #329: Inbox default scope requires lastInboundAt IS NOT NULL.
      // Synthesize an older inbound timestamp so this snippet-rendering
      // fixture appears in the inbox list. The outbound stays the latest.
      lastInboundAt: "2026-04-15T00:00:00.000Z",
      lastOutboundAt: "2026-04-16T09:00:00.000Z",
      lastActivityAt: "2026-04-16T09:00:00.000Z",
      snippet:
        '<p><span style="font-size: 14px;">Hi Alice,</span></p><p><span style="font-size: 14px;">Thanks for jumping in to help with training.</span></p>',
      lastCanonicalEventId: latestLegacyEvent.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const list = await getInboxList();
    const detail = await getInboxDetail("contact:alice-preview");
    const row = list.items.find(
      (item) => item.contactId === "contact:alice-preview",
    );
    const latestEntry = detail?.timeline.at(-1);

    expect(row).toMatchObject({
      latestSubject: "Outbound email sent",
      snippet: "Hi Alice,\nThanks for jumping in to help with training.",
    });
    expect(latestEntry).toMatchObject({
      kind: "email-activity",
      body: "Hi Alice,\nThanks for jumping in to help with training.",
    });
  });

  it("strips multi-dash MIME boundaries from projection snippet fallbacks", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:alice-mime-boundary",
      salesforceContactId: "003-alice-mime-boundary",
      displayName: "Alice Mime Boundary",
      primaryEmail: "alice.mime@example.org",
      primaryPhone: null,
    });
    const latestLegacyEvent = await seedInboxLegacySalesforceOutboundEmailEvent(
      runtime.context,
      {
        id: "alice-salesforce-legacy-mime-boundary",
        contactId: "contact:alice-mime-boundary",
        occurredAt: "2026-04-16T10:00:00.000Z",
        messageKind: null,
      },
    );
    await seedInboxProjection(runtime.context, {
      contactId: "contact:alice-mime-boundary",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      // PR #329: see lisa-zhang note above.
      lastInboundAt: "2026-04-15T00:00:00.000Z",
      lastOutboundAt: "2026-04-16T10:00:00.000Z",
      lastActivityAt: "2026-04-16T10:00:00.000Z",
      snippet: [
        "------=_Part_2324998_585856288.1775021416555",
        "rest of body",
      ].join("\n"),
      lastCanonicalEventId: latestLegacyEvent.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const list = await getInboxList();
    const detail = await getInboxDetail("contact:alice-mime-boundary");
    const row = list.items.find(
      (item) => item.contactId === "contact:alice-mime-boundary",
    );
    const latestEntry = detail?.timeline.at(-1);

    expect(row).toMatchObject({
      snippet: "rest of body",
    });
    expect(latestEntry).toMatchObject({
      kind: "email-activity",
      body: "rest of body",
    });
  });

  it("prefers Gmail clean body previews over noisier projection snippets so Maria stays aligned between list and detail", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:maria-gmail",
      salesforceContactId: "003-maria-gmail",
      displayName: "Maria Ortega",
      primaryEmail: "maria@example.org",
      primaryPhone: null,
    });
    const latestMariaEvent = await seedInboxEmailEvent(runtime.context, {
      id: "maria-gmail-latest",
      contactId: "contact:maria-gmail",
      occurredAt: "2026-04-16T11:00:00.000Z",
      direction: "inbound",
      subject: "Re: Glacier field training",
      snippet: "Projection fallback should not win.",
      snippetClean: "Projection fallback should not win.",
      bodyTextPreview: "Hi team,\nI can make the glacier training after all.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:maria-gmail",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-16T11:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-16T11:00:00.000Z",
      snippet: [
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "Hi Maria=2C older projection fallback",
        "",
        "On Tue, Apr 16, 2026 at 9:00 AM Alison Example wrote:",
        "> Earlier thread",
      ].join("\n"),
      lastCanonicalEventId: latestMariaEvent.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const list = await getInboxList();
    const detail = await getInboxDetail("contact:maria-gmail");
    const row = list.items.find(
      (item) => item.contactId === "contact:maria-gmail",
    );
    const latestEntry = detail?.timeline.at(-1);

    expect(row).toMatchObject({
      latestSubject: "Re: Glacier field training",
      snippet: "Hi team,\nI can make the glacier training after all.",
    });
    expect(latestEntry).toMatchObject({
      kind: "inbound-email",
      subject: "Re: Glacier field training",
      body: "Hi team,\nI can make the glacier training after all.",
      isUnread: true,
    });
  });

  it("consistently crops inline quoted-reply markers in timeline email bodies", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:inline-quote",
      salesforceContactId: "003-inline-quote",
      displayName: "Inline Quote",
      primaryEmail: "inline.quote@example.org",
      primaryPhone: null,
    });
    const latestEvent = await seedInboxEmailEvent(runtime.context, {
      id: "inline-quote-latest",
      contactId: "contact:inline-quote",
      occurredAt: "2026-04-25T16:30:00.000Z",
      direction: "inbound",
      subject: "Re: Field packet",
      snippet: "Thanks for sending this.",
      bodyTextPreview: [
        "Thanks for sending this.",
        "",
        "On 2026-04-25 at 10:00 AM, Alison Example wrote:",
        "> Original field packet details",
      ].join("\n"),
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:inline-quote",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-25T16:30:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-25T16:30:00.000Z",
      snippet: "Thanks for sending this.",
      lastCanonicalEventId: latestEvent.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:inline-quote");
    const latestEntry = detail?.timeline.at(-1);

    expect(latestEntry).toMatchObject({
      kind: "inbound-email",
      body: "Thanks for sending this.",
    });
  });

  it("skips encrypted placeholder bodies when deriving composer reply context", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:encrypted-reply",
      salesforceContactId: "003-encrypted-reply",
      displayName: "Steve Negri",
      primaryEmail: "steve.negri@tetratech.com",
      primaryPhone: null,
    });

    await seedInboxEmailEvent(runtime.context, {
      id: "encrypted-reply-older",
      contactId: "contact:encrypted-reply",
      occurredAt: "2026-04-16T10:00:00.000Z",
      direction: "inbound",
      subject: "Re: Project check-in",
      snippet: "Older plaintext inbound",
      bodyTextPreview: "Here are the field updates you asked for.",
    });
    const latestEncryptedEvent = await seedInboxEmailEvent(runtime.context, {
      id: "encrypted-reply-latest",
      contactId: "contact:encrypted-reply",
      occurredAt: "2026-04-16T11:00:00.000Z",
      direction: "inbound",
      subject: "Re: Project check-in",
      snippet: "[Encrypted message — open in Gmail to read]",
      bodyTextPreview: "[Encrypted message — open in Gmail to read]",
      bodyKind: "encrypted_placeholder",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:encrypted-reply",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-16T11:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-16T11:00:00.000Z",
      snippet: "[Encrypted message — open in Gmail to read]",
      lastCanonicalEventId: latestEncryptedEvent.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:encrypted-reply");

    expect(detail?.timeline.at(-1)).toMatchObject({
      kind: "inbound-email",
      body: "[Encrypted message — open in Gmail to read]",
    });
    expect(detail?.composerReplyContext).toMatchObject({
      subject: "Re: Project check-in",
      threadCursor: "event:encrypted-reply-older",
      inReplyToRfc822: "<encrypted-reply-latest@example.org>",
    });
  });

  it("skips short garbled Gmail bodies and renders the readable snippet instead", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:short-garbled",
      salesforceContactId: "003-short-garbled",
      displayName: "Joe Rutledge",
      primaryEmail: "joe@example.org",
      primaryPhone: null,
    });

    const latestEvent = await seedInboxEmailEvent(runtime.context, {
      id: "short-garbled-latest",
      contactId: "contact:short-garbled",
      occurredAt: "2026-04-30T16:31:58.000Z",
      direction: "inbound",
      subject: "Re: Placement completed 28 April",
      snippet: "Thanks. Will work on this. May take a day or two",
      snippetClean: "Thanks. Will work on this. May take a day or two",
      bodyTextPreview: "�٥�杙�Z��iz�����w/�i",
      bodyKind: "plaintext",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:short-garbled",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-30T16:31:58.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-30T16:31:58.000Z",
      snippet: "Thanks. Will work on this. May take a day or two",
      lastCanonicalEventId: latestEvent.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:short-garbled");

    expect(detail?.timeline.at(-1)).toMatchObject({
      kind: "inbound-email",
      body: "Thanks. Will work on this. May take a day or two",
    });
  });

  it("falls back to provider communication details before projection snippets for Salesforce-backed latest rows", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:maria-salesforce",
      salesforceContactId: "003-maria-salesforce",
      displayName: "Maria Santos",
      primaryEmail: "maria.santos@example.org",
      primaryPhone: null,
    });
    const latestSalesforceEvent = await seedInboxSalesforceOutboundEmailEvent(
      runtime.context,
      {
        id: "maria-salesforce-latest",
        contactId: "contact:maria-salesforce",
        occurredAt: "2026-04-16T12:00:00.000Z",
        subject: "Field schedule update",
        snippet: "Here is the clean Salesforce body for Maria.",
        messageKind: "one_to_one",
      },
    );
    await seedInboxProjection(runtime.context, {
      contactId: "contact:maria-salesforce",
      bucket: "Opened",
      needsFollowUp: true,
      hasUnresolved: false,
      // PR #329: see lisa-zhang note above.
      lastInboundAt: "2026-04-15T00:00:00.000Z",
      lastOutboundAt: "2026-04-16T12:00:00.000Z",
      lastActivityAt: "2026-04-16T12:00:00.000Z",
      snippet: [
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: quoted-printable",
      ].join("\n"),
      lastCanonicalEventId: latestSalesforceEvent.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const list = await getInboxList();
    const detail = await getInboxDetail("contact:maria-salesforce");
    const row = list.items.find(
      (item) => item.contactId === "contact:maria-salesforce",
    );
    const latestEntry = detail?.timeline.at(-1);

    expect(row).toMatchObject({
      latestSubject: "Field schedule update",
      snippet: "Here is the clean Salesforce body for Maria.",
    });
    expect(latestEntry).toMatchObject({
      kind: "outbound-email",
      subject: "Field schedule update",
      body: "Here is the clean Salesforce body for Maria.",
    });
  });

  it("shows an informative fallback when a Salesforce 1:1 email has no cached body", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:maria-no-body",
      salesforceContactId: "003-maria-no-body",
      displayName: "Maria No Body",
      primaryEmail: "maria.nobody@example.org",
      primaryPhone: null,
    });
    const latestSalesforceEvent = await seedInboxSalesforceOutboundEmailEvent(
      runtime.context,
      {
        id: "maria-no-body-latest",
        contactId: "contact:maria-no-body",
        occurredAt: "2026-04-16T12:30:00.000Z",
        subject: "Volunteer onboarding details",
        snippet: "",
        messageKind: "one_to_one",
      },
    );
    await runtime.context.repositories.timelineProjection.upsert({
      id: "timeline:maria-no-body-latest",
      contactId: "contact:maria-no-body",
      canonicalEventId: latestSalesforceEvent.canonicalEventId,
      occurredAt: "2026-04-16T12:30:00.000Z",
      sortKey: "2026-04-16T12:30:00.000Z::event:maria-no-body-latest",
      eventType: "communication.email.outbound",
      summary: "Outbound Email Sent",
      channel: "email",
      primaryProvider: "salesforce",
      reviewState: "clear",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:maria-no-body",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-04-16T12:30:00.000Z",
      lastActivityAt: "2026-04-16T12:30:00.000Z",
      snippet: "",
      lastCanonicalEventId: latestSalesforceEvent.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const detail = await getInboxDetail("contact:maria-no-body");
    const latestEntry = detail?.timeline.at(-1);

    expect(latestEntry).toMatchObject({
      kind: "outbound-email",
      subject: "Volunteer onboarding details",
      body: "Email body not cached - open in Salesforce",
    });
  });

  it("strips quoted-printable junk and forwarded header blocks from legacy projection fallbacks without trying to recover the forwarded chain", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:maria-legacy",
      salesforceContactId: "003-maria-legacy",
      displayName: "Maria Legacy",
      primaryEmail: "maria.legacy@example.org",
      primaryPhone: null,
    });
    const latestLegacyEvent = await seedInboxLegacySalesforceOutboundEmailEvent(
      runtime.context,
      {
        id: "maria-legacy-latest",
        contactId: "contact:maria-legacy",
        occurredAt: "2026-04-16T13:00:00.000Z",
        messageKind: null,
      },
    );
    await seedInboxProjection(runtime.context, {
      contactId: "contact:maria-legacy",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      // PR #329: see lisa-zhang note above.
      lastInboundAt: "2026-04-15T00:00:00.000Z",
      lastOutboundAt: "2026-04-16T13:00:00.000Z",
      lastActivityAt: "2026-04-16T13:00:00.000Z",
      snippet: [
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "Hi Maria=2C thanks for jumping in.=0AI'll follow up tomorrow.=0A=0AFrom: Alison Example <alison@example.org>",
        "To: Maria Legacy <maria.legacy@example.org>",
        "Subject: Re: Desert field plan",
      ].join("\n"),
      lastCanonicalEventId: latestLegacyEvent.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const list = await getInboxList();
    const detail = await getInboxDetail("contact:maria-legacy");
    const row = list.items.find(
      (item) => item.contactId === "contact:maria-legacy",
    );
    const latestEntry = detail?.timeline.at(-1);

    expect(row).toMatchObject({
      latestSubject: "Re: Desert field plan",
      snippet: "Hi Maria, thanks for jumping in.\nI'll follow up tomorrow.",
    });
    expect(latestEntry).toMatchObject({
      kind: "email-activity",
      subject: "Re: Desert field plan",
      body: "Hi Maria, thanks for jumping in.\nI'll follow up tomorrow.",
    });
  });

  it("prefers campaign name for campaign email headlines while keeping the expanded body", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "sarah-campaign-email-structured",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T15:00:00.000Z",
      activityType: "sent",
      campaignName: "April Volunteer Update",
      snippet: [
        "From: volunteers@example.org",
        "To: sarah@example.org",
        "",
        "Subject: April field update",
        "Body:",
        "Hi Sarah,",
        "Please bring your field notebook.",
        "",
        "Forwarded message:",
        "From: Older campaign thread",
      ].join("\n"),
    });

    const detail = await getInboxDetail("contact:sarah-martinez");
    const campaignEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-campaign-email-structured",
    );

    expect(campaignEntry).toMatchObject({
      kind: "outbound-campaign-email",
      subject: "April Volunteer Update",
      body: "Hi Sarah,\nPlease bring your field notebook.",
      isPreview: true,
      campaignActivity: [],
    });
  });

  it("surfaces opened and clicked metadata on consolidated campaign email rows while keeping the sent body", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "sarah-campaign-email-consolidated-sent",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T15:00:00.000Z",
      activityType: "sent",
      campaignId: "campaign:april-field-update",
      campaignName: "April Volunteer Update",
      snippet: [
        "From: volunteers@example.org",
        "To: sarah@example.org",
        "",
        "Subject: April field update",
        "Body:",
        "Hi Sarah,",
        "Please bring your field notebook.",
      ].join("\n"),
    });
    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "sarah-campaign-email-consolidated-opened",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T16:00:00.000Z",
      activityType: "opened",
      campaignId: "campaign:april-field-update",
      campaignName: "April Volunteer Update",
      snippet: "Campaign opened",
    });
    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "sarah-campaign-email-consolidated-clicked",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T16:30:00.000Z",
      activityType: "clicked",
      campaignId: "campaign:april-field-update",
      campaignName: "April Volunteer Update",
      snippet: "https://example.org/register",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");
    const campaignEntries =
      detail?.timeline.filter(
        (entry) =>
          entry.kind === "outbound-campaign-email" &&
          entry.subject === "April Volunteer Update",
      ) ?? [];

    expect(campaignEntries).toHaveLength(1);
    expect(campaignEntries[0]).toMatchObject({
      kind: "outbound-campaign-email",
      subject: "April Volunteer Update",
      body: "Hi Sarah,\nPlease bring your field notebook.",
    });
    expect(
      campaignEntries[0]?.campaignActivity.map(
        (activity) => activity.activityType,
      ),
    ).toEqual(["opened", "clicked"]);
  });

  it("falls back to stripped campaign subjects when no campaign name exists", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxAutoEmailEvent(runtime.context, {
      id: "sarah-auto-email-prefixed",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T15:30:00.000Z",
      subject: "→ Email: Re: still time to get involved?",
      snippet: "Checking in before the training window closes.",
    });
    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "sarah-campaign-email-arrow-ascii",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T15:45:00.000Z",
      activityType: "sent",
      campaignName: null,
      snippet: [
        "From: volunteers@example.org",
        "To: sarah@example.org",
        "",
        "Subject: -> Email: Last Call: PNW Training",
        "Body:",
        "Please confirm your attendance today.",
      ].join("\n"),
    });
    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "sarah-campaign-email-arrow-entity",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T15:50:00.000Z",
      activityType: "sent",
      campaignName: null,
      snippet: [
        "From: volunteers@example.org",
        "To: sarah@example.org",
        "",
        "Subject: &rarr; Email: Weekly Digest",
        "Body:",
        "A quick recap from this week.",
      ].join("\n"),
    });
    await seedInboxAutoEmailEvent(runtime.context, {
      id: "sarah-auto-email-bare-prefix",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T15:55:00.000Z",
      subject:
        "Email: Aplicacion en Revision: Monitoreo y Restauracion de Arrecifes de Coral",
      snippet: "Coral project review workflow.",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");
    const autoEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-auto-email-prefixed",
    );
    const asciiCampaignEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-campaign-email-arrow-ascii",
    );
    const entityCampaignEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-campaign-email-arrow-entity",
    );
    const barePrefixAutoEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-auto-email-bare-prefix",
    );

    expect(autoEntry).toMatchObject({
      kind: "outbound-auto-email",
      subject: "Re: still time to get involved?",
    });
    expect(asciiCampaignEntry).toMatchObject({
      kind: "outbound-campaign-email",
      subject: "Last Call: PNW Training",
    });
    expect(entityCampaignEntry).toMatchObject({
      kind: "outbound-campaign-email",
      subject: "Weekly Digest",
    });
    expect(barePrefixAutoEntry).toMatchObject({
      kind: "outbound-auto-email",
      subject:
        "Aplicacion en Revision: Monitoreo y Restauracion de Arrecifes de Coral",
    });
  });

  it("hides unusable automated and campaign email fallback subjects while keeping meaningful body and embedded URLs", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    const zoomUrl =
      "https://us02web.zoom.us/webinar/register/WN_BrC0DjiqS36ei74Vhtg7sw";

    await seedInboxAutoEmailEvent(runtime.context, {
      id: "sarah-auto-email-url-subject",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T16:05:00.000Z",
      subject: zoomUrl,
      snippet: `Body:\n${zoomUrl}`,
    });
    await seedInboxAutoEmailEvent(runtime.context, {
      id: "sarah-auto-email-embedded-url",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T16:10:00.000Z",
      subject: `Register here: ${zoomUrl}`,
      snippet: "Sharing the registration link for next week's webinar.",
    });
    await seedInboxAutoEmailEvent(runtime.context, {
      id: "sarah-auto-email-empty-after-prefix",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T16:15:00.000Z",
      subject: "→ Email:    ",
      snippet: "The automation body still needs to render.",
    });
    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "sarah-campaign-email-url-subject",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T16:20:00.000Z",
      activityType: "sent",
      campaignName: null,
      snippet: [
        "From: volunteers@example.org",
        "To: sarah@example.org",
        "",
        `Subject: ${zoomUrl}`,
        "Body:",
        zoomUrl,
      ].join("\n"),
    });
    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "sarah-campaign-email-no-subject",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T16:25:00.000Z",
      activityType: "sent",
      campaignName: null,
      snippet: "Welcome to the new field season.",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");
    const autoUrlEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-auto-email-url-subject",
    );
    const autoEmbeddedUrlEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-auto-email-embedded-url",
    );
    const autoEmptyEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-auto-email-empty-after-prefix",
    );
    const campaignUrlEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-campaign-email-url-subject",
    );
    const campaignNoSubjectEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-campaign-email-no-subject",
    );

    expect(autoUrlEntry).toMatchObject({
      kind: "outbound-auto-email",
      subject: null,
      body: zoomUrl,
    });
    expect(autoEmbeddedUrlEntry).toMatchObject({
      kind: "outbound-auto-email",
      subject: `Register here: ${zoomUrl}`,
    });
    expect(autoEmptyEntry).toMatchObject({
      kind: "outbound-auto-email",
      subject: null,
      body: "The automation body still needs to render.",
    });
    expect(campaignUrlEntry).toMatchObject({
      kind: "outbound-campaign-email",
      subject: null,
      body: zoomUrl,
    });
    expect(campaignNoSubjectEntry).toMatchObject({
      kind: "outbound-campaign-email",
      subject: null,
      body: "Welcome to the new field season.",
    });
  });

  it("does not duplicate the campaign subject as the expanded body when no body content is cached", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "sarah-campaign-email-subject-only",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T16:00:00.000Z",
      activityType: "sent",
      campaignName: "April Volunteer Update",
      snippet: [
        "From: volunteers@example.org",
        "To: sarah@example.org",
        "",
        "Subject: April field update",
      ].join("\n"),
    });

    const detail = await getInboxDetail("contact:sarah-martinez");
    const campaignEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-campaign-email-subject-only",
    );

    expect(campaignEntry).toMatchObject({
      kind: "outbound-campaign-email",
      subject: "April Volunteer Update",
      body: "",
      isPreview: true,
    });
  });

  it("returns null for campaign email headlines when both campaign name and usable subject are missing", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "sarah-campaign-email-empty-fallback",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T16:30:00.000Z",
      activityType: "sent",
      campaignName: null,
      snippet: "Body:\nNo explicit subject here, only body copy.",
    });

    const detail = await getInboxDetail("contact:sarah-martinez");
    const campaignEntry = detail?.timeline.find(
      (entry) => entry.id === "timeline:sarah-campaign-email-empty-fallback",
    );

    expect(campaignEntry).toMatchObject({
      kind: "outbound-campaign-email",
      subject: null,
      body: "No explicit subject here, only body copy.",
    });
  });

  it("pages inbox rows and timeline history instead of loading full history by default", async () => {
    const firstPage = await getInboxList("inbox", {
      limit: 2,
    });

    expect(firstPage.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
      "contact:alex-thompson",
    ]);
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPage.page.nextCursor).not.toBeNull();

    const secondPage = await getInboxList("inbox", {
      limit: 2,
      cursor: firstPage.page.nextCursor,
    });

    expect(secondPage.items.map((item) => item.contactId)).toEqual([
      "contact:lisa-zhang",
    ]);
    expect(secondPage.page.hasMore).toBe(false);

    const detail = await getInboxDetail("contact:sarah-martinez", {
      timelineLimit: 1,
    });

    expect(detail?.timeline).toHaveLength(1);
    expect(detail?.timelinePage.hasMore).toBe(true);

    const olderPage = await getInboxTimelinePage("contact:sarah-martinez", {
      limit: 1,
      ...(detail?.timelinePage.nextCursor === undefined
        ? {}
        : { cursor: detail.timelinePage.nextCursor }),
    });

    expect(olderPage?.entries).toHaveLength(1);
    expect(olderPage?.entries[0]).toMatchObject({
      kind: "outbound-email",
      subject: "Amazon Basin equipment list",
    });
  });

  it("supports server-backed search beyond the initially loaded page", async () => {
    const searched = await getInboxList("inbox", {
      limit: 1,
      query: "Alex Thompson",
    });

    expect(searched.items).toHaveLength(1);
    expect(searched.items[0]).toMatchObject({
      contactId: "contact:alex-thompson",
      displayName: "Alex Thompson",
    });
    expect(searched.page.total).toBe(1);
    expect(searched.page.hasMore).toBe(false);
  });

  it("bypasses the inbox inbound-only scope while searching", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:search-only-outbound",
      salesforceContactId: null,
      displayName: "Search Only Outbound",
      primaryEmail: "search-only-outbound@example.org",
      primaryPhone: null,
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "search-only-outbound-email-1",
      contactId: "contact:search-only-outbound",
      occurredAt: "2026-04-28T12:00:00.000Z",
      direction: "outbound",
      subject: "Outbound-only profile",
      snippet: "This contact should only appear through search.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:search-only-outbound",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-04-28T12:00:00.000Z",
      lastActivityAt: "2026-04-28T12:00:00.000Z",
      snippet: "This contact should only appear through search.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const defaultList = await getInboxList("inbox");
    const searched = await getInboxList("inbox", {
      query: "Search Only Outbound",
    });

    expect(defaultList.items.map((item) => item.contactId)).not.toContain(
      "contact:search-only-outbound",
    );
    expect(searched.items.map((item) => item.contactId)).toContain(
      "contact:search-only-outbound",
    );
  });

  it("matches query terms across display name, email, project label, subject, and snippet", async () => {
    const byDisplayName = await getInboxList("inbox", {
      query: "Alex Thompson",
    });
    const byEmail = await getInboxList("inbox", {
      query: "sarah@example.org",
    });
    const bySubject = await getInboxList("inbox", {
      query: "Safety protocols",
    });
    const byProject = await getInboxList("inbox", {
      query: "Searching for Killer Whales",
    });
    const bySnippet = await getInboxList("inbox", {
      query: "weather",
    });
    const noMatch = await getInboxList("inbox", {
      query: "Michelle Neitzey",
    });

    expect(byDisplayName.items.map((item) => item.contactId)).toEqual([
      "contact:alex-thompson",
    ]);
    expect(byEmail.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
    ]);
    expect(bySubject.items.map((item) => item.contactId)).toEqual([
      "contact:lisa-zhang",
    ]);
    expect(byProject.items.map((item) => item.contactId)).toEqual([
      "contact:lisa-zhang",
    ]);
    expect(bySnippet.items.map((item) => item.contactId)).toEqual([
      "contact:alex-thompson",
    ]);
    expect(noMatch.items).toEqual([]);
    expect(noMatch.page.total).toBe(0);
    expect(noMatch.page.hasMore).toBe(false);
  });

  it("falls back to expedition names when project names are unavailable during search", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:expedition-only",
      salesforceContactId: "003-expedition-only",
      displayName: "Expedition Only",
      primaryEmail: "expedition-only@example.org",
      primaryPhone: null,
    });
    await runtime.context.repositories.expeditionDimensions.upsert({
      expeditionId: "expedition:amazon-fallback",
      projectId: null,
      expeditionName: "Amazon Basin Expedition",
      source: "salesforce",
    });
    await runtime.context.repositories.contactMemberships.upsert({
      id: "membership:expedition-only",
      contactId: "contact:expedition-only",
      projectId: null,
      expeditionId: "expedition:amazon-fallback",
      salesforceMembershipId: "membership:expedition-only:sf",
      role: "volunteer",
      status: "active",
      source: "salesforce",
      createdAt: "2026-04-15T12:00:00.000Z",
    });

    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "expedition-only-email-1",
      contactId: "contact:expedition-only",
      occurredAt: "2026-04-15T16:00:00.000Z",
      direction: "inbound",
      subject: "Expedition-only routing",
      snippet: "I only have expedition context on this contact.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:expedition-only",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-15T16:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-15T16:00:00.000Z",
      snippet: "I only have expedition context on this contact.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const searched = await getInboxList("inbox", {
      query: "Amazon Basin Expedition",
    });

    expect(searched.items.map((item) => item.contactId)).toEqual([
      "contact:expedition-only",
    ]);
  });

  it("composes search with unread and follow-up filters", async () => {
    const unread = await getInboxList("unread", {
      query: "sarah@example.org",
    });
    const followUp = await getInboxList("follow-up", {
      query: "Sarah",
    });
    expect(unread.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
    ]);
    expect(followUp.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
    ]);
  });

  it("restores paragraph breaks for flattened structured Salesforce email bodies", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:mylee-marques",
      salesforceContactId: "003-mylee-marques",
      displayName: "Mylee Marques",
      primaryEmail: "mylee@example.org",
      primaryPhone: null,
    });
    const latestSalesforceEvent = await seedInboxSalesforceOutboundEmailEvent(
      runtime.context,
      {
        id: "mylee-flattened-salesforce-body",
        contactId: "contact:mylee-marques",
        occurredAt: "2026-04-16T14:00:00.000Z",
        subject:
          "Email: Aplicacion en Revision: Monitoreo y Restauracion de Arrecifes de Coral",
        snippet: [
          "To: mylee@example.org",
          "",
          "Subject: Aplicacion en Revision: Monitoreo y Restauracion de Arrecifes de Coral",
          "Body:",
          "Hola Mylee,Gracias por aplicar al Proyecto de Monitoreo y Restauracion de Arrecifes de Coral. ¡Estamos emocionados de tenerte a bordo en esta aventura unica!Esta iniciativa multinacional es la primera de su tipo en America Latina en emplear ciencia ciudadana y protocolos de monitoreo globales para generar datos estandarizados y de alta calidad sobre arrecifes de coral. El coordinador del proyecto en tu area estara revisando tu solicitud y, si es aprobada, se pondra en contacto contigo pronto para informarte sobre los siguientes pasos.en:Thank you for applying to the Coral Reef Monitoring and Restoration Project. We are excited for your interest in participating in this one of a kind adventure!This multi-country initiative is the first of its kind in Latin America to employ citizen science and global monitoring protocols to generate high-quality, standardized coral reef data. The project coordinator for your area will be reviewing your application, and if approved, they will be in touch soon about next steps.Saludos,Adventure Scientists",
        ].join("\n"),
        messageKind: "one_to_one",
      },
    );
    await seedInboxProjection(runtime.context, {
      contactId: "contact:mylee-marques",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-04-16T14:00:00.000Z",
      lastActivityAt: "2026-04-16T14:00:00.000Z",
      snippet: "Flattened Salesforce fallback should not win.",
      lastCanonicalEventId: latestSalesforceEvent.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });

    const detail = await getInboxDetail("contact:mylee-marques");
    const latestEntry = detail?.timeline.at(-1);

    expect(latestEntry).toMatchObject({
      kind: "outbound-email",
      body: [
        "Hola Mylee,",
        "",
        "Gracias por aplicar al Proyecto de Monitoreo y Restauracion de Arrecifes de Coral.",
        "",
        "¡Estamos emocionados de tenerte a bordo en esta aventura unica!",
        "",
        "Esta iniciativa multinacional es la primera de su tipo en America Latina en emplear ciencia ciudadana y protocolos de monitoreo globales para generar datos estandarizados y de alta calidad sobre arrecifes de coral.",
        "",
        "El coordinador del proyecto en tu area estara revisando tu solicitud y, si es aprobada, se pondra en contacto contigo pronto para informarte sobre los siguientes pasos.",
        "",
        "en:Thank you for applying to the Coral Reef Monitoring and Restoration Project.",
        "",
        "We are excited for your interest in participating in this one of a kind adventure!",
        "",
        "This multi-country initiative is the first of its kind in Latin America to employ citizen science and global monitoring protocols to generate high-quality, standardized coral reef data.",
        "",
        "The project coordinator for your area will be reviewing your application, and if approved, they will be in touch soon about next steps.",
      ].join("\n"),
    });
  });

  it("preserves inbound Salesforce bodies that begin with 'Thanks,'", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:shaina-dotson",
      salesforceContactId: "003-shaina-dotson",
      displayName: "Shaina Dotson",
      primaryEmail: "shaina.dotson@gmail.com",
      primaryPhone: null,
    });
    const latestSalesforceEvent = await seedInboxSalesforceOutboundEmailEvent(
      runtime.context,
      {
        id: "shaina-thanks-body",
        contactId: "contact:shaina-dotson",
        occurredAt: "2026-04-21T00:38:00.000Z",
        direction: "inbound",
        subject: "Re: Update on Hex 43191",
        snippet: [
          "Thanks, Ricky & Samantha! I didn't realize that all ARUs need to be placed by the end of June! Glad I'll still be able to claim a hex to retrieve later this summer. Thanks for all your help!",
          "",
          "Shaina",
        ].join("\n"),
        messageKind: "one_to_one",
      },
    );
    await seedInboxProjection(runtime.context, {
      contactId: "contact:shaina-dotson",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-21T00:38:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-21T00:38:00.000Z",
      snippet: "Shaina thanks-body preview",
      lastCanonicalEventId: latestSalesforceEvent.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    const detail = await getInboxDetail("contact:shaina-dotson");
    const latestEntry = detail?.timeline.at(-1);

    expect(latestEntry).toMatchObject({
      kind: "inbound-email",
      body: [
        "Thanks, Ricky & Samantha! I didn't realize that all ARUs need to be placed by the end of June! Glad I'll still be able to claim a hex to retrieve later this summer. Thanks for all your help!",
        "",
        "Shaina",
      ].join("\n"),
    });
  });

  it("strips signature fixtures without stripping inline closing phrases", () => {
    expect(
      stripSignature(
        [
          "Please review the attached scope update.",
          "---",
          "Adventure Scientists",
        ].join("\n"),
      ),
    ).toBe("Please review the attached scope update.");

    expect(
      stripSignature(
        [
          "Your document is ready for signature.",
          "Sent with DocuSeal Pro",
          "https://docuseal.com/e/example",
        ].join("\n"),
      ),
    ).toBe("Your document is ready for signature.");

    expect(
      stripSignature(
        [
          "We work with Seaside High School, Neah-kah-nie High School, and Northwest Academy.",
          "",
          "Best, Elise",
        ].join("\n"),
      ),
    ).toBe(
      "We work with Seaside High School, Neah-kah-nie High School, and Northwest Academy.",
    );

    expect(
      stripSignature(
        [
          "We are thrilled to have you in our pod and look forward to seeing where this project takes us, together.",
          "The Adventure Scientists Team",
        ].join("\n"),
      ),
    ).toBe(
      "We are thrilled to have you in our pod and look forward to seeing where this project takes us, together.",
    );

    expect(
      stripSignature(
        [
          "Got this point moved last week but did not email you that I did.",
          "",
          "Thanks,",
          "John",
        ].join("\n"),
      ),
    ).toBe("Got this point moved last week but did not email you that I did.");

    expect(
      stripSignature(
        "Best regards, Samantha mentioned the confirmation timing in the paragraph above.",
      ),
    ).toBe(
      "Best regards, Samantha mentioned the confirmation timing in the paragraph above.",
    );

    expect(
      stripSignature(
        [
          "Thanks, Ricky & Samantha! I didn't realize that all ARUs need to be placed by the end of June! Glad I'll still be able to claim a hex to retrieve later this summer. Thanks for all your help!",
          "",
          "Shaina",
        ].join("\n"),
      ),
    ).toBe(
      [
        "Thanks, Ricky & Samantha! I didn't realize that all ARUs need to be placed by the end of June! Glad I'll still be able to claim a hex to retrieve later this summer. Thanks for all your help!",
        "",
        "Shaina",
      ].join("\n"),
    );
  });

  it("treats an empty query as the default ordered inbox list", async () => {
    const defaultList = await getInboxList("inbox");
    const emptyQueryList = await getInboxList("inbox", {
      query: "   ",
    });

    expect(emptyQueryList.items.map((item) => item.contactId)).toEqual(
      defaultList.items.map((item) => item.contactId),
    );
    expect(emptyQueryList.page).toEqual(defaultList.page);
  });

  it("paginates search results while preserving recency order", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxEmailOnlyContact(runtime, {
      contactId: "contact:ridge-alpha",
      displayName: "Ridge Alpha",
      salesforceContactId: "003-ridge-alpha",
      subject: "Ridge weather update",
      snippet: "The ridge weather shifted again overnight.",
      occurredAt: "2026-04-15T18:00:00.000Z",
    });
    await seedInboxEmailOnlyContact(runtime, {
      contactId: "contact:ridge-beta",
      displayName: "Ridge Beta",
      salesforceContactId: "003-ridge-beta",
      subject: "Ridge transport note",
      snippet: "Sharing the ridge transport plan for tomorrow.",
      occurredAt: "2026-04-15T17:00:00.000Z",
    });
    await seedInboxEmailOnlyContact(runtime, {
      contactId: "contact:ridge-gamma",
      displayName: "Ridge Gamma",
      salesforceContactId: "003-ridge-gamma",
      subject: "Ridge camping logistics",
      snippet: "The ridge camping checklist is attached.",
      occurredAt: "2026-04-15T16:00:00.000Z",
    });

    const firstPage = await getInboxList("inbox", {
      query: "ridge",
      limit: 2,
    });

    expect(firstPage.items.map((item) => item.contactId)).toEqual([
      "contact:ridge-alpha",
      "contact:ridge-beta",
    ]);
    expect(firstPage.page.total).toBe(3);
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPage.page.nextCursor).not.toBeNull();

    const secondPage = await getInboxList("inbox", {
      query: "ridge",
      limit: 2,
      cursor: firstPage.page.nextCursor,
    });

    expect(secondPage.items.map((item) => item.contactId)).toEqual([
      "contact:ridge-gamma",
    ]);
    expect(secondPage.page.total).toBe(3);
    expect(secondPage.page.hasMore).toBe(false);
  });

  it("paginates cleanly through inbound-only inbox rows", async () => {
    // PR #329: the new "inbox" filter excludes contacts with
    // lastInboundAt IS NULL, so the original "across the null-inbound
    // boundary" premise is moot. The recency fixture has 4 inbound rows
    // at indices 0-3 and 2 outbound-only rows at 4-5; under the new
    // scope only the 4 inbound rows show up.
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.dispose();
    runtime = await createInboxTestRuntime();
    await seedSharedInboxRecencyFixture(runtime);

    const firstPage = await getInboxList("inbox", {
      limit: 3,
    });

    expect(firstPage.items.map((item) => item.contactId)).toEqual(
      inboxRecencyExpectedOrder.slice(0, 3),
    );
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPage.page.nextCursor).not.toBeNull();

    const secondPage = await getInboxList("inbox", {
      limit: 3,
      cursor: firstPage.page.nextCursor,
    });

    expect(secondPage.items.map((item) => item.contactId)).toEqual(
      inboxRecencyExpectedOrder.slice(3, 4),
    );
    // Only 4 inbound rows pass the new lastInboundAt IS NOT NULL filter.
    expect(
      new Set(
        [...firstPage.items, ...secondPage.items].map((item) => item.contactId),
      ).size,
    ).toBe(4);
    expect(secondPage.page.hasMore).toBe(false);
    expect(secondPage.page.nextCursor).toBeNull();
  });

  it("orders and paginates sent mode by last outbound 1:1 message", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.dispose();
    runtime = await createInboxTestRuntime();
    await seedSharedInboxRecencyFixture(runtime);

    const firstPage = await getInboxList("sent", {
      limit: 2,
    });

    expect(firstPage.items.map((item) => item.contactId)).toEqual(
      inboxSentExpectedOrder.slice(0, 2),
    );
    expect(firstPage.page.total).toBe(inboxSentExpectedOrder.length);
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPage.page.nextCursor).not.toBeNull();

    const secondPage = await getInboxList("sent", {
      limit: 2,
      cursor: firstPage.page.nextCursor,
    });

    expect(secondPage.items.map((item) => item.contactId)).toEqual(
      inboxSentExpectedOrder.slice(2),
    );
    expect(secondPage.page.hasMore).toBe(false);
    expect(secondPage.page.nextCursor).toBeNull();
  });

  it("excludes campaign and automated outbound activity from sent mode", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:campaign-only-outbound",
      salesforceContactId: "003-campaign-only-outbound",
      displayName: "Campaign Only Outbound",
      primaryEmail: "campaign-only@example.org",
      primaryPhone: null,
    });

    const inbound = await seedInboxEmailEvent(runtime.context, {
      id: "campaign-only-inbound",
      contactId: "contact:campaign-only-outbound",
      occurredAt: "2026-04-16T09:00:00.000Z",
      direction: "inbound",
      subject: "Checking in",
      snippet: "I had one inbound note before campaign activity.",
    });

    await seedInboxProjection(runtime.context, {
      contactId: "contact:campaign-only-outbound",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-16T09:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-16T09:00:00.000Z",
      snippet: "I had one inbound note before campaign activity.",
      lastCanonicalEventId: inbound.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });

    await seedInboxCampaignEmailEvent(runtime.context, {
      id: "campaign-only-campaign",
      contactId: "contact:campaign-only-outbound",
      occurredAt: "2026-04-16T12:00:00.000Z",
      activityType: "sent",
      campaignName: "Spring Check-In",
      snippet: "Campaign send should not make this contact appear in Sent.",
    });

    await seedInboxAutoEmailEvent(runtime.context, {
      id: "campaign-only-auto",
      contactId: "contact:campaign-only-outbound",
      occurredAt: "2026-04-16T13:00:00.000Z",
      subject: "Automated follow-up",
      snippet: "Automated outreach should not count as sent mode activity.",
    });

    const sentList = await getInboxList("sent");

    expect(sentList.items.map((item) => item.contactId)).not.toContain(
      "contact:campaign-only-outbound",
    );
  });

  it("batch-loads timeline attachments once and groups them by source evidence id", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:attachment-test",
      salesforceContactId: "003-attachment",
      displayName: "Attachment Test",
      primaryEmail: "attachment@example.org",
      primaryPhone: null,
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "attachment-email-1",
      contactId: "contact:attachment-test",
      occurredAt: "2026-04-20T12:00:00.000Z",
      direction: "inbound",
      subject: "Photo update",
      snippet: "Two files attached.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:attachment-test",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-20T12:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-04-20T12:00:00.000Z",
      snippet: "Two files attached.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });
    await seedInboxMessageAttachment(runtime.context, {
      sourceEvidenceId: "source:attachment-email-1",
      id: "att:gmail:attachment-email-1:0/1",
      mimeType: "image/jpeg",
      filename: "field-photo.jpg",
      sizeBytes: 1234,
      storageKey: "gmail/ab/att:gmail:attachment-email-1:0/1",
      isInline: true,
    });
    await seedInboxMessageAttachment(runtime.context, {
      sourceEvidenceId: "source:attachment-email-1",
      id: "att:gmail:attachment-email-1:0/2",
      mimeType: "application/pdf",
      filename: "packet.pdf",
      sizeBytes: 4567,
      storageKey: "gmail/cd/att:gmail:attachment-email-1:0/2",
    });
    const findByMessageIds = vi.spyOn(
      runtime.context.repositories.messageAttachments,
      "findByMessageIds",
    );

    const detail = await getInboxDetail("contact:attachment-test");

    expect(findByMessageIds).toHaveBeenCalledTimes(1);
    expect(findByMessageIds).toHaveBeenCalledWith([
      "source:attachment-email-1",
    ]);
    // attachmentCount derivation moved here from the domain presenter
    // (see packages/domain/src/timeline.ts loadTimelinePresentationContext)
    // so the selector — which already loads attachments — is the canonical
    // home for this assertion.
    expect(detail?.timeline[0]?.attachmentCount).toBe(1);
    expect(detail?.timeline[0]?.attachments).toEqual([
      {
        id: "att:gmail:attachment-email-1:0/2",
        mimeType: "application/pdf",
        filename: "packet.pdf",
        sizeBytes: 4567,
        proxyUrl: "/api/attachments/att%3Agmail%3Aattachment-email-1%3A0%2F2",
      },
    ]);
  });

  it("falls back to pending attachment metadata when pending outbounds have no canonical attachments yet", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedOperatorUser(runtime);
    await seedInboxContact(runtime.context, {
      contactId: "contact:pending-attachment-test",
      salesforceContactId: null,
      displayName: "Pending Attachment Test",
      primaryEmail: "pending@example.org",
      primaryPhone: null,
    });
    const priorInbound = await seedInboxEmailEvent(runtime.context, {
      id: "pending-attachment-inbound-1",
      contactId: "contact:pending-attachment-test",
      occurredAt: "2026-04-20T11:00:00.000Z",
      direction: "inbound",
      subject: "Question about volunteering",
      snippet: "Hi, I would like to know more.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:pending-attachment-test",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-04-20T11:00:00.000Z",
      lastOutboundAt: "2026-04-20T12:05:00.000Z",
      lastActivityAt: "2026-04-20T12:05:00.000Z",
      snippet: "Pending outbound with attachment.",
      lastCanonicalEventId: priorInbound.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });
    await runtime.context.repositories.pendingOutbounds.insert({
      id: "pending-attachment-1",
      fingerprint: "fp:pending-attachment-1",
      actorId: "user:operator",
      canonicalContactId: "contact:pending-attachment-test",
      projectId: null,
      fromAlias: "field@adventuresci.org",
      toEmailNormalized: "pending@example.org",
      subject: "Packet attached",
      bodyPlaintext: "See attached.",
      bodyHtml: "<p>See attached.</p>",
      bodySha256: "sha256:pending-attachment-1",
      attachmentMetadata: [
        {
          filename: "x.zip",
          contentType: "application/zip",
          size: 1234,
        },
      ],
      gmailThreadId: null,
      inReplyToRfc822: null,
      attemptedAt: "2026-04-20T12:05:00.000Z",
    });

    const detail = await getInboxDetail("contact:pending-attachment-test");

    const pendingEntry = detail?.timeline.find((entry) =>
      entry.attachments.some((attachment) => attachment.proxyUrl === null),
    );
    expect(pendingEntry?.attachmentCount).toBe(1);
    expect(pendingEntry?.attachments).toEqual([
      {
        id: null,
        mimeType: "application/zip",
        filename: "x.zip",
        sizeBytes: 1234,
        proxyUrl: null,
      },
    ]);
  });

  it("prefers canonical attachments over pending metadata after reconciliation", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedOperatorUser(runtime);
    await seedInboxContact(runtime.context, {
      contactId: "contact:canonical-attachment-preferred",
      salesforceContactId: "003-canonical-attachment",
      displayName: "Canonical Attachment Preferred",
      primaryEmail: "canonical@example.org",
      primaryPhone: null,
    });
    const latest = await seedInboxEmailEvent(runtime.context, {
      id: "canonical-attachment-email-1",
      contactId: "contact:canonical-attachment-preferred",
      occurredAt: "2026-04-20T13:00:00.000Z",
      direction: "outbound",
      subject: "Canonical packet",
      snippet: "See canonical attachment.",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:canonical-attachment-preferred",
      bucket: "Opened",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: null,
      lastOutboundAt: "2026-04-20T13:00:00.000Z",
      lastActivityAt: "2026-04-20T13:00:00.000Z",
      snippet: "See canonical attachment.",
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.outbound",
    });
    await seedInboxMessageAttachment(runtime.context, {
      sourceEvidenceId: "source:canonical-attachment-email-1",
      id: "att:gmail:canonical-attachment-email-1:0/1",
      mimeType: "application/pdf",
      filename: "canonical.pdf",
      sizeBytes: 4567,
      storageKey: "gmail/ef/att:gmail:canonical-attachment-email-1:0/1",
    });
    await runtime.context.repositories.pendingOutbounds.insert({
      id: "pending-canonical-attachment-1",
      fingerprint: "fp:pending-canonical-attachment-1",
      actorId: "user:operator",
      canonicalContactId: "contact:canonical-attachment-preferred",
      projectId: null,
      fromAlias: "field@adventuresci.org",
      toEmailNormalized: "canonical@example.org",
      subject: "Canonical packet",
      bodyPlaintext: "See canonical attachment.",
      bodyHtml: "<p>See canonical attachment.</p>",
      bodySha256: "sha256:pending-canonical-attachment-1",
      attachmentMetadata: [
        {
          filename: "pending.zip",
          contentType: "application/zip",
          size: 1234,
        },
      ],
      gmailThreadId: null,
      inReplyToRfc822: null,
      attemptedAt: "2026-04-20T12:59:00.000Z",
    });

    const detail = await getInboxDetail(
      "contact:canonical-attachment-preferred",
    );

    const canonicalEntry = detail?.timeline.find((entry) =>
      entry.attachments.some((attachment) => attachment.proxyUrl !== null),
    );
    expect(canonicalEntry?.attachments).toEqual([
      {
        id: "att:gmail:canonical-attachment-email-1:0/1",
        mimeType: "application/pdf",
        filename: "canonical.pdf",
        sizeBytes: 4567,
        proxyUrl:
          "/api/attachments/att%3Agmail%3Acanonical-attachment-email-1%3A0%2F1",
      },
    ]);
  });
});
