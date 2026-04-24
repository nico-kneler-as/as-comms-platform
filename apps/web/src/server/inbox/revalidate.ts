export function revalidateInboxViews(input?: {
  readonly contactIds?: readonly string[];
}): {
  readonly contactIds: readonly string[];
} {
  const contactIds = Array.from(
    new Set((input?.contactIds ?? []).filter((id) => id.trim().length > 0))
  );
  // No-op under D-040: inbox pages are `force-dynamic`, so there is no
  // server cache to invalidate. Kept as the integration point for a
  // future event-driven invalidation upgrade if/when scale demands it.
  return { contactIds };
}

export function revalidateInboxContact(contactId: string): void {
  revalidateInboxViews({ contactIds: [contactId] });
}
