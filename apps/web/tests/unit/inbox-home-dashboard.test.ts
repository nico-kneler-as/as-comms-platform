import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getInboxWelcomeSalesforceLifecycle } from "../../app/inbox/_lib/home-dashboard";
import { projectToneFromName } from "../../app/inbox/_lib/project-tone";
import {
  createInboxTestRuntime,
  seedInboxContact,
  seedInboxLifecycleEvent,
  seedInboxProjection,
  type InboxTestRuntime,
} from "./inbox-stage1-helpers";

describe("getInboxWelcomeSalesforceLifecycle", () => {
  let runtime: InboxTestRuntime | null = null;

  beforeEach(async () => {
    runtime = await createInboxTestRuntime();
  });

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("returns lifecycle tiles and freshness from runtime-backed fixtures", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:active",
      salesforceContactId: "003-active",
      displayName: "Active Contact",
      primaryEmail: "active@example.org",
      primaryPhone: null,
      projectId: "project:alpha",
      projectName: "Alpha Research",
      projectAlias: "Alpha",
      membershipId: "membership:alpha",
      membershipStatus: "active",
      membershipCreatedAt: "2026-04-20T12:00:00.000Z",
    });
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:beta",
      projectName: "Beta Research",
      projectAlias: "Beta",
      source: "salesforce",
      isActive: true,
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "lifecycle-alpha-signup",
      contactId: "contact:active",
      occurredAt: "2026-05-07T10:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:alpha",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:active",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-05-07T11:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-05-07T11:00:00.000Z",
      snippet: "Unread inbound",
      lastCanonicalEventId: "event:lifecycle-alpha-signup",
      lastEventType: "communication.email.inbound",
    });
    await runtime.context.settings.integrationHealth.seedDefaults();
    const salesforceHealth =
      await runtime.context.settings.integrationHealth.findById("salesforce");

    if (salesforceHealth === null) {
      throw new Error("Expected seeded Salesforce integration health row");
    }

    await runtime.context.settings.integrationHealth.upsert({
      ...salesforceHealth,
      status: "healthy",
      lastCheckedAt: "2026-05-07T11:55:00.000Z",
      updatedAt: "2026-05-07T11:55:00.000Z",
    });
    await runtime.context.repositories.syncState.upsert({
      id: "sync:salesforce:live:latest",
      scope: "provider",
      provider: "salesforce",
      jobType: "live_ingest",
      cursor: "cursor:salesforce",
      windowStart: "2026-05-07T11:45:00.000Z",
      windowEnd: "2026-05-07T11:50:00.000Z",
      status: "succeeded",
      parityPercent: null,
      freshnessP95Seconds: null,
      freshnessP99Seconds: null,
      lastSuccessfulAt: "2026-05-07T11:50:00.000Z",
      consecutiveFailureCount: 0,
      leaseOwner: null,
      heartbeatAt: null,
      deadLetterCount: 0,
    });

    const result = await getInboxWelcomeSalesforceLifecycle({
      now: new Date("2026-05-07T12:00:00.000Z"),
    });

    expect(result.freshness).toBe("fresh");
    expect(result.tiles).toEqual([
      {
        projectId: "project:alpha",
        projectName: "Alpha",
        projectTone: projectToneFromName("Alpha"),
        unreadCount: 1,
        totals: {
          signups: 1,
          trainingCompletions: 0,
          dataSubmissions: 0,
        },
        today: {
          signups: 1,
          trainingCompletions: 0,
          dataSubmissions: 0,
        },
        sparkline: {
          signups: [0, 0, 0, 0, 0, 0, 1],
          trainingCompletions: [0, 0, 0, 0, 0, 0, 0],
          dataSubmissions: [0, 0, 0, 0, 0, 0, 0],
        },
      },
      {
        projectId: "project:beta",
        projectName: "Beta",
        projectTone: projectToneFromName("Beta"),
        unreadCount: 0,
        totals: {
          signups: 0,
          trainingCompletions: 0,
          dataSubmissions: 0,
        },
        today: {
          signups: 0,
          trainingCompletions: 0,
          dataSubmissions: 0,
        },
        sparkline: {
          signups: [0, 0, 0, 0, 0, 0, 0],
          trainingCompletions: [0, 0, 0, 0, 0, 0, 0],
          dataSubmissions: [0, 0, 0, 0, 0, 0, 0],
        },
      },
    ]);
  });
});
