import { notFound, redirect } from "next/navigation";

import { getCurrentUser, requireSession } from "@/src/server/auth/session";

import { ProjectDetail } from "../../_components/project-detail";
import { SettingsContent } from "../../_components/settings-content";
import { findMockProjectById } from "../../_lib/mock-data";

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

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    redirect("/auth/sign-in");
  }

  const { projectId } = await params;
  const decoded = decodeURIComponent(projectId);
  const project = findMockProjectById(decoded);
  if (!project) {
    notFound();
  }

  const isAdmin = currentUser.role === "admin";

  return (
    <SettingsContent>
      <ProjectDetail project={project} isAdmin={isAdmin} />
    </SettingsContent>
  );
}
