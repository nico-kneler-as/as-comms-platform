import { revalidatePath, revalidateTag } from "next/cache";

export function revalidateProjectsSettings(): void {
  revalidateTag("settings:projects");
  revalidatePath("/settings");
  revalidatePath("/settings/projects");
}

export function revalidateProjectSettings(projectId: string): void {
  revalidateProjectsSettings();
  revalidateTag(`settings:projects:${projectId}`);
  revalidatePath(`/settings/projects/${encodeURIComponent(projectId)}`);
}

export function revalidateAutomatedEmailViews(projectId: string): void {
  revalidateProjectSettings(projectId);
  revalidateTag(`automated-emails:${projectId}`);
  revalidatePath(
    `/settings/projects/${encodeURIComponent(projectId)}/automated-emails`,
  );
}

export function revalidateAccessSettings(): void {
  revalidateTag("settings:team");
  revalidatePath("/settings/team");
}

export function revalidateNewsletterSettings(): void {
  revalidateTag("settings:newsletter");
  revalidatePath("/settings/newsletter");
}

export function revalidateIntegrationHealth(): void {
  revalidateTag("settings:integrations");
  revalidatePath("/settings/integrations");
}
