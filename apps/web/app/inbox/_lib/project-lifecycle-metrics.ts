export type LifecycleEventType =
  | "lifecycle.signed_up"
  | "lifecycle.completed_training"
  | "lifecycle.submitted_first_data";

export interface LifecycleEventRow {
  readonly contactId: string;
  readonly eventType: LifecycleEventType;
  readonly occurredAt: Date;
}

export interface MembershipRow {
  readonly contactId: string;
  readonly projectId: string;
}

export interface ProjectRow {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectTone: string;
  readonly isActive: boolean;
  readonly unreadCount: number;
}

export type MetricKey =
  | "signups"
  | "trainingCompletions"
  | "dataSubmissions";

export interface MetricCounts {
  readonly signups: number;
  readonly trainingCompletions: number;
  readonly dataSubmissions: number;
}

export interface ProjectLifecycleTile {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectTone: string;
  readonly unreadCount: number;
  readonly totals: MetricCounts;
  readonly today: MetricCounts;
  readonly sparkline: {
    readonly signups: readonly number[];
    readonly trainingCompletions: readonly number[];
    readonly dataSubmissions: readonly number[];
  };
}

interface MutableMetricCounts {
  signups: number;
  trainingCompletions: number;
  dataSubmissions: number;
}

const DEFAULT_DAYS = 7;
const METRIC_KEYS = [
  "signups",
  "trainingCompletions",
  "dataSubmissions",
] as const satisfies readonly MetricKey[];
const MS_PER_DAY = 24 * 60 * 60 * 1_000;

function startOfUtcDay(date: Date): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0,
  );
}

function buildZeroCounts(): MetricCounts {
  return {
    signups: 0,
    trainingCompletions: 0,
    dataSubmissions: 0,
  };
}

function metricKeyFromEventType(eventType: LifecycleEventType): MetricKey {
  switch (eventType) {
    case "lifecycle.signed_up":
      return "signups";
    case "lifecycle.completed_training":
      return "trainingCompletions";
    case "lifecycle.submitted_first_data":
      return "dataSubmissions";
  }
}

function getUtcDayIndex(input: {
  readonly occurredAt: Date;
  readonly now: Date;
  readonly days: number;
}): number | null {
  const occurredAtMs = input.occurredAt.getTime();
  const nowMs = input.now.getTime();

  if (Number.isNaN(occurredAtMs) || Number.isNaN(nowMs) || occurredAtMs > nowMs) {
    return null;
  }

  const todayStartMs = startOfUtcDay(input.now);
  const windowStartMs = todayStartMs - (input.days - 1) * MS_PER_DAY;
  const occurredDayStartMs = startOfUtcDay(input.occurredAt);

  if (occurredDayStartMs < windowStartMs || occurredDayStartMs > todayStartMs) {
    return null;
  }

  return Math.floor((occurredDayStartMs - windowStartMs) / MS_PER_DAY);
}

export function bucketEventsByUtcDay(input: {
  readonly occurredAts: readonly Date[];
  readonly now: Date;
  readonly days?: number;
}): readonly number[] {
  const days = Math.max(0, input.days ?? DEFAULT_DAYS);
  const buckets = Array.from({ length: days }, () => 0);

  for (const occurredAt of input.occurredAts) {
    const index = getUtcDayIndex({
      occurredAt,
      now: input.now,
      days,
    });

    if (index !== null && index >= 0 && index < buckets.length) {
      const current = buckets[index] ?? 0;
      buckets[index] = current + 1;
    }
  }

  return buckets;
}

export function buildProjectLifecycleMetrics(input: {
  readonly events: readonly LifecycleEventRow[];
  readonly memberships: readonly MembershipRow[];
  readonly projects: readonly ProjectRow[];
  readonly now: Date;
}): readonly ProjectLifecycleTile[] {
  const activeProjects = input.projects.filter((project) => project.isActive);
  if (activeProjects.length === 0) {
    return [];
  }

  const activeProjectIds = new Set(
    activeProjects.map((project) => project.projectId),
  );
  const projectIdsByContactId = new Map<string, Set<string>>();

  for (const membership of input.memberships) {
    if (!activeProjectIds.has(membership.projectId)) {
      continue;
    }

    let projectIds = projectIdsByContactId.get(membership.contactId);
    if (projectIds === undefined) {
      projectIds = new Set<string>();
      projectIdsByContactId.set(membership.contactId, projectIds);
    }

    projectIds.add(membership.projectId);
  }

  const earliestEventByContactProjectMetric = new Map<string, Date>();

  for (const event of input.events) {
    const dayIndex = getUtcDayIndex({
      occurredAt: event.occurredAt,
      now: input.now,
      days: DEFAULT_DAYS,
    });
    if (dayIndex === null) {
      continue;
    }

    const projectIds = projectIdsByContactId.get(event.contactId);
    if (projectIds === undefined || projectIds.size === 0) {
      continue;
    }

    const metricKey = metricKeyFromEventType(event.eventType);
    for (const projectId of projectIds) {
      const dedupeKey = `${event.contactId}::${projectId}::${metricKey}`;
      const existing = earliestEventByContactProjectMetric.get(dedupeKey);

      if (existing === undefined || event.occurredAt.getTime() < existing.getTime()) {
        earliestEventByContactProjectMetric.set(dedupeKey, event.occurredAt);
      }
    }
  }

  const occurredAtsByProjectMetric = new Map<
    string,
    Record<MetricKey, Date[]>
  >();

  for (const project of activeProjects) {
    occurredAtsByProjectMetric.set(project.projectId, {
      signups: [],
      trainingCompletions: [],
      dataSubmissions: [],
    });
  }

  for (const [dedupeKey, occurredAt] of earliestEventByContactProjectMetric) {
    const [, projectId, metricKeyRaw] = dedupeKey.split("::");
    if (projectId === undefined || metricKeyRaw === undefined) {
      continue;
    }

    const metricKey = metricKeyRaw as MetricKey;
    const projectMetrics = occurredAtsByProjectMetric.get(projectId);

    if (projectMetrics !== undefined) {
      projectMetrics[metricKey].push(occurredAt);
    }
  }

  return [...activeProjects]
    .map((project) => {
      const projectMetrics = occurredAtsByProjectMetric.get(project.projectId) ?? {
        signups: [],
        trainingCompletions: [],
        dataSubmissions: [],
      };

      const sparkline = {
        signups: bucketEventsByUtcDay({
          occurredAts: projectMetrics.signups,
          now: input.now,
        }),
        trainingCompletions: bucketEventsByUtcDay({
          occurredAts: projectMetrics.trainingCompletions,
          now: input.now,
        }),
        dataSubmissions: bucketEventsByUtcDay({
          occurredAts: projectMetrics.dataSubmissions,
          now: input.now,
        }),
      };

      const totals: MutableMetricCounts = buildZeroCounts();
      const today: MutableMetricCounts = buildZeroCounts();

      for (const metricKey of METRIC_KEYS) {
        const buckets = sparkline[metricKey];
        const total = buckets.reduce((sum, count) => sum + count, 0);

        totals[metricKey] = total;
        today[metricKey] = buckets[DEFAULT_DAYS - 1] ?? 0;
      }

      return {
        projectId: project.projectId,
        projectName: project.projectName,
        projectTone: project.projectTone,
        unreadCount: project.unreadCount,
        totals,
        today,
        sparkline,
      };
    })
    .sort((left, right) => {
      const leftTotal =
        left.totals.signups +
        left.totals.trainingCompletions +
        left.totals.dataSubmissions;
      const rightTotal =
        right.totals.signups +
        right.totals.trainingCompletions +
        right.totals.dataSubmissions;

      if (leftTotal !== rightTotal) {
        return rightTotal - leftTotal;
      }

      return left.projectName.localeCompare(right.projectName);
    });
}
