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

  const entries = await runtime.repositories.projectKnowledge.list({
    projectId: decoded,
    approvedOnly: false
  });

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
      />
    </SettingsContent>
  );
}
