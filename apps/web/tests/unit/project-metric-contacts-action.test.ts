import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.hoisted(() => vi.fn());
const getCurrentUser = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
}));

vi.mock("@/src/server/auth/session", () => ({
  requireSession,
  getCurrentUser,
}));

import { loadProjectMetricContacts } from "../../app/inbox/actions";
import {
  createInboxTestRuntime,
  seedInboxContact,
  seedInboxLifecycleEvent,
  type InboxTestRuntime,
} from "./inbox-stage1-helpers";

function buildCurrentUser() {
  const now = new Date("2026-05-07T12:00:00.000Z");
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

describe("loadProjectMetricContacts", () => {
  let runtime: InboxTestRuntime | null = null;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T12:00:00.000Z"));
    requireSession.mockReset();
    requireSession.mockResolvedValue(buildCurrentUser());
    runtime = await createInboxTestRuntime();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await runtime?.dispose();
    runtime = null;
  });

  it("returns deduped rows newest-first within the last 7 UTC calendar days", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: "contact:alpha",
      salesforceContactId: "003-alpha",
      displayName: "Alpha Person",
      primaryEmail: "alpha@example.org",
      primaryPhone: null,
      projectId: "project:alpha",
      projectName: "Alpha Research",
      projectAlias: "Alpha",
      membershipId: "membership:alpha",
      membershipStatus: "active",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:bravo",
      salesforceContactId: "003-bravo",
      displayName: "Bravo Person",
      primaryEmail: "bravo@example.org",
      primaryPhone: null,
      projectId: "project:alpha",
      projectName: "Alpha Research",
      projectAlias: "Alpha",
      membershipId: "membership:bravo",
      membershipStatus: "active",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:charlie",
      salesforceContactId: "003-charlie",
      displayName: "Charlie Person",
      primaryEmail: "charlie@example.org",
      primaryPhone: null,
      projectId: "project:beta",
      projectName: "Beta Research",
      projectAlias: "Beta",
      membershipId: "membership:charlie",
      membershipStatus: "active",
    });
    await seedInboxContact(runtime.context, {
      contactId: "contact:delta",
      salesforceContactId: "003-delta",
      displayName: "Delta Person",
      primaryEmail: "delta@example.org",
      primaryPhone: null,
      projectId: "project:alpha",
      projectName: "Alpha Research",
      projectAlias: "Alpha",
      membershipId: "membership:delta",
      membershipStatus: "active",
    });

    await seedInboxLifecycleEvent(runtime.context, {
      id: "alpha-signup-earliest",
      contactId: "contact:alpha",
      occurredAt: "2026-05-03T08:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:alpha",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "alpha-signup-reemit",
      contactId: "contact:alpha",
      occurredAt: "2026-05-06T09:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up again",
      projectId: "project:alpha",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "bravo-signup",
      contactId: "contact:bravo",
      occurredAt: "2026-05-05T11:00:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:alpha",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "charlie-signup",
      contactId: "contact:charlie",
      occurredAt: "2026-05-07T09:30:00.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:beta",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: "delta-outside-window",
      contactId: "contact:delta",
      occurredAt: "2026-04-30T23:59:59.000Z",
      eventType: "lifecycle.signed_up",
      summary: "Signed up",
      projectId: "project:alpha",
    });

    const result = await loadProjectMetricContacts({
      projectId: "project:alpha",
      metricKey: "signups",
    });

    expect(result).toEqual({
      rows: [
        {
          contactId: "contact:bravo",
          name: "Bravo Person",
          email: "bravo@example.org",
          occurredAt: "2026-05-05T11:00:00.000Z",
        },
        {
          contactId: "contact:alpha",
          name: "Alpha Person",
          email: "alpha@example.org",
          occurredAt: "2026-05-03T08:00:00.000Z",
        },
      ],
    });
  });

  it.each([
    {
      metricKey: "signups" as const,
      includedEventType: "lifecycle.signed_up" as const,
      excludedEventType: "lifecycle.completed_training" as const,
    },
    {
      metricKey: "trainingCompletions" as const,
      includedEventType: "lifecycle.completed_training" as const,
      excludedEventType: "lifecycle.submitted_first_data" as const,
    },
    {
      metricKey: "dataSubmissions" as const,
      includedEventType: "lifecycle.submitted_first_data" as const,
      excludedEventType: "lifecycle.signed_up" as const,
    },
  ])("maps $metricKey to the correct canonical event type", async ({
    metricKey,
    includedEventType,
    excludedEventType,
  }) => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await seedInboxContact(runtime.context, {
      contactId: `contact:${metricKey}`,
      salesforceContactId: `003:${metricKey}`,
      displayName: `Contact ${metricKey}`,
      primaryEmail: `${metricKey}@example.org`,
      primaryPhone: null,
      projectId: "project:alpha",
      projectName: "Alpha Research",
      projectAlias: "Alpha",
      membershipId: `membership:${metricKey}`,
      membershipStatus: "active",
    });

    await seedInboxLifecycleEvent(runtime.context, {
      id: `${metricKey}:included`,
      contactId: `contact:${metricKey}`,
      occurredAt: "2026-05-07T10:00:00.000Z",
      eventType: includedEventType,
      summary: "Included event",
      projectId: "project:alpha",
    });
    await seedInboxLifecycleEvent(runtime.context, {
      id: `${metricKey}:excluded`,
      contactId: `contact:${metricKey}`,
      occurredAt: "2026-05-07T11:00:00.000Z",
      eventType: excludedEventType,
      summary: "Excluded event",
      projectId: "project:alpha",
    });

    const result = await loadProjectMetricContacts({
      projectId: "project:alpha",
      metricKey,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.contactId).toBe(`contact:${metricKey}`);
    expect(result.rows[0]?.occurredAt).toBe("2026-05-07T10:00:00.000Z");
  });

  it("returns an empty list for missing, inactive, or membershipless projects", async () => {
    if (runtime === null) {
      throw new Error("Expected inbox test runtime");
    }

    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:inactive",
      projectName: "Inactive Project",
      projectAlias: "Inactive",
      source: "salesforce",
      isActive: false,
    });
    await runtime.context.repositories.projectDimensions.upsert({
      projectId: "project:empty",
      projectName: "Empty Project",
      projectAlias: "Empty",
      source: "salesforce",
      isActive: true,
    });

    expect(
      await loadProjectMetricContacts({
        projectId: "project:missing",
        metricKey: "signups",
      }),
    ).toEqual({ rows: [] });

    expect(
      await loadProjectMetricContacts({
        projectId: "project:inactive",
        metricKey: "signups",
      }),
    ).toEqual({ rows: [] });

    expect(
      await loadProjectMetricContacts({
        projectId: "project:empty",
        metricKey: "signups",
      }),
    ).toEqual({ rows: [] });
  });
});
