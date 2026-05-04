import { and, asc, gte, inArray, lte } from "drizzle-orm";

import { canonicalEventLedger } from "@as-comms/db";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import {
  buildProjectLifecycleMetrics,
  type LifecycleEventRow,
  type MembershipRow,
  type ProjectLifecycleTile,
  type ProjectRow,
} from "./project-lifecycle-metrics";
import { projectToneFromName } from "./project-tone";
import {
  classifySyncFreshness,
  type SyncFreshnessState,
} from "./sync-freshness";

export interface InboxWelcomeSalesforceLifecycleData {
  readonly tiles: readonly ProjectLifecycleTile[];
  readonly freshness: SyncFreshnessState;
  readonly lastSuccessAt: Date | null;
}

const LIFECYCLE_EVENT_TYPES = [
  "lifecycle.signed_up",
  "lifecycle.completed_training",
  "lifecycle.submitted_first_data",
] as const satisfies readonly LifecycleEventRow["eventType"][];
const MS_PER_DAY = 24 * 60 * 60 * 1_000;

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function readProjectDisplayName(project: {
  readonly projectAlias?: string | null | undefined;
  readonly projectName: string;
}): string {
  const trimmedAlias = project.projectAlias?.trim() ?? "";
  return trimmedAlias.length > 0 ? trimmedAlias : project.projectName;
}

async function readLifecycleEvents(
  now: Date,
): Promise<readonly LifecycleEventRow[]> {
  const runtime = await getStage1WebRuntime();
  if (runtime.connection === null) {
    return [];
  }

  const todayStart = startOfUtcDay(now);
  const windowStart = new Date(todayStart.getTime() - 6 * MS_PER_DAY);

  const rows = await runtime.connection.db
    .select({
      contactId: canonicalEventLedger.contactId,
      eventType: canonicalEventLedger.eventType,
      occurredAt: canonicalEventLedger.occurredAt,
    })
    .from(canonicalEventLedger)
    .where(
      and(
        inArray(canonicalEventLedger.eventType, [...LIFECYCLE_EVENT_TYPES]),
        gte(canonicalEventLedger.occurredAt, windowStart),
        lte(canonicalEventLedger.occurredAt, now),
      ),
    )
    .orderBy(asc(canonicalEventLedger.occurredAt), asc(canonicalEventLedger.id));

  return rows
    .map((row) => ({
      contactId: row.contactId,
      eventType: row.eventType as LifecycleEventRow["eventType"],
      occurredAt: toValidDate(row.occurredAt),
    }))
    .filter(
      (
        row,
      ): row is {
        readonly contactId: string;
        readonly eventType: LifecycleEventRow["eventType"];
        readonly occurredAt: Date;
      } => row.occurredAt !== null,
    );
}

async function readLifecycleProjects(): Promise<readonly ProjectRow[]> {
  const runtime = await getStage1WebRuntime();
  const activeProjects = await runtime.repositories.projectDimensions.listActive();
  const projectCounts = await Promise.all(
    activeProjects.map((project) =>
      runtime.repositories.inboxProjection.countByFilters({
        projectId: project.projectId,
      }),
    ),
  );

  return activeProjects.map((project, index) => {
    const projectName = readProjectDisplayName(project);
    return {
      projectId: project.projectId,
      projectName,
      projectTone: projectToneFromName(projectName),
      isActive: project.isActive ?? true,
      unreadCount: projectCounts[index]?.unread ?? 0,
    };
  });
}

async function readLifecycleMemberships(
  contactIds: readonly string[],
): Promise<readonly MembershipRow[]> {
  const runtime = await getStage1WebRuntime();
  const memberships =
    contactIds.length === 0
      ? []
      : await runtime.repositories.contactMemberships.listByContactIds(contactIds);

  return memberships
    .filter(
      (membership): membership is typeof membership & { readonly projectId: string } =>
        membership.projectId !== null,
    )
    .map((membership) => ({
      contactId: membership.contactId,
      projectId: membership.projectId,
    }));
}

async function readSalesforceCaptureLastSuccessAt(
): Promise<Date | null> {
  const runtime = await getStage1WebRuntime();

  await runtime.settings.integrationHealth.seedDefaults();
  const [integrationHealth, latestLiveSync] = await Promise.all([
    runtime.settings.integrationHealth.findById("salesforce"),
    runtime.repositories.syncState.findLatest({
      scope: "provider",
      provider: "salesforce",
      jobType: "live_ingest",
    }),
  ]);

  if (integrationHealth?.status === "not_configured") {
    return null;
  }

  const lastSuccessfulAt = toValidDate(latestLiveSync?.lastSuccessfulAt ?? null);

  if (lastSuccessfulAt === null) {
    return null;
  }

  return lastSuccessfulAt;
}

export async function getInboxWelcomeSalesforceLifecycle(
  input?: {
    readonly now?: Date;
  },
): Promise<InboxWelcomeSalesforceLifecycleData> {
  const now = input?.now ?? new Date();
  const [events, projects, lastSuccessAt] = await Promise.all([
    readLifecycleEvents(now),
    readLifecycleProjects(),
    readSalesforceCaptureLastSuccessAt(),
  ]);
  const memberships = await readLifecycleMemberships(
    Array.from(new Set(events.map((event) => event.contactId))),
  );

  return {
    tiles: buildProjectLifecycleMetrics({
      events,
      memberships,
      projects,
      now,
    }),
    freshness: classifySyncFreshness({
      lastSuccessAt,
      now,
    }),
    lastSuccessAt,
  };
}
