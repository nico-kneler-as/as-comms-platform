import { Suspense } from "react";
import { notFound } from "next/navigation";

import { requireSession } from "@/src/server/auth/session";
import {
  InboxDetail,
  InboxDetailTimelineFallback,
  InboxDetailTimelinePanel,
} from "../_components/inbox-detail";
import type { InboxDetailSummaryViewModel } from "../_lib/view-models";
import {
  getInboxDetailSummary,
  getInboxDetailTimeline,
} from "../_lib/selectors";

interface PageProps {
  readonly params: Promise<{ readonly contactId: string }>;
}

interface TimelineSectionProps {
  readonly contactId: string;
  readonly contact: InboxDetailSummaryViewModel["contact"];
  readonly composerReplyContext: InboxDetailSummaryViewModel["composerReplyContext"];
  readonly currentOperatorUserId: string;
}

async function InboxContactTimelineSection({
  contactId,
  contact,
  composerReplyContext,
  currentOperatorUserId,
}: TimelineSectionProps) {
  const timeline = await getInboxDetailTimeline(contactId, {
    recordReadAudit: true,
  });

  if (timeline === null) {
    notFound();
  }

  return (
    <InboxDetailTimelinePanel
      contact={contact}
      composerReplyContext={composerReplyContext}
      initialTimeline={timeline}
      currentOperatorUserId={currentOperatorUserId}
    />
  );
}

export default async function InboxContactPage({ params }: PageProps) {
  const { contactId } = await params;
  const currentUser = await requireSession();
  const decodedContactId = decodeURIComponent(contactId);
  const detail = await getInboxDetailSummary(decodedContactId);

  if (!detail) {
    notFound();
  }

  return (
    <InboxDetail
      detail={detail}
      currentOperatorUserId={currentUser.id}
      timelineSlot={
        <Suspense fallback={<InboxDetailTimelineFallback />}>
          <InboxContactTimelineSection
            contactId={decodedContactId}
            contact={detail.contact}
            composerReplyContext={detail.composerReplyContext}
            currentOperatorUserId={currentUser.id}
          />
        </Suspense>
      }
    />
  );
}
