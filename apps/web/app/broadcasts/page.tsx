import { Suspense } from "react";
import Link from "next/link";

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

function buildPreviewMaps(input: {
  readonly rows: readonly CampaignRunProjectionRow[];
  readonly postmarkPreheaders: ReadonlyMap<string, string | null>;
  readonly mailchimpSnippets: ReadonlyMap<string, string | null>;
}) {
  return new Map(
    input.rows.map((row) => {
      if (row.provider === "postmark") {
        return [
          row.runId,
          input.postmarkPreheaders.get(row.runId) ?? null,
        ] as const;
      }

      return [
        row.runId,
        input.mailchimpSnippets.get(row.runId) ?? null,
      ] as const;
    }),
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
  const reader = createCampaignRunProjectionReader({
    repositories: runtime.campaigns,
  });
  const rows = await reader.listRecent({
    ...(input.activeStates === null ? {} : { states: [...input.activeStates] }),
    ...(input.selectedProjectIds.length === 0
      ? {}
      : { projectIds: [...input.selectedProjectIds] }),
    ...(input.searchQuery.length === 0
      ? {}
      : { searchQuery: input.searchQuery }),
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
  const mailchimpSnippets = new Map<string, string | null>();
  const mailchimpRunIds = rows
    .filter((row) => row.provider === "mailchimp")
    .map((row) => row.runId);
  const mailchimpDetails =
    runtime.repositories.mailchimpCampaignActivityDetails.listByCampaignIds ===
    undefined
      ? []
      : await runtime.repositories.mailchimpCampaignActivityDetails.listByCampaignIds(
          mailchimpRunIds,
        );
  for (const detail of mailchimpDetails) {
    if (!detail.campaignId || mailchimpSnippets.has(detail.campaignId)) {
      continue;
    }
    mailchimpSnippets.set(detail.campaignId, detail.snippet);
  }

  const previewByRunId = buildPreviewMaps({
    rows,
    postmarkPreheaders,
    mailchimpSnippets,
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
    name:
      row.provider === "mailchimp"
        ? row.subject
        : (postmarkRunById.get(row.runId)?.name ?? null),
    audienceType:
      row.provider === "mailchimp" || row.kind === "newsletter"
        ? "newsletter"
        : (postmarkRunById.get(row.runId)?.audienceCriteria.projectIds.length ??
              0) === 0
          ? "specific"
          : "project",
    projectAlias:
      row.projectId === null
        ? null
        : (() => {
            const senderAlias = row.sender.split("@")[0]?.trim() ?? "";
            if (senderAlias.length > 0) {
              return senderAlias;
            }

            return projectMetaById.get(row.projectId)?.alias ?? null;
          })(),
    previewText: previewByRunId.get(row.runId) ?? null,
  }));

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
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
  const reader = createCampaignRunProjectionReader({
    repositories: runtime.campaigns,
  });

  const activeFilterId = parseFilterId(params.state);
  const activeStates = resolveFilterStates(activeFilterId);
  const selectedProjectIds = normalizeProjectIds(params.projectId);
  const searchQuery = normalizeSearchQuery(params.q);
  const requestedPage = normalizePage(params.page);
  const countOptions: Parameters<typeof reader.count>[0] = {
    ...(activeStates === null ? {} : { states: [...activeStates] }),
    ...(selectedProjectIds.length === 0
      ? {}
      : { projectIds: selectedProjectIds }),
    ...(searchQuery.length === 0 ? {} : { searchQuery }),
  };

  const [allProjects, totalMatchingCount, countsByState] = await Promise.all([
    runtime.settings.projects.listAll(),
    reader.count(countOptions),
    reader.countByState({
      ...(selectedProjectIds.length === 0
        ? {}
        : { projectIds: selectedProjectIds }),
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
