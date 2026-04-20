import { redirect } from "next/navigation";

import { getCurrentUser, requireSession } from "@/src/server/auth/session";

import { ActiveProjectsSection } from "../_components/active-projects-section";
import { SettingsContent } from "../_components/settings-content";
import {
  MOCK_INACTIVE_PROJECTS,
  MOCK_PROJECTS
} from "../_lib/mock-data";

export const dynamic = "force-dynamic";

export default async function SettingsActiveProjectsPage() {
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

  const isAdmin = currentUser.role === "admin";
  const activeProjects = MOCK_PROJECTS.filter((project) => project.active);

  return (
    <SettingsContent>
      <ActiveProjectsSection
        projects={activeProjects}
        inactiveProjects={MOCK_INACTIVE_PROJECTS}
        isAdmin={isAdmin}
      />
    </SettingsContent>
  );
}
