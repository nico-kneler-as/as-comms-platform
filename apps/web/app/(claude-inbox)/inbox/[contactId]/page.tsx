import { notFound } from "next/navigation";

import { ClaudeInboxDetail } from "../../_components/claude-inbox-detail";
import { getClaudeInboxDetail } from "../../_lib/selectors";

interface PageProps {
  readonly params: Promise<{ readonly contactId: string }>;
}

export default async function ClaudeInboxContactPage({ params }: PageProps) {
  const { contactId } = await params;
  const detail = getClaudeInboxDetail(contactId);
  if (!detail) {
    notFound();
  }
  return <ClaudeInboxDetail detail={detail} />;
}
