import { notFound } from "next/navigation";

import { InboxDetail } from "../_components/inbox-detail";
import { getInboxDetail } from "../_lib/selectors";

interface PageProps {
  readonly params: Promise<{ readonly contactId: string }>;
}

export default async function InboxContactPage({ params }: PageProps) {
  const { contactId } = await params;
  const detail = getInboxDetail(contactId);
  if (!detail) {
    notFound();
  }
  return <InboxDetail detail={detail} />;
}
