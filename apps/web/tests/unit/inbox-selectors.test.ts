import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
  revalidateTag: vi.fn()
}));

import {
  compareInboxRecency,
  getInboxDetail,
  getInboxList
} from "../../app/inbox/_lib/selectors";
import type { InboxListItemViewModel } from "../../app/inbox/_lib/view-models";
import {
  createInboxTestRuntime,
  seedInboxAutoEmailEvent,
  seedInboxCampaignEmailEvent,
  seedInboxCampaignSmsEvent,
  seedInboxContact,
  seedInboxEmailEvent,
  seedInboxInternalNoteEvent,
  seedInboxLifecycleEvent,
  seedInboxProjection,
  seedInboxSalesforceOutboundEmailEvent,
  seedInboxSmsEvent,
  type InboxTestRuntime
} from "./inbox-stage1-helpers";

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
    membershipStatus: "successful"
  });
  const lisaLatest = await seedInboxEmailEvent(runtime.context, {
    id: "lisa-outbound-1",
    contactId: "contact:lisa-zhang",
    occurredAt: "2026-04-14T15:00:00.000Z",
    direction: "outbound",
    subject: "Safety protocols",
    snippet: "Sending the final safety protocol packet for review."
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
    lastEventType: "communication.email.outbound"
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
    membershipStatus: "in_training"
  });
  await seedInboxEmailEvent(runtime.context, {
    id: "sarah-outbound-1",
    contactId: "contact:sarah-martinez",
    occurredAt: "2026-04-13T12:00:00.000Z",
    direction: "outbound",
    subject: "Amazon Basin equipment list",
    snippet: "Sharing the equipment list for the next field session."
  });
  const sarahLatest = await seedInboxEmailEvent(runtime.context, {
    id: "sarah-inbound-1",
    contactId: "contact:sarah-martinez",
    occurredAt: "2026-04-14T13:00:00.000Z",
    direction: "inbound",
    subject: "Re: Amazon Basin equipment list",
    snippet: "Following up on the field study logistics for the Amazon basin project."
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
    lastEventType: "communication.email.inbound"
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
    membershipStatus: "trip_planning"
  });
  await seedInboxSmsEvent(runtime.context, {
    id: "alex-outbound-1",
    contactId: "contact:alex-thompson",
    occurredAt: "2026-04-12T18:00:00.000Z",
    direction: "outbound",
    summary: "We can shift the mountain research dates if weather stays rough."
  });
  const alexLatest = await seedInboxSmsEvent(runtime.context, {
    id: "alex-inbound-1",
    contactId: "contact:alex-thompson",
    occurredAt: "2026-04-12T19:00:00.000Z",
    direction: "inbound",
    summary: "Had to postpone due to weather. Proposing new dates."
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
    lastEventType: "communication.sms.inbound"
  });
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
      "contact:lisa-zhang",
      "contact:sarah-martinez",
      "contact:alex-thompson"
    ]);
    expect(list.items[0]).toMatchObject({
      contactId: "contact:lisa-zhang",
      latestSubject: "Safety protocols",
      bucket: "opened"
    });
    expect(list.items[1]).toMatchObject({
      contactId: "contact:sarah-martinez",
      latestSubject: "Re: Amazon Basin equipment list",
      needsFollowUp: true,
      bucket: "new"
    });
  });

  it("uses bucket, needsFollowUp, and hasUnresolved for the secondary filters", async () => {
    const unread = await getInboxList("unread");
    const followUp = await getInboxList("follow-up");
    const unresolved = await getInboxList("unresolved");

    expect(unread.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez"
    ]);
    expect(followUp.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez"
    ]);
    expect(unresolved.items.map((item) => item.contactId)).toEqual([
      "contact:alex-thompson"
    ]);
  });

  it("assembles selected-contact detail from real contact, membership, timeline, and projection data", async () => {
    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      bucket: "new",
      needsFollowUp: true,
      smsEligible: true
    });
    expect(detail?.contact).toMatchObject({
      contactId: "contact:sarah-martinez",
      displayName: "Sarah Martinez",
      volunteerId: "003-sarah"
    });
    expect(detail?.contact.activeProjects[0]).toMatchObject({
      projectName: "Amazon Basin Research",
      status: "in-training"
    });
    expect(detail?.timeline.map((entry) => entry.kind)).toEqual([
      "outbound-email",
      "inbound-email"
    ]);
    expect(detail?.timeline.at(-1)).toMatchObject({
      subject: "Re: Amazon Basin equipment list",
      isUnread: true
    });
  });

  it("preserves Stage 1 timeline families instead of flattening them into generic system events", async () => {
    await seedInboxCampaignEmailEvent(runtime!.context, {
      id: "sarah-campaign-email-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-10T09:00:00.000Z",
      activityType: "sent",
      campaignName: "Spring Kickoff",
      snippet: "Welcome to the new field season."
    });
    await seedInboxAutoEmailEvent(runtime!.context, {
      id: "sarah-auto-email-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-11T09:00:00.000Z",
      subject: "Training confirmation",
      snippet: "You are confirmed for training."
    });
    await seedInboxCampaignSmsEvent(runtime!.context, {
      id: "sarah-campaign-sms-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T09:00:00.000Z",
      campaignName: "Field Reminder",
      messageTextPreview: "Field reminder text"
    });
    await seedInboxInternalNoteEvent(runtime!.context, {
      id: "sarah-note-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-12T12:00:00.000Z",
      body: "Prefers SMS check-ins before training.",
      authorDisplayName: "Jordan"
    });
    await seedInboxLifecycleEvent(runtime!.context, {
      id: "sarah-lifecycle-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-09T09:00:00.000Z",
      eventType: "lifecycle.received_training",
      summary: "Received training materials"
    });

    const detail = await getInboxDetail("contact:sarah-martinez");

    expect(detail).not.toBeNull();
    expect(detail?.timeline.map((entry) => entry.kind)).toEqual([
      "system-event",
      "outbound-campaign-email",
      "outbound-auto-email",
      "outbound-campaign-sms",
      "internal-note",
      "outbound-email",
      "inbound-email"
    ]);
    expect(detail?.timeline[1]).toMatchObject({
      kind: "outbound-campaign-email",
      subject: "Spring Kickoff",
      body: "Welcome to the new field season."
    });
    expect(detail?.timeline[2]).toMatchObject({
      kind: "outbound-auto-email",
      subject: "Training confirmation",
      body: "You are confirmed for training."
    });
    expect(detail?.timeline[3]).toMatchObject({
      kind: "outbound-campaign-sms",
      subject: "Field Reminder",
      body: "Field reminder text"
    });
    expect(detail?.timeline[4]).toMatchObject({
      kind: "internal-note",
      actorLabel: "Jordan",
      body: "Prefers SMS check-ins before training."
    });
  });

  it("keeps Salesforce outbound email in the 1:1 contract unless canon explicitly marks it auto", async () => {
    await seedInboxSalesforceOutboundEmailEvent(runtime!.context, {
      id: "sarah-salesforce-null-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-10T06:00:00.000Z",
      subject: "Logged Salesforce follow-up",
      snippet: "Logged Salesforce follow-up body.",
      messageKind: null
    });
    await seedInboxSalesforceOutboundEmailEvent(runtime!.context, {
      id: "sarah-salesforce-one-to-one-1",
      contactId: "contact:sarah-martinez",
      occurredAt: "2026-04-10T07:00:00.000Z",
      subject: "Explicit Salesforce one-to-one",
      snippet: "Explicit Salesforce one-to-one body.",
      messageKind: "one_to_one"
    });

    const detail = await getInboxDetail("contact:sarah-martinez");
    const nullClassifiedEntry = detail?.timeline.find(
      (entry) => entry.subject === "Logged Salesforce follow-up"
    );
    const explicitOneToOneEntry = detail?.timeline.find(
      (entry) => entry.subject === "Explicit Salesforce one-to-one"
    );

    expect(nullClassifiedEntry).toMatchObject({
      kind: "outbound-email",
      actorLabel: "You",
      channel: "email",
      body: "Logged Salesforce follow-up body."
    });
    expect(explicitOneToOneEntry).toMatchObject({
      kind: "outbound-email",
      actorLabel: "You",
      channel: "email",
      body: "Explicit Salesforce one-to-one body."
    });
    expect(
      detail?.timeline
        .filter((entry) => entry.kind === "outbound-auto-email")
        .map((entry) => entry.subject)
    ).not.toEqual(
      expect.arrayContaining([
        "Logged Salesforce follow-up",
        "Explicit Salesforce one-to-one"
      ])
    );
  });
});
