export type SyncFreshnessState =
  | "fresh"
  | "stale-30m"
  | "stale-2h"
  | "unknown";

const THIRTY_MINUTES_MS = 30 * 60 * 1_000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1_000;

export function classifySyncFreshness(input: {
  readonly lastSuccessAt: Date | null;
  readonly now: Date;
}): SyncFreshnessState {
  if (input.lastSuccessAt === null) {
    return "unknown";
  }

  const ageMs = input.now.getTime() - input.lastSuccessAt.getTime();

  if (ageMs <= THIRTY_MINUTES_MS) {
    return "fresh";
  }

  if (ageMs <= TWO_HOURS_MS) {
    return "stale-30m";
  }

  return "stale-2h";
}
