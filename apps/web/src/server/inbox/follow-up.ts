import { getStage1WebRuntime } from "../stage1-runtime";

export interface InboxNeedsFollowUpUpdateResult {
  readonly ok: true;
  readonly contactId: string;
  readonly needsFollowUp: boolean;
}

export interface InboxNeedsFollowUpUpdateNotFound {
  readonly ok: false;
  readonly code: "inbox_contact_not_found";
}

export async function setInboxNeedsFollowUp(input: {
  readonly contactId: string;
  readonly needsFollowUp: boolean;
}): Promise<InboxNeedsFollowUpUpdateResult | InboxNeedsFollowUpUpdateNotFound> {
  const runtime = await getStage1WebRuntime();
  const existing = await runtime.repositories.inboxProjection.findByContactId(
    input.contactId
  );

  if (existing === null) {
    return {
      ok: false,
      code: "inbox_contact_not_found"
    };
  }

  await runtime.repositories.inboxProjection.upsert({
    ...existing,
    needsFollowUp: input.needsFollowUp
  });

  return {
    ok: true,
    contactId: input.contactId,
    needsFollowUp: input.needsFollowUp
  };
}
