import { sql } from "drizzle-orm";

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

interface LifecycleEventSqlRow {
  readonly contactId: string;
  readonly eventType: LifecycleEventRow["eventType"];
  readonly occurredAt: Date | string;
}

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

function normalizeSqlResultRows(result: unknown): readonly unknown[] {
  // postgres-js (drizzle-orm/postgres-js, used in production) returns a
  // plain array; node-pg / pglite return { rows: [...] }.
  if (Array.isArray(result)) {
    return result;
  }

  if (
    typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray(result.rows)
  ) {
    return result.rows;
  }

  return [];
}

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
  const result = await runtime.connection.db.execute(
    sql<LifecycleEventSqlRow>`
      select
        contact_id as "contactId",
        event_type as "eventType",
        occurred_at as "occurredAt"
      from canonical_event_ledger
      where event_type::text in (
        ${LIFECYCLE_EVENT_TYPES[0]},
        ${LIFECYCLE_EVENT_TYPES[1]},
        ${LIFECYCLE_EVENT_TYPES[2]}
      )
        and occurred_at >= ${windowStart.toISOString()}
        and occurred_at <= ${now.toISOString()}
      order by occurred_at asc, id asc
    `,
  );

  return normalizeSqlResultRows(result)
    .map((row) => row as LifecycleEventSqlRow)
    .map((row) => ({
      contactId: row.contactId,
      eventType: row.eventType,
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

interface LifecycleProjectsData {
  readonly tiles: readonly ProjectRow[];
  // Sub-project id -> host id, used to fold connected-sub-project memberships
  // and lifecycle events into the host's tile. See migration 0056.
  readonly hostByConnectedProjectId: ReadonlyMap<string, string>;
}

async function readLifecycleProjects(): Promise<LifecycleProjectsData> {
  const runtime = await getStage1WebRuntime();
  const activeProjects = await runtime.repositories.projectDimensions.listActive();

  // Connected sub-projects fold into their host's tile (one merged tile per
  // host) instead of getting their own tile. Build the redirect map first so
  // it stays consistent with the tile list below.
  const hostByConnectedProjectId = new Map<string, string>();
  const hostProjects = activeProjects.filter((project) => {
    const connectedTo = project.connectedToProjectId ?? null;
    if (connectedTo !== null && connectedTo.length > 0) {
      hostByConnectedProjectId.set(project.projectId, connectedTo);
      return false;
    }
    return true;
  });

  const projectCounts = await Promise.all(
    hostProjects.map((project) =>
      runtime.repositories.inboxProjection.countByFilters({
        projectId: project.projectId,
      }),
    ),
  );

  const tiles = hostProjects.map((project, index) => {
    const projectName = readProjectDisplayName(project);
    return {
      projectId: project.projectId,
      projectName,
      projectTone: projectToneFromName(projectName),
      isActive: project.isActive ?? true,
      // countByFilters already counts connected-sub-project memberships under
      // the host (buildInboxProjectPredicate's third branch), so this is the
      // rolled-up unread count.
      unreadCount: projectCounts[index]?.unread ?? 0,
    };
  });

  return { tiles, hostByConnectedProjectId };
}

async function readLifecycleMemberships(
  contactIds: readonly string[],
  hostByConnectedProjectId: ReadonlyMap<string, string>,
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
      // Memberships in a connected sub-project roll up to the host so the
      // lifecycle metric aggregator credits the host's tile.
      projectId:
        hostByConnectedProjectId.get(membership.projectId) ?? membership.projectId,
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
  const [events, projectsData, lastSuccessAt] = await Promise.all([
    readLifecycleEvents(now),
    readLifecycleProjects(),
    readSalesforceCaptureLastSuccessAt(),
  ]);
  const memberships = await readLifecycleMemberships(
    Array.from(new Set(events.map((event) => event.contactId))),
    projectsData.hostByConnectedProjectId,
  );

  return {
    tiles: buildProjectLifecycleMetrics({
      events,
      memberships,
      projects: projectsData.tiles,
      now,
    }),
    freshness: classifySyncFreshness({
      lastSuccessAt,
      now,
    }),
    lastSuccessAt,
  };
}
