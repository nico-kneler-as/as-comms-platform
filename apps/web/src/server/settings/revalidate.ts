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

export function revalidateAccessSettings(): void {
  revalidateTag("settings:access");
  revalidatePath("/settings/access");
}

export function revalidateIntegrationHealth(): void {
  revalidateTag("settings:integrations");
  revalidatePath("/settings/integrations");
}
