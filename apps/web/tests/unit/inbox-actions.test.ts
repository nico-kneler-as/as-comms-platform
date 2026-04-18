import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
  revalidateTag,
  revalidatePath
}));

import {
  clearInboxNeedsFollowUpAction,
  markInboxNeedsFollowUpAction
} from "../../app/inbox/actions";
import { getInboxDetail, getInboxList } from "../../app/inbox/_lib/selectors";
import {
  createInboxTestRuntime,
  seedInboxContact,
  seedInboxEmailEvent,
  seedInboxProjection,
  type InboxTestRuntime
} from "./inbox-stage1-helpers";

async function seedActionFixture(runtime: InboxTestRuntime): Promise<void> {
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
    needsFollowUp: false,
    hasUnresolved: false,
    lastInboundAt: "2026-04-14T13:00:00.000Z",
    lastOutboundAt: null,
    lastActivityAt: "2026-04-14T13:00:00.000Z",
    snippet:
      "Following up on the field study logistics for the Amazon basin project.",
    lastCanonicalEventId: sarahLatest.canonicalEventId,
    lastEventType: "communication.email.inbound"
  });

  await seedInboxContact(runtime.context, {
    contactId: "contact:michael-chen",
    salesforceContactId: "003-michael",
    displayName: "Michael Chen",
    primaryEmail: "michael@example.org",
    primaryPhone: null,
    projectId: "project:coral-reefs",
    projectName: "Monitoring Coral Reefs",
    membershipId: "membership:michael",
    membershipStatus: "in_training"
  });
  const michaelLatest = await seedInboxEmailEvent(runtime.context, {
    id: "michael-inbound-1",
    contactId: "contact:michael-chen",
    occurredAt: "2026-04-14T12:00:00.000Z",
    direction: "inbound",
    subject: "Questions about data collection protocols",
    snippet:
      "Thanks for the training materials. I have a few questions about the data collection protocols."
  });
  await seedInboxProjection(runtime.context, {
    contactId: "contact:michael-chen",
    bucket: "New",
    needsFollowUp: false,
    hasUnresolved: false,
    lastInboundAt: "2026-04-14T12:00:00.000Z",
    lastOutboundAt: null,
    lastActivityAt: "2026-04-14T12:00:00.000Z",
    snippet:
      "Thanks for the training materials. I have a few questions about the data collection protocols.",
    lastCanonicalEventId: michaelLatest.canonicalEventId,
    lastEventType: "communication.email.inbound"
  });
}

describe("server-backed follow-up actions", () => {
  let runtime: InboxTestRuntime | null = null;

  beforeEach(async () => {
    revalidateTag.mockReset();
    runtime = await createInboxTestRuntime();
    await seedActionFixture(runtime);
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("marks needsFollowUp without changing bucket semantics or row ordering", async () => {
    const before = await getInboxList();
    const formData = new FormData();
    formData.set("contactId", "contact:michael-chen");

    const result = await markInboxNeedsFollowUpAction(formData);
    if (!runtime) throw new Error("runtime not initialized");
    const projection = await runtime.context.repositories.inboxProjection.findByContactId(
      "contact:michael-chen"
    );
    const after = await getInboxList();
    const detail = await getInboxDetail("contact:michael-chen");

    expect(result).toMatchObject({
      ok: true,
      data: {
        contactId: "contact:michael-chen",
        needsFollowUp: true
      }
    });
    expect(before.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
      "contact:michael-chen"
    ]);
    expect(after.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
      "contact:michael-chen"
    ]);
    expect(projection).toMatchObject({
      contactId: "contact:michael-chen",
      needsFollowUp: true,
      bucket: "New"
    });
    expect(after.items.find((item) => item.contactId === "contact:michael-chen")).toMatchObject({
      needsFollowUp: true,
      bucket: "new"
    });
    expect(detail).toMatchObject({
      needsFollowUp: true,
      bucket: "new"
    });
    expect(revalidateTag).toHaveBeenCalledTimes(3);
    expect(revalidateTag).toHaveBeenNthCalledWith(1, "inbox");
    expect(revalidateTag).toHaveBeenNthCalledWith(
      2,
      "inbox:contact:contact:michael-chen"
    );
    expect(revalidateTag).toHaveBeenNthCalledWith(
      3,
      "timeline:contact:contact:michael-chen"
    );
  });

  it("clears needsFollowUp without mutating unread state", async () => {
    const formData = new FormData();
    formData.set("contactId", "contact:michael-chen");
    await markInboxNeedsFollowUpAction(formData);
    revalidateTag.mockReset();

    const result = await clearInboxNeedsFollowUpAction(formData);
    if (!runtime) throw new Error("runtime not initialized");
    const projection = await runtime.context.repositories.inboxProjection.findByContactId(
      "contact:michael-chen"
    );
    const followUpList = await getInboxList("follow-up");

    expect(result).toMatchObject({
      ok: true,
      data: {
        contactId: "contact:michael-chen",
        needsFollowUp: false
      }
    });
    expect(projection).toMatchObject({
      contactId: "contact:michael-chen",
      needsFollowUp: false,
      bucket: "New"
    });
    expect(followUpList.items).toHaveLength(0);
    expect(revalidateTag).toHaveBeenCalledTimes(3);
  });

  it("does not clobber fresher projection state when follow-up is toggled", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    const staleProjection =
      await runtime.context.repositories.inboxProjection.findByContactId(
        "contact:michael-chen"
      );
    const fresherEvent = await seedInboxEmailEvent(runtime.context, {
      id: "michael-inbound-2",
      contactId: "contact:michael-chen",
      occurredAt: "2026-04-14T14:30:00.000Z",
      direction: "inbound",
      subject: "Latest logistics update",
      snippet: "Fresh inbound message that arrived after the stale snapshot."
    });

    await runtime.context.repositories.inboxProjection.upsert({
      contactId: "contact:michael-chen",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: true,
      lastInboundAt: "2026-04-14T14:30:00.000Z",
      lastOutboundAt: "2026-04-14T12:00:00.000Z",
      lastActivityAt: "2026-04-14T14:30:00.000Z",
      snippet: "Fresh inbound message that arrived after the stale snapshot.",
      lastCanonicalEventId: fresherEvent.canonicalEventId,
      lastEventType: "communication.email.inbound"
    });

    const findByContactIdSpy = vi
      .spyOn(runtime.context.repositories.inboxProjection, "findByContactId")
      .mockResolvedValue(staleProjection ?? null);
    const upsertSpy = vi.spyOn(
      runtime.context.repositories.inboxProjection,
      "upsert"
    );
    const formData = new FormData();
    formData.set("contactId", "contact:michael-chen");

    const result = await markInboxNeedsFollowUpAction(formData);
    expect(findByContactIdSpy).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();
    findByContactIdSpy.mockRestore();
    upsertSpy.mockRestore();
    const projection = await runtime.context.repositories.inboxProjection.findByContactId(
      "contact:michael-chen"
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        contactId: "contact:michael-chen",
        needsFollowUp: true
      }
    });
    expect(projection).toMatchObject({
      contactId: "contact:michael-chen",
      bucket: "New",
      needsFollowUp: true,
      hasUnresolved: true,
      lastInboundAt: "2026-04-14T14:30:00.000Z",
      lastActivityAt: "2026-04-14T14:30:00.000Z",
      snippet: "Fresh inbound message that arrived after the stale snapshot.",
      lastCanonicalEventId: fresherEvent.canonicalEventId,
      lastEventType: "communication.email.inbound"
    });
  });
});
