import { Suspense } from "react";
import Link from "next/link";
import { sql } from "drizzle-orm";

import type { CampaignRunProjectionRow, RunState } from "@as-comms/contracts";
import { createCampaignRunProjectionReader } from "@as-comms/domain";

import { Button } from "@/components/ui/button";
import { requireSession } from "@/src/server/auth/session";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import { CampaignRow, type CampaignRowViewModel } from "./_components/campaign-row";
import {
  CampaignRowsSkeleton,
  CampaignsList,
} from "./_components/campaigns-list";

type CampaignFilterId =
  | "all"
  | "drafts"
  | "scheduled"
  | "sending"
  | "complete"
  | "cancelled";

interface CampaignProjectOption {
  readonly id: string;
  readonly label: string;
}

interface CampaignsSearchParams {
  readonly state?: string;
  readonly q?: string;
  readonly page?: string;
  readonly projectId?: string | readonly string[];
}

const CAMPAIGNS_PAGE_SIZE = 25;

const FILTER_DEFINITIONS: readonly {
  readonly id: CampaignFilterId;
  readonly label: string;
  readonly states: readonly RunState[] | null;
}[] = [
  { id: "all", label: "All", states: null },
  { id: "drafts", label: "Drafts", states: ["draft"] },
  { id: "scheduled", label: "Scheduled", states: ["scheduled"] },
  { id: "sending", label: "Sending", states: ["sending"] },
  { id: "complete", label: "Complete", states: ["complete", "finalized"] },
  { id: "cancelled", label: "Cancelled", states: ["cancelled"] },
] as const;

function parseFilterId(value: string | undefined): CampaignFilterId {
  return FILTER_DEFINITIONS.some((filter) => filter.id === value)
    ? (value as CampaignFilterId)
    : "all";
}

function normalizeProjectIds(
  value: CampaignsSearchParams["projectId"],
): string[] {
  const rawValues =
    typeof value === "string" ? [value] : Array.isArray(value) ? value : [];

  return [
    ...new Set(
      rawValues
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ];
}

function normalizeSearchQuery(value: CampaignsSearchParams["q"]): string {
  const normalized = (value ?? "").trim();
  return normalized.length === 0 ? "" : normalized;
}

function normalizePage(value: CampaignsSearchParams["page"]): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

function resolveFilterStates(filterId: CampaignFilterId) {
  return (
    FILTER_DEFINITIONS.find((filter) => filter.id === filterId)?.states ?? null
  );
}

function normalizeSqlResultRows<TRow>(
  result:
    | readonly TRow[]
    | {
        readonly rows?: readonly TRow[];
      },
): readonly TRow[] {
  if (Array.isArray(result)) {
    return result as readonly TRow[];
  }

  return (result as { readonly rows?: readonly TRow[] }).rows ?? [];
}

interface CampaignProjectionSqlRow {
  readonly runId: string;
  readonly provider: "postmark";
  readonly kind: CampaignRunProjectionRow["kind"];
  readonly launchType: CampaignRunProjectionRow["launchType"];
  readonly state: CampaignRunProjectionRow["state"];
  readonly projectId: string | null;
  readonly sender: string;
  readonly subject: string;
  readonly audienceSize: number | null;
  readonly scheduledAt: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface CampaignProjectionCountSqlRow {
  readonly total: number | string;
}

interface CampaignProjectionStateCountSqlRow {
  readonly state: RunState;
  readonly total: number | string;
}

interface CampaignMetricSqlRow {
  readonly runId: string;
  readonly sent: number | string;
  readonly opened: number | string;
  readonly total: number | string;
}

type CampaignMetricByRunId = Map<
  string,
  {
    readonly sent: number;
    readonly opened: number;
    readonly total: number;
  }
>;

function buildPostmarkProjectionWhereClause(input: {
  readonly states: readonly RunState[] | null;
  readonly projectIds: readonly string[] | null;
  readonly searchQuery: string | null;
}) {
  const conditions = [sql`"provider" = 'postmark'`];

  if (input.projectIds !== null) {
    conditions.push(
      input.projectIds.length === 0
        ? sql`1 = 0`
        : sql`"project_id" in (${sql.join(
            input.projectIds.map((projectId) => sql`${projectId}`),
            sql`, `,
          )})`,
    );
  }

  if (input.states !== null) {
    conditions.push(
      input.states.length === 0
        ? sql`1 = 0`
        : sql`"state" in (${sql.join(
            input.states.map((state) => sql`${state}`),
            sql`, `,
          )})`,
    );
  }

  if (input.searchQuery !== null) {
    const pattern = `%${input.searchQuery.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(sql`"subject" ilike ${pattern} escape '\\'`);
  }

  return sql`where ${sql.join(conditions, sql` and `)}`;
}

function mapProjectionSqlRow(
  row: CampaignProjectionSqlRow,
): CampaignRunProjectionRow {
  return {
    runId: row.runId,
    provider: row.provider,
    kind: row.kind,
    launchType: row.launchType,
    state: row.state,
    projectId: row.projectId,
    sender: row.sender,
    subject: row.subject,
    audienceSize: row.audienceSize,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function listRecentPostmarkRows(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly activeStates: readonly RunState[] | null;
  readonly selectedProjectIds: readonly string[];
  readonly searchQuery: string;
  readonly limit: number;
  readonly offset: number;
}) {
  const connection = input.runtime.connection;
  if (connection === null) {
    const reader = createCampaignRunProjectionReader({
      repositories: input.runtime.campaigns,
    });
    return (await reader.listRecent({
      ...(input.activeStates === null ? {} : { states: [...input.activeStates] }),
      ...(input.selectedProjectIds.length === 0
        ? {}
        : { projectIds: [...input.selectedProjectIds] }),
      ...(input.searchQuery.length === 0
        ? {}
        : { searchQuery: input.searchQuery }),
      limit: input.limit,
      offset: input.offset,
    })).filter((row) => row.provider === "postmark");
  }

  const result = await connection.db.execute(sql<CampaignProjectionSqlRow>`
    select
      "run_id" as "runId",
      "provider" as "provider",
      "kind" as "kind",
      "launch_type" as "launchType",
      "state" as "state",
      "project_id" as "projectId",
      "sender" as "sender",
      "subject" as "subject",
      "audience_size" as "audienceSize",
      "scheduled_at" as "scheduledAt",
      "started_at" as "startedAt",
      "completed_at" as "completedAt",
      "cancelled_at" as "cancelledAt",
      "created_at" as "createdAt",
      "updated_at" as "updatedAt"
    from "campaign_run_projection"
    ${buildPostmarkProjectionWhereClause({
      states: input.activeStates,
      projectIds:
        input.selectedProjectIds.length === 0 ? null : input.selectedProjectIds,
      searchQuery: input.searchQuery.length === 0 ? null : input.searchQuery,
    })}
    order by "updated_at" desc, "created_at" desc, "run_id" asc
    limit ${input.limit}
    offset ${input.offset}
  `);

  const rows = normalizeSqlResultRows<CampaignProjectionSqlRow>(
    result as { readonly rows?: readonly CampaignProjectionSqlRow[] },
  );
  return rows.map(mapProjectionSqlRow);
}

async function countPostmarkRows(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly activeStates: readonly RunState[] | null;
  readonly selectedProjectIds: readonly string[];
  readonly searchQuery: string;
}) {
  const connection = input.runtime.connection;
  if (connection === null) {
    const reader = createCampaignRunProjectionReader({
      repositories: input.runtime.campaigns,
    });
    return reader.count({
      ...(input.activeStates === null ? {} : { states: [...input.activeStates] }),
      ...(input.selectedProjectIds.length === 0
        ? {}
        : { projectIds: [...input.selectedProjectIds] }),
      ...(input.searchQuery.length === 0
        ? {}
        : { searchQuery: input.searchQuery }),
    });
  }

  const result = await connection.db.execute(sql<CampaignProjectionCountSqlRow>`
    select count(*)::int as "total"
    from "campaign_run_projection"
    ${buildPostmarkProjectionWhereClause({
      states: input.activeStates,
      projectIds:
        input.selectedProjectIds.length === 0 ? null : input.selectedProjectIds,
      searchQuery: input.searchQuery.length === 0 ? null : input.searchQuery,
    })}
  `);
  const [row] = normalizeSqlResultRows<CampaignProjectionCountSqlRow>(
    result as { readonly rows?: readonly CampaignProjectionCountSqlRow[] },
  );

  return Number(row?.total ?? 0);
}

async function countPostmarkRowsByState(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly selectedProjectIds: readonly string[];
}) {
  const connection = input.runtime.connection;
  if (connection === null) {
    const reader = createCampaignRunProjectionReader({
      repositories: input.runtime.campaigns,
    });
    return reader.countByState({
      ...(input.selectedProjectIds.length === 0
        ? {}
        : { projectIds: [...input.selectedProjectIds] }),
    });
  }

  const result = await connection.db.execute(sql<CampaignProjectionStateCountSqlRow>`
    select "state" as "state", count(*)::int as "total"
    from "campaign_run_projection"
    ${buildPostmarkProjectionWhereClause({
      states: null,
      projectIds:
        input.selectedProjectIds.length === 0 ? null : input.selectedProjectIds,
      searchQuery: null,
    })}
    group by "state"
  `);
  const rows = normalizeSqlResultRows<CampaignProjectionStateCountSqlRow>(
    result as { readonly rows?: readonly CampaignProjectionStateCountSqlRow[] },
  );
  const counts: Partial<Record<RunState, number>> = {};
  for (const row of rows) {
    counts[row.state] = Number(row.total);
  }
  return counts;
}

async function readMetricsByRunId(input: {
  readonly runtime: Awaited<ReturnType<typeof getStage1WebRuntime>>;
  readonly runIds: readonly string[];
}): Promise<CampaignMetricByRunId> {
  if (input.runIds.length === 0) {
    return new Map();
  }

  const connection = input.runtime.connection;
  if (connection === null) {
    return new Map();
  }

  const result = await connection.db.execute(sql<CampaignMetricSqlRow>`
    select
      campaign_run_id as "runId",
      count(*) filter (
        where sent_at is not null
          or delivery_status in ('sent', 'delivered', 'bounced', 'complained', 'unsubscribed')
      )::int as "sent",
      count(*) filter (where opened_at is not null)::int as "opened",
      count(*)::int as "total"
    from audience_snapshots
    where campaign_run_id in (${sql.join(
      input.runIds.map((runId) => sql`${runId}`),
      sql`, `,
    )})
    group by campaign_run_id
  `);

  const rows = normalizeSqlResultRows<CampaignMetricSqlRow>(
    result as { readonly rows?: readonly CampaignMetricSqlRow[] },
  );
  return new Map(
    rows.map((row) => [
      row.runId,
      {
        sent: Number(row.sent),
        opened: Number(row.opened),
        total: Number(row.total),
      },
    ]),
  );
}

function countStates(
  countsByState: Partial<Record<RunState, number>>,
  states: readonly RunState[] | null,
): number {
  if (states === null) {
    return Object.values(countsByState).reduce(
      (total, count) => total + count,
      0,
    );
  }

  return states.reduce(
    (total, state) => total + (countsByState[state] ?? 0),
    0,
  );
}

async function CampaignRowsSection(input: {
  readonly activeStates: readonly RunState[] | null;
  readonly selectedProjectIds: readonly string[];
  readonly searchQuery: string;
  readonly currentPage: number;
  readonly activeProjects: readonly {
    readonly projectId: string;
    readonly projectName: string;
    readonly projectAlias: string | null;
  }[];
}) {
  const runtime = await getStage1WebRuntime();
  const rows = await listRecentPostmarkRows({
    runtime,
    activeStates: input.activeStates,
    selectedProjectIds: input.selectedProjectIds,
    searchQuery: input.searchQuery,
    limit: CAMPAIGNS_PAGE_SIZE,
    offset: (input.currentPage - 1) * CAMPAIGNS_PAGE_SIZE,
  });
  const postmarkRunIds = rows
    .filter((row) => row.provider === "postmark")
    .map((row) => row.runId);
  const postmarkRuns =
    postmarkRunIds.length === 0
      ? []
      : await runtime.campaigns.campaignRuns.listByIds(postmarkRunIds);
  const postmarkRunById = new Map(
    postmarkRuns.map((run) => [run.id, run] as const),
  );
  const postmarkPreheaders = new Map(
    postmarkRuns.map((run) => [run.id, run.preheader] as const),
  );
  const metricByRunId = await readMetricsByRunId({
    runtime,
    runIds: postmarkRunIds,
  });
  const projectMetaById = new Map(
    input.activeProjects.map((project) => [
      project.projectId,
      {
        alias: project.projectAlias,
        name: project.projectName,
      },
    ]),
  );
  const items: readonly CampaignRowViewModel[] = rows.map((row) => ({
    ...row,
    name: postmarkRunById.get(row.runId)?.name ?? null,
    audienceType:
      row.kind === "newsletter"
        ? "newsletter"
        : (postmarkRunById.get(row.runId)?.audienceCriteria.contactIds.length ??
              0) > 0
          ? "specific"
          : "project",
    projectName:
      row.projectId === null
        ? null
        : (projectMetaById.get(row.projectId)?.name ?? null),
    projectAlias:
      row.projectId === null
        ? null
        : (projectMetaById.get(row.projectId)?.alias ?? null),
    projectLabel:
      row.projectId === null
        ? null
        : (() => {
            const projectMeta = projectMetaById.get(row.projectId);
            return projectMeta?.alias ?? projectMeta?.name ?? null;
          })(),
    previewText: postmarkPreheaders.get(row.runId) ?? null,
    selectedContactCount:
      postmarkRunById.get(row.runId)?.audienceCriteria.contactIds.length ?? 0,
    sentCount: metricByRunId.get(row.runId)?.sent ?? null,
    openedCount: metricByRunId.get(row.runId)?.opened ?? null,
  }));

  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {items.map((item) => (
        <CampaignRow key={`${item.provider}:${item.runId}`} item={item} />
      ))}
    </div>
  );
}

export default async function CampaignsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<CampaignsSearchParams>;
}) {
  const params: CampaignsSearchParams = (await searchParams) ?? {};
  const currentUser = await requireSession();
  const runtime = await getStage1WebRuntime();

  const activeFilterId = parseFilterId(params.state);
  const activeStates = resolveFilterStates(activeFilterId);
  const selectedProjectIds = normalizeProjectIds(params.projectId);
  const searchQuery = normalizeSearchQuery(params.q);
  const requestedPage = normalizePage(params.page);

  const [allProjects, totalMatchingCount, countsByState] = await Promise.all([
    runtime.settings.projects.listAll(),
    countPostmarkRows({
      runtime,
      activeStates,
      selectedProjectIds,
      searchQuery,
    }),
    countPostmarkRowsByState({
      runtime,
      selectedProjectIds,
    }),
  ]);
  const totalPages = Math.max(
    1,
    Math.ceil(totalMatchingCount / CAMPAIGNS_PAGE_SIZE),
  );
  const currentPage = Math.min(requestedPage, totalPages);
  const activeProjects = allProjects
    .filter(
      (project) => project.isActive && project.connectedToProjectId === null,
    )
    .sort((left, right) => left.projectName.localeCompare(right.projectName));
  const projectOptions: readonly CampaignProjectOption[] = activeProjects.map(
    (project) => ({
      id: project.projectId,
      label: project.projectAlias ?? project.projectName,
    }),
  );
  const tabCounts = FILTER_DEFINITIONS.map((filter) => ({
    id: filter.id,
    label: filter.label,
    count: countStates(countsByState, filter.states),
  }));
  const activeCount =
    searchQuery.length > 0
      ? totalMatchingCount
      : (tabCounts.find((filter) => filter.id === activeFilterId)?.count ?? 0);
  const totalCount =
    tabCounts.find((filter) => filter.id === "all")?.count ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-100">
      <div className="h-[54px] border-b border-slate-200 bg-white px-6">
        <div className="mx-auto flex h-full w-full max-w-[1180px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="text-lg font-semibold text-slate-900">Broadcasts</h1>
            <p className="text-[12px] tabular-nums text-slate-500">
              {activeCount.toLocaleString()}
            </p>
          </div>
          {currentUser.role === "admin" ? (
            <Button asChild size="sm">
              <Link href="/broadcasts/new">+ New broadcast</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <CampaignsList
        items={[]}
        rowsSection={
          totalMatchingCount === 0 ? undefined : (
            <Suspense fallback={<CampaignRowsSkeleton />}>
              <CampaignRowsSection
                activeStates={activeStates}
                selectedProjectIds={selectedProjectIds}
                searchQuery={searchQuery}
                currentPage={currentPage}
                activeProjects={activeProjects.map((project) => ({
                  projectId: project.projectId,
                  projectName: project.projectName,
                  projectAlias: project.projectAlias,
                }))}
              />
            </Suspense>
          )
        }
        projectOptions={projectOptions}
        selectedProjectIds={selectedProjectIds}
        tabs={tabCounts}
        activeFilterId={activeFilterId}
        searchQuery={searchQuery}
        page={currentPage}
        totalPages={totalPages}
        totalCount={totalCount}
        showNewCampaignCta={currentUser.role === "admin"}
      />
    </div>
  );
}
