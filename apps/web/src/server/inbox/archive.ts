import { getStage1WebRuntime } from "../stage1-runtime";

export async function setInboxArchived(input: {
  readonly contactId: string;
  readonly archived: boolean;
}): Promise<
  | { ok: true; contactId: string }
  | { ok: false; error: "inbox_contact_not_found" }
> {
  const runtime = await getStage1WebRuntime();
  const row = await runtime.repositories.inboxProjection.setArchived(input);

  if (row === null) {
    return { ok: false, error: "inbox_contact_not_found" };
  }

  return { ok: true, contactId: input.contactId };
}
