import { describe, expect, it } from "vitest";

import {
  bucketEventsByUtcDay,
  buildProjectLifecycleMetrics,
  type LifecycleEventRow,
  type MembershipRow,
  type ProjectRow,
} from "../../app/inbox/_lib/project-lifecycle-metrics";

function date(value: string): Date {
  return new Date(value);
}

function buildEvent(
  overrides: Partial<LifecycleEventRow> = {},
): LifecycleEventRow {
  return {
    contactId: overrides.contactId ?? "contact-1",
    eventType: overrides.eventType ?? "lifecycle.signed_up",
    occurredAt: overrides.occurredAt ?? date("2026-05-07T10:00:00.000Z"),
  };
}

function buildMembership(
  overrides: Partial<MembershipRow> = {},
): MembershipRow {
  return {
    contactId: overrides.contactId ?? "contact-1",
    projectId: overrides.projectId ?? "project-a",
  };
}

function buildProject(
  overrides: Partial<ProjectRow> = {},
): ProjectRow {
  return {
    projectId: overrides.projectId ?? "project-a",
    projectName: overrides.projectName ?? "Alpha Project",
    projectTone: overrides.projectTone ?? "sky",
    isActive: overrides.isActive ?? true,
    unreadCount: overrides.unreadCount ?? 0,
  };
}

describe("bucketEventsByUtcDay", () => {
  it("separates adjacent UTC-midnight boundary events into different buckets", () => {
    const now = date("2026-05-07T12:00:00.000Z");

    expect(
      bucketEventsByUtcDay({
        occurredAts: [
          date("2026-05-05T23:59:59.999Z"),
          date("2026-05-06T00:00:00.000Z"),
        ],
        now,
      }),
    ).toEqual([0, 0, 0, 0, 1, 1, 0]);
  });

  it("ignores out-of-window events", () => {
    const now = date("2026-05-07T12:00:00.000Z");

    expect(
      bucketEventsByUtcDay({
        occurredAts: [
          date("2026-04-29T23:59:59.999Z"),
          date("2026-05-08T00:00:00.000Z"),
        ],
        now,
      }),
    ).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("returns zero-filled arrays for empty input", () => {
    expect(
      bucketEventsByUtcDay({
        occurredAts: [],
        now: date("2026-05-07T12:00:00.000Z"),
      }),
    ).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("respects a custom day count", () => {
    expect(
      bucketEventsByUtcDay({
        occurredAts: [date("2026-05-07T12:00:00.000Z")],
        now: date("2026-05-07T12:00:00.000Z"),
        days: 3,
      }),
    ).toEqual([0, 0, 1]);
  });
});

describe("buildProjectLifecycleMetrics", () => {
  it("returns an empty result for empty input", () => {
    expect(
      buildProjectLifecycleMetrics({
        events: [],
        memberships: [],
        projects: [],
        now: date("2026-05-07T12:00:00.000Z"),
      }),
    ).toEqual([]);
  });

  it("preserves active zero-event projects with zero totals and seven-day sparklines", () => {
    expect(
      buildProjectLifecycleMetrics({
        events: [],
        memberships: [],
        projects: [
          buildProject({
            projectId: "project-a",
            projectName: "Alpha",
            unreadCount: 3,
          }),
        ],
        now: date("2026-05-07T12:00:00.000Z"),
      }),
    ).toEqual([
      {
        projectId: "project-a",
        projectName: "Alpha",
        projectTone: "sky",
        unreadCount: 3,
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

  it("excludes inactive projects even when lifecycle events exist", () => {
    expect(
      buildProjectLifecycleMetrics({
        events: [
          buildEvent({
            contactId: "contact-1",
            occurredAt: date("2026-05-07T10:00:00.000Z"),
          }),
        ],
        memberships: [buildMembership()],
        projects: [
          buildProject({
            projectId: "project-a",
            projectName: "Alpha",
            isActive: false,
          }),
        ],
        now: date("2026-05-07T12:00:00.000Z"),
      }),
    ).toEqual([]);
  });

  it("orders projects by seven-day total activity descending", () => {
    const now = date("2026-05-07T12:00:00.000Z");

    const result = buildProjectLifecycleMetrics({
      events: [
        buildEvent({
          contactId: "contact-a1",
          occurredAt: date("2026-05-07T08:00:00.000Z"),
        }),
        buildEvent({
          contactId: "contact-a2",
          occurredAt: date("2026-05-06T08:00:00.000Z"),
        }),
        buildEvent({
          contactId: "contact-b1",
          eventType: "lifecycle.completed_training",
          occurredAt: date("2026-05-05T08:00:00.000Z"),
        }),
      ],
      memberships: [
        buildMembership({ contactId: "contact-a1", projectId: "project-a" }),
        buildMembership({ contactId: "contact-a2", projectId: "project-a" }),
        buildMembership({ contactId: "contact-b1", projectId: "project-b" }),
      ],
      projects: [
        buildProject({ projectId: "project-b", projectName: "Beta" }),
        buildProject({ projectId: "project-a", projectName: "Alpha" }),
        buildProject({ projectId: "project-c", projectName: "Gamma" }),
      ],
      now,
    });

    expect(result.map((project) => project.projectId)).toEqual([
      "project-a",
      "project-b",
      "project-c",
    ]);
  });

  it("breaks activity ties alphabetically by project name", () => {
    const result = buildProjectLifecycleMetrics({
      events: [
        buildEvent({
          contactId: "contact-1",
          occurredAt: date("2026-05-07T08:00:00.000Z"),
        }),
        buildEvent({
          contactId: "contact-2",
          occurredAt: date("2026-05-07T08:00:00.000Z"),
        }),
      ],
      memberships: [
        buildMembership({ contactId: "contact-1", projectId: "project-b" }),
        buildMembership({ contactId: "contact-2", projectId: "project-a" }),
      ],
      projects: [
        buildProject({ projectId: "project-b", projectName: "Zulu" }),
        buildProject({ projectId: "project-a", projectName: "Alpha" }),
      ],
      now: date("2026-05-07T12:00:00.000Z"),
    });

    expect(result.map((project) => project.projectName)).toEqual([
      "Alpha",
      "Zulu",
    ]);
  });

  it("deduplicates repeated ledger rows for the same contact, project, and milestone", () => {
    const result = buildProjectLifecycleMetrics({
      events: [
        buildEvent({
          contactId: "contact-1",
          occurredAt: date("2026-05-06T10:00:00.000Z"),
        }),
        buildEvent({
          contactId: "contact-1",
          occurredAt: date("2026-05-07T10:00:00.000Z"),
        }),
      ],
      memberships: [buildMembership()],
      projects: [buildProject()],
      now: date("2026-05-07T12:00:00.000Z"),
    });

    expect(result[0]?.totals.signups).toBe(1);
    expect(result[0]?.today.signups).toBe(0);
    expect(result[0]?.sparkline.signups).toEqual([0, 0, 0, 0, 0, 1, 0]);
  });

  it("counts the same milestone for the same contact across different projects", () => {
    const result = buildProjectLifecycleMetrics({
      events: [buildEvent()],
      memberships: [
        buildMembership({ projectId: "project-a" }),
        buildMembership({ projectId: "project-b" }),
      ],
      projects: [
        buildProject({ projectId: "project-a", projectName: "Alpha" }),
        buildProject({ projectId: "project-b", projectName: "Beta" }),
      ],
      now: date("2026-05-07T12:00:00.000Z"),
    });

    expect(result.map((project) => project.totals.signups)).toEqual([1, 1]);
  });

  it("includes events just after the window start and excludes events just before it", () => {
    const now = date("2026-05-07T00:00:00.000Z");

    const result = buildProjectLifecycleMetrics({
      events: [
        buildEvent({
          contactId: "contact-inside",
          occurredAt: date("2026-05-01T00:00:00.001Z"),
        }),
        buildEvent({
          contactId: "contact-outside",
          occurredAt: date("2026-04-30T23:59:59.999Z"),
        }),
      ],
      memberships: [
        buildMembership({
          contactId: "contact-inside",
          projectId: "project-a",
        }),
        buildMembership({
          contactId: "contact-outside",
          projectId: "project-a",
        }),
      ],
      projects: [buildProject()],
      now,
    });

    expect(result[0]?.totals.signups).toBe(1);
    expect(result[0]?.sparkline.signups).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });

  it("excludes future events", () => {
    const result = buildProjectLifecycleMetrics({
      events: [
        buildEvent({
          occurredAt: date("2026-05-08T00:00:00.000Z"),
        }),
      ],
      memberships: [buildMembership()],
      projects: [buildProject()],
      now: date("2026-05-07T12:00:00.000Z"),
    });

    expect(result[0]?.totals.signups).toBe(0);
  });

  it("counts only the current UTC day in the today metric", () => {
    const result = buildProjectLifecycleMetrics({
      events: [
        buildEvent({
          contactId: "today-contact",
          occurredAt: date("2026-05-07T10:00:00.000Z"),
        }),
        buildEvent({
          contactId: "yesterday-contact",
          occurredAt: date("2026-05-06T23:59:59.999Z"),
        }),
      ],
      memberships: [
        buildMembership({ contactId: "today-contact" }),
        buildMembership({ contactId: "yesterday-contact" }),
      ],
      projects: [buildProject()],
      now: date("2026-05-07T12:00:00.000Z"),
    });

    expect(result[0]?.today.signups).toBe(1);
    expect(result[0]?.totals.signups).toBe(2);
  });

  it("places today at index 6 and yesterday at index 5", () => {
    const result = buildProjectLifecycleMetrics({
      events: [
        buildEvent({
          contactId: "today-contact",
          eventType: "lifecycle.completed_training",
          occurredAt: date("2026-05-07T10:00:00.000Z"),
        }),
        buildEvent({
          contactId: "yesterday-contact",
          eventType: "lifecycle.completed_training",
          occurredAt: date("2026-05-06T10:00:00.000Z"),
        }),
      ],
      memberships: [
        buildMembership({ contactId: "today-contact" }),
        buildMembership({ contactId: "yesterday-contact" }),
      ],
      projects: [buildProject()],
      now: date("2026-05-07T12:00:00.000Z"),
    });

    expect(result[0]?.sparkline.trainingCompletions).toEqual([
      0, 0, 0, 0, 0, 1, 1,
    ]);
  });

  it("rolls many same-day events into a single sparkline bucket", () => {
    const result = buildProjectLifecycleMetrics({
      events: [
        buildEvent({
          contactId: "contact-1",
          eventType: "lifecycle.submitted_first_data",
          occurredAt: date("2026-05-04T01:00:00.000Z"),
        }),
        buildEvent({
          contactId: "contact-2",
          eventType: "lifecycle.submitted_first_data",
          occurredAt: date("2026-05-04T12:00:00.000Z"),
        }),
        buildEvent({
          contactId: "contact-3",
          eventType: "lifecycle.submitted_first_data",
          occurredAt: date("2026-05-04T23:00:00.000Z"),
        }),
      ],
      memberships: [
        buildMembership({ contactId: "contact-1" }),
        buildMembership({ contactId: "contact-2" }),
        buildMembership({ contactId: "contact-3" }),
      ],
      projects: [buildProject()],
      now: date("2026-05-07T12:00:00.000Z"),
    });

    expect(result[0]?.sparkline.dataSubmissions).toEqual([0, 0, 0, 3, 0, 0, 0]);
    expect(result[0]?.totals.dataSubmissions).toBe(3);
  });
});
