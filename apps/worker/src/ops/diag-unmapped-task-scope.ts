import { salesforceLaunchScopeAutomatedOwnerUsernames } from "@as-comms/integrations";

export type UnmappedTaskSubjectBucket =
  | "hex"
  | "plan_your"
  | "time_to_plan"
  | "dont_forget"
  | "other";

export interface UnmappedTaskScopeAuditRow {
  readonly policyCode: string;
  readonly entityId: string;
  readonly occurredAt: string;
  readonly taskSubtype: string | null;
  readonly subject: string | null;
  readonly ownerUsername: string | null;
  readonly whoId: string | null;
  readonly relatedMembershipPresent: boolean;
  readonly createdDate: string | null;
  readonly lastModifiedDate: string | null;
}

export interface UnmappedTaskScopeOwnerBucket {
  readonly ownerUsername: string;
  readonly count: number;
  readonly launchScopeOwner: boolean;
}

export interface UnmappedTaskScopeClusterSample {
  readonly ownerUsername: string;
  readonly taskSubtype: string;
  readonly rows: readonly UnmappedTaskScopeAuditRow[];
}

export interface UnmappedTaskScopeReport {
  readonly totalRows: number;
  readonly taskSubtypeDistribution: Readonly<Record<string, number>>;
  readonly ownerUsernameDistribution: readonly UnmappedTaskScopeOwnerBucket[];
  readonly subjectBucketDistribution: Readonly<
    Record<UnmappedTaskSubjectBucket, number>
  >;
  readonly last30DayCounts: readonly {
    readonly day: string;
    readonly count: number;
  }[];
  readonly samplesByCluster: readonly UnmappedTaskScopeClusterSample[];
}

const hexSubjectPattern = /\bhex\s+\d+\b/iu;
const planYourPattern = /^\s*plan your\b/iu;
const timeToPlanPattern = /^\s*time to plan\b/iu;
const dontForgetPattern = /^\s*don['’]t forget\b/iu;

function incrementCounter(
  counters: Map<string, number>,
  key: string
): void {
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

function toSortedRecord(counters: Map<string, number>): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Array.from(counters.entries()).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

export function classifyUnmappedTaskSubjectBucket(
  subject: string | null
): UnmappedTaskSubjectBucket {
  if (subject === null) {
    return "other";
  }

  if (hexSubjectPattern.test(subject)) {
    return "hex";
  }

  if (planYourPattern.test(subject)) {
    return "plan_your";
  }

  if (timeToPlanPattern.test(subject)) {
    return "time_to_plan";
  }

  if (dontForgetPattern.test(subject)) {
    return "dont_forget";
  }

  return "other";
}

function toOwnerKey(ownerUsername: string | null): string {
  return ownerUsername?.trim() ?? "(missing)";
}

function toTaskSubtypeKey(taskSubtype: string | null): string {
  return taskSubtype?.trim() ?? "(missing)";
}

function toDayKey(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function makeClusterKey(ownerUsername: string, taskSubtype: string): string {
  return JSON.stringify([ownerUsername, taskSubtype]);
}

function parseClusterKey(clusterKey: string): {
  readonly ownerUsername: string;
  readonly taskSubtype: string;
} {
  const parsed = JSON.parse(clusterKey) as unknown;

  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string"
  ) {
    throw new Error(`Invalid unmapped-task cluster key: ${clusterKey}`);
  }

  return {
    ownerUsername: parsed[0],
    taskSubtype: parsed[1]
  };
}

export function buildUnmappedTaskScopeReport(input: {
  readonly rows: readonly UnmappedTaskScopeAuditRow[];
  readonly now?: Date;
}): UnmappedTaskScopeReport {
  const now = input.now ?? new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  const taskSubtypeCounts = new Map<string, number>();
  const ownerCounts = new Map<string, number>();
  const subjectBucketCounts = new Map<UnmappedTaskSubjectBucket, number>();
  const dayCounts = new Map<string, number>();
  const sampleRowsByCluster = new Map<string, UnmappedTaskScopeAuditRow[]>();

  for (const row of input.rows) {
    incrementCounter(taskSubtypeCounts, toTaskSubtypeKey(row.taskSubtype));
    incrementCounter(ownerCounts, toOwnerKey(row.ownerUsername));
    const subjectBucket = classifyUnmappedTaskSubjectBucket(row.subject);
    subjectBucketCounts.set(
      subjectBucket,
      (subjectBucketCounts.get(subjectBucket) ?? 0) + 1
    );

    const occurredAtDate = new Date(row.occurredAt);
    if (!Number.isNaN(occurredAtDate.getTime()) && occurredAtDate >= thirtyDaysAgo) {
      incrementCounter(dayCounts, toDayKey(row.occurredAt));
    }

    const clusterKey = makeClusterKey(
      toOwnerKey(row.ownerUsername),
      toTaskSubtypeKey(row.taskSubtype)
    );
    const clusterRows = sampleRowsByCluster.get(clusterKey) ?? [];
    if (clusterRows.length < 5) {
      clusterRows.push(row);
      sampleRowsByCluster.set(clusterKey, clusterRows);
    }
  }

  const samplesByCluster = Array.from(sampleRowsByCluster.entries())
    .map(([clusterKey, rows]) => {
      const { ownerUsername, taskSubtype } = parseClusterKey(clusterKey);
      return {
        ownerUsername,
        taskSubtype,
        rows
      };
    })
    .sort((left, right) => {
      if (left.ownerUsername !== right.ownerUsername) {
        return left.ownerUsername.localeCompare(right.ownerUsername);
      }

      return left.taskSubtype.localeCompare(right.taskSubtype);
    });

  const ownerUsernameDistribution = Array.from(ownerCounts.entries())
    .map(([ownerUsername, count]) => ({
      ownerUsername,
      count,
      launchScopeOwner: salesforceLaunchScopeAutomatedOwnerUsernames.includes(
        ownerUsername as (typeof salesforceLaunchScopeAutomatedOwnerUsernames)[number]
      )
    }))
    .sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }

      return left.ownerUsername.localeCompare(right.ownerUsername);
    });

  const last30DayCounts = Array.from(dayCounts.entries())
    .map(([day, count]) => ({ day, count }))
    .sort((left, right) => left.day.localeCompare(right.day));

  return {
    totalRows: input.rows.length,
    taskSubtypeDistribution: toSortedRecord(taskSubtypeCounts),
    ownerUsernameDistribution,
    subjectBucketDistribution: {
      hex: subjectBucketCounts.get("hex") ?? 0,
      plan_your: subjectBucketCounts.get("plan_your") ?? 0,
      time_to_plan: subjectBucketCounts.get("time_to_plan") ?? 0,
      dont_forget: subjectBucketCounts.get("dont_forget") ?? 0,
      other: subjectBucketCounts.get("other") ?? 0
    },
    last30DayCounts,
    samplesByCluster
  };
}

function formatSampleRow(row: UnmappedTaskScopeAuditRow): string {
  return JSON.stringify({
    taskId: row.entityId,
    occurredAt: row.occurredAt,
    taskSubtype: row.taskSubtype,
    ownerUsername: row.ownerUsername,
    subject: row.subject,
    whoId: row.whoId,
    relatedMembershipPresent: row.relatedMembershipPresent,
    createdDate: row.createdDate,
    lastModifiedDate: row.lastModifiedDate,
    policyCode: row.policyCode
  });
}

export function renderUnmappedTaskScopeMarkdown(
  report: UnmappedTaskScopeReport
): string {
  const lines = [
    "# Unmapped Salesforce Task Scope",
    "",
    `- total rows: ${String(report.totalRows)}`,
    "",
    "## TaskSubtype distribution"
  ];

  for (const [taskSubtype, count] of Object.entries(report.taskSubtypeDistribution)) {
    lines.push(`- ${taskSubtype}: ${String(count)}`);
  }

  lines.push("", "## Owner.Username distribution");
  for (const owner of report.ownerUsernameDistribution) {
    lines.push(
      `- ${owner.ownerUsername}: ${String(owner.count)}${owner.launchScopeOwner ? " (launch-scope owner)" : ""}`
    );
  }

  lines.push("", "## Subject buckets");
  for (const [bucket, count] of Object.entries(report.subjectBucketDistribution)) {
    lines.push(`- ${bucket}: ${String(count)}`);
  }

  lines.push("", "## Per-day count (last 30 days)");
  if (report.last30DayCounts.length === 0) {
    lines.push("- none");
  } else {
    for (const day of report.last30DayCounts) {
      lines.push(`- ${day.day}: ${String(day.count)}`);
    }
  }

  lines.push("", "## Sample rows by (ownerUsername, taskSubtype)");
  if (report.samplesByCluster.length === 0) {
    lines.push("- none");
  } else {
    for (const cluster of report.samplesByCluster) {
      lines.push(`### ${cluster.ownerUsername} / ${cluster.taskSubtype}`);
      for (const row of cluster.rows) {
        lines.push(`- ${formatSampleRow(row)}`);
      }
      lines.push("");
    }
    if (lines.at(-1) === "") {
      lines.pop();
    }
  }

  return `${lines.join("\n")}\n`;
}
