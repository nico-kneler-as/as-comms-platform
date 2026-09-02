import { redirect } from "next/navigation";

interface PageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

export default async function AutomatedEmailsPage({ params }: PageProps) {
  const { projectId } = await params;
  redirect(
    `/settings/projects/${encodeURIComponent(decodeURIComponent(projectId))}?tab=automated-emails`,
  );
}
