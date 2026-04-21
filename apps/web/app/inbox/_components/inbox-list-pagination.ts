export function resolveAutoLoadInboxCursor(input: {
  readonly isIntersecting: boolean;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly isQueueLoading: boolean;
  readonly isFilterTransitionPending: boolean;
  readonly pendingCursor: string | null;
}): string | null {
  if (!input.isIntersecting) {
    return null;
  }

  if (!input.hasMore || input.nextCursor === null) {
    return null;
  }

  if (input.isQueueLoading || input.isFilterTransitionPending) {
    return null;
  }

  if (input.pendingCursor === input.nextCursor) {
    return null;
  }

  return input.nextCursor;
}
