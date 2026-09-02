import { redirect } from "next/navigation";

import { requireSession } from "@/src/server/auth/session";
import { loadProjectSettingsDetail } from "@/src/server/settings/selectors";
import { loadAutomatedEmailList } from "@/src/server/automated-email/selectors";

import { ProjectDetail } from "../../_components/project-detail";
import { SettingsContent } from "../../_components/settings-content";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<{ readonly tab?: string }>;
}

export default async function SettingsProjectDetailPage({
  params,
  searchParams,
}: PageProps) {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  }

  const { projectId } = await params;
  const { tab } = await searchParams;
  const decoded = decodeURIComponent(projectId);
  const [project, automatedEmails] = await Promise.all([
    loadProjectSettingsDetail(decoded),
    loadAutomatedEmailList(decoded),
  ]);
  if (!project) {
    redirect("/settings/projects");
  }

  const initialTab =
    tab === "ai-knowledge" || tab === "automated-emails" || tab === "danger-zone"
      ? tab
      : undefined;

  return (
    <SettingsContent>
      <ProjectDetail
        project={project}
        automatedEmails={automatedEmails}
        initialTab={initialTab}
      />
    </SettingsContent>
  );
}
