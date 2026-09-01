import { redirect } from "next/navigation";

import { AutomatedEmailTemplateList } from "./_components/template-list";
import { requireSession } from "@/src/server/auth/session";
import { loadAutomatedEmailList } from "@/src/server/automated-email/selectors";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

export default async function AutomatedEmailsPage({ params }: PageProps) {
  try {
    await requireSession();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      redirect("/auth/sign-in");
    }
    throw error;
  }

  const { projectId } = await params;
  const data = await loadAutomatedEmailList(decodeURIComponent(projectId));
  if (data === null) {
    redirect("/settings/projects");
  }

  return (
    <div className="mx-auto w-full min-w-[1060px] max-w-[1220px] px-10 py-8">
      <AutomatedEmailTemplateList data={data} />
    </div>
  );
}
