const RAIL_EVENT_TIME_ZONE = "America/Denver";

function buildRailEventFormatters(timeZone: string) {
  return {
    sameYear: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone,
    }),
    withYear: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone,
    }),
    year: new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      timeZone,
    }),
  };
}

const RAIL_EVENT_FORMATTERS = buildRailEventFormatters(RAIL_EVENT_TIME_ZONE);
const UTC_RAIL_EVENT_FORMATTERS = buildRailEventFormatters("UTC");

function formatRailEventDateWithFormatters(
  occurredAt: string,
  referenceNowIso: string,
  formatters: ReturnType<typeof buildRailEventFormatters>,
): string {
  const occurred = new Date(occurredAt);
  const reference = new Date(referenceNowIso);
  const occurredYear = formatters.year.format(occurred);
  const referenceYear = formatters.year.format(reference);

  return occurredYear === referenceYear
    ? formatters.sameYear.format(occurred)
    : formatters.withYear.format(occurred);
}

/**
 * Returns "Apr 23" if `occurredAt` is in the same Mountain Time calendar year
 * as `referenceNowIso`, otherwise "Apr 23, 2025".
 */
export function formatRailEventDate(
  occurredAt: string,
  referenceNowIso: string,
): string {
  return formatRailEventDateWithFormatters(
    occurredAt,
    referenceNowIso,
    RAIL_EVENT_FORMATTERS,
  );
}

export function formatUtcRailEventDate(
  occurredAt: string,
  referenceNowIso: string,
): string {
  return formatRailEventDateWithFormatters(
    occurredAt,
    referenceNowIso,
    UTC_RAIL_EVENT_FORMATTERS,
  );
}
