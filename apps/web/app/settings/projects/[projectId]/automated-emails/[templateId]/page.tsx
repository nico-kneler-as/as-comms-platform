import { redirect } from "next/navigation";

import { AutomatedEmailTemplateEditor } from "../_components/template-editor";
import { SettingsContent } from "../../../../_components/settings-content";
import { requireSession } from "@/src/server/auth/session";
import { loadAutomatedEmailEditor } from "@/src/server/automated-email/selectors";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{
    readonly projectId: string;
    readonly templateId: string;
  }>;
}

export default async function AutomatedEmailEditorPage({ params }: PageProps) {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  }

  const { projectId, templateId } = await params;
  const data = await loadAutomatedEmailEditor(
    decodeURIComponent(projectId),
    decodeURIComponent(templateId),
  );
  if (data === null) {
    redirect(
      `/settings/projects/${encodeURIComponent(decodeURIComponent(projectId))}/automated-emails`,
    );
  }

  return (
    <SettingsContent>
      <AutomatedEmailTemplateEditor data={data} />
    </SettingsContent>
  );
}
