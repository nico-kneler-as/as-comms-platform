import { revalidatePath, revalidateTag } from "next/cache";

function uniqueContactIds(contactIds: readonly string[]): string[] {
  return Array.from(
    new Set(contactIds.filter((contactId) => contactId.trim().length > 0))
  );
}

export function revalidateInboxViews(input?: {
  readonly contactIds?: readonly string[];
}): {
  readonly contactIds: readonly string[];
} {
  const contactIds = uniqueContactIds(input?.contactIds ?? []);

  revalidateTag("inbox");
  revalidatePath("/inbox");

  for (const contactId of contactIds) {
    revalidateTag(`inbox:contact:${contactId}`);
    revalidateTag(`timeline:contact:${contactId}`);
    revalidatePath(`/inbox/${encodeURIComponent(contactId)}`);
  }

  return {
    contactIds
  };
}

export function revalidateInboxContact(contactId: string): void {
  revalidateInboxViews({
    contactIds: [contactId]
  });
}
