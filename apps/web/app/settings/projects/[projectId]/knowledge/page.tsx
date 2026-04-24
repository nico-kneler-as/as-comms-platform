import { redirect } from "next/navigation";

import { requireSession } from "@/src/server/auth/session";
import { getStage1WebRuntime } from "@/src/server/stage1-runtime";
import { loadProjectSettingsDetail } from "@/src/server/settings/selectors";

import { SettingsContent } from "../../../_components/settings-content";
import { ProjectKnowledgeTable } from "../../../_components/project-knowledge-table";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

export default async function SettingsProjectKnowledgePage({ params }: PageProps) {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  }

  const { projectId } = await params;
  const decoded = decodeURIComponent(projectId);
  const [project, runtime] = await Promise.all([
    loadProjectSettingsDetail(decoded),
    getStage1WebRuntime()
  ]);
  if (!project) {
    redirect("/settings/projects");
  }

  const [entries, sourceLinks, runs] = await Promise.all([
    runtime.repositories.projectKnowledge.list({
      projectId: decoded,
      approvedOnly: false
    }),
    runtime.repositories.projectKnowledgeSourceLinks.list(decoded),
    runtime.repositories.projectKnowledgeBootstrapRuns.listByProject(decoded, 10)
  ]);

  return (
    <SettingsContent>
      <ProjectKnowledgeTable
        projectId={decoded}
        projectName={project.projectName}
        entries={entries.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          issueType: entry.issueType,
          volunteerStage: entry.volunteerStage,
          questionSummary: entry.questionSummary,
          replyStrategy: entry.replyStrategy,
          maskedExample: entry.maskedExample,
          sourceKind: entry.sourceKind,
          approvedForAi: entry.approvedForAi,
          lastReviewedAt: entry.lastReviewedAt,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt
        }))}
        sourceLinks={sourceLinks.map((source) => ({
          id: source.id,
          kind: source.kind,
          label: source.label,
          url: source.url,
          createdAt: source.createdAt,
          updatedAt: source.updatedAt
        }))}
        runs={runs.map((run) => ({
          id: run.id,
          status: run.status,
          force: run.force,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          stats: {
            sourcesFetched:
              typeof run.statsJson.sourcesFetched === "number"
                ? run.statsJson.sourcesFetched
                : null,
            topicsFound:
              typeof run.statsJson.topicsFound === "number"
                ? run.statsJson.topicsFound
                : null,
            candidatesWritten:
              typeof run.statsJson.candidatesWritten === "number"
                ? run.statsJson.candidatesWritten
                : null,
            costEstimateUsd:
              typeof run.statsJson.costEstimateUsd === "number"
                ? run.statsJson.costEstimateUsd
                : null,
            budgetWarn: run.statsJson.budgetWarn === true
          },
          errorDetail: run.errorDetail
        }))}
      />
    </SettingsContent>
  );
}
