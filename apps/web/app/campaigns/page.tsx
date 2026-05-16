import Link from "next/link";

import type {
  CampaignRunProjectionRow,
  RunState,
} from "@as-comms/contracts";
import { createCampaignRunProjectionReader } from "@as-comms/domain";

import { Button } from "@/components/ui/button";
import { requireSession } from "@/src/server/auth/session";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";

import { CampaignsList } from "./_components/campaigns-list";

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

interface CampaignListRowViewModel {
  readonly runId: string;
  readonly provider: "postmark" | "mailchimp";
  readonly kind: CampaignRunProjectionRow["kind"];
  readonly launchType: CampaignRunProjectionRow["launchType"];
  readonly state: CampaignRunProjectionRow["state"];
  readonly projectId: string | null;
  readonly projectLabel: string | null;
  readonly sender: string;
  readonly subject: string;
  readonly previewText: string | null;
  readonly audienceSize: number | null;
  readonly scheduledAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface CampaignsSearchParams {
  readonly state?: string;
  readonly q?: string;
  readonly projectId?: string | readonly string[];
}

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

function resolveFilterStates(filterId: CampaignFilterId) {
  return FILTER_DEFINITIONS.find((filter) => filter.id === filterId)?.states ?? null;
}

function buildPreviewMaps(input: {
  readonly rows: readonly CampaignRunProjectionRow[];
  readonly postmarkPreheaders: ReadonlyMap<string, string | null>;
  readonly mailchimpSnippets: ReadonlyMap<string, string | null>;
}) {
  return new Map(
    input.rows.map((row) => {
      if (row.provider === "postmark") {
        return [row.runId, input.postmarkPreheaders.get(row.runId) ?? null] as const;
      }

      return [row.runId, input.mailchimpSnippets.get(row.runId) ?? null] as const;
    }),
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

  const activeProjects = (await runtime.settings.projects.listAll())
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
  const projectLabelById = new Map(
    activeProjects.map((project) => [project.projectId, project.projectName] as const),
  );

  const listRecentOptions: Parameters<typeof reader.listRecent>[0] = {
    limit: 200,
    offset: 0,
    ...(activeStates === null ? {} : { states: [...activeStates] }),
    ...(selectedProjectIds.length === 0 ? {} : { projectIds: selectedProjectIds }),
    ...(searchQuery.length === 0 ? {} : { searchQuery }),
  };
  const rows = await reader.listRecent(listRecentOptions);
  const mailchimpCampaignIds = rows
    .filter((row) => row.provider === "mailchimp")
    .map((row) => row.runId);

  const mailchimpDetailsPromise =
    runtime.repositories.mailchimpCampaignActivityDetails.listByCampaignIds === undefined
      ? Promise.resolve(
          [] as Awaited<
            ReturnType<
              NonNullable<
                typeof runtime.repositories.mailchimpCampaignActivityDetails.listByCampaignIds
              >
            >
          >,
        )
      : runtime.repositories.mailchimpCampaignActivityDetails.listByCampaignIds(
          mailchimpCampaignIds,
        );
  const [postmarkRuns, mailchimpDetails, tabCounts] = await Promise.all([
    Promise.all(
      rows
        .filter((row) => row.provider === "postmark")
        .map(async (row) => runtime.campaigns.campaignRuns.findById(row.runId)),
    ),
    mailchimpDetailsPromise,
    Promise.all(
      FILTER_DEFINITIONS.map(async (filter) => ({
        id: filter.id,
        label: filter.label,
        count: await reader.count({
          ...(filter.states === null ? {} : { states: [...filter.states] }),
          ...(selectedProjectIds.length === 0
            ? {}
            : { projectIds: selectedProjectIds }),
        }),
      })),
    ),
  ]);

  const postmarkPreheaders = new Map(
    postmarkRuns
      .filter((run): run is NonNullable<typeof run> => run !== null)
      .map((run) => [run.id, run.preheader] as const),
  );
  const mailchimpSnippets = new Map<string, string | null>();
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

  const items: readonly CampaignListRowViewModel[] = rows.map((row) => ({
    ...row,
    projectLabel:
      row.projectId === null ? null : (projectLabelById.get(row.projectId) ?? null),
    previewText: previewByRunId.get(row.runId) ?? null,
  }));

  const activeCount =
    tabCounts.find((filter) => filter.id === activeFilterId)?.count ?? items.length;
  const totalCount = tabCounts.find((filter) => filter.id === "all")?.count ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-100">
      <div className="border-b border-slate-200 bg-white px-6 py-6 sm:px-8">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-900">Campaigns</h1>
            <p className="mt-1 text-sm text-slate-500">
              {`${activeCount.toLocaleString()} ${
                activeFilterId === "all" ? "campaigns" : "matching campaigns"
              }`}
            </p>
          </div>
          {currentUser.role === "admin" ? (
            <Button asChild>
              <Link href="/campaigns/new">New campaign</Link>
            </Button>
          ) : null}
        </div>
      </div>

      <CampaignsList
        items={items}
        projectOptions={projectOptions}
        selectedProjectIds={selectedProjectIds}
        tabs={tabCounts}
        activeFilterId={activeFilterId}
        searchQuery={searchQuery}
        totalCount={totalCount}
        showNewCampaignCta={currentUser.role === "admin"}
      />
    </div>
  );
}
