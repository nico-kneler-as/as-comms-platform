const RAIL_EVENT_TIME_ZONE = "America/Denver";

const RAIL_EVENT_FORMATTER_SAME_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: RAIL_EVENT_TIME_ZONE,
});

const RAIL_EVENT_FORMATTER_WITH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: RAIL_EVENT_TIME_ZONE,
});

const RAIL_EVENT_YEAR_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  timeZone: RAIL_EVENT_TIME_ZONE,
});

/**
 * Returns "Apr 23" if `occurredAt` is in the same Mountain Time calendar year
 * as `referenceNowIso`, otherwise "Apr 23, 2025".
 */
export function formatRailEventDate(
  occurredAt: string,
  referenceNowIso: string,
): string {
  const occurred = new Date(occurredAt);
  const reference = new Date(referenceNowIso);
  const occurredYear = RAIL_EVENT_YEAR_FORMATTER.format(occurred);
  const referenceYear = RAIL_EVENT_YEAR_FORMATTER.format(reference);

  return occurredYear === referenceYear
    ? RAIL_EVENT_FORMATTER_SAME_YEAR.format(occurred)
    : RAIL_EVENT_FORMATTER_WITH_YEAR.format(occurred);
}
