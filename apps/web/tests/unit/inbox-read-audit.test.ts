import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
}));

vi.mock("@/src/server/auth/session", () => ({
  getCurrentUser,
}));

import { getInboxDetail } from "../../app/inbox/_lib/selectors";
import { waitForPendingSecurityAuditTasksForTests } from "../../src/server/security/audit";
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

describe("inbox detail read audit", () => {
  let runtime: InboxTestRuntime | null = null;

  beforeEach(async () => {
    getCurrentUser.mockReset();
    getCurrentUser.mockResolvedValue(buildCurrentUser());
    runtime = await createInboxTestRuntime();

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
    const latest = await seedInboxEmailEvent(runtime.context, {
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
      lastCanonicalEventId: latest.canonicalEventId,
      lastEventType: "communication.email.inbound",
    });
  });

  afterEach(async () => {
    await waitForPendingSecurityAuditTasksForTests();
    await runtime?.dispose();
    runtime = null;
  });

  it("records who opened a contact timeline without blocking the read", async () => {
    const detail = await getInboxDetail("contact:sarah-martinez");
    if (!runtime) {
      throw new Error("runtime not initialized");
    }

    await waitForPendingSecurityAuditTasksForTests();

    const audits =
      await runtime.context.repositories.auditEvidence.listByEntity({
        entityType: "contact",
        entityId: "contact:sarah-martinez",
      });
    const latestAudit = audits.at(-1);

    expect(detail).not.toBeNull();
    expect(latestAudit).toMatchObject({
      actorType: "user",
      actorId: "user:nico",
      action: "contact.timeline.read",
      result: "recorded",
      policyCode: "security.read_audit",
    });
    expect(latestAudit?.metadataJson).toMatchObject({
      timelineCount: 1,
    });
  });
});
