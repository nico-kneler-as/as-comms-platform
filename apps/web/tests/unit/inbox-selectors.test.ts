import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
  revalidateTag: vi.fn(),
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
  getInboxDetail,
  getInboxList,
  getInboxTimelinePage,
  getInboxWelcomeWorkload,
  stripSignature,
} from "../../app/inbox/_lib/selectors";
import { InboxContactRail } from "../../app/inbox/_components/inbox-contact-rail";
import type { InboxListItemViewModel } from "../../app/inbox/_lib/view-models";
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
    volunteerStage: overrides.volunteerStage ?? "active",
    bucket: overrides.bucket ?? "opened",
    needsFollowUp: overrides.needsFollowUp ?? false,
    hasUnresolved: overrides.hasUnresolved ?? false,
    unreadCount: overrides.unreadCount ?? 0,
    lastInboundAt: overrides.lastInboundAt ?? null,
    lastOutboundAt: overrides.lastOutboundAt ?? null,
    lastActivityAt: overrides.lastActivityAt ?? "2026-04-14T14:00:00.000Z",
    lastEventType: overrides.lastEventType ?? "communication.email.outbound",
    lastActivityLabel: overrides.lastActivityLabel ?? "today",
  };
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
    lastInboundAt: null,
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

describe("real inbox selectors", () => {
  let runtime: InboxTestRuntime | null = null;

  beforeEach(async () => {
    runtime = await createInboxTestRuntime();
    await seedInboxFixture(runtime);
  });

  afterEach(async () => {
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

  it("uses bucket, needsFollowUp, and hasUnresolved for the secondary filters", async () => {
    const unread = await getInboxList("unread");
    const followUp = await getInboxList("follow-up");
    const unresolved = await getInboxList("unresolved");

    expect(unread.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
    ]);
    expect(followUp.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
    ]);
    expect(unresolved.items.map((item) => item.contactId)).toEqual([
      "contact:alex-thompson",
    ]);
  });

  it("builds welcome workload counts from active project projections only", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:amazon-basin",
      projectName: "Amazon Basin Research",
      source: "salesforce",
      isActive: true,
    });
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:whitebark-pine",
      projectName: "Tracking Whitebark Pine",
      source: "salesforce",
      isActive: true,
    });
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:river-cleanup",
      projectName: "River Cleanup",
      source: "salesforce",
      isActive: true,
    });
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:killer-whales",
      projectName: "Searching for Killer Whales",
      source: "salesforce",
      isActive: false,
    });

    const workload = await getInboxWelcomeWorkload();

    expect(workload.projects).toEqual([
      {
        projectId: "project:amazon-basin",
        projectName: "Amazon Basin Research",
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
        projectName: "Tracking Whitebark Pine",
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
      source: "salesforce",
      isActive: true,
    });
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:whitebark-pine",
      projectName: "Tracking Whitebark Pine",
      source: "salesforce",
      isActive: true,
    });
    await runtime.context.repositories.contactMemberships.upsert({
      id: "membership:sarah:whitebark",
      contactId: "contact:sarah-martinez",
      projectId: "project:whitebark-pine",
      expeditionId: null,
      role: "volunteer",
      status: "trip_planning",
      source: "salesforce",
    });

    const workload = await getInboxWelcomeWorkload();

    expect(workload.projects).toEqual([
      {
        projectId: "project:amazon-basin",
        projectName: "Amazon Basin Research",
        unreadCount: 1,
        needsFollowUpCount: 1,
      },
      {
        projectId: "project:whitebark-pine",
        projectName: "Tracking Whitebark Pine",
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

  it("assembles selected-contact detail from real contact, membership, timeline, and projection data", async () => {
    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      bucket: "new",
      needsFollowUp: true,
      smsEligible: true,
    });
    expect(detail?.contact).toMatchObject({
      contactId: "contact:sarah-martinez",
      displayName: "Sarah Martinez",
      volunteerId: "003-sarah",
    });
    expect(detail?.contact.activeProjects[0]).toMatchObject({
      projectName: "Amazon Basin Research",
      status: "in-training",
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
      nextCursor: null,
      total: 2,
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
      subject: null,
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
    });
    expect(detail?.contact.recentActivity[0]?.occurredAtLabel).toEqual(
      expect.any(String),
    );
  });

  it("builds right-rail lifecycle activity for all four locked milestones in newest-first order", async () => {
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
      actorLabel: "You",
      channel: "email",
      body: "Logged Salesforce follow-up body.",
    });
    expect(explicitOneToOneEntry).toMatchObject({
      kind: "outbound-email",
      actorLabel: "You",
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
      lastInboundAt: null,
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
      lastInboundAt: null,
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
      lastInboundAt: null,
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
      lastInboundAt: null,
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

  it("uses the best available current headline for campaign email rows and shows the sanitized body when expanded", async () => {
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
      subject: "April field update",
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
          entry.subject === "April field update",
      ) ?? [];

    expect(campaignEntries).toHaveLength(1);
    expect(campaignEntries[0]).toMatchObject({
      kind: "outbound-campaign-email",
      subject: "April field update",
      body: "Hi Sarah,\nPlease bring your field notebook.",
    });
    expect(campaignEntries[0]?.campaignActivity.map((activity) => activity.activityType)).toEqual([
      "opened",
      "clicked",
    ]);
  });

  it("strips outbound email prefixes from automated and campaign email subjects before display", async () => {
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
      campaignName: "PNW Training",
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
      campaignName: "Weekly Digest",
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
      subject: "Email: Aplicacion en Revision: Monitoreo y Restauracion de Arrecifes de Coral",
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

  it("hides unusable automated and campaign email subjects while keeping meaningful body and embedded URLs", async () => {
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
      campaignName: "Webinar Push",
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
      campaignName: "Field Update",
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
      subject: "April field update",
      body: "",
      isPreview: true,
    });
  });

  it("pages inbox rows and timeline history instead of loading full history by default", async () => {
    const firstPage = await getInboxList("all", {
      limit: 2,
    });

    expect(firstPage.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
      "contact:alex-thompson",
    ]);
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPage.page.nextCursor).not.toBeNull();

    const secondPage = await getInboxList("all", {
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
    const searched = await getInboxList("all", {
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

  it("matches query terms across display name, email, project label, subject, and snippet", async () => {
    const byDisplayName = await getInboxList("all", {
      query: "Alex Thompson",
    });
    const byEmail = await getInboxList("all", {
      query: "sarah@example.org",
    });
    const bySubject = await getInboxList("all", {
      query: "Safety protocols",
    });
    const byProject = await getInboxList("all", {
      query: "Searching for Killer Whales",
    });
    const bySnippet = await getInboxList("all", {
      query: "weather",
    });
    const noMatch = await getInboxList("all", {
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
      role: "volunteer",
      status: "active",
      source: "salesforce",
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

    const searched = await getInboxList("all", {
      query: "Amazon Basin Expedition",
    });

    expect(searched.items.map((item) => item.contactId)).toEqual([
      "contact:expedition-only",
    ]);
  });

  it("composes search with unread, follow-up, and unresolved filters", async () => {
    const unread = await getInboxList("unread", {
      query: "sarah@example.org",
    });
    const followUp = await getInboxList("follow-up", {
      query: "Sarah",
    });
    const unresolved = await getInboxList("unresolved", {
      query: "weather",
    });

    expect(unread.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
    ]);
    expect(followUp.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
    ]);
    expect(unresolved.items.map((item) => item.contactId)).toEqual([
      "contact:alex-thompson",
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
    const defaultList = await getInboxList("all");
    const emptyQueryList = await getInboxList("all", {
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

    const firstPage = await getInboxList("all", {
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

    const secondPage = await getInboxList("all", {
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

  it("paginates cleanly across the null-inbound boundary", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.dispose();
    runtime = await createInboxTestRuntime();
    await seedSharedInboxRecencyFixture(runtime);

    const firstPage = await getInboxList("all", {
      limit: 3,
    });

    expect(firstPage.items.map((item) => item.contactId)).toEqual(
      inboxRecencyExpectedOrder.slice(0, 3),
    );
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPage.page.nextCursor).not.toBeNull();

    const secondPage = await getInboxList("all", {
      limit: 3,
      cursor: firstPage.page.nextCursor,
    });

    expect(secondPage.items.map((item) => item.contactId)).toEqual(
      inboxRecencyExpectedOrder.slice(3),
    );
    expect(
      new Set(
        [...firstPage.items, ...secondPage.items].map((item) => item.contactId),
      ),
    ).toHaveLength(inboxRecencyExpectedOrder.length);
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
});
