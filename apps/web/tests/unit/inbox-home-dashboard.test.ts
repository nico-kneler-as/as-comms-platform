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
    expect(result.lastSuccessAt?.toISOString()).toBe("2026-05-07T11:50:00.000Z");
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

  it("rolls connected sub-project signups into the host's tile and hides the sub from the tile list", async () => {
    // Migration 0056 lets two Salesforce projects share an inbox alias: one
    // is the host, the other is a connected sub-project. The dashboard must
    // present them as a single tile (the host's), with the sub's signups,
    // training completions, and unread counts folded in.
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    // Host project + a contact + signup directly on the host. (Existing path.)
    await seedInboxContact(runtime.context, {
      contactId: "contact:host-volunteer",
      salesforceContactId: "003-host-volunteer",
      displayName: "Host Volunteer",
      primaryEmail: "host-volunteer@example.org",
      primaryPhone: null,
      projectId: "project:beech",
      projectName: "Beech",
      projectAlias: "Beech",
      membershipId: "membership:host",
      membershipStatus: "active",
      membershipCreatedAt: "2026-04-20T12:00:00.000Z",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "lifecycle-host-signup",
      contactId: "contact:host-volunteer",
      occurredAt: "2026-05-07T10:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Host signed up",
      projectId: "project:beech",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:host-volunteer",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-05-07T11:00:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-05-07T11:00:00.000Z",
      snippet: "Host inbound",
      lastCanonicalEventId: "event:lifecycle-host-signup",
      lastEventType: "communication.email.inbound",
    });

    // Connected sub-project + a contact + signup. This contact has no host
    // membership; only a sub-project membership.
    await seedInboxContact(runtime.context, {
      contactId: "contact:sub-volunteer",
      salesforceContactId: "003-sub-volunteer",
      displayName: "Sub Volunteer",
      primaryEmail: "sub-volunteer@example.org",
      primaryPhone: null,
      projectId: "project:butternut",
      projectName: "Butternut",
      // Connected sub-projects don't need their own alias under 0056. The
      // helper's default would set one; pass null explicitly to mirror the
      // production shape.
      projectAlias: null,
      membershipId: "membership:sub",
      membershipStatus: "active",
      membershipCreatedAt: "2026-04-20T12:30:00.000Z",
    });
    // Mark the sub-project as connected to the host AFTER the project row
    // exists. The seed helper doesn't accept connectedToProjectId; do the
    // upsert directly.
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:butternut",
      projectName: "Butternut",
      projectAlias: null,
      source: "salesforce",
      isActive: true,
      connectedToProjectId: "project:beech",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "lifecycle-sub-signup",
      contactId: "contact:sub-volunteer",
      occurredAt: "2026-05-07T10:30:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Sub signed up",
      projectId: "project:butternut",
    });
    await seedInboxProjection(runtime.context, {
      contactId: "contact:sub-volunteer",
      bucket: "New",
      needsFollowUp: false,
      hasUnresolved: false,
      lastInboundAt: "2026-05-07T11:30:00.000Z",
      lastOutboundAt: null,
      lastActivityAt: "2026-05-07T11:30:00.000Z",
      snippet: "Sub inbound",
      lastCanonicalEventId: "event:lifecycle-sub-signup",
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

    // Only the host appears as a tile.
    expect(result.tiles.map((tile) => tile.projectId)).toEqual([
      "project:beech",
    ]);
    const beech = result.tiles[0];
    expect(beech).toBeDefined();
    if (beech === undefined) {
      throw new Error("Expected beech tile");
    }
    // Both signups (host + sub) credited to the host.
    expect(beech.totals.signups).toBe(2);
    expect(beech.today.signups).toBe(2);
    expect(beech.sparkline.signups).toEqual([0, 0, 0, 0, 0, 0, 2]);
    // Both unread inbound contacts (host + sub) counted under the host's tile,
    // because buildInboxProjectPredicate's connected-projects branch makes
    // countByFilters include sub-project members.
    expect(beech.unreadCount).toBe(2);
  });
});
