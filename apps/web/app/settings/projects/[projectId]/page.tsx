import { redirect } from "next/navigation";

import { requireSession } from "@/src/server/auth/session";
import { loadProjectSettingsDetail } from "@/src/server/settings/selectors";

import { ProjectDetail } from "../../_components/project-detail";
import { SettingsContent } from "../../_components/settings-content";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

export default async function SettingsProjectDetailPage({ params }: PageProps) {
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
  const project = await loadProjectSettingsDetail(decoded);
  if (!project) {
    redirect("/settings/projects");
  }

  return (
    <SettingsContent>
      <ProjectDetail project={project} />
    </SettingsContent>
  );
}
