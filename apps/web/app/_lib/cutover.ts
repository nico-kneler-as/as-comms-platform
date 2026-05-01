/**
 * Platform "full capture" cutover line. Events with occurredAt before this
 * timestamp are hidden from operator views (timeline, message-history, AI
 * grounding) but remain in the database. Project memberships and other
 * non-event data are NOT subject to this filter.
 *
 * To move the line: change this constant. To disable: remove the filter at
 * each consumer (see callers).
 */
export const PLATFORM_FULL_CAPTURE_CUTOVER = "2025-01-01T00:00:00.000Z";

export function occurredAtIsOnOrAfterPlatformFullCaptureCutover(
  occurredAt: string,
): boolean {
  return occurredAt >= PLATFORM_FULL_CAPTURE_CUTOVER;
}

export function occurredAtIsBeforePlatformFullCaptureCutover(
  occurredAt: string,
): boolean {
  return occurredAt < PLATFORM_FULL_CAPTURE_CUTOVER;
}

export function filterItemsAtOrAfterPlatformFullCaptureCutover<
  T extends { readonly occurredAt: string },
>(items: readonly T[]): readonly T[] {
  return items.filter((item) =>
    occurredAtIsOnOrAfterPlatformFullCaptureCutover(item.occurredAt),
  );
}
