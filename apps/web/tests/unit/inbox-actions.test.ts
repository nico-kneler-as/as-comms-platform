import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());
const generateAiDraft = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
}));

vi.mock("@/src/server/auth/session", () => ({
  requireSession,
}));

vi.mock("@/src/server/ai", async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...(actual as object),
    generateAiDraft,
  };
});

import {
  clearInboxNeedsFollowUpAction,
  draftWithAiAction,
  markInboxNeedsFollowUpAction,
} from "../../app/inbox/actions";
import { resetSecurityRateLimiterForTests } from "../../src/server/security/rate-limit";
import { getInboxDetail, getInboxList } from "../../app/inbox/_lib/selectors";
import {
  createInboxTestRuntime,
  seedInboxContact,
  seedInboxEmailEvent,
  seedInboxProjection,
  type InboxTestRuntime,
} from "./inbox-stage1-helpers";

function buildCurrentUser() {
  const now = new Date("2026-04-14T10:00:00.000Z");
  return {
    id: "user:nico",
    name: "Nico",
    email: "nico@adventurescientists.org",
    emailVerified: now,
    image: null,
    role: "operator" as const,
    deactivatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

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
    membershipStatus: "in_training",
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
    needsFollowUp: false,
    hasUnresolved: false,
    lastInboundAt: "2026-04-14T13:00:00.000Z",
    lastOutboundAt: null,
    lastActivityAt: "2026-04-14T13:00:00.000Z",
    snippet:
      "Following up on the field study logistics for the Amazon basin project.",
    lastCanonicalEventId: sarahLatest.canonicalEventId,
    lastEventType: "communication.email.inbound",
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
    membershipStatus: "in_training",
  });
  const michaelLatest = await seedInboxEmailEvent(runtime.context, {
    id: "michael-inbound-1",
    contactId: "contact:michael-chen",
    occurredAt: "2026-04-14T12:00:00.000Z",
    direction: "inbound",
    subject: "Questions about data collection protocols",
    snippet:
      "Thanks for the training materials. I have a few questions about the data collection protocols.",
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
    lastEventType: "communication.email.inbound",
  });
}

describe("server-backed follow-up actions", () => {
  let runtime: InboxTestRuntime | null = null;

  beforeEach(async () => {
    resetSecurityRateLimiterForTests();
    requireSession.mockReset();
    requireSession.mockResolvedValue(buildCurrentUser());
    generateAiDraft.mockReset();
    runtime = await createInboxTestRuntime();
    await seedActionFixture(runtime);
  });

  afterEach(async () => {
    resetSecurityRateLimiterForTests();
    await runtime?.dispose();
    runtime = null;
  });

  it("marks needsFollowUp without changing bucket semantics or row ordering", async () => {
    const before = await getInboxList();
    const formData = new FormData();
    formData.set("contactId", "contact:michael-chen");

    const result = await markInboxNeedsFollowUpAction(formData);
    if (!runtime) throw new Error("runtime not initialized");
    const projection =
      await runtime.context.repositories.inboxProjection.findByContactId(
        "contact:michael-chen",
      );
    const after = await getInboxList();
    const detail = await getInboxDetail("contact:michael-chen");

    expect(result).toMatchObject({
      ok: true,
      data: {
        contactId: "contact:michael-chen",
        needsFollowUp: true,
      },
    });
    expect(before.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
      "contact:michael-chen",
    ]);
    expect(after.items.map((item) => item.contactId)).toEqual([
      "contact:sarah-martinez",
      "contact:michael-chen",
    ]);
    expect(projection).toMatchObject({
      contactId: "contact:michael-chen",
      needsFollowUp: true,
      bucket: "New",
    });
    expect(
      after.items.find((item) => item.contactId === "contact:michael-chen"),
    ).toMatchObject({
      needsFollowUp: true,
      bucket: "new",
    });
    expect(detail).toMatchObject({
      needsFollowUp: true,
      bucket: "new",
    });
  });

  it("clears needsFollowUp without mutating unread state", async () => {
    const formData = new FormData();
    formData.set("contactId", "contact:michael-chen");
    await markInboxNeedsFollowUpAction(formData);

    const result = await clearInboxNeedsFollowUpAction(formData);
    if (!runtime) throw new Error("runtime not initialized");
    const projection =
      await runtime.context.repositories.inboxProjection.findByContactId(
        "contact:michael-chen",
      );
    const followUpList = await getInboxList("follow-up");

    expect(result).toMatchObject({
      ok: true,
      data: {
        contactId: "contact:michael-chen",
        needsFollowUp: false,
      },
    });
    expect(projection).toMatchObject({
      contactId: "contact:michael-chen",
      needsFollowUp: false,
      bucket: "New",
    });
    expect(followUpList.items).toHaveLength(0);
  });

  it("does not clobber fresher projection state when follow-up is toggled", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    const staleProjection =
      await runtime.context.repositories.inboxProjection.findByContactId(
        "contact:michael-chen",
      );
    const fresherEvent = await seedInboxEmailEvent(runtime.context, {
      id: "michael-inbound-2",
      contactId: "contact:michael-chen",
      occurredAt: "2026-04-14T14:30:00.000Z",
      direction: "inbound",
      subject: "Latest logistics update",
      snippet: "Fresh inbound message that arrived after the stale snapshot.",
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
      lastEventType: "communication.email.inbound",
    });

    const findByContactIdSpy = vi
      .spyOn(runtime.context.repositories.inboxProjection, "findByContactId")
      .mockResolvedValue(staleProjection ?? null);
    const upsertSpy = vi.spyOn(
      runtime.context.repositories.inboxProjection,
      "upsert",
    );
    const formData = new FormData();
    formData.set("contactId", "contact:michael-chen");

    const result = await markInboxNeedsFollowUpAction(formData);
    expect(findByContactIdSpy).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();
    findByContactIdSpy.mockRestore();
    upsertSpy.mockRestore();
    const projection =
      await runtime.context.repositories.inboxProjection.findByContactId(
        "contact:michael-chen",
      );

    expect(result).toMatchObject({
      ok: true,
      data: {
        contactId: "contact:michael-chen",
        needsFollowUp: true,
      },
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
      lastEventType: "communication.email.inbound",
    });
  });

  it("rejects follow-up mutations when the operator session is missing", async () => {
    requireSession.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    const formData = new FormData();
    formData.set("contactId", "contact:michael-chen");

    const result = await markInboxNeedsFollowUpAction(formData);
    if (!runtime) throw new Error("runtime not initialized");
    const projection =
      await runtime.context.repositories.inboxProjection.findByContactId(
        "contact:michael-chen",
      );

    expect(result).toMatchObject({
      ok: false,
      code: "unauthorized",
    });
    expect(projection).toMatchObject({
      contactId: "contact:michael-chen",
      needsFollowUp: false,
    });
  });

  it("rate limits repeated follow-up toggles per authenticated user and audits the denial", async () => {
    const formData = new FormData();
    formData.set("contactId", "contact:michael-chen");

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await markInboxNeedsFollowUpAction(formData);
      expect(result.ok).toBe(true);
    }

    const limitedResult = await markInboxNeedsFollowUpAction(formData);
    if (!runtime) throw new Error("runtime not initialized");
    const audits =
      await runtime.context.repositories.auditEvidence.listByEntity({
        entityType: "server_action",
        entityId: "inbox.follow_up",
      });
    const latestAudit = audits.at(-1);

    expect(limitedResult).toMatchObject({
      ok: false,
      code: "rate_limit_exceeded",
    });
    expect(latestAudit).toMatchObject({
      actorType: "user",
      actorId: "user:nico",
      action: "inbox.follow_up.rate_limited",
      result: "denied",
      policyCode: "security.rate_limit",
    });
    expect(latestAudit?.metadataJson).toMatchObject({
      reason: "rate_limit_exceeded",
      contactId: "contact:michael-chen",
      limit: 30,
    });
  });

  it("returns a non-retryable AI misconfiguration result for missing schema errors", async () => {
    const error = new Error("relation project_knowledge_entries does not exist");
    (
      error as Error & {
        cause: { code: string };
      }
    ).cause = { code: "42P01" };
    generateAiDraft.mockRejectedValueOnce(error);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const result = await draftWithAiAction({
      mode: "draft",
      contactId: "contact:sarah-martinez",
      projectId: "project:amazon-basin",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "ai_draft_misconfigured",
      retryable: false,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "AI draft generation is not fully configured.",
      expect.objectContaining({
        code: "42P01",
        name: "Error",
      }),
    );
    warnSpy.mockRestore();
  });

  it("keeps generic AI draft failures retryable", async () => {
    generateAiDraft.mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const result = await draftWithAiAction({
      mode: "draft",
      contactId: "contact:sarah-martinez",
      projectId: "project:amazon-basin",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "ai_draft_failed",
      retryable: true,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "AI draft generation failed unexpectedly.",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });
});
