export type FollowUpOverrides = ReadonlyMap<string, boolean>;

export function resolveNeedsFollowUp(
  contactId: string,
  seededNeedsFollowUp: boolean,
  overrides: FollowUpOverrides
): boolean {
  return overrides.get(contactId) ?? seededNeedsFollowUp;
}

export function toggleNeedsFollowUp(
  contactId: string,
  seededNeedsFollowUp: boolean,
  overrides: FollowUpOverrides
): FollowUpOverrides {
  const next = new Map(overrides);
  const effectiveNeedsFollowUp = resolveNeedsFollowUp(
    contactId,
    seededNeedsFollowUp,
    overrides
  );
  const nextNeedsFollowUp = !effectiveNeedsFollowUp;

  if (nextNeedsFollowUp === seededNeedsFollowUp) {
    next.delete(contactId);
  } else {
    next.set(contactId, nextNeedsFollowUp);
  }

  return next;
}
