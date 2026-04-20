import { redirect } from "next/navigation";

import { requireSession } from "@/src/server/auth/session";
import { loadProjectsSettings } from "@/src/server/settings/selectors";

import { ProjectsSection } from "../_components/projects-section";
import { SettingsContent } from "../_components/settings-content";

export const dynamic = "force-dynamic";

export default async function SettingsProjectsPage() {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  }

  const viewModel = await loadProjectsSettings({
    filter: "all"
  });

  return (
    <SettingsContent>
      <ProjectsSection viewModel={viewModel} />
    </SettingsContent>
  );
}
